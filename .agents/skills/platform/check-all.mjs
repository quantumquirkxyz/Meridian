import { spawn } from 'node:child_process';

const checks = [
  ['node', ['.agents/skills/platform/validate-skills.mjs']],
  ['node', ['.agents/skills/platform/audit-semantics.mjs']],
  ['node', ['.agents/skills/platform/evaluate-scenarios.mjs']],
  ['node', ['.agents/skills/platform/evaluate-behavioral-fixtures.mjs']],
  ['node', ['--check', '.agents/skills/platform/audit-semantics.mjs']],
  ['node', ['--check', '.agents/skills/platform/evaluate-scenarios.mjs']],
  ['node', ['--check', '.agents/skills/platform/evaluate-behavioral-fixtures.mjs']],
  ['node', ['--check', '.agents/skills/platform/sync-bundle.mjs']],
  ['bash', ['-n', '.agents/skills/diagnosing-bugs/scripts/hitl-loop.template.sh']],
  ['node', ['--test', '.agents/skills/platform/tests/*.test.mjs']],
];

function run(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => {
      resolve({ command: [command, ...args].join(' '), code, stdout, stderr });
    });
  });
}

const results = [];
for (const [command, args] of checks) {
  results.push(await run(command, args));
}

const failures = results.filter((result) => result.code !== 0);

console.log(JSON.stringify({
  status: failures.length ? 'fail' : 'pass',
  checks: results.map((result) => ({
    command: result.command,
    status: result.code === 0 ? 'pass' : 'fail',
    code: result.code,
  })),
}, null, 2));

if (failures.length) {
  for (const failure of failures) {
    console.error(`\n${failure.command}`);
    if (failure.stdout.trim()) console.error(failure.stdout.trim());
    if (failure.stderr.trim()) console.error(failure.stderr.trim());
  }
  process.exit(1);
}
