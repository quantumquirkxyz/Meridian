---
name: database-migrations
category: platform
maturity: stable
version: 1
description: Plan and sequence database schema changes so they can ship safely without breaking callers.
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


# Database Migrations

Use this skill when a schema or data-shape change needs to be made safely. It should sequence the move, identify backwards-compatibility concerns, and keep data integrity visible.

## Contract

- Input: schema change request, data shape, and migration context.
- Output: a migration plan, rollback guidance, and data integrity checks.
- Scope: plan the migration, not the live execution.
- Rule: prefer expand-then-contract when callers need time to move.
- Rule: call out destructive steps and their rollback path explicitly.
- Rule: keep compatibility windows short but real when the change spans deploys.

## Steps

1. Identify the current and target schema shapes.
2. Choose the safest migration ordering.
3. Define rollback and data integrity checks.
4. Note when the migration must be coordinated with application code.

## Completion criteria

- the migration order is named
- the rollback path is named
- the data integrity checks are concrete
