import fs from 'node:fs/promises';
import path from 'node:path';
import { recordExecution } from './record-execution.mjs';

const repoRoot = process.cwd();
const fixturesRoot = path.join(repoRoot, '.agents', 'skills', 'evaluate-skill', 'behavioral-fixtures');

const fixtureChecks = {
  'spec-output.md': [
    '## Metadata',
    '## Problem Statement',
    '## Goals',
    '## Non-goals',
    '## Functional Requirements',
    '## Acceptance Criteria',
    '## Risks and Open Questions',
  ],
  'ticket-output.md': [
    '## Parent',
    '## What to build',
    '## Metadata',
    '## Acceptance criteria',
    '## Validation',
    '## Blocked by',
    '## Notes',
  ],
  'review-fix-plan-output.md': [
    '## Review Fix Plan',
    'Status: planned',
    'PR:',
    'Source review:',
    'Severity:',
    'Scope guard:',
  ],
  'pr-body-output.md': [
    '## Summary',
    '## Why',
    '## Impact',
    '## Validation',
    '## Review Focus',
    '## Development',
  ],
};

const forbidden = [
  'TODO',
  'point 1',
  'Criterion 1',
  'Acceptance criterion 1',
  'BE-2',
  'OpenAPI spec',
];

async function main() {
  const warnings = [];
  const errors = [];
  const results = [];

  for (const [fileName, required] of Object.entries(fixtureChecks)) {
    const filePath = path.join(fixturesRoot, fileName);
    const text = await fs.readFile(filePath, 'utf8').catch(() => null);
    if (text === null) {
      errors.push(`missing fixture ${fileName}`);
      continue;
    }
    for (const phrase of required) {
      if (!text.includes(phrase)) errors.push(`${fileName} missing "${phrase}"`);
    }
    for (const phrase of forbidden) {
      if (text.includes(phrase)) errors.push(`${fileName} contains forbidden placeholder "${phrase}"`);
    }
    results.push({ file: fileName, status: 'checked' });
  }

  const runPath = await recordExecution({
    repoRoot,
    skill: 'evaluate-skill',
    tool: 'skills:evaluate-behavioral-fixtures',
    contextPack: 'platform-behavioral-fixtures',
    status: errors.length ? 'fail' : 'pass',
    warnings,
    errors,
    extra: { fixtures: results.length, results },
  });

  console.log(JSON.stringify({
    fixtures: results.length,
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
