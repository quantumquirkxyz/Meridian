---
name: grill
category: routing
maturity: stable
version: 1
description: Alias for the quirk grilling flow. Use when the user says "grill" and wants a relentless interview to sharpen a plan, de
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


# Grill

Run the `grilling` primitive as the stable quirk entrypoint named `grill`.

Use this alias when the user asks for `grill` specifically. Keep the behavior identical to `grilling`: ask one question at a time, recommend an answer for each question, inspect discoverable facts directly, and do not act on the plan until the user confirms the shared understanding is complete.
