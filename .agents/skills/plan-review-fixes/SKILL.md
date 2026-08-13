---
name: plan-review-fixes
description: Convert review-pr findings on a GitHub PR into a concrete remediation plan and post that plan as PR comments. Use after review-pr reports Standards or Spec findings that should be fixed before ship-subissue, or when review-fix-loop needs a durable correction plan for a PR.
version: 1
capabilities:
  - plan-review-remediation
  - post-fix-plan
inputs:
  - review findings
  - pr metadata
outputs:
  - review fix plan
  - PR comment
dependencies:
  - review-pr
sideEffects:
  - write-pr-comment
stopCondition: A durable Review Fix Plan comment is posted.
risk: medium
---

# Plan Review Fixes

## Overview

Turn a review report into a small, traceable repair plan. This skill does not edit code; it preserves review signal, organizes the work, and writes a PR comment that implement-review-fixes can execute later.

## Workflow

1. Identify the PR.
   - Prefer an explicit PR number from the user.
   - Otherwise run `gh pr view --json number,headRefName,baseRefName,url,title` from the current branch.
   - Stop if no PR is associated with the current branch.

2. Capture review input.
   - Use the latest review-pr output from the conversation when present.
   - If no review output is available, run or request `review-pr` first.
   - Preserve the two axes: `Standards` and `Spec`. Do not merge them into one severity ranking.

3. Normalize findings.
   - Drop findings that are explicitly marked as passes or non-issues.
   - Deduplicate repeated findings only when they clearly describe the same root cause.
   - Keep judgement-call smells labelled as judgement calls.
   - Keep hard standard violations labelled as hard violations.
   - Keep spec mismatches tied to the quoted or referenced requirement.

4. Produce the plan.
   - Group work into the smallest correction steps that can be implemented and verified independently.
   - For each step, include: source axis, finding summary, target files or symbols if known, intended fix, and validation command or observable check.
   - Order blockers first: spec correctness, failing behavior, hard standards, then design smells.
   - Do not prescribe a broad refactor unless the finding truly requires it.

5. Post the PR comment.
   - Use `gh pr comment <number> --body-file <file>` for multi-line comments.
   - Mark the comment with the heading `## Review Fix Plan` so implement-review-fixes can find it.
   - Include the fixed point or review command when known.
   - Include a short status line: `Status: planned`.

## Comment Format

Use this structure:

```markdown
## Review Fix Plan

Status: planned
Review: <fixed-point or review-pr command if known>

### Standards

- [ ] <short title>
  - Finding: <review finding>
  - Fix: <specific correction>
  - Validate: `<command or check>`

### Spec

- [ ] <short title>
  - Requirement: <quoted or referenced spec requirement>
  - Finding: <review finding>
  - Fix: <specific correction>
  - Validate: `<command or check>`

### Notes

<risks, assumptions, or "None">
```

If an axis has no findings, write `No planned fixes`.

## Guardrails

- Do not change source files.
- Do not resolve or dismiss a finding silently; either plan it or explain why it is not actionable.
- Do not post duplicate plans. If a `## Review Fix Plan` comment already exists, update by posting a superseding comment that links or references the earlier one.
- Do not proceed to ship-subissue from this skill.
