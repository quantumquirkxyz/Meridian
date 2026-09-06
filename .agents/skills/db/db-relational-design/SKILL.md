---
name: db-relational-design
category: skill-dev/sandbox
maturity: experimental
version: 1
description: Design relational schemas — entities, relations, keys, indexes, constraints — with normalisation, performance, and migration planning.
capabilities:
  - identify entities, relationships, and cardinality
  - design relational schemas with keys, indexes, constraints
  - plan migrations with rollback steps
outputs:
  - Markdown artifact: schema diagram/text, index justification, migration script sequence
sideEffects: []
dependencies: []
stopCondition: Artifact complete with schema, indexes, constraints, and migration sequence.
risk: low
trustTier: 1
maxIterations: 8
---

## Contract

- **Input:** domain requirements and access patterns.
- **Output:** schema and migration artifact.
- **Side effects:** none (design only; no DB writes during skill run unless user explicitly runs migration scripts separately).
- **Dependencies:** none.
- **Stop condition:** schema and migration plan complete.
- **Risk:** low.
- **Boundary:** schema design and migration plan; no direct DB changes unless user executes scripts separately.
---

# Relational DB Design

Design a **relational database schema** — entities, relations, keys, indexes, constraints — with normalisation, query patterns, and migration planning.

## When to use

- The user wants a database schema designed or audited.
- A new feature requires a model change.
- A migration needs sequencing.

## Process

1. Identify entities and relationships (1:1, 1:N, N:M).
2. Normalise to 3NF (at least); denormalise only for read-heavy patterns with justification.
3. Define primary / foreign / composite / candidate keys; state uniqueness constraints.
4. Design indexes for the query workload — primary access path, search patterns, reporting queries.
5. Define constraints: NOT NULL, CHECK, UNIQUE, foreign-key actions (ON DELETE / UPDATE).
6. Migration plan: backward-compatible steps (add column, backfill, change constraint, drop old column / table); rollback steps.
7. Performance: explain plan for critical queries; estimate size and growth.
8. Deliver — artifact: schema diagram (text/table), entity descriptions, index justification, constraints, and migration script sequence.
