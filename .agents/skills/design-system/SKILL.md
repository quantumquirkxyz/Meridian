---
name: design-system
description: Define and evolve reusable UI tokens, components, and usage rules as a coherent system.
version: 1
capabilities:
  - define-ui-tokens
  - design-reusable-components
  - set-usage-rules
inputs:
  - UI requirements
  - component inventory
  - brand context
outputs:
  - token guidance
  - component guidance
  - usage rules
dependencies:
  - frontend-design
  - codebase-design
sideEffects:
  - read-only
stopCondition: The reusable UI system and its usage rules are explicit enough for consistent implementation.
risk: low
---

# Design System

Use this skill when UI work starts to repeat and needs a shared system rather than one-off styling. It should define the reusable tokens, components, and usage rules that keep the frontend coherent as it grows.

## Contract

- Input: UI requirements, component inventory, and brand context.
- Output: token guidance, component guidance, and usage rules.
- Scope: design the shared system, not a single page.
- Rule: prefer a small set of reusable tokens over ad hoc styling.
- Rule: make reuse rules explicit so callers know what belongs in the system.
- Rule: keep component contracts stable enough for multiple surfaces.

## Steps

1. Find repeated UI patterns and naming collisions.
2. Define the minimum token set that carries the brand.
3. Identify which components should be shared and which should stay local.
4. Write the rules that keep the system coherent over time.

## Completion criteria

- the reusable tokens are named
- the shared components are named
- the usage rules are explicit
