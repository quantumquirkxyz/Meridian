import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

function run(args) {
  return spawnSync('node', args, { encoding: 'utf8' });
}

test('scenario evaluator passes on repository fixtures', () => {
  const result = run(['.agents/skills/platform/evaluate-scenarios.mjs']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, 'pass');
  assert.equal(payload.scenarios, 5);
});

test('semantic audit passes without warnings', () => {
  const result = run(['.agents/skills/platform/audit-semantics.mjs']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, 'pass');
  assert.deepEqual(payload.warnings, []);
});

test('sync bundle defaults to dry-run', () => {
  const target = fs.mkdtempSync('/tmp/qquirk-sync-test-');
  const result = run(['.agents/skills/platform/sync-bundle.mjs', target]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.mode, 'dry-run');
  assert.equal(fs.existsSync(`${target}/.agents`), false);
});
