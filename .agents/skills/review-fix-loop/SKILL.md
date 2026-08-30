---
name: review-fix-loop
description: "Orchestrate the PR repair loop: run review-pr, use plan-review-fixes when findings exist, use implement-review-fixes to apply the plan, then repeat until Standards and Spec are clean or the loop is blocked. Use for PRs that should automatically cycle through review-driven fixes before ship-subissue, including the re-review that happens after a conflicted branch state is resolved."
version: 1
capabilities:
  - orchestrate-review-fixes
  - repeat-review-loop
inputs:
  - pr number
  - fixed point
  - spec source
outputs:
  - clean review status
  - repair plan notes
dependencies:
  - review-pr
  - plan-review-fixes
  - implement-review-fixes
sideEffects:
  - write-tracker
stopCondition: Review is clean or the loop is blocked after repeated evidence.
risk: medium
---

Do not merge, close, or delete branches here; this skill coordinates the loop only.

# Review Fix Loop

## Overview

Coordinate review, planning, and implementation without diluting any one skill's responsibility. The review remains the measurement instrument; this skill decides whether to plan fixes, implement them, repeat, or hand off to ship-subissue.
Use the canonical work-item metadata format in [`docs/agents/work-item-format.md`](../../../docs/agents/work-item-format.md) as the source of truth for labels, milestone, and project metadata when preserving the loop state in comments or handoffs.
Keep the loop tight: if the same review-fix plan would be posted again without a new finding, stop rather than restating the same repair in different words.

## Contract

- Input: one PR, one fixed point, and one spec source when needed.
- Output: either a clean review state or a blocked repair loop with a documented cause.
- Scope: repair review findings only; do not expand into unrelated refactors.
- Rule: re-enter the loop only when the latest plan is current and the next fix is still scoped.
- Rule: if the same blocker repeats, stop rather than churn.

## Inputs

- PR number or current branch with an associated PR.
- Fixed point for review-pr, such as `main`, a base branch, a commit SHA, or a tag.
- Spec source when review-pr cannot infer one.

If the fixed point is missing, ask for it before starting. If the PR is missing, identify it with `gh pr view` or stop.

## Workflow

1. Run review-pr.
   - Use the user-provided fixed point.
   - Preserve the output exactly enough that plan-review-fixes can cite Standards and Spec separately.

2. Decide.
   - If Standards and Spec both have no findings, stop the loop and tell the user the PR is ready for ship-subissue.
   - If either axis has findings, continue.
   - If the same blocking condition repeats for three consecutive loop passes, stop and report the blocker instead of looping indefinitely.
   - If the latest review changes only wording but not substance, treat it as the same blocker.
   - If a conflicted branch state was resolved, rerun review-pr on the cleaned branch before deciding whether to plan more fixes or hand off to ship-subissue.

3. Plan.
   - Use plan-review-fixes to turn the review findings into a PR comment headed `## Review Fix Plan`.
   - Treat the PR comment as the durable handoff between review and implementation.

4. Implement.
   - Use implement-review-fixes to apply the latest planned fixes.
   - Require local validation or an explicit explanation of skipped validation before the next review pass.
   - If the branch is conflicted, resolve that branch state first with `resolving-merge-conflicts`, then return here and continue the review-fix plan.

5. Repeat.
   - Run review-pr again against the same fixed point.
   - Continue until clean or blocked.
   - Do not widen scope during a repeat pass unless a new review finding makes it unavoidable.

## Loop State

Track these facts in the working response or PR comments:

- PR number and branch.
- Fixed point.
- Review pass count.
- Whether the last plan was posted.
- Whether the last implementation completed.
- Validation commands and results.
- Any metadata that must stay aligned with the linked issue: labels, milestone, and project fields.

## Exit Conditions

- **Clean:** review-pr reports no Standards findings and no Spec findings. Say that ship-subissue may proceed when the user wants merge/close/project updates or when a separate ship step will handle them.
- **Blocked:** missing PR, missing fixed point, stale or contradictory plan, failing validation without an obvious scoped fix, or the same findings recurring after three passes.
- **User stop:** user pauses or redirects the loop.

## Completion criteria

- the latest review state is preserved accurately
- the next action is either a scoped fix, a re-review, or a stop
- validation evidence exists for the most recent implementation pass
- the loop does not attempt to merge or close the PR
- the loop does not continue past the repeat threshold for the same blocker

## Guardrails

- Do not merge, close, or delete branches; ship-subissue owns that.
- Do not hide review findings by reclassifying them as planned work.
- Do not keep looping when the next action needs user judgement.
- Do not change the fixed point mid-loop unless the user explicitly changes it.
