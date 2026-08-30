import fs from 'node:fs/promises';
import path from 'node:path';
import { recordExecution } from './record-execution.mjs';

const repoRoot = process.cwd();
const skillsRoot = path.join(repoRoot, '.agents', 'skills');
const scenariosDir = path.join(skillsRoot, 'evaluate-skill', 'scenarios');

function frontmatterValue(text, key) {
  const match = text.match(new RegExp(`^${key}:\\s*(.*)$`, 'm'));
  return match ? match[1].trim().replace(/^["']|["']$/g, '') : '';
}

function frontmatterList(text, key) {
  const start = text.indexOf('---');
  const end = text.indexOf('\n---', 3);
  if (start !== 0 || end === -1) return [];
  const lines = text.slice(4, end).split(/\r?\n/);
  const values = [];
  let active = false;
  for (const line of lines) {
    const keyMatch = line.match(/^([A-Za-z][A-Za-z0-9-]*):/);
    if (keyMatch) active = keyMatch[1] === key;
    else if (active) {
      const item = line.match(/^\s+-\s+(.+)$/);
      if (item) values.push(item[1].replace(/^["']|["']$/g, ''));
    }
  }
  return values;
}

async function readSkill(skillName) {
  const skillPath = path.join(skillsRoot, skillName, 'SKILL.md');
  const text = await fs.readFile(skillPath, 'utf8');
  return {
    path: skillPath,
    text,
    sideEffects: frontmatterList(text, 'sideEffects'),
    name: frontmatterValue(text, 'name'),
  };
}

async function scenarioFiles() {
  const entries = await fs.readdir(scenariosDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => path.join(scenariosDir, entry.name))
    .sort();
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const warnings = [];
  const errors = [];
  const results = [];

  for (const file of await scenarioFiles()) {
    const scenario = JSON.parse(await fs.readFile(file, 'utf8'));
    const scenarioResult = { id: scenario.id, checks: [] };

    for (const skillName of scenario.expectedRoute ?? []) {
      if (!(await exists(path.join(skillsRoot, skillName, 'SKILL.md')))) {
        errors.push(`${scenario.id}: expected route references missing skill ${skillName}`);
      }
    }

    for (const check of scenario.checks ?? []) {
      const skill = await readSkill(check.skill).catch(() => null);
      if (!skill) {
        errors.push(`${scenario.id}: check references missing skill ${check.skill}`);
        continue;
      }
      if (skill.name !== check.skill) {
        errors.push(`${scenario.id}: ${check.skill} frontmatter name is ${skill.name}`);
      }
      for (const phrase of check.mustMention ?? []) {
        if (!skill.text.includes(phrase)) {
          errors.push(`${scenario.id}: ${check.skill} missing phrase "${phrase}"`);
        }
      }
      for (const phrase of check.forbid ?? []) {
        if (skill.text.includes(phrase)) {
          errors.push(`${scenario.id}: ${check.skill} contains forbidden phrase "${phrase}"`);
        }
      }
      for (const effect of check.expectedSideEffects ?? []) {
        if (!skill.sideEffects.includes(effect)) {
          errors.push(`${scenario.id}: ${check.skill} missing sideEffect ${effect}`);
        }
      }
      for (const ref of check.requiredReferences ?? []) {
        const refPath = path.join(skillsRoot, check.skill, ref);
        if (!(await exists(refPath))) {
          errors.push(`${scenario.id}: ${check.skill} missing reference ${ref}`);
        }
      }
      scenarioResult.checks.push({ skill: check.skill, status: 'checked' });
    }

    if (!scenario.expectedRoute?.length) {
      warnings.push(`${scenario.id}: scenario has no expectedRoute`);
    }
    results.push(scenarioResult);
  }

  const runPath = await recordExecution({
    repoRoot,
    skill: 'evaluate-skill',
    tool: 'skills:evaluate-scenarios',
    contextPack: 'platform-scenarios',
    status: errors.length ? 'fail' : 'pass',
    warnings,
    errors,
    extra: { scenarios: results.length, results },
  });

  console.log(JSON.stringify({
    scenarios: results.length,
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
