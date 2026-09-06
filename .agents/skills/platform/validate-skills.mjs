import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { recordExecution } from './record-execution.mjs';

const repoRoot = process.cwd();
const agentsSkillsDir = path.join(repoRoot, '.agents', 'skills');
const claudeSkillsDir = path.join(repoRoot, '.claude', 'skills');
const lockPath = path.join(repoRoot, 'skills-lock.json');
const excludedDirs = new Set(['runs', 'node_modules', '.git']);

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

function jaccardSimilarity(a, b) {
  const tokensA = new Set((a || '').split(/\s+/).filter(Boolean));
  const tokensB = new Set((b || '').split(/\s+/).filter(Boolean));
  if (!tokensA.size || !tokensB.size) return 0;
  let intersection = 0;
  for (const token of tokensA) if (tokensB.has(token)) intersection++;
  return intersection / (tokensA.size + tokensB.size - intersection);
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findSkillDirs(rootDir) {
  const out = [];
  async function walk(dir, rel) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (excludedDirs.has(entry.name)) continue;
      if (!entry.isDirectory()) continue;
      const full = path.join(dir, entry.name);
      const nextRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (await exists(path.join(full, 'SKILL.md'))) {
        out.push({ name: entry.name, rel: nextRel, dir: full });
      } else {
        await walk(full, nextRel);
      }
    }
  }
  await walk(rootDir, null);
  return out;
}

async function main() {
  const errors = [];
  const warnings = [];
  const lock = JSON.parse(await fs.readFile(lockPath, 'utf8'));
  const lockSkills = lock.skills ?? {};
  const canonicalNames = new Set(Object.keys(lockSkills));
  const skillDirs = await findSkillDirs(agentsSkillsDir);
  const skillNames = new Set(skillDirs.map((skill) => skill.name));

  for (const skill of skillDirs) {
    const name = skill.name;
    const skillMd = path.join(skill.dir, 'SKILL.md');
    const text = await fs.readFile(skillMd, 'utf8');

    const claudeLink = path.join(claudeSkillsDir, name);
    if (!(await exists(claudeLink))) {
      errors.push(`missing .claude link for ${name}`);
    } else {
      const stat = await fs.lstat(claudeLink);
      if (!stat.isSymbolicLink()) {
        errors.push(`.claude/${name} is not a symlink`);
      }
    }

    if (!canonicalNames.has(name)) {
      warnings.push(`reference skill ${name} has no lockfile entry; promoted skills are added by skill-promoter`);
      continue;
    }

    const fm = parseFrontmatter(text);
    if (fm.name !== name) errors.push(`${name}: frontmatter name mismatch (${fm.name})`);

    const allowedRisks = new Set(['low', 'medium', 'high']);
    if (!allowedRisks.has(fm.risk)) errors.push(`${name}: frontmatter risk must be low|medium|high (${fm.risk})`);

    const allowedTrustTiers = new Set(['1', '2', '3', '4']);
    if (!allowedTrustTiers.has(fm.trustTier)) errors.push(`${name}: frontmatter trustTier must be 1|2|3|4 (${fm.trustTier})`);
    else {
      const tier = Number(fm.trustTier);
      const inferred = fm.risk === 'low' ? (tier <= 2 ? null : 'low risk should be tier 1 or 2') : fm.risk === 'medium' ? (tier === 3 ? null : 'medium risk should be tier 3') : fm.risk === 'high' ? (tier === 4 ? null : 'high risk should be tier 4') : null;
      if (inferred) warnings.push(`${name}: ${inferred}`);
    }

    const body = text.replace(/^---[\s\S]*?---\s*/, '');
    const hasLoop = /\b(repeat|loop|until|passes|cycle|red-green|again)\b/i.test(body) && !/disable-model-invocation:\s*true/.test(text);
    if (hasLoop && !fm.maxIterations) {
      warnings.push(`${name}: skill has an implicit loop but maxIterations is not declared in frontmatter`);
    }
    if (fm.maxIterations && (!Number.isInteger(Number(fm.maxIterations)) || Number(fm.maxIterations) < 1)) {
      errors.push(`${name}: maxIterations must be a positive integer (${fm.maxIterations})`);
    }

    if ((fm.risk === 'medium' || fm.risk === 'high')) {
      const fixturesDir = path.join(skill.dir, 'behavioral-fixtures');
      const hasFixtures = await exists(fixturesDir) && (await fs.readdir(fixturesDir)).length > 0;
      if (!hasFixtures) {
        warnings.push(`${name}: risk=${fm.risk} but no behavioral-fixtures/ directory found; add fixtures or document why none are needed`);
      }
    }

    for (const dependency of fm.dependencies ?? []) {
      if (!skillNames.has(dependency)) errors.push(`${name}: dependency missing ${dependency}`);
    }
    for (const effect of fm.sideEffects ?? []) {
      if (effect === 'write-code' && fm.risk === 'low') warnings.push(`${name}: write-code skill marked low risk`);
    }

    const hash = crypto.createHash('sha256').update(await fs.readFile(skillMd)).digest('hex');
    if (lockSkills[name]?.hash !== hash) errors.push(`${name}: lock hash is stale`);
  }

  for (const name of canonicalNames) {
    if (!skillNames.has(name)) {
      errors.push(`lockfile references missing skill ${name}`);
    }
  }

  const skillManifests = [];
  for (const skill of skillDirs) {
    const text = await fs.readFile(path.join(skill.dir, 'SKILL.md'), 'utf8').catch(() => '');
    const fm = parseFrontmatter(text);
    skillManifests.push({ name: skill.name, description: (fm.description || '').toLowerCase(), capabilities: fm.capabilities ?? [] });
  }

  for (let i = 0; i < skillManifests.length; i++) {
    for (let j = i + 1; j < skillManifests.length; j++) {
      const a = skillManifests[i];
      const b = skillManifests[j];
      const sharedCapabilities = a.capabilities.filter((cap) => b.capabilities.includes(cap));
      if (sharedCapabilities.length === 0) continue;
      const descOverlap = jaccardSimilarity(a.description, b.description);
      if (descOverlap > 0.5) {
        warnings.push(`possible skill-shadowing: ${a.name} and ${b.name} share ${sharedCapabilities.length} capability(ies) (${sharedCapabilities.slice(0, 3).join(', ')}); description similarity ${(descOverlap * 100).toFixed(0)}%`);
      }
    }
  }

  const skills = skillDirs.length;
  const runPath = await recordExecution({
    repoRoot,
    skill: 'skill-audit',
    tool: 'skills:validate',
    contextPack: 'platform-default',
    status: errors.length ? 'fail' : 'pass',
    warnings,
    errors,
    extra: { skills },
  });

  console.log(JSON.stringify({
    skills,
    warnings,
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