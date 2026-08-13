---
name: artifact-handoff
description: Transfer structured artifacts between Skills and sessions.
disable-model-invocation: true
---

# Artifact Handoff

Use this skill to move a result from one Skill to another without flattening it into prose.

## Steps

1. Package the artifact with id, type, producer, status, summary, evidence, and consumers.
2. Include the minimal context pointer required by the consumer.
3. Preserve provenance and redaction by default.

## Completion criteria

- the artifact validates against the shared envelope
- the next consumer is explicit

