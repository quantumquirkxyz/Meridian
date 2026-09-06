---
name: webapp-testing
category: delivery
maturity: stable
version: 1
description: Choose the right test seam for a web app and describe how to verify it at unit, integration, and end-to-end levels.
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


# Webapp Testing

Use this skill when the project needs guidance on how to test a frontend or full-stack web app. The goal is to select the right seam and keep each test level honest about what it proves.

## Contract

- Input: web app surface, behavior under test, and test stack.
- Output: a test seam recommendation, verification plan, and coverage boundaries.
- Scope: choose testing strategy, not implementation details.
- Rule: keep unit, integration, and end-to-end tests distinct in purpose.
- Rule: avoid testing private UI internals when the public seam can prove the behavior.
- Rule: identify the smallest observable check that proves the user-facing contract.

## Steps

1. Identify the public behavior that needs proof.
2. Map that behavior to the smallest useful seam.
3. Decide which level owns the check: unit, integration, or end-to-end.
4. Define the boundary so tests do not overreach into internals.

## Completion criteria

- the best test seam is named
- the test level is named
- the observable behavior is clear enough to automate
