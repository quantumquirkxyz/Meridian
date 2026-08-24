---
name: ship-review-fix-loop
description: Use when a PR has already been driven clean by review-fix-loop and you want to finish the delivery cycle by merging the PR, closing the linked issue, and updating project metadata when required.
version: 1
capabilities:
  - merge-clean-pr
  - close-linked-issue
  - update-project-metadata
inputs:
  - clean pr
  - linked issue
outputs:
  - merged pr
  - closed issue
  - updated project metadata
dependencies:
  - review-fix-loop
  - ship-subissue
sideEffects:
  - merge-pr
  - close-issue
  - update-project
stopCondition: The PR is merged, the linked issue is closed or marked complete, and project metadata is aligned.
risk: medium
---

# Ship Review Fix Loop

Use this wrapper when the user wants the review repair cycle to end in a fully shipped work item rather than only a clean PR.
This skill does not do review itself; it assumes review-fix-loop has already produced a clean PR and then completes the repository's normal ship path.
Preserve the canonical work-item metadata format in [`docs/agents/work-item-format.md`](../../../docs/agents/work-item-format.md) so labels, milestone, and project state stay aligned with the linked issue.

## Workflow

1. Confirm the target.
   - Read the open PR with `gh pr view`.
   - Confirm the PR still belongs to the current branch and linked issue.
   - Confirm the linked issue reference is clear enough to close safely.
2. Confirm review is clean.
   - Only proceed if the latest review-fix-loop or review-pr pass is clean on both Standards and Spec.
   - If review is not clean, stop and return to review-fix-loop.
3. Merge the PR.
   - Use `ship-subissue` or the repository's accepted merge command to merge the clean PR.
   - Do not invent a merge strategy that differs from the repository convention.
4. Close the issue.
   - If GitHub does not auto-close the linked issue, close it with `gh issue close <number> --comment "Merged in PR #<number>."`
   - Do not guess the issue number.
5. Update project metadata.
   - Align labels, milestone, and project fields with the completed state when the repository uses them.
   - Record the completion in the repository's normal tracker surface.

## Guardrails

- Do not merge with unresolved review findings.
- Do not close an issue unless the linked reference is clear.
- Do not leave project metadata in a state that contradicts completion.
