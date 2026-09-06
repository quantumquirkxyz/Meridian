---
name: execution-policy
description: Decide whether a Skill action is allowed, requires approval, or must stop.
disable-model-invocation: true
version: 1
capabilities:
  - classify-action
  - check-approval-threshold
  - require-approval
inputs:
  - requested action
  - skill manifest
outputs:
  - allow/block decision
  - approval requirement
  - rollback path
dependencies: []
sideEffects:
  - read-only
stopCondition: The action is allowed or blocked with reason, approval requirement is clear, and rollback is named.
risk: low
trustTier: 2
---

## Contract

- **Input:** problem or task defined by the skill body.
- **Output:** Markdown artifact or structured result with completion criteria met.
- **Side effects:** none (design/review/documentation only unless explicitly stated).
- **Dependencies:** none (self-contained unless linked to other skills).
- **Stop condition:** all process steps completed; artifact saved; criteria checked.
- **Risk:** low.
- **Boundary:** produces reasoning or documentation artifacts; does not modify external systems unless explicitly instructed.


# Execution Policy

This skill is advisory only. It does not change repository state or perform the action it judges.

Use this skill before any risky state change.

## Steps

1. Classify the requested action as read, write, delete, network, or external write.
2. Check the Skill manifest side effects and approval threshold.
3. Require explicit approval for destructive or irreversible actions.
4. Record the decision and rollback path.

## Completion criteria

- the action is allowed or blocked with reason
- the approval requirement is clear
- rollback is named