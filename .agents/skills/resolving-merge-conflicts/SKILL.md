---
name: resolving-merge-conflicts
description: "Use when you need to resolve a conflicted or blocked branch state: in-progress git merge/rebase conflicts, PR branch conflicts, or the most reasonable branch-side correction needed to keep a PR's changes intact while it moves forward, without merging the pull request itself."
version: 1
capabilities:
  - resolve-merge-conflicts
  - resolve-rebase-conflicts
inputs:
  - conflicted files
  - merge goal
  - review request context
  - branch-side correction context
outputs:
  - conflict resolution
  - validated branch state
dependencies: []
sideEffects:
  - write-code
stopCondition: The blocked branch state is resolved in the most reasonable way without inventing new behavior or distorting the PR's changes.
risk: medium
---

1. **See the current state** of the branch. Check git history, the conflicting files, and whether the block came from a merge/rebase, from changes made while answering review requests on a PR branch, or from a branch-side correction needed to keep the PR moving.

2. **Find the primary sources** for each conflict. Understand deeply why each change was made, and what the original intent was. Read the commit messages, the PR and review-request history, the review comments, and the original issues/tickets.

3. **Resolve each hunk.** Preserve both intents where possible. Where incompatible, pick the one matching the branch goal and note the trade-off. Prefer the most reasonable correction that preserves the PR's changes and surrounding intent. Do **not** invent new behaviour. Always resolve; never `--abort`.

4. Discover the project's **automated checks** and run them — typically typecheck, then tests, then format. Fix anything the branch-state resolution broke.

5. **Finish the branch-state resolution.** Stage everything and commit. If rebasing, continue the rebase process until all commits are rebased.

6. **Do not merge the PR here.** This skill resolves the branch-side problem only; PR merge/close happens in the dedicated ship workflow after the branch is clean.
