---
name: ticket-audit
description: Audit whether a ticket or subissue set covers a parent spec's requirements; use underneath spec-audit or when the user asks if tickets fully cover a spec.
disable-model-invocation: true
version: 1
capabilities:
  - audit-ticket-coverage
  - map-requirements-to-subissues
  - identify-ticket-gaps
  - identify-stale-blockers
inputs:
  - parent spec requirements
  - ticket set or subissues
  - linked PR and completion evidence
outputs:
  - ticket coverage matrix
  - missing ticket recommendations
  - duplicate or orphan ticket findings
dependencies:
  - context-pack
  - work-item-router
  - to-tickets
sideEffects:
  - read-issues
  - recommend-only
stopCondition: Every parent requirement is mapped to sufficient tickets or a concrete missing-ticket finding.
risk: low
---

# Ticket Audit

Audit whether a set of tickets or subissues faithfully covers a parent spec.

This skill is intentionally narrower than `/spec-audit`: it does not decide whether the overall spec is complete and it does not create issues by itself. It produces the ticket coverage matrix that `/spec-audit` uses to decide completion and corrective work, and it formats corrective recommendations so they can be handed to `/to-tickets` without rework.

## Contract

- Input: parent spec requirement rows and a concrete ticket/subissue set.
- Output: a ticket coverage matrix, ticket-level findings, and `to-tickets`-compatible corrective ticket recommendations.
- Scope: ticket decomposition and completion evidence only; do not edit code, merge PRs, or mutate tracker state.
- Rule: never infer coverage from similar titles alone; cite ticket body, acceptance criteria, linked PRs, or comments.
- Rule: preserve parent labels and milestone from `docs/agents/work-item-format.md`; do not invent tracker metadata.

## Process

### 1. Confirm The Ticket Set

Build a minimal fresh context pack first. Read the parent spec requirements, then list the tickets or subissues that are in scope.

Stop and ask for clarification if:

- no ticket set is provided or discoverable,
- the parent spec requirements are unavailable,
- ticket links appear to span multiple unrelated specs.

### 2. Normalize Tickets

For each ticket, record:

- issue number or local file path,
- title,
- state,
- labels and milestone,
- parent reference,
- acceptance checklist,
- blockers,
- linked PRs and merge state,
- evidence that each checklist item is complete.

Treat the ticket body and linked PRs as evidence. Treat labels and milestone as metadata, not proof of completion.

### 3. Build Requirement Coverage Matrix

For each parent requirement, classify ticket coverage:

- `sufficient` when the ticket set has closed/merged evidence for the requirement,
- `partial` when tickets exist but acceptance or PR evidence is incomplete,
- `missing` when no ticket maps to the requirement,
- `ambiguous` when evidence exists but does not prove the requirement.

Also flag:

- orphan tickets that do not map to any parent requirement,
- duplicate tickets that cover the same requirement without adding a distinct slice,
- stale blockers whose prerequisites are already closed or whose dependency direction is unclear,
- horizontal tickets that are too broad to prove a vertical requirement.

### 4. Recommend Missing Tickets

For each `missing` or `partial` requirement, recommend the smallest corrective ticket that would close the gap and can be passed directly to `/to-tickets`.

Each recommendation must include:

- parent requirement quote,
- ticket title,
- what the ticket delivers,
- acceptance criteria,
- blockers or `None`,
- validation or evidence expected after implementation.
- publication shape: title, blocked-by, what it delivers, acceptance criteria, and metadata preserved from the parent spec.

Do not publish these tickets. Return them to `/spec-audit` or the caller.

## Output Format

```markdown
## Ticket Audit

Status: sufficient | incomplete | blocked

### Coverage Matrix

| Requirement | Coverage | Tickets | Evidence | Gap |
| --- | --- | --- | --- | --- |
| <quote or id> | sufficient/partial/missing/ambiguous | <tickets> | <PR/checklist/comment> | <gap or None> |

### Ticket Findings

- <ticket> -> <orphan | duplicate | stale-blocker | too-broad | evidence-missing>
  Reason: <why this matters>

### Missing Ticket Recommendations

- <title>
  Requirement: <quoted parent requirement>
  What it delivers: <vertical slice>
  Acceptance criteria: <checklist>
  Blocked by: <tickets or None>
  Expected evidence: <test, PR, checklist, or demo evidence>

### Notes

<assumptions or missing evidence>
```

## Completion Criteria

- every parent requirement has a coverage row,
- every in-scope ticket is either mapped or flagged,
- missing coverage has a concrete corrective ticket recommendation,
- ambiguous evidence is labelled as ambiguous instead of guessed complete.

## Guardrails

- Do not write issues or comments; this skill is read/recommend-only.
- Do not judge code quality; use `/review-pr` for implementation review.
- Do not close parent specs or tickets.
- Do not broaden a missing-ticket recommendation beyond the cited parent requirement.
