---
name: vercel
description: Shape Vercel deployment and runtime concerns into a clear operational seam.
version: 1
capabilities:
  - design-vercel-seam
  - plan-vercel-runtime
  - define-vercel-ops
inputs:
  - Vercel brief
  - runtime constraints
  - deployment target
outputs:
  - Vercel seam proposal
  - runtime guidance
  - operational guidance
dependencies:
  - deployment
  - observability
sideEffects:
  - read-only
stopCondition: The Vercel seam and runtime expectations are explicit enough to implement or review.
risk: medium
---

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
