---
name: context-pack
description: Build a minimal fresh context pack with ordered reads and provenance.
disable-model-invocation: true
version: 1
capabilities:
  - build-context-pack
  - order-reads
inputs:
  - task scope
  - repo state
outputs:
  - ordered read set
  - freshness and provenance record
dependencies: []
sideEffects:
  - read-only
stopCondition: The pack has an ordered read set with explicit freshness and provenance, and stays bounded.
risk: low
---

# Context Pack

Use this skill to select the minimum repo context needed for a task.

## Contract

- Build the pack before reading broadly.
- Keep the read set minimal and ordered from durable context to task-specific evidence.
- Record why each read is included, how fresh it is, and what it should answer.
- Prefer authoritative repo docs, then the smallest relevant evidence.
- Stop when the pack is sufficient to start work; do not over-collect.
- Include enough provenance that a later skill can tell which facts came from durable docs and which came from runtime state.
- Prefer one pack per task, not one pack per skill hop.

## Steps

1. Identify the task scope and the smallest authoritative docs needed.
2. Order the reads from durable repo context to task-specific evidence.
3. Record freshness, provenance, and budget in the pack.
4. Capture the smallest set of facts needed to choose the next skill without reopening the full repo.

## Completion criteria

- the pack has an ordered read set
- freshness and provenance are explicit
- the pack stays bounded
