---
name: testing
description: Shape the test strategy for a project so behavior is verified at the right seams and at the right level.
version: 1
capabilities:
  - design-test-strategy
  - choose-test-seams
  - define-coverage-boundaries
inputs:
  - testing brief
  - system surface
  - test stack
outputs:
  - test strategy
  - seam guidance
  - coverage boundaries
dependencies:
  - codebase-design
  - tdd
sideEffects:
  - read-only
stopCondition: The test strategy and seam choices are explicit enough to implement without guessing.
risk: low
---

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
