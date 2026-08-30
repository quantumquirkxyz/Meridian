# Spec Template

Use this template when publishing a new spec issue.

```markdown
## Metadata

- Labels: `spec`, `ready-for-agent`
- Milestone: <phase milestone or none>
- Project: <project board or none>
- Fields: Work Type = Epic; Repo Scope = <scope>; Phase = Ready for build; Priority = <priority>; Risk = <risk>

## Problem Statement

<one or two paragraphs describing the user-visible problem, current constraint, or opportunity>

## Goals

- <measurable outcome this spec must achieve>
- <another measurable outcome>

## Non-goals

- <adjacent work explicitly out of scope>

## Solution

<one or two paragraphs describing the proposed behavior from the user's perspective>

## User Stories

1. As an <actor>, I want a <feature>, so that <benefit>

## Functional Requirements

- <observable behavior or contract the implementation must satisfy>
- <edge case, error condition, or state transition>

## Implementation Decisions

- <seams, contracts, migration, or observability decisions>

## Testing Decisions

- Primary test seam: <public interface, API, CLI, UI flow, contract, or integration>
- Required automated checks: <tests, typecheck, lint, migration check, replay, etc.>
- Manual or operational checks: <only when needed>
- Prior art: <similar tests or patterns in the repo, if known>

## Acceptance Criteria

- [ ] <specific observable criterion>
- [ ] <specific observable criterion>

## Out of Scope

- <explicitly excluded behavior, migration, platform, or refactor>

## Risks and Open Questions

- Risk: <risk and mitigation, or "None known">
- Open question: <question, owner, and decision deadline, or "None">
```
