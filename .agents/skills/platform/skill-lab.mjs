#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

const root = process.cwd();
const skillsRoot = path.join(root, '.agents', 'skills');
const sandboxRoot = path.join(root, '.skill-sandbox');
const required = ['name', 'description', 'version', 'capabilities', 'outputs'];
const labSkillNames = new Set([
  'contribution-workflow-optimizer',
  'integration-playground',
  'interactive-tutorial-builder',
  'rule-cataloger',
  'skill-dependency-graph',
  'skill-diff-analyzer',
  'skill-performance-metrics',
  'skill-template-generator',
  'skill-testing-framework',
]);

async function read(file) { return fs.readFile(file, 'utf8'); }
async function exists(file) { try { await fs.access(file); return true; } catch { return false; } }
function frontmatter(text) {
  const match = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  const data = {};
  if (!match) return data;
  let key;
  for (const line of match[1].split(/\r?\n/)) {
    const scalar = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    const item = line.match(/^\s+-\s+(.+)$/);
    if (scalar) {
      key = scalar[1];
      data[key] = scalar[2] ? scalar[2].replace(/^['"]|['"]$/g, '') : [];
    } else if (item && key) {
      if (!Array.isArray(data[key])) data[key] = [];
      data[key].push(item[1].replace(/^['"]|['"]$/g, ''));
    }
  }
  return data;
}
async function skillFiles(base = skillsRoot) {
  const entries = await fs.readdir(base, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === 'platform') continue;
    const file = path.join(base, entry.name, 'SKILL.md');
    if (await exists(file)) out.push(file);
  }
  return out.sort();
}
async function manifest(file) { return frontmatter(await read(file)); }
function listValue(value) { return Array.isArray(value) ? value : !value || value === '[]' ? [] : [value]; }
function json(value) { console.log(JSON.stringify(value, null, 2)); }
function optionValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1] ?? fallback;
}
function normalizedManifest(raw) {
  return {
    ...raw,
    capabilities: listValue(raw.capabilities),
    inputs: listValue(raw.inputs),
    outputs: listValue(raw.outputs),
    dependencies: listValue(raw.dependencies),
    sideEffects: listValue(raw.sideEffects),
  };
}
function parseJsonOption(name) {
  const value = optionValue(name);
  if (value === undefined) return undefined;
  try { return JSON.parse(value); } catch { throw new Error(`${name} must contain valid JSON`); }
}
function runCommand(command, args, cwd) {
  if (command !== 'node' && command !== process.execPath) {
    return Promise.reject(new Error('--command executable must be node'));
  }
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--permission', `--allow-fs-read=${cwd}`, `--allow-fs-write=${cwd}`, ...args], {
      cwd,
      env: { QQUIRK_PLAYGROUND: cwd, PATH: process.env.PATH ?? '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout = []; const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (exitCode) => resolve({
      command: [command, ...args],
      exitCode,
      stdout: Buffer.concat(stdout).toString(),
      stderr: Buffer.concat(stderr).toString(),
    }));
  });
}
function usage() {
  console.log(`skill-lab commands:
  template <name> [--domain domain] [--description text] [--capabilities JSON]
  validate [path] [--json]
  graph [--format mermaid|json]
  rules [--json]
  diff <old/SKILL.md> <new/SKILL.md>
  tutorial <skill-name|SKILL.md>
  metrics [runs-directory]
  playground [--output directory] [--fixtures JSON] [--command JSON]
  pr-check [--base ref]`);
}
async function template() {
  const name = process.argv[3];
  if (!name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) throw new Error('name must be kebab-case');
  const domain = optionValue('--domain', 'general');
  const description = optionValue('--description', `A focused skill for ${domain} workflows.`).replace(/\r?\n/g, ' ');
  const capabilities = parseJsonOption('--capabilities') ?? [`define-${name}-workflow`];
  if (!Array.isArray(capabilities) || capabilities.length === 0 || capabilities.some((capability) => typeof capability !== 'string' || !capability.trim())) {
    throw new Error('--capabilities must be a non-empty JSON array of non-empty strings');
  }
  const directory = path.join(sandboxRoot, name);
  await fs.mkdir(directory, { recursive: true });
  const file = path.join(directory, 'SKILL.md');
  if (await exists(file)) throw new Error(`refusing to overwrite ${file}`);
  await fs.writeFile(file, `---
name: ${name}
description: ${description}
version: 1
capabilities:
${capabilities.map((capability) => `  - ${capability}`).join('\n')}
inputs:
  - user-request
outputs:
  - ${name}-result
dependencies: []
sideEffects:
  - write-docs
stopCondition: The requested ${name} result is complete and its validation evidence is recorded.
risk: medium
trustTier: 3
maxIterations: 5
---

# ${name}

## Contract

- Input: user request and relevant repository context
- Output: a concrete ${name} result with validation evidence
- Boundary: solve one focused ${domain} problem

## Process

1. Clarify the input and success condition.
2. Perform the smallest safe analysis or change.
3. Report the output and evidence.

## Guardrails

- Preserve existing repository conventions.
- Surface uncertainty and failures explicitly.
`, 'utf8');
  json({ status: 'created', file: path.relative(root, file), sandboxSkill: path.relative(root, directory), completedFrontmatter: true, nextValidationCommand: `node .agents/skills/platform/skill-lab.mjs validate ${path.relative(root, directory)} --json` });
}
async function validate() {
  const requested = process.argv.slice(3).find((value) => !value.startsWith('--'));
  const files = requested
    ? [path.resolve(root, requested.endsWith('.md') ? requested : path.join(requested, 'SKILL.md'))]
    : await skillFiles();
  const names = new Set((await skillFiles()).map((file) => path.basename(path.dirname(file))));
  const results = [];
  for (const file of files) {
    const name = path.basename(path.dirname(file));
    const text = await read(file).catch(() => '');
    const fm = normalizedManifest(frontmatter(text));
    const errors = [];
    const warnings = [];
    for (const key of required) if (!fm[key] || (Array.isArray(fm[key]) && !fm[key].length)) errors.push(`missing ${key}`);
    if (requested || labSkillNames.has(name)) {
      for (const key of ['sideEffects', 'stopCondition', 'risk', 'trustTier']) {
        if (fm[key] === undefined) errors.push(`missing ${key}`);
      }
      if (fm.maxIterations === undefined) warnings.push(`missing maxIterations; required when skill body contains a repeat/loop`);
    }
    if (fm.trustTier && !['1', '2', '3', '4'].includes(String(fm.trustTier))) {
      errors.push(`trustTier must be 1|2|3|4 (${fm.trustTier})`);
    }
    if (fm.maxIterations && (!Number.isInteger(Number(fm.maxIterations)) || Number(fm.maxIterations) < 1)) {
      errors.push(`maxIterations must be a positive integer (${fm.maxIterations})`);
    }
    const allowedRisks = new Set(['low', 'medium', 'high']);
    if (!allowedRisks.has(fm.risk)) errors.push(`risk must be low|medium|high (${fm.risk})`);
    const tierRiskMap = { low: [1, 2], medium: [3], high: [4] };
    if (fm.trustTier && fm.risk && !tierRiskMap[fm.risk]?.includes(Number(fm.trustTier))) {
      warnings.push(`trustTier ${fm.trustTier} does not match risk ${fm.risk} (expected ${tierRiskMap[fm.risk].join('|')})`);
    }
    if (fm.name !== name) errors.push(`frontmatter name must be ${name}`);
    const body = text.replace(/^---[\s\S]*?---\s*/, '');
    const contractRequired = Boolean(requested) || labSkillNames.has(name);
    if (contractRequired) {
      const contractStart = body.indexOf('## Contract');
      const nextHeading = contractStart === -1 ? -1 : body.indexOf('\n## ', contractStart + 10);
      const contractBody = contractStart === -1 ? '' : body.slice(contractStart, nextHeading === -1 ? body.length : nextHeading);
      if (contractStart === -1) errors.push('missing ## Contract section');
      else {
        for (const field of ['Input:', 'Output:', 'Boundary:']) {
          if (!contractBody.includes(field)) errors.push(`Contract missing ${field}`);
        }
      }
    }
    if (!/^#\s+/.test(body)) warnings.push('missing Markdown title');
    for (const dependency of listValue(fm.dependencies)) {
      if (!names.has(dependency)) errors.push(`unknown dependency ${dependency}`);
    }
    for (const pattern of [/TODO\b/i, /replace this/i, /lorem ipsum/i]) {
      if (pattern.test(text)) warnings.push(`anti-pattern: ${pattern}`);
    }
    if (listValue(fm.sideEffects).includes('write-code') && fm.risk === 'low') warnings.push('write-code should not be low risk');
    results.push({ skill: name, file: path.relative(root, file), status: errors.length ? 'fail' : 'pass', errors, warnings });
  }
  const execution = [];
  if (process.argv.includes('--execute') && requested?.includes('.skill-sandbox')) {
    const validationScript = path.join(root, '.skill-sandbox', 'validations', 'validate-sandbox-skills.mjs');
    if (await exists(validationScript)) execution.push(await runProcess('node', [validationScript], root));
    const behavioralScript = path.join(root, '.agents', 'skills', 'platform', 'evaluate-behavioral-fixtures.mjs');
    const fixtureDir = path.join(root, '.skill-sandbox', 'behavioral-fixtures');
    if (await exists(behavioralScript) && await exists(fixtureDir)) {
      execution.push(await runProcess('node', [behavioralScript], root));
    }
    function runProcess(command, args, cwd) {
      return new Promise((resolve, reject) => {
        const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
        const stdout = []; const stderr = [];
        child.stdout.on('data', (chunk) => stdout.push(chunk));
        child.stderr.on('data', (chunk) => stderr.push(chunk));
        child.on('error', reject);
        child.on('close', (exitCode) => resolve({
          command: [command, ...args],
          exitCode,
          stdout: Buffer.concat(stdout).toString(),
          stderr: Buffer.concat(stderr).toString(),
        }));
      });
    }
  }
  const report = {
    status: results.some((item) => item.status === 'fail') || execution.some((item) => item.exitCode !== 0) ? 'fail' : 'pass',
    results,
    execution,
  };
  if (process.argv.includes('--json')) json(report);
  else console.log(`${report.status}: ${results.length} skill(s), ${results.filter((item) => item.status === 'fail').length} failure(s)`);
  if (report.status === 'fail') process.exitCode = 1;
}
async function graph() {
  const nodes = await Promise.all((await skillFiles()).map(async (file) => ({ name: path.basename(path.dirname(file)), dependencies: listValue((await manifest(file)).dependencies) })));
  const incoming = new Map(nodes.map((node) => [node.name, 0]));
  for (const node of nodes) for (const dependency of node.dependencies) incoming.set(dependency, (incoming.get(dependency) ?? 0) + 1);
  const centralSkills = [...incoming].filter(([, count]) => count > 0).sort((a, b) => b[1] - a[1]).map(([skill, dependents]) => ({ skill, dependents }));
  const modularityFindings = centralSkills.filter(({ dependents }) => dependents >= 5).map(({ skill, dependents }) => `${skill} has ${dependents} dependents; review whether its contract is too broad.`);
  if (optionValue('--format', 'mermaid') === 'json') return json({ nodes, cycles: findCycles(nodes), centralSkills, modularityFindings });
  console.log('graph TD');
  for (const node of nodes) for (const dep of node.dependencies) console.log(`  ${node.name} --> ${dep}`);
  if (centralSkills.length) console.log(`  %% central skills: ${centralSkills.slice(0, 5).map(({ skill }) => skill).join(', ')}`);
}
function findCycles(nodes) {
  const edges = new Map(nodes.map((node) => [node.name, node.dependencies]));
  const cycles = new Map();
  function visit(name, stack) {
    if (stack.includes(name)) {
      const cycle = stack.slice(stack.indexOf(name));
      const rotations = cycle.map((_, index) => cycle.slice(index).concat(cycle.slice(0, index)));
      const canonical = rotations.sort().at(0).join(' -> ');
      cycles.set(canonical, [...rotations[0], rotations[0][0]]);
      return;
    }
    for (const dep of edges.get(name) ?? []) visit(dep, [...stack, name]);
  }
  for (const name of edges.keys()) visit(name, []);
  return [...cycles.values()];
}
async function rules() {
  const counts = new Map();
  const bySkill = [];
  for (const file of await skillFiles()) {
    const text = await read(file);
    const rulesFound = text.split(/\r?\n/).filter((line) => /^\s*-\s+Rule:\s*/i.test(line) || /^\s*-\s+.+\bmust\b/i.test(line));
    const skill = path.basename(path.dirname(file));
    const rules = rulesFound.map((line) => line.replace(/^\s*-\s+/, ''));
    bySkill.push({ skill, rules });
    for (const rule of rules) {
      const current = counts.get(rule) ?? { frequency: 0, sources: [] };
      current.frequency += 1;
      current.sources.push(skill);
      counts.set(rule, current);
    }
  }
  const catalog = [...counts].sort((a, b) => b[1].frequency - a[1].frequency).map(([rule, data]) => ({
  rule,
  frequency: data.frequency,
  sources: data.sources,
  type: /structure|frontmatter|format/i.test(rule) ? 'structure' : /test|valid|evidence|quality/i.test(rule) ? 'quality' : 'process',
  applicationArea: /test|valid|fixture|evidence/i.test(rule) ? 'testing' : /doc|report|artifact/i.test(rule) ? 'documentation' : 'implementation',
  }));
  const result = { catalog, bySkill };
  if (process.argv.includes('--json')) json(result);
  else console.table(catalog);
}
async function diff() {
  const oldFile = process.argv[3]; const newFile = process.argv[4];
  if (!oldFile || !newFile) throw new Error('diff requires old and new SKILL.md paths');
  const oldText = await read(path.resolve(root, oldFile)); const newText = await read(path.resolve(root, newFile));
  const oldFm = frontmatter(oldText); const newFm = frontmatter(newText);
  const fields = [...new Set([...Object.keys(oldFm), ...Object.keys(newFm)])];
  const changes = fields.filter((field) => JSON.stringify(oldFm[field]) !== JSON.stringify(newFm[field])).map((field) => ({ field, from: oldFm[field] ?? null, to: newFm[field] ?? null }));
  function lineDelta(before, after) {
    const counts = new Map();
    for (const line of after) counts.set(line, (counts.get(line) ?? 0) + 1);
    return before.filter((line) => {
      const count = counts.get(line) ?? 0;
      if (count > 0) { counts.set(line, count - 1); return false; }
      return true;
    }).slice(0, 20);
  }
  const removed = lineDelta(oldText.split(/\r?\n/), newText.split(/\r?\n/));
  const added = lineDelta(newText.split(/\r?\n/), oldText.split(/\r?\n/));
  json({ status: 'complete', changes, added, removed, impact: changes.some((item) => ['dependencies', 'sideEffects', 'risk'].includes(item.field)) ? 'review-required' : 'low' });
}
async function tutorial() {
  const requested = process.argv[3]; if (!requested) throw new Error('tutorial requires a skill name');
  const file = requested.endsWith('.md') ? path.resolve(root, requested) : path.join(skillsRoot, requested, 'SKILL.md');
  const fm = normalizedManifest(await manifest(file));
  const learnerContext = optionValue('--learner-context', 'a contributor learning the quirk method');
  console.log(`# Tutorial: ${fm.name}\n\n${fm.description}\n\n## Learner context\n\n${learnerContext}\n\n## Learning goals\n\n${listValue(fm.capabilities).map((x) => `- ${x}`).join('\n')}\n\n## Exercise\n\nProvide an input satisfying: ${listValue(fm.inputs).join(', ') || 'the documented contract'}.\n\n## Expected result\n\n${listValue(fm.outputs).map((x) => `- ${x}`).join('\n')}\n\n## Checkpoint\n\n${fm.stopCondition || 'Confirm the output and validation evidence.'}\n\n## Learner response\n\nRecord the input, output, and validation evidence before continuing.\n`);
}
async function metrics() {
  const directory = path.resolve(root, process.argv[3] ?? '.agents/skills/platform/runs');
  const files = (await fs.readdir(directory).catch(() => [])).filter((file) => file.endsWith('.json'));
  const records = [];
  for (const file of files) {
    const data = JSON.parse(await read(path.join(directory, file)));
    const recordedDuration = data.finishedAt && data.startedAt
      ? Date.parse(data.finishedAt) - Date.parse(data.startedAt)
      : undefined;
    const duration = Number(data.durationMs ?? data.duration ?? data.metrics?.durationMs ?? recordedDuration);
    if (Number.isFinite(duration)) records.push({ file, status: data.status, durationMs: duration });
  }
  const average = records.length ? records.reduce((sum, x) => sum + x.durationMs, 0) / records.length : 0;
  const skillComplexity = [];
  for (const file of await skillFiles()) {
    const text = await read(file);
    const fm = normalizedManifest(frontmatter(text));
    skillComplexity.push({
      skill: fm.name,
      cognitiveComplexity: text.split(/\r?\n/).length + listValue(fm.capabilities).length * 2 + listValue(fm.dependencies).length * 3,
    });
  }
  json({ samples: records.length, durationAvailable: records.length > 0, averageDurationMs: records.length ? Math.round(average) : null, successRate: records.length ? records.filter((x) => ['pass', 'success'].includes(x.status)).length / records.length : null, skillComplexity, records });
}
async function playground() {
  const output = path.resolve(root, optionValue('--output', path.join(os.tmpdir(), 'quirk-skill-playground')));
  if (output === root || !output.startsWith(`${os.tmpdir()}${path.sep}`)) throw new Error('output must be a disposable directory under the system temp directory');
  const tempRoot = await fs.realpath(os.tmpdir());
  const outputParent = await fs.realpath(path.dirname(output));
  if (outputParent !== tempRoot && !outputParent.startsWith(`${tempRoot}${path.sep}`)) throw new Error('output must resolve under the system temp directory');
  try {
    await fs.access(output);
    throw new Error('output directory already exists; choose a new disposable directory');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await fs.mkdir(path.join(output, 'filesystem'), { recursive: true });
  const fixtures = parseJsonOption('--fixtures') ?? { filesystem: 'isolated fixture\n', api: { status: 'ok', items: [] }, database: { users: [{ id: 1, name: 'fixture-user' }] } };
  await fs.writeFile(path.join(output, 'filesystem', 'fixture.txt'), String(fixtures.filesystem ?? 'isolated fixture\n'));
  await fs.writeFile(path.join(output, 'api.json'), JSON.stringify(fixtures.api ?? { status: 'ok', items: [] }, null, 2));
  await fs.writeFile(path.join(output, 'database.json'), JSON.stringify(fixtures.database ?? { users: [] }, null, 2));
  const command = parseJsonOption('--command');
  let result = { status: 'created', output: path.relative(root, output), command: null };
  if (command) {
    if (!Array.isArray(command) || typeof command[0] !== 'string' || command.some((part) => typeof part !== 'string')) throw new Error('--command must be a JSON array of executable and arguments');
    const child = await runCommand(command[0], command.slice(1), output);
    result = { ...result, status: child.exitCode === 0 ? 'pass' : 'fail', ...child };
  }
  json(result);
}
async function prCheck() {
  const { stdout } = await new Promise((resolve, reject) => {
    const child = spawn('git', ['diff', '--name-only', `${optionValue('--base', 'HEAD~1')}...HEAD`], { cwd: root });
    let out = ''; child.stdout.on('data', (x) => { out += x; }); child.on('close', (code) => code ? reject(new Error('git diff failed')) : resolve({ stdout: out }));
  });
  const changed = stdout.split(/\r?\n/).filter((file) => /SKILL\.md$/.test(file));
  const validation = changed.length ? 'Run skill-lab validate on each changed skill.' : 'No skill files changed.';
  json({ changedSkills: changed, checks: ['contract/frontmatter', 'documentation', 'dependencies', 'examples'], recommendation: validation });
}

const command = process.argv[2];
try {
  if (command === 'template') await template();
  else if (command === 'validate') await validate();
  else if (command === 'graph') await graph();
  else if (command === 'rules') await rules();
  else if (command === 'diff') await diff();
  else if (command === 'tutorial') await tutorial();
  else if (command === 'metrics') await metrics();
  else if (command === 'playground') await playground();
  else if (command === 'pr-check') await prCheck();
  else usage();
} catch (error) { console.error(error.message); process.exitCode = 1; }
