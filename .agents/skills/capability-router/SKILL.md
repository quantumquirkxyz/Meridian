---
name: capability-router
description: Route work to the best matching Skill using declared capabilities and compatibility.
disable-model-invocation: true
version: 1
capabilities:
  - route-work
  - match-capabilities
inputs:
  - task intent
  - required artifact type
  - available skills registry
outputs:
  - selected skill name
  - rationale
  - fallback options
dependencies: []
sideEffects:
  - recommend-only
stopCondition: A selected Skill is named with explicit rationale and fallback options noted.
risk: low
---

# Capability Router

Use this skill to choose the right Skill from the registry instead of relying on memory.

## Contract

- Route from declared capabilities, inputs, outputs, and side effects.
- Choose the thinnest Skill that can complete the work end to end.
- Prefer one primary Skill; add a second only when the task truly crosses a seam.
- If the choice is ambiguous, state the competing Skills and the reason for the final pick.
- Do not route on name similarity or past habit when the registry says otherwise.

## Steps

1. Parse the task intent and required artifact type.
2. Match against declared capabilities and side effects.
3. Prefer the thinnest Skill that can finish the work.
4. Fall back to a human-readable rationale when multiple Skills fit.

## Completion criteria

- a selected Skill is named
- the reason for the selection is explicit
- fallback options are noted when applicable