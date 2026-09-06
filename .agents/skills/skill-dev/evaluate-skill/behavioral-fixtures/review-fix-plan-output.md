## Review Fix Plan

Status: planned
PR: #45
Review: `main...feature/task-create`
Source review: current conversation

### Standards

- [ ] Add missing validation test
  - Severity: required
  - Finding: The API accepts invalid input without a regression test.
  - Fix: Add a test for missing acceptance criteria.
  - Validate: `npm test -- task-api`
  - Scope guard: Do not change the task response shape.

### Spec

No planned fixes.

### Notes

None
