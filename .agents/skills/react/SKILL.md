---
name: react
description: Design React component structure and state seams so the UI stays composable and testable.
version: 1
capabilities:
  - design-react-seam
  - shape-component-graph
  - define-state-boundary
inputs:
  - React brief
  - component tree
  - state shape
outputs:
  - React seam proposal
  - component guidance
  - state boundary guidance
dependencies:
  - frontend-design
  - codebase-design
sideEffects:
  - read-only
stopCondition: The component shape and state boundary are explicit enough to implement or review.
risk: low
---

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
