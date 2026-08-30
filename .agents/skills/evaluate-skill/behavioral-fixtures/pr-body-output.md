## Summary

Adds the task creation API path with validation and persistence.

## Why

The linked ticket requires maintainers to create claimable tasks from structured input.

## Impact

Maintainers can create and fetch tasks; invalid input now fails before persistence.

## Validation

- `npm test -- task-api` -> pass

## Review Focus

Validation behavior and task persistence contract.

## Notes

No known follow-ups.

## Development

Closes #123
