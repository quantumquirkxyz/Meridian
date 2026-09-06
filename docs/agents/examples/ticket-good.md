# Example Ticket

## Parent

Spec issue or local spec path.

## What to build

Make structured work-item validation available from the platform check command.

## Metadata

- Labels: `ready-for-agent`
- Milestone: none
- Project: none
- Fields: Work Type = Ticket; Repo Scope = platform; Phase = Ready for agent; Priority = medium; Risk = medium; Sprint = none; Release Train = none

## Acceptance criteria

- [ ] `check-all.mjs` runs the semantic audit.
- [ ] The semantic audit reports retired names as errors outside allowed provenance docs.

## Validation

- `node .agents/skills/platform/check-all.mjs`

## Blocked by

- None - can start immediately.

## Notes

- Do not add network dependencies.
