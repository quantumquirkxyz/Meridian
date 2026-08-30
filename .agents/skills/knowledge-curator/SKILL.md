---
name: knowledge-curator
description: Keep context, ADRs, registry entries, and research coherent over time.
disable-model-invocation: true
version: 1
capabilities:
  - curate-context
  - curate-adrs
  - curate-registry
  - curate-research
inputs:
  - candidate updates
  - existing context
  - existing ADRs
outputs:
  - minimal durable update
dependencies: []
sideEffects:
  - write-docs
stopCondition: The durable knowledge set is consistent, stale/duplicate material is rejected or merged, update is minimal and durable, contradictions resolved or flagged.
risk: low
---

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