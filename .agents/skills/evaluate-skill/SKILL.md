---
name: evaluate-skill
description: Evaluate a Skill against fixed scenarios for routing, completion, and artifact validity.
disable-model-invocation: true
---

# Evaluate Skill

Use this skill to check whether a Skill behaves predictably.

## Steps

1. Load the Skill manifest and representative fixtures.
2. Run the Skill against the scenario set.
3. Check routing, output shape, stop condition, and safety behavior.
4. Record the failures as regression cases.

## Completion criteria

- the Skill passes or fails against a fixed scenario set
- regressions are captured in writing

