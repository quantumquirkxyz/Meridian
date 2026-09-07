import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const repoRoot = process.cwd();
const args = process.argv.slice(2);
const targetArg = args.find((arg) => !arg.startsWith('--'));
const write = args.includes('--write');
const force = args.includes('--force');

if (!targetArg) {
  console.error('Usage: node .agents/skills/platform/sync-bundle.mjs <target-repo> [--write] [--force]');
  process.exit(2);
}

const targetRoot = path.resolve(targetArg);
const copyEntries = [
  '.agents/AGENTS.md',
  '.agents/skills',
  'docs/agents',
  'docs/adr/README.md',
  'case-studies/README.md',
  'case-studies/template.md',
  'AUTHORSHIP.md',
  'CONTEXT.md',
  'README.md',
  'LICENSE',
  'VERSION',
  'CHANGELOG.md',
  'skills-lock.json',
];

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function hashFile(filePath) {
  return crypto.createHash('sha256').update(await fs.readFile(filePath)).digest('hex');
}

async function walk(filePath) {
  const stat = await fs.lstat(filePath);
  if (!stat.isDirectory()) return [filePath];
  const out = [];
  for (const entry of await fs.readdir(filePath)) {
    out.push(...await walk(path.join(filePath, entry)));
  }
  return out;
}

async function copyPath(source, target) {
  const stat = await fs.lstat(source);
  if (stat.isDirectory()) {
    await fs.mkdir(target, { recursive: true });
    for (const entry of await fs.readdir(source)) {
      await copyPath(path.join(source, entry), path.join(target, entry));
    }
    return;
  }
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.copyFile(source, target);
}

async function recreateClaudeLinks() {
  const claudeRoot = path.join(targetRoot, '.claude', 'skills');
  const skillsRoot = path.join(targetRoot, '.agents', 'skills');
  await fs.mkdir(claudeRoot, { recursive: true });
  for (const entry of await fs.readdir(skillsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'platform') continue;
    const linkPath = path.join(claudeRoot, entry.name);
    const linkTarget = '../../.agents/skills/' + entry.name;
    if (await exists(linkPath)) {
      const stat = await fs.lstat(linkPath);
      if (!stat.isSymbolicLink()) {
        if (!force) throw new Error(`Refusing to replace non-symlink ${linkPath}`);
        await fs.rm(linkPath, { recursive: true, force: true });
      } else {
        await fs.unlink(linkPath);
      }
    }
    await fs.symlink(linkTarget, linkPath);
  }
}

const planned = [];
const conflicts = [];

for (const relative of copyEntries) {
  const source = path.join(repoRoot, relative);
  if (!(await exists(source))) continue;
  for (const sourceFile of await walk(source)) {
    const relFile = path.relative(repoRoot, sourceFile);
    const targetFile = path.join(targetRoot, relFile);
    if (await exists(targetFile)) {
      const same = await hashFile(sourceFile) === await hashFile(targetFile).catch(() => '');
      if (!same && !force) conflicts.push(relFile);
    }
    planned.push(relFile);
  }
}

if (conflicts.length) {
  console.log(JSON.stringify({
    status: 'blocked',
    write,
    target: targetRoot,
    conflicts,
    note: 'Use --force with --write only after reviewing target-local changes.',
  }, null, 2));
  process.exit(1);
}

if (write) {
  for (const relative of copyEntries) {
    const source = path.join(repoRoot, relative);
    const target = path.join(targetRoot, relative);
    if (await exists(source)) await copyPath(source, target);
  }
  await recreateClaudeLinks();
}

console.log(JSON.stringify({
  status: 'pass',
  mode: write ? 'write' : 'dry-run',
  target: targetRoot,
  files: planned.length,
  note: write ? 'Bundle synced.' : 'No files written. Add --write to apply.',
}, null, 2));
