import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { recordExecution } from './record-execution.mjs';

const repoRoot = process.cwd();
const skillsRoot = path.join(repoRoot, '.agents', 'skills');
const docsRoot = path.join(repoRoot, 'docs');
const lockPath = path.join(repoRoot, 'skills-lock.json');
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
    const filePath = path.join(dir, entry.name);
    if (filePath.includes(`${path.sep}platform${path.sep}runs${path.sep}`)) continue;
    if (entry.isDirectory()) out.push(...await walk(filePath, predicate));
    else if (entry.isFile() && predicate(filePath)) out.push(filePath);
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
  const markdownFiles = await walk(repoRoot, (file) => file.endsWith('.md'));
  const skillFiles = await walk(skillsRoot, (file) => file.endsWith('SKILL.md'));
  const lock = JSON.parse(await fs.readFile(lockPath, 'utf8'));
  const skillNames = new Set(skillFiles.map((file) => path.basename(path.dirname(file))));

  for (const file of [...markdownFiles, ...await walk(skillsRoot, (name) => name.endsWith('.sh'))]) {
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
    if (fm.name !== name) errors.push(`${name}: frontmatter name mismatch (${fm.name})`);
    for (const dependency of fm.dependencies ?? []) {
      if (!skillNames.has(dependency)) errors.push(`${name}: dependency missing ${dependency}`);
    }
    for (const effect of fm.sideEffects ?? []) {
      if (effect === 'write-code' && fm.risk === 'low') warnings.push(`${name}: write-code skill marked low risk`);
    }
    const hash = crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');
    if (lock.skills?.[name]?.hash !== hash) errors.push(`${name}: lock hash is stale`);
  }

  for (const name of Object.keys(lock.skills ?? {})) {
    if (!skillNames.has(name)) errors.push(`lockfile references missing skill ${name}`);
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
