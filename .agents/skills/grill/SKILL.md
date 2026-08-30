---
name: grill
description: Alias for the qquirk grilling flow. Use when the user says "grill" and wants a relentless interview to sharpen a plan, decision, or idea.
disable-model-invocation: true
version: 1
capabilities:
  - interview-plan
  - stress-test-idea
inputs:
  - plan
  - design
  - idea
outputs:
  - clarified decisions
  - recommended answers
dependencies:
  - grilling
sideEffects:
  - question-only
stopCondition: The current decision tree is sharpened enough to move forward or hand off.
risk: low
---

# Grill

Run the `grilling` primitive as the stable qquirk entrypoint named `grill`.

Use this alias when the user asks for `grill` specifically. Keep the behavior identical to `grilling`: ask one question at a time, recommend an answer for each question, inspect discoverable facts directly, and do not act on the plan until the user confirms the shared understanding is complete.
