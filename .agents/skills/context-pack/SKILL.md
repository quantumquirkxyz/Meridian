---
name: context-pack
description: Build a minimal fresh context pack with ordered reads and provenance.
disable-model-invocation: true
---

# Context Pack

Use this skill to select the minimum repo context needed for a task.

## Contract

- Build the pack before reading broadly.
- Keep the read set minimal and ordered from durable context to task-specific evidence.
- Record why each read is included, how fresh it is, and what it should answer.
- Prefer authoritative repo docs, then the smallest relevant evidence.
- Stop when the pack is sufficient to start work; do not over-collect.

## Steps

1. Identify the task scope and the smallest authoritative docs needed.
2. Order the reads from durable repo context to task-specific evidence.
3. Record freshness, provenance, and budget in the pack.

## Completion criteria

- the pack has an ordered read set
- freshness and provenance are explicit
- the pack stays bounded
