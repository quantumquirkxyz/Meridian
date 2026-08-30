---
name: database-migrations
description: Plan and sequence database schema changes so they can ship safely without breaking callers.
version: 1
capabilities:
  - plan-schema-change
  - sequence-migration
  - protect-data-integrity
inputs:
  - schema change request
  - data shape
  - migration context
outputs:
  - migration plan
  - rollback guidance
  - data integrity checks
dependencies:
  - codebase-design
sideEffects:
  - read-only
stopCondition: The migration sequence and rollback path are clear enough to execute safely.
risk: medium
---

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
