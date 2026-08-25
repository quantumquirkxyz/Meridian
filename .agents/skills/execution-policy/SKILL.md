---
name: execution-policy
description: Decide whether a Skill action is allowed, requires approval, or must stop.
disable-model-invocation: true
---

# Execution Policy

Use this skill before any risky state change.

## Operating rule

For trading flows, treat the first admissible phase as `paper`, then `demo`, then `live`. Do not authorize a live Bybit transition until the paper phase has been exercised end-to-end, the demo phase has been exercised against Bybit's simulated venue, and both have been explicitly judged stable enough to carry forward.

## Steps

1. Classify the requested action as read, write, delete, network, or external write.
2. Check the Skill manifest side effects and approval threshold.
3. If the action touches trading execution, require a paper-only first phase:
   - Bybit demo trading / sandbox / simulation only for the non-live phases.
   - REST and WebSocket connectivity may be validated, but no real capital may be at risk.
   - Order lifecycle, reconciliation, and risk limits should be exercised in the safe environment first.
4. Require explicit approval for the live transition and treat it as a separate state change from paper validation.
5. Require explicit approval for destructive or irreversible actions.
6. Record the decision, the phase boundary, and the rollback path.

## Completion criteria

- the action is allowed or blocked with reason
- the approval requirement is clear
- the paper-only gate or live-transition gate is explicit
- rollback is named
