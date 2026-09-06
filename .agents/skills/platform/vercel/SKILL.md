---
name: vercel
category: platform
maturity: experimental
version: 1
description: Shape Vercel deployment and runtime concerns into a clear operational seam.
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


# Vercel

Use this skill when a project runs on Vercel and the deployment/runtime seam needs to be clear. It should define what Vercel owns, what the app owns, and where operational expectations live.

## Contract

- Input: Vercel brief, runtime constraints, and deployment target.
- Output: a Vercel seam proposal, runtime guidance, and operational guidance.
- Scope: design the Vercel shape, not the full deployment implementation.
- Rule: make runtime expectations explicit before choosing platform features.
- Rule: keep platform-specific coupling visible.
- Rule: describe rollback and observability in the same pass as the runtime seam.

## Steps

1. Identify the platform responsibilities and app responsibilities.
2. Define the runtime seam and its constraints.
3. Note deployment and rollback expectations.
4. Call out any Vercel-specific lock-in that matters.

## Completion criteria

- the runtime seam is named
- the platform responsibilities are explicit
- the lock-in tradeoff is named
