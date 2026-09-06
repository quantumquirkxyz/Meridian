---
name: skill-audit
category: skill-dev
maturity: experimental
version: 1
description: Audit the Skills bundle, lockfile, symlink parity, and contract drift.
capabilities:
  - execute the core process defined in the skill body
  - produce a Markdown artifact or structured result
outputs:
  - Markdown artifact with process steps and completion criteria
sideEffects: []
dependencies: []
stopCondition: All process steps executed; artifact saved; criteria met.
risk: low
trustTier: 1
maxIterations: 6
---

## Contract

- **Input:** problem or task defined by the skill body.
- **Output:** Markdown artifact or structured result with completion criteria met.
- **Side effects:** none (design/review/documentation only unless explicitly stated).
- **Dependencies:** none (self-contained unless linked to other skills).
- **Stop condition:** all process steps completed; artifact saved; criteria checked.
- **Risk:** low.
- **Boundary:** produces reasoning or documentation artifacts; does not modify external systems unless explicitly instructed.


# Skill Audit

Use this skill to verify the repository-local Skills platform.

## Contract

- Input: the local Skills bundle, lockfile, symlink tree, and platform schemas.
- Output: a concise audit report with warnings and errors ranked by impact.
- Scope: verify bundle health; do not modify the skills during the audit.
- Rule: report parity, lock coverage, and contract drift separately.
- Rule: treat validator output as evidence, not as the audit itself.
- Rule: distinguish inventory drift, symlink drift, and contract drift so the maintenance action is obvious.
- Rule: if the bundle is healthy, say so explicitly instead of summarizing only the validator.

## Steps

1. Run the platform validator in `.agents/skills/platform/validate-skills.mjs`.
2. Run the semantic auditor in `.agents/skills/platform/audit-semantics.mjs` when the audit includes templates, retired names, Markdown links, or contract drift.
3. Inspect the output for missing canonical skills, broken `.claude/` links, and lockfile drift.
4. Inspect the inventory for stale aliases or mismatched metadata that the validator may not classify crisply.
5. Summarize findings as a prioritized maintenance report.

## Completion criteria

- `.agents/` and `.claude/` parity is checked
- the lockfile coverage gap is reported
- any missing manifest or contract issue is surfaced
- the report is prioritized and actionable
- the validator result is captured in the audit evidence
- semantic audit output is captured when run
- the report states whether the bundle is healthy, warning-only, or failing
