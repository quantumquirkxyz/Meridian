---
name: agent-observability
description: Capture redacted execution records, traces, and quality signals for Skill runs.
disable-model-invocation: true
---

# Agent Observability

Use this skill to make Skill runs observable without leaking sensitive data.

## Steps

1. Capture the Skill version, context pack, tools, and outputs.
2. Redact secrets and sensitive data before persistence.
3. Store the execution record with a stable identifier.

## Completion criteria

- the execution record is redacted
- the run is traceable
- the record links to outputs or validation evidence