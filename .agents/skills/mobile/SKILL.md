---
name: mobile
description: Shape mobile projects around device constraints, offline behavior, and platform seams that stay explicit.
version: 1
capabilities:
  - design-mobile-seam
  - plan-device-flow
  - define-offline-boundary
inputs:
  - mobile brief
  - device constraints
  - interaction context
outputs:
  - mobile seam proposal
  - device-flow guidance
  - offline boundary guidance
dependencies:
  - frontend-design
  - codebase-design
sideEffects:
  - read-only
stopCondition: The mobile seam, device flow, and offline boundary are explicit enough to implement or review.
risk: medium
---

# Mobile

Use this skill when the product needs to respect device constraints, offline behavior, or platform-specific UX. It should keep the seam explicit so the app can remain reliable across different device conditions.

## Contract

- Input: mobile brief, device constraints, and interaction context.
- Output: mobile seam proposal, device-flow guidance, and offline boundary guidance.
- Scope: design the mobile shape, not the full implementation.
- Rule: account for small screens, interruptions, and connectivity loss.
- Rule: make offline behavior explicit when it matters.
- Rule: keep platform-specific quirks visible rather than hidden behind generic advice.

## Steps

1. Identify the core mobile interaction path.
2. Define the seam around device and connectivity constraints.
3. Decide what must work offline or under interruption.
4. Describe the platform-specific behaviors that matter.

## Completion criteria

- the mobile seam is named
- the offline boundary is named
- the device constraints are explicit
