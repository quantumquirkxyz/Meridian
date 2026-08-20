---
name: spec-audit
description: Audit a parent spec issue and its subissues for completion coverage; use when the user asks whether a spec with tickets is fully complete or needs corrective subissues.
disable-model-invocation: true
version: 1
capabilities:
  - audit-spec-completion
  - compare-spec-to-subissues
  - request-ticket-audit
  - publish-corrective-subissues
inputs:
  - parent spec issue or spec path
  - linked subissues or ticket set
  - completion evidence from PRs or closed tickets
outputs:
  - spec completion report
  - coverage gaps
  - corrective subissues when approved or explicitly requested
dependencies:
  - context-pack
  - capability-router
  - work-item-router
  - ticket-audit
  - to-tickets
sideEffects:
  - read-issues
  - optional-write-issue
stopCondition: The parent spec is classified as complete, incomplete with planned corrective subissues, or blocked by missing evidence.
risk: medium
---

# Spec Audit

Audit whether a parent spec and its subissues actually completed the intended Quant work.

This skill is a review and routing surface, not an implementation step. It preserves the parent spec as the source of truth, delegates ticket coverage to `/ticket-audit`, and prepares corrective subissues in a `/to-tickets`-compatible shape when the missing work is clear.

## Contract

- Input: one parent spec issue, issue URL, issue number, or spec file path.
- Output: one completion report with covered requirements, partial requirements, missing requirements, and corrective-ticket recommendations.
- Scope: judge spec completion across subissues and merged PR evidence; do not edit product code.
- Rule: call `/ticket-audit` to assess ticket coverage instead of duplicating its work.
- Rule: do not invent labels, milestone, project fields, or parent links; preserve metadata from `docs/agents/work-item-format.md` and the parent issue.
- Rule: if completion evidence is missing, report what is missing instead of guessing.
- Rule: when gaps exist, shape corrective work so it can be handed directly to `/to-tickets` for publication if the user approves or explicitly requests issue creation.

## Process

### 1. Confirm Inputs

Build a minimal fresh context pack first. Read:

- `docs/agents/issue-tracker.md` to confirm tracker behavior.
- `docs/agents/work-item-format.md` to preserve metadata.
- `CONTEXT.md` and, for Quant model-sensitive specs, `docs/model/quant_model.tex`.
- The parent spec issue or spec file supplied by the user.

If the user does not provide a parent spec reference, ask for it and stop.

### 2. Extract Requirements

Normalize the parent spec into requirement rows:

- requirement id or short name,
- quoted requirement text,
- acceptance criterion or checklist source,
- required evidence type,
- metadata inherited from the parent issue.

Use the parent issue's labels and milestone as the source of truth. Do not add new tracker metadata during audit.

### 3. Discover Subissues And Evidence

Find the ticket set attached to the parent spec:

- GitHub subissues when available,
- issue body links under Parent / Blocked by sections,
- PR development links and closing references,
- local `.scratch/<feature>/issues/` files when the spec is local.

For each ticket, collect state, labels, milestone, linked PRs, merged status, and acceptance checklist state. If the tracker cannot expose subissue links directly, use explicit links and comments; do not infer from title similarity alone.

### 4. Delegate Ticket Coverage

Run `/ticket-audit` with:

- the parent spec requirement rows,
- the discovered ticket set,
- linked PR or completion evidence,
- the fixed metadata from the parent issue.

Require `/ticket-audit` to report ticket-level coverage, orphan work, duplicate coverage, stale blockers, and missing slices.

### 5. Classify Completion

Classify each requirement as:

- `covered` when closed/merged evidence satisfies the requirement,
- `partial` when a ticket exists but evidence is incomplete,
- `missing` when no ticket covers the requirement,
- `blocked` when tracker or PR evidence cannot prove completion.

The overall spec is complete only when every requirement is `covered` and no blocking ticket remains open.

### 6. Plan Corrective Subissues

When gaps exist, produce corrective subissue drafts grouped by missing requirement. Keep them as small tracer bullets and preserve parent metadata:

- Parent: the audited spec issue.
- Labels: parent non-conflicting labels plus `ready-for-agent` when consistent with repo convention.
- Milestone: parent milestone, if set.
- Acceptance criteria: only the missing behavior needed to close the gap.
- Blocked by: only true prerequisite issues.
- Publication shape: express the corrective subissue in the same tracer-bullet form that `/to-tickets` expects, so it can be published without re-synthesizing scope.

If the user explicitly asked to create subissues, hand the corrective drafts to `/to-tickets` or the configured tracker. Otherwise, present drafts and ask for approval before writing issues.

## Report Format

```markdown
## Spec Audit

Status: complete | incomplete | blocked
Spec: <issue, URL, or path>
Metadata: labels=<labels>; milestone=<milestone or none>

### Coverage

- Covered: <count>
- Partial: <count>
- Missing: <count>
- Blocked: <count>

### Findings

- <requirement> -> <covered | partial | missing | blocked>
  Evidence: <ticket/PR/source>
  Gap: <what remains, or None>

### Corrective Subissues

- <title>
  Requirement: <quoted parent requirement>
  What to build: <narrow behavior>
  Blocked by: <issues or None>

### Notes

<metadata, assumptions, or missing evidence>
```

## Completion Criteria

- parent spec reference is explicit,
- ticket coverage was delegated to `/ticket-audit`,
- every parent requirement has a coverage classification,
- missing work is represented as corrective subissue drafts or published subissues,
- no code changes are made.

## Guardrails

- Do not mark a spec complete from closed issues alone; require linked PR or checklist evidence.
- Do not create corrective subissues from vague gaps; ask for clarification when the missing behavior cannot be stated as an acceptance criterion.
- Do not alter parent issue metadata unless the user explicitly asks.
- Do not merge, close, or reopen PRs.
- Do not implement corrective work; hand off to `/implement` after subissues exist.
