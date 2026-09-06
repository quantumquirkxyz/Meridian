---
name: knowledge-curator
category: routing
maturity: experimental
version: 1
description: Keep context, ADRs, registry entries, and research coherent over time.
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


# Knowledge Curator

Use this skill to curate durable knowledge after a run.

## Contract

- Input: candidate updates, existing context, and ADRs.
- Output: the minimal durable update that preserves consistency.
- Scope: curate durable knowledge, not implementation work.
- Rule: reject stale, duplicate, or contradictory material unless it is explicitly resolved.
- Rule: write only what should survive the current session.

## Steps

1. Compare candidate updates against existing context and ADRs.
2. Resolve contradictions or mark them for review.
3. Write only the minimal durable update needed.

## Completion criteria

- the durable knowledge set is consistent
- stale or duplicate material is rejected or merged
- the update is minimal and durable
- any contradiction is either resolved or flagged for review