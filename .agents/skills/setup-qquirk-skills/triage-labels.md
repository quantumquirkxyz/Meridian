# Triage Labels

Triage is part of the standard project flow in this repo. It turns incoming issues and PRs into a stable state machine before implementation starts.

## Canonical roles

- `bug`
- `enhancement`
- `needs-triage`
- `needs-info`
- `ready-for-agent`
- `ready-for-human`
- `wontfix`

## Label mapping

| Canonical role | Tracker label | Meaning |
| --- | --- | --- |
| `needs-triage` | `needs-triage` | Maintainer needs to evaluate this item |
| `needs-info` | `needs-info` | Waiting on reporter for more information |
| `ready-for-agent` | `ready-for-agent` | Fully specified, ready for an AFK agent |
| `ready-for-human` | `ready-for-human` | Requires human implementation or merge |
| `wontfix` | `wontfix` | Will not be actioned |

When a skill mentions a role, use the canonical role name first and the tracker label second if the tracker vocabulary differs.
