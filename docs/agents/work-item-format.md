# Work Item Format

Canonical metadata shape for specs, tickets, and linked PRs in this repo.

## Metadata

- `labels`
- `milestone`
- `project`
- `fields.work_type`
- `fields.repo_scope`
- `fields.phase`
- `fields.priority`
- `fields.risk`
- `fields.sprint`
- `fields.release_train`
- `todo`

## Rules

- Specs default to `spec` and `ready-for-agent` with `fields.work_type = Epic`.
- Tickets default to `ready-for-agent` plus justified labels inherited from the source spec or parent issue.
- Preserve the linked issue or PR metadata as the source of truth.
- Do not invent conflicting tracker metadata in downstream comments or handoff notes.

## Tracker coupling

- `to-spec` writes the spec using this shape.
- `to-tickets` preserves this shape across each ticket.
- `plan-review-fixes` and `implement-review-fixes` keep the same source metadata aligned with review loops.
