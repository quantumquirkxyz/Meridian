import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { recordExecution } from './record-execution.mjs';

const repoRoot = process.cwd();
const skillsRoot = path.join(repoRoot, '.agents', 'skills');
const lockPath = path.join(repoRoot, 'skills-lock.json');
const excludedDirs = new Set([
  'runs', 'node_modules', '.git', '.claude', '.bun', '.next', '.gradle',
  'dist', 'build', 'coverage', '.scratch', '.skill-sandbox', 'case-studies',
]);
const allowedRetiredTermFiles = new Set([
  'docs/agents/provenance.md',
]);

const retiredPatterns = [
  /\bask-matt\b/,
  /\bsetup-matt-pocock-skills\b/,
  /\bship-review-fix-loop\b/,
  /\bdoc-draft-pr\b/,
  /\bfrontend-development\b/,
  /\bimprove-codebase-architecture\b/,
  /\bARIES\b/,
  /\bMatt\b/,
];

const weakTemplatePatterns = [
  /A LONG/,
  /extremely extensive/,
  /point 1/,
  /Criterion 1/,
  /Acceptance criterion 1/,
  /localhost:3000/,
  /BE-2/,
  /OpenAPI spec/,
  /sharedInterests/,
];

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function walk(dir, predicate = () => true) {
  const out = [];
  if (!(await exists(dir))) return out;
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (excludedDirs.has(entry.name)) continue;
    const filePath = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(filePath, predicate));
    else if (entry.isFile() && predicate(filePath)) out.push(filePath);
  }
  return out;
}

async function scanRoots() {
  const roots = [skillsRoot];
  for (const rel of ['docs/agents', 'docs/adr']) {
    const dir = path.join(repoRoot, rel);
    if (await exists(dir)) roots.push(dir);
  }
  const standalone = [];
  for (const rel of ['.agents/AGENTS.md', 'AGENTS.md', 'CONTEXT.md', 'README.md']) {
    if (await exists(path.join(repoRoot, rel))) standalone.push(path.join(repoRoot, rel));
  }
  return { roots, standalone };
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

async function checkLinks(markdownFiles, errors) {
  const linkPattern = /\[[^\]]+\]\((?!https?:|mailto:|#)([^)]+)\)/g;
  for (const file of markdownFiles) {
    const text = await fs.readFile(file, 'utf8');
    let match;
    while ((match = linkPattern.exec(text))) {
      let target = match[1].split('#')[0];
      if (!target || target.startsWith('/')) continue;
      target = target.replace(/^<|>$/g, '');
      const fullPath = path.normalize(path.join(path.dirname(file), target));
      if (!(await exists(fullPath))) {
        errors.push(`${path.relative(repoRoot, file)} links to missing ${match[1]}`);
      }
    }
  }
}

async function main() {
  const warnings = [];
  const errors = [];
  const { roots, standalone } = await scanRoots();
  const markdownFiles = [];
  for (const root of roots) markdownFiles.push(...await walk(root, (file) => file.endsWith('.md')));
  markdownFiles.push(...standalone.filter((file) => file.endsWith('.md')));

  const shellFiles = await walk(skillsRoot, (name) => name.endsWith('.sh'));
  const skillFiles = await walk(skillsRoot, (name) => name.endsWith('SKILL.md'));
  const lock = JSON.parse(await fs.readFile(lockPath, 'utf8'));
  const lockSkills = lock.skills ?? {};
  const canonicalNames = new Set(Object.keys(lockSkills));
  const skillsByPath = new Map(skillFiles.map((file) => [path.basename(path.dirname(file)), file]));

  const scanList = async () => [...markdownFiles, ...shellFiles];
  for (const file of await scanList()) {
    const text = await fs.readFile(file, 'utf8');
    const relative = path.relative(repoRoot, file);
    for (const pattern of retiredPatterns) {
      if (!allowedRetiredTermFiles.has(relative) && pattern.test(text)) {
        errors.push(`${relative} contains retired term ${pattern}`);
      }
    }
    for (const pattern of weakTemplatePatterns) {
      if (pattern.test(text)) warnings.push(`${relative} contains weak template/example marker ${pattern}`);
    }
  }

  for (const file of skillFiles) {
    const text = await fs.readFile(file, 'utf8');
    const fm = parseFrontmatter(text);
    const name = path.basename(path.dirname(file));
    if (!canonicalNames.has(name)) continue;
    if (fm.name !== name) errors.push(`${name}: frontmatter name mismatch (${fm.name})`);
    for (const dependency of fm.dependencies ?? []) {
      if (!skillsByPath.has(dependency)) errors.push(`${name}: dependency missing ${dependency}`);
    }
    for (const effect of fm.sideEffects ?? []) {
      if (effect === 'write-code' && fm.risk === 'low') warnings.push(`${name}: write-code skill marked low risk`);
    }
    const hash = crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');
    if (lockSkills[name]?.hash !== hash) errors.push(`${name}: lock hash is stale`);
  }

  for (const name of canonicalNames) {
    if (!skillsByPath.has(name)) errors.push(`lockfile references missing skill ${name}`);
  }

  await checkLinks(markdownFiles, errors);

  const runPath = await recordExecution({
    repoRoot,
    skill: 'skill-audit',
    tool: 'skills:audit-semantics',
    contextPack: 'platform-semantic',
    status: errors.length ? 'fail' : 'pass',
    warnings,
    errors,
    extra: { markdownFiles: markdownFiles.length, skills: skillFiles.length },
  });

  console.log(JSON.stringify({
    skills: skillFiles.length,
    markdownFiles: markdownFiles.length,
    warnings,
    errors,
    status: errors.length ? 'fail' : 'pass',
    executionRecord: path.relative(repoRoot, runPath),
  }, null, 2));

  if (errors.length) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});