---
name: skill-audit
description: Audit the Skills bundle, lockfile, symlink parity, and contract drift.
disable-model-invocation: true
version: 1
capabilities:
  - audit-skills
  - validate-parity
  - detect-contract-drift
inputs:
  - skills bundle
  - lockfile
  - symlink tree
  - platform schemas
outputs:
  - audit report
  - warnings
  - errors
dependencies:
sideEffects:
  - read-only
stopCondition: Bundle parity, lock coverage, and contract drift have been checked.
risk: low
---

# Skill Audit

Use this skill to verify the repository-local Skills platform.

## Contract

- Input: the local Skills bundle, lockfile, symlink tree, and platform schemas.
- Output: a concise audit report with warnings and errors ranked by impact.
- Scope: verify bundle health; do not modify the skills during the audit.
- Rule: report parity, lock coverage, and contract drift separately.
- Rule: treat validator output as evidence, not as the audit itself.

## Steps

1. Run the platform validator in `.agents/skills/platform/validate-skills.mjs`.
2. Inspect the output for missing canonical skills, broken `.claude/` links, and lockfile drift.
3. Summarize findings as a prioritized maintenance report.

## Completion criteria

- `.agents/` and `.claude/` parity is checked
- the lockfile coverage gap is reported
- any missing manifest or contract issue is surfaced
- the report is prioritized and actionable
- the validator result is captured in the audit evidence
