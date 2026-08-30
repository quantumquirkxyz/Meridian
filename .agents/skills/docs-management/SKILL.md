---
name: docs-management
description: Keep repository documentation, ADRs, and durable context aligned with the current project shape.
version: 1
capabilities:
  - curate-docs
  - manage-adrs
  - keep-context-coherent
inputs:
  - docs brief
  - repository context
  - change scope
outputs:
  - docs guidance
  - ADR guidance
  - context coherence notes
dependencies:
  - knowledge-curator
  - domain-modeling
sideEffects:
  - read-only
stopCondition: The documentation and ADR guidance are explicit enough to keep the repo coherent.
risk: low
---

# Docs Management

Use this skill when the repository needs durable documentation discipline: what belongs in `CONTEXT.md`, when to write an ADR, and how to keep docs from drifting away from the code.

## Contract

- Input: docs brief, repository context, and change scope.
- Output: docs guidance, ADR guidance, and context coherence notes.
- Scope: decide what durable docs should say; do not write implementation code here.
- Rule: keep `CONTEXT.md` glossary-like and implementation-free.
- Rule: write an ADR only when the decision is hard to reverse and the trade-off is real.
- Rule: reject stale or duplicate documentation unless it is explicitly resolved.

## Steps

1. Identify which durable docs are affected by the change.
2. Decide whether the change is glossary material, an ADR, or operational guidance.
3. Note what needs to stay coherent across future changes.
4. Flag any stale or contradictory material that should be removed or revised.

## Completion criteria

- the durable doc surface is named
- the ADR threshold is explicit
- the coherence risk is described
