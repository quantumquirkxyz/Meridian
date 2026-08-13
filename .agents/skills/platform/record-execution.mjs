import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export async function recordExecution({
  repoRoot,
  skill,
  tool,
  contextPack,
  status,
  warnings = [],
  errors = [],
  extra = {},
}) {
  const runsDir = path.join(repoRoot, '.agents', 'skills', 'platform', 'runs');
  const startedAt = new Date().toISOString();
  const record = {
    id: crypto.randomUUID(),
    skill,
    tool,
    startedAt,
    finishedAt: new Date().toISOString(),
    contextPack,
    status,
    warnings,
    errors,
    ...extra,
  };
  await fs.mkdir(runsDir, { recursive: true });
  const runPath = path.join(runsDir, `${record.startedAt.replace(/[:.]/g, '-')}-${record.id}.json`);
  await fs.writeFile(runPath, JSON.stringify(record, null, 2) + '\n');
  return runPath;
}

