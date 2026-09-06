# Example Review Fix Plan

## Review Fix Plan

Status: planned
PR: #123
Review: `main...feature/work-item-validation`
Source review: current conversation

### Standards

- [ ] Keep validation deterministic
  - Severity: required
  - Finding: The validator depends on wall-clock data in a way that changes output between runs.
  - Fix: Move timestamps into run records and keep pass/fail checks deterministic.
  - Validate: `node .agents/skills/platform/check-all.mjs`
  - Scope guard: Do not change the work-item artifact schema in this fix.

### Spec

No planned fixes.

### Notes

None
