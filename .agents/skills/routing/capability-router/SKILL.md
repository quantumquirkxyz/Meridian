---
name: capability-router
category: routing
maturity: experimental
version: 1
description: Route work to the best matching Skill using declared capabilities and compatibility.
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