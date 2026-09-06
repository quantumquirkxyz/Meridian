---
name: react
category: frontend
maturity: stable
version: 1
description: Design React component structure and state seams so the UI stays composable and testable.
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


# React

Use this skill when React components or state need to be shaped deliberately. Keep the component graph shallow where possible, and make the state seam explicit so the UI remains testable and refactor-friendly.

## Contract

- Input: React brief, component tree, and state shape.
- Output: a React seam proposal, component guidance, and state boundary guidance.
- Scope: design component and state shape, not the full implementation.
- Rule: keep state as local as possible while still serving the interaction flow.
- Rule: prefer reusable components only when the interface stays honest.
- Rule: avoid component forests that hide the real user path.

## Steps

1. Identify the primary interaction path.
2. Decide which state is local and which state must be lifted.
3. Shape the component graph around the seam.
4. Describe the boundaries that make the UI easy to test.

## Completion criteria

- the component seam is named
- the state boundary is named
- the interaction path is explicit
