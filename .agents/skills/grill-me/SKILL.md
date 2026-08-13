---
name: grill-me
description: A relentless interview to sharpen a plan or design.
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
  - clarified plan
  - recommended answers
dependencies:
  - grilling
sideEffects:
  - question-only
stopCondition: The plan is sharpened enough to move forward or hand off.
risk: low
---

Run a `/grilling` session.
