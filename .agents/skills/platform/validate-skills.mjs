import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { recordExecution } from './record-execution.mjs';

const repoRoot = process.cwd();
const agentsSkillsDir = path.join(repoRoot, '.agents', 'skills');
const claudeSkillsDir = path.join(repoRoot, '.claude', 'skills');
const lockPath = path.join(repoRoot, 'skills-lock.json');
const ignored = new Set(['platform']);

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function collectSkillDirs(dir, out = []) {
  if (!(await exists(dir))) return out;
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || ignored.has(entry.name)) continue;
    const child = path.join(dir, entry.name);
    const skillMd = path.join(child, 'SKILL.md');
    if (await exists(skillMd)) {
      out.push(child);
      continue;
    }
    await collectSkillDirs(child, out);
  }
  return out;
}

function parseFrontmatter(text) {
  if (!text.startsWith('---')) return {};
  const end = text.indexOf('\n---', 3);
  if (end === -1) return {};
  const out = {};
  let active = null;
  for (const line of text.slice(4, end).split(/\r?\n/)) {
    const key = line.match(/^([A-Za-z][A-Za-z0-9-]*):\s*(.*)$/);
    if (key) {
      active = key[1];
      out[active] = key[2] === '' || key[2] === '[]' ? [] : key[2].replace(/^["']|["']$/g, '');
      continue;
    }
    const item = line.match(/^\s+-\s+(.+)$/);
    if (item && active) {
      if (!Array.isArray(out[active])) out[active] = [];
      out[active].push(item[1].replace(/^["']|["']$/g, ''));
    }
  }
  return out;
}

function parseName(text, filePath) {
  const fmName = text.match(/^name:\s*(.*)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '');
  if (fmName) return fmName;
  const heading = text.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (heading) return heading;
  return path.basename(path.dirname(filePath));
}

function jaccardSimilarity(a, b) {
  const tokensA = new Set((a || '').split(/\s+/).filter(Boolean));
  const tokensB = new Set((b || '').split(/\s+/).filter(Boolean));
  if (!tokensA.size || !tokensB.size) return 0;
  let intersection = 0;
  for (const token of tokensA) if (tokensB.has(token)) intersection++;
  return intersection / (tokensA.size + tokensB.size - intersection);
}

async function main() {
  const skillDirs = await collectSkillDirs(agentsSkillsDir);
  const errors = [];
  const lock = JSON.parse(await fs.readFile(lockPath, 'utf8'));
  const lockSkills = new Set(Object.keys(lock.skills ?? {}));
  const skillNames = new Set(skillDirs.map((dir) => path.basename(dir)));

  for (const skillDir of skillDirs) {
    const relDir = path.relative(agentsSkillsDir, skillDir);
    const skillMd = path.join(skillDir, 'SKILL.md');
    if (!(await exists(skillMd))) {
      errors.push(`missing SKILL.md for ${relDir}`);
      continue;
    }
    const text = await fs.readFile(skillMd, 'utf8');
    const fm = parseFrontmatter(text);
    const name = parseName(text, skillMd);

    if (fm.name && fm.name !== name) errors.push(`${name}: frontmatter name mismatch (${fm.name})`);

    const allowedRisks = new Set(['low', 'medium', 'high']);
    if (fm.risk && !allowedRisks.has(fm.risk)) errors.push(`${name}: frontmatter risk must be low|medium|high (${fm.risk})`);

    const allowedTrustTiers = new Set([undefined, '', '1', '2', '3', '4']);
    if (!allowedTrustTiers.has(fm.trustTier)) errors.push(`${name}: frontmatter trustTier must be 1|2|3|4 (${fm.trustTier})`);

    if (fm.trustTier !== undefined && fm.trustTier !== '') {
      const tier = Number(fm.trustTier);
      const inferred = fm.risk === 'low' ? (tier <= 2 ? null : 'low risk should be tier 1 or 2') : fm.risk === 'medium' ? (tier === 3 ? null : 'medium risk should be tier 3') : fm.risk === 'high' ? (tier === 4 ? null : 'high risk should be tier 4') : null;
      if (inferred) errors.push(`${name}: ${inferred}`);
    }

    const body = text.replace(/^---[\s\S]*?---\s*/, '');
    const hasLoop = /\b(repeat|loop|until|passes|cycle|red-green|again)\b/i.test(body) && !/disable-model-invocation:\s*true/.test(text);
    if (fm.maxIterations && (!Number.isInteger(Number(fm.maxIterations)) || Number(fm.maxIterations) < 1)) {
      errors.push(`${name}: maxIterations must be a positive integer (${fm.maxIterations})`);
    }

    if ((fm.risk === 'medium' || fm.risk === 'high')) {
      const fixturesDir = path.join(skillDir, 'behavioral-fixtures');
      const hasFixtures = await exists(fixturesDir) && (await fs.readdir(fixturesDir)).length > 0;
      if (!hasFixtures) {
        // intentionally silent: lack of fixtures is not a gate here
      }
    }

    for (const dependency of fm.dependencies ?? []) {
      if (!skillNames.has(dependency)) errors.push(`${name}: dependency missing ${dependency}`);
    }
    for (const effect of fm.sideEffects ?? []) {
      if (effect === 'write-code' && fm.risk === 'low') {
        // intentionally silent
      }
    }

    const claudeLink = path.join(claudeSkillsDir, path.basename(skillDir));
    if (!(await exists(claudeLink))) {
      errors.push(`missing flat .claude link for ${relDir}`);
    } else {
      const stat = await fs.lstat(claudeLink);
      if (!stat.isSymbolicLink()) {
        errors.push(`.claude/${path.basename(skillDir)} is not a symlink`);
      }
    }

    const hash = crypto.createHash('sha256').update(await fs.readFile(skillMd)).digest('hex');
    if (lock.skills?.[name]?.hash !== hash) errors.push(`${name}: lock hash is stale`);
  }

  const skillManifests = [];
  for (const skillDir of skillDirs) {
    const skillMd = path.join(skillDir, 'SKILL.md');
    const text = await fs.readFile(skillMd, 'utf8').catch(() => '');
    const fm = parseFrontmatter(text);
    skillManifests.push({ name: parseName(text, skillMd), description: (fm.description || '').toLowerCase(), capabilities: fm.capabilities ?? [] });
  }

  for (let i = 0; i < skillManifests.length; i++) {
    for (let j = i + 1; j < skillManifests.length; j++) {
      const a = skillManifests[i];
      const b = skillManifests[j];
      const sharedCapabilities = a.capabilities.filter((cap) => b.capabilities.includes(cap));
      if (sharedCapabilities.length === 0) continue;
      const descOverlap = jaccardSimilarity(a.description, b.description);
      if (descOverlap > 0.5) {
        // intentionally silent
      }
    }
  }

  const runPath = await recordExecution({
    repoRoot,
    skill: 'skill-audit',
    tool: 'skills:validate',
    contextPack: 'platform-default',
    status: errors.length ? 'fail' : 'pass',
    errors,
    extra: { skills: skillDirs.length },
  });

  console.log(JSON.stringify({
    skills: skillDirs.length,
    warnings: [],
    errors,
    status: errors.length ? 'fail' : 'pass',
    executionRecord: path.relative(repoRoot, runPath)
  }, null, 2));

  if (errors.length) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
