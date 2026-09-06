---
name: interactive-tutorial-builder
description: Generate a focused tutorial with goals, exercise inputs, expected outputs, and checkpoints for any Skill; use when teaching or onboarding someone to a Skill.
version: 1
capabilities:
  - generate-skill-tutorial
  - derive-learning-goals
  - create-tutorial-checkpoints
inputs:
  - skill-name
  - learner-context
outputs:
  - interactive-tutorial
  - exercise
  - checkpoint
dependencies:
  - skill-tutor
sideEffects: []
stopCondition: The learner has a runnable exercise and a checkable checkpoint derived from the target Skill contract.
risk: low
trustTier: 2
---

# Interactive Tutorial Builder

## Contract

- Input: a Skill name and learner context.
- Output: learning goals, exercise, expected outputs, checkpoint, and response space.
- Boundary: generate instructional scaffolding; the learner remains responsible for executing the Skill.

Run `node .agents/skills/platform/skill-lab.mjs tutorial <skill-name>`. Adapt the generated exercise to the learner's context, keep the target Skill's stop condition intact, and require evidence at the checkpoint.
