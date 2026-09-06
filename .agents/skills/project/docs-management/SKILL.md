---
name: docs-management
category: project
maturity: stable
version: 1
description: Keep repository documentation, ADRs, and durable context aligned with the current project shape.
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
