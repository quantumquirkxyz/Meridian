---
name: integration-playground
description: Create a disposable fixture environment for safely exercising Skills against local APIs, data, and files; use when testing a Skill with isolated local fixtures.
version: 1
capabilities:
  - create-isolated-fixtures
  - run-sandboxed-command
  - preserve-playground-evidence
inputs:
  - fixture-definition
  - command
  - output-directory
outputs:
  - playground-directory
  - execution-result
  - stdout-and-stderr
dependencies:
  - skill-sandbox
sideEffects:
  - write-files
stopCondition: The command ran in the disposable fixture directory and its exit status and output are recorded.
risk: low
trustTier: 2
---

# Integration Playground

## Contract

- Input: JSON fixture definition, an optional executable plus argument array, and a temporary output directory.
- Output: disposable playground directory; when a command is supplied, its exit status, stdout, stderr, and command evidence.
- Boundary: output must be under the system temporary directory; only Node.js commands run with a minimal environment and commands never pass through a shell.

Run `node .agents/skills/platform/skill-lab.mjs playground --output /tmp/quirk-playground --fixtures '{"api":{"status":"ok"}}' --command '["node","script.mjs"]'`. Never point it at a production directory or pass credentials into a playground command.
