## Metadata

- Labels: `spec`, `ready-for-agent`
- Milestone: none
- Project: none
- Fields: Work Type = Epic; Repo Scope = app; Phase = Ready for build; Priority = medium; Risk = medium

## Problem Statement

Users need a durable way to create project tasks from natural language without losing acceptance criteria.

## Goals

- Produce project tasks with clear acceptance criteria.
- Preserve traceability to the originating request.

## Non-goals

- Building a full project-management UI.

## Solution

Add a task creation flow that turns a short request into a saved task with status and validation notes.

## User Stories

1. As a project maintainer, I want to create a task from a short request, so that work can be tracked consistently.

## Functional Requirements

- A task has a title, status, source request, and acceptance criteria.
- Missing title or criteria returns a validation error.

## Implementation Decisions

- The task service owns task creation.
- The API contract returns validation errors without persisting invalid tasks.

## Testing Decisions

- Primary test seam: task creation API.
- Required automated checks: unit and API contract tests.

## Acceptance Criteria

- [ ] Valid input creates a task with status `ready-for-agent`.
- [ ] Invalid input returns a validation error and creates no task.

## Out of Scope

- Notifications.

## Risks and Open Questions

- Risk: validation drift between UI and API; mitigation is API-level validation tests.
- Open question: None.
