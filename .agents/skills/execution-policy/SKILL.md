---
name: execution-policy
description: Decide whether a Skill action is allowed, requires approval, or must stop.
disable-model-invocation: true
---

# Execution Policy

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

