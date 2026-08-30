---
name: evaluate-skill
description: Evaluate a Skill against fixed scenarios for routing, completion, and artifact validity.
disable-model-invocation: true
version: 1
capabilities:
  - evaluate-routing
  - evaluate-completion
  - evaluate-artifact-validity
inputs:
  - skill manifest
  - scenario fixtures
outputs:
  - pass/fail result
  - regression cases
dependencies: []
sideEffects:
  - read-only
stopCondition: The Skill passes or fails against a fixed scenario set with regressions captured in writing.
risk: low
---

# Evaluate Skill

Use this skill to check whether a Skill behaves predictably.

Scenario fixtures live in [`scenarios/`](scenarios/). They describe expected routes and static assertions for representative project-development workflows.
Behavioral fixtures live in [`behavioral-fixtures/`](behavioral-fixtures/). They describe representative artifact outputs that templates should continue to produce.

Use the deterministic runner when you need a repeatable regression check:

```bash
node .agents/skills/platform/evaluate-scenarios.mjs
node .agents/skills/platform/evaluate-behavioral-fixtures.mjs
```

## Steps

1. Load the Skill manifest and representative fixtures from `scenarios/`.
2. Run the static scenario evaluator when deterministic validation is enough.
3. Run the behavioral fixture evaluator after changing templates or artifact formats.
4. Check routing, output shape, stop condition, and safety behavior.
5. Check that the skill's contract matches the shape of its actual effects: routing-only skills should not write, write-capable skills should declare their side effects, and read-only skills should stay read-only.
6. Record the failures as regression cases by adding or updating a scenario or behavioral fixture.

## Completion criteria

- the Skill passes or fails against a fixed scenario set
- regressions are captured in writing
- contract mismatches are called out separately from scenario failures
- the scenario runner result is captured when the deterministic runner applies
- behavioral fixture output is captured when templates or artifact formats changed
