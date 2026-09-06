---
name: context-pack
category: routing
maturity: experimental
version: 1
description: Build a minimal fresh context pack with ordered reads and provenance.
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


# Context Pack

Use this skill to select the minimum repo context needed for a task.

## Contract

- Build the pack before reading broadly.
- Keep the read set minimal and ordered from durable context to task-specific evidence.
- Record why each read is included, how fresh it is, and what it should answer.
- Prefer authoritative repo docs, then the smallest relevant evidence.
- Stop when the pack is sufficient to start work; do not over-collect.
- Include enough provenance that a later skill can tell which facts came from durable docs and which came from runtime state.
- Prefer one pack per task, not one pack per skill hop.

## Steps

1. Identify the task scope and the smallest authoritative docs needed.
2. Order the reads from durable repo context to task-specific evidence.
3. Record freshness, provenance, and budget in the pack.
4. Capture the smallest set of facts needed to choose the next skill without reopening the full repo.

## Completion criteria

- the pack has an ordered read set
- freshness and provenance are explicit
- the pack stays bounded
