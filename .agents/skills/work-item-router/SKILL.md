---
name: work-item-router
description: Force reading the canonical work-item governance index before routing specs, tickets, project boards, or publication flows.
disable-model-invocation: true
version: 1
capabilities:
  - route-work-item-governance
inputs:
  - work item request
outputs:
  - routing note
dependencies:
  - capability-router
sideEffects: []
stopCondition: The canonical governance index has been read and the matching downstream skill is identified.
risk: low
---

This skill routes only. It does not create issues, tickets, PRs, or project items.

# Work Item Router

Use this skill before `to-spec`, `to-tickets`, or `make-project` when the task involves tracker metadata, project boards, or publication flow.

## Contract

- Input: a request involving specs, tickets, spec/ticket audits, projects, PR metadata, or review-fix comments.
- Output: a routing note that identifies the downstream skill and the relevant governance documents.
- Scope: routing only. Do not draft the artifact here.
- Rule: always read [`docs/agents/index.md`](../../../docs/agents/index.md) first.
- Rule: prefer the canonical work-item format over ad hoc tracker metadata.

## Workflow

1. Read `docs/agents/index.md`.
2. Identify whether the request is a spec, ticket, spec completion audit, ticket coverage audit, corrective ticket publication, project board, PR publication, review-fix plan, or closeout.
3. Route to the thinnest downstream skill that can finish the work.
4. If metadata is involved, preserve the canonical shape from `docs/agents/work-item-format.md`.

## Completion criteria

- the governance index has been read
- the downstream skill is named
- any required metadata contract is explicit
