---
name: grill-with-docs
description: A relentless interview to sharpen a plan or design, while creating docs (ADRs and glossary) as we go.
disable-model-invocation: true
version: 1
capabilities:
  - interview-plan
  - maintain-domain-docs
inputs:
  - plan or design
  - repo context
  - domain vocabulary
outputs:
  - sharpened plan
  - CONTEXT updates
  - ADR drafts
dependencies:
  - grilling
  - domain-modeling
sideEffects:
  - write-docs
stopCondition: The plan is sharpened and the durable docs are updated inline.
risk: medium
---

Run a `/grilling` session, using the `/domain-modeling` skill.
