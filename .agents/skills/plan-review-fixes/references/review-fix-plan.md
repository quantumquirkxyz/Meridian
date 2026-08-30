# Review Fix Plan Template

Use this template when converting review findings into a durable PR comment.

```markdown
## Review Fix Plan

Status: planned
PR: <number or URL>
Review: <fixed-point or review-pr command if known>
Source review: <review-pr comment URL, review id, or "current conversation">

### Standards

- [ ] <short title>
  - Severity: blocker / required / advisory
  - Finding: <review finding>
  - Fix: <specific correction>
  - Validate: `<command or check>`
  - Scope guard: <what not to change while fixing this>

### Spec

- [ ] <short title>
  - Severity: blocker / required / advisory
  - Requirement: <quoted or referenced spec requirement>
  - Finding: <review finding>
  - Fix: <specific correction>
  - Validate: `<command or check>`
  - Scope guard: <what not to change while fixing this>

### Notes

<risks, assumptions, or "None">
```
