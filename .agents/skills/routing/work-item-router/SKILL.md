---
name: work-item-router
category: routing
maturity: experimental
version: 1
description: Force reading the canonical work-item governance index before routing specs, tickets, project boards, or publication flo
capabilities:
  - execute the core process defined in the skill body
  - produce a Markdown artifact or structured result
outputs:
  - Markdown artifact with process steps and completion criteria
sideEffects: []
dependencies: []
stopCondition: All process steps executed; artifact saved; criteria met.
risk: low
trustTier: 1
maxIterations: 6
---

## Contract

- **Input:** problem or task defined by the skill body.
- **Output:** Markdown artifact or structured result with completion criteria met.
- **Side effects:** none (design/review/documentation only unless explicitly stated).
- **Dependencies:** none (self-contained unless linked to other skills).
- **Stop condition:** all process steps completed; artifact saved; criteria checked.
- **Risk:** low.
- **Boundary:** produces reasoning or documentation artifacts; does not modify external systems unless explicitly instructed.


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
