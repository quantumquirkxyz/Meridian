# Context Packs

A context pack is the ordered, task-scoped read set for a run.

Rules:

- start with the smallest fresh set that answers the task;
- prefer primary repo context before secondary docs;
- record the read order explicitly;
- keep provenance with each item;
- do not load durable knowledge from conversation memory when a repo source exists;
- treat freshness as a first-class constraint, not a nice-to-have.

Minimum fields:

- `id`
- `task`
- `scope`
- `readOrder`
- `freshness`
- `provenance`
- `budget`

