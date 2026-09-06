---
name: nextjs
category: frontend
maturity: experimental
version: 1
description: Shape Next.js projects around routes, server/client seams, and data flow that stay deep rather than tangled.
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


# Next.js

Use this skill when the project is built on Next.js and the route tree or rendering model needs to be shaped with intent. Keep the route surface small, the server/client split explicit, and the data flow easy to reason about.

## Contract

- Input: Next.js brief, route map, and rendering constraints.
- Output: a Next.js seam proposal, route guidance, and server/client split guidance.
- Scope: design the route and rendering shape, not the full implementation.
- Rule: identify which logic belongs on the server and which must stay client-side.
- Rule: keep route structure aligned with the primary user paths.
- Rule: avoid shallow wrappers that only move data around.

## Steps

1. Identify the primary user path and route shape.
2. Decide the server/client split at the seam.
3. Note any data-fetching or rendering constraints.
4. Describe the smallest route structure that still fits the flow.

## Completion criteria

- the route shape is named
- the server/client seam is named
- the rendering constraints are explicit
