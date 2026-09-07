---
name: db-migrations
category: db
maturity: stable
version: 1
description: Plan database migrations — schema changes, backfills, compatibility windows, and rollback strategy — with explicit application and data safety checks.
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

# db-migrations

- **Propósito**: Plan database migrations — schema changes, backfills, compatibility windows, and rollback strategy — with explicit application and data safety checks.
- **Contenido sugerido**: migration order, backfill strategy, and rollback plan.
- **Estado**: defined as a practical database specialization.
