---
name: postgres
category: platform
maturity: stable
version: 1
description: Shape PostgreSQL schema and query decisions so the data model stays durable and reviewable.
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


# Postgres

Use this skill when PostgreSQL is the persistence layer and the schema or query shape matters. It should make the data model durable and the query seam explicit so changes can be migrated safely.

## Contract

- Input: postgres brief, data model, and persistence constraints.
- Output: schema guidance, query guidance, and data durability notes.
- Scope: design the persistence shape, not the full implementation.
- Rule: keep the schema honest to the domain model.
- Rule: make the query seam explicit when it affects performance or correctness.
- Rule: flag data-loss risk and migration coupling early.

## Steps

1. Identify the persisted concepts and their boundaries.
2. Decide what belongs in schema versus derived data.
3. Note the query and migration constraints.
4. Describe the durability tradeoffs clearly.

## Completion criteria

- the schema shape is named
- the query seam is named
- the durability risks are explicit
