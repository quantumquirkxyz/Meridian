import fs from 'node:fs/promises';
import path from 'node:path';
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

async function main() {
  const entries = await fs.readdir(agentsSkillsDir, { withFileTypes: true });
  const skillDirs = entries.filter((entry) => entry.isDirectory() && !ignored.has(entry.name));
  const errors = [];
  const warnings = [];
  const lock = JSON.parse(await fs.readFile(lockPath, 'utf8'));
  const lockSkills = new Set(Object.keys(lock.skills ?? {}));

  for (const entry of skillDirs) {
    const skillDir = path.join(agentsSkillsDir, entry.name);
    const skillMd = path.join(skillDir, 'SKILL.md');
    if (!(await exists(skillMd))) {
      errors.push(`missing SKILL.md for ${entry.name}`);
    }
    const claudeLink = path.join(claudeSkillsDir, entry.name);
    if (!(await exists(claudeLink))) {
      errors.push(`missing .claude link for ${entry.name}`);
    } else {
      const stat = await fs.lstat(claudeLink);
      if (!stat.isSymbolicLink()) {
        errors.push(`.claude/${entry.name} is not a symlink`);
      }
    }
    if (!lockSkills.has(entry.name)) {
      warnings.push(`lockfile missing local entry for ${entry.name}`);
    }
  }

  for (const name of lockSkills) {
    const localSkill = path.join(agentsSkillsDir, name);
    if (!(await exists(localSkill))) {
      errors.push(`lockfile references missing skill ${name}`);
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
