---
name: plan-review-fixes
category: delivery
maturity: stable
version: 1
description: Convert review-pr findings on a GitHub PR into a concrete remediation plan and post that plan as PR comments. Use after 
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


# Plan Review Fixes

## Overview

Turn a review report into a small, traceable repair plan. This skill does not edit code; it preserves review signal, organizes the work, and writes a PR comment that implement-review-fixes can execute later. Use `references/review-fix-plan.md` as the canonical comment shape.

The plan still needs the familiar checklist language that keeps fixes executable:

- Severity
- Scope guard
When a PR already has linked-issue metadata, keep the plan aligned with the canonical work-item format in [`docs/agents/work-item-format.md`](../../../docs/agents/work-item-format.md): preserve the linked issue's labels and milestone as the source of truth, and do not invent new tracker metadata in the comment.
If a finding is already partially fixed in the current branch, keep it only if the remaining gap is still actionable and testable.

## Workflow

1. Identify the PR.
   - Prefer an explicit PR number from the user.
   - Otherwise run `gh pr view --json number,headRefName,baseRefName,url,title` from the current branch.
   - Stop if no PR is associated with the current branch.

2. Capture review input.
   - Use the latest review-pr output from the conversation when present.
   - If no review output is available, run or request `review-pr` first.
   - Preserve the two axes: `Standards` and `Spec`. Do not merge them into one severity ranking.
   - If the real blocker is a conflicted branch state rather than a review finding, stop and hand off to `resolving-merge-conflicts` instead of inventing a fix plan.

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
   - Prefer a plan shape that can be executed in one review-fix loop pass without guessing at scope.

5. Post the PR comment.
   - Use `gh pr comment <number> --body-file <file>` for multi-line comments.
   - Mark the comment with the heading `## Review Fix Plan` so implement-review-fixes can find it.
   - Include the fixed point or review command when known.
   - Include a short status line: `Status: planned`.

## Comment Format

Use the structure in `references/review-fix-plan.md`.

If an axis has no findings, write `No planned fixes`. Do not include advisory findings in the executable checklist unless they must be fixed before `ship-subissue`.

## Guardrails

- Do not change source files.
- Do not resolve or dismiss a finding silently; either plan it or explain why it is not actionable.
- Do not post duplicate plans. If a `## Review Fix Plan` comment already exists, update by posting a superseding comment that links or references the earlier one.
- Do not proceed to ship-subissue from this skill.
