# Multi-agent Protocol

Use this protocol when more than one agent or session works on the same project.

```mermaid
flowchart TD
    A[Agent A owns work item] --> B[Handoff to Agent B]
    B --> C{Names source artifact?}
    C -->|no| D[Stop: handoff incomplete]
    C -->|yes| E{Names next consumer?}
    E -->|no| D
    E -->|yes| F{Names status?}
    F -->|no| D
    F -->|yes| G{Names validation evidence?}
    G -->|no| D
    G -->|yes| H{Names unresolved blockers?}
    H -->|no| D
    H -->|yes| I[Continue]
    I --> J{Conflicting branch/ticket?}
    J -->|yes| K[Stop and reconcile ownership]
    J -->|no| L[Proceed]
    L --> M{Plan stale?}
    M -->|yes| N[Rerun measurement step]
    M -->|no| O[Execute plan]
```

## Rules

- One agent owns one work item at a time.
- Every handoff names the source artifact, next consumer, current status, validation evidence, and unresolved blockers.
- Do not duplicate work already claimed in the tracker.
- Do not merge review, repair, and ship responsibilities into one opaque action.
- A subagent may investigate or review, but the main agent owns final synthesis and user-facing state.

## Standard Handoffs

| Producer | Consumer | Artifact |
|---|---|---|
| `grill-with-docs` | `to-spec` | Clarified decisions, glossary/ADR updates |
| `to-spec` | `to-tickets` | Spec issue |
| `to-tickets` | `implement` | Claimable ticket |
| `implement` | `publish-open-pr` | Validated issue branch |
| `review-pr` | `plan-review-fixes` | Standards and Spec findings |
| `plan-review-fixes` | `implement-review-fixes` | Review Fix Plan PR comment |
| `implement-review-fixes` | `review-pr` | Implementation note and validation |
| `review-pr` | `ship-subissue` | Clean review state |

## Conflict Handling

| Situation | Rule |
|---|---|
| Two agents touch same branch or ticket | Stop and reconcile ownership |
| Plan is stale | Rerun the measurement step before editing |
| Validation fails after repair | Keep PR in review-fix-loop, do not ship |
