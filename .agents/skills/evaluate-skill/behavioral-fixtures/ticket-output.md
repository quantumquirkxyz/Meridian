## Parent

#123

## What to build

Create the task persistence path so a valid task request can be saved and fetched through the public API.

## Metadata

- Labels: `ready-for-agent`
- Milestone: none
- Project: none
- Fields: Work Type = Ticket; Repo Scope = app; Phase = Ready for agent; Priority = medium; Risk = medium; Sprint = none; Release Train = none

## Acceptance criteria

- [ ] Valid task input creates a persisted task.
- [ ] The created task can be fetched by id.

## Validation

- `npm test -- task-service` proves persistence behavior.

## Blocked by

- None - can start immediately.

## Notes

- Do not add notification behavior in this ticket.
