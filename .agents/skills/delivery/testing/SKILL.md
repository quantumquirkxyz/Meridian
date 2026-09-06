---
name: testing
category: delivery
maturity: stable
version: 1
description: Shape the test strategy for a project so behavior is verified at the right seams and at the right level.
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


# Testing

Use this skill when the project needs a testing strategy beyond a single feature slice. It should make the seams, levels, and coverage boundaries explicit so tests stay behavior-focused and maintainable.

## Contract

- Input: testing brief, system surface, and test stack.
- Output: a test strategy, seam guidance, and coverage boundaries.
- Scope: design test strategy, not implementation details.
- Rule: test the public seam first, not the internals.
- Rule: distinguish unit, integration, and end-to-end ownership clearly.
- Rule: avoid speculative coverage that does not prove user-visible behavior.

## Steps

1. Identify the public behavior that needs protection.
2. Choose the smallest seam that proves that behavior.
3. Assign the right test level to each behavior slice.
4. State what is intentionally not covered.

## Completion criteria

- the test seam is named
- the test level is named
- the coverage boundary is explicit
