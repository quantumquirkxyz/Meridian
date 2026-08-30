---
name: publish-open-pr
description: Use when the user wants to publish a finished subissue as an open GitHub pull request from an already-prepared issue branch, after `implement` has finished, with a draft fallback when GitHub rejects the non-draft path.
version: 1
capabilities:
  - publish-pr
  - package-reviewable-diff
inputs:
  - prepared issue branch
  - linked issue
outputs:
  - open pull request
dependencies:
  - implement
sideEffects:
  - push-branch
  - create-pr
stopCondition: The prepared branch is pushed and a PR is open, preferring non-draft and falling back to draft when needed.
risk: medium
---

# Publish Open PR

Publish one completed repository-local subissue, including a corrective subissue, from a local checkout to GitHub as an open pull request after `implement` has finished.
Keep the diff tight and leave a reviewer with a short body that explains what changed and why in this repo's terms.
Follow the issue workflow in `AGENTS.md`; this skill only publishes the already-prepared branch.
The linked issue's metadata is the source of truth for labels and milestone. Follow [`docs/agents/work-item-format.md`](../../../docs/agents/work-item-format.md) when carrying metadata into the PR.

## Workflow

1. Confirm scope.
   - Run `git status -sb`.
   - Review the changed files and the relevant diff hunks.
   - Confirm the current branch matches the dedicated issue branch and only contains that subissue's work.
   - If the intended scope is unclear, stop and ask for clarification before opening the PR.
2. Verify prerequisites.
   - Confirm `git` is available.
   - Confirm `gh` is available and `gh auth status` succeeds.
   - Confirm the current branch can push to `origin`.
3. Run the smallest relevant validation.
   - Follow [Validation](references/validation.md).
   - If validation fails, stop and report it rather than changing the branch here.
4. Prepare the PR bundle.
   - Follow [PR Body](references/pr-body.md).
   - Run `scripts/render_pr_bundle.py` to materialize the title, body, and metadata from the current branch, latest commit, validation results, and linked issue.
   - Write the title, body, and metadata to explicit temp files before opening the PR.
   - If the repository already has a PR template, fill it in rather than replacing it.
5. Push the branch and open a PR.
   - Use `git push -u origin <branch>`.
    - Use the metadata bundle to set:
      - assignee: the current GitHub user
      - reviewers: the other human collaborator, and any additional reviewers explicitly resolved by the bundle
      - labels: the linked issue's non-triage labels
      - milestone: the linked issue milestone, if one is set
    - Use `gh pr create --title "<title>" --body-file "<body-file>" --assignee "@me" --milestone "<milestone>"` without `--draft`, then add repeated `--label` and `--reviewer` flags from the metadata bundle.
    - If GitHub rejects the non-draft PR path with a diff-resolution error for this prepared branch, retry the same PR as `--draft` rather than stopping.
   - Use a title that matches the subissue and the actual diff.
6. Hand off to the next workflow.
   - After the PR opens, the next workflow is `review-pr`.
   - If review finds defects, hand off to `review-fix-loop`.
   - When the latest review is clean, hand off to `ship-subissue` for merge and issue completion.

## Guardrails

- Never open a PR before the branch is pushed.
- Never guess at issue traceability when the reference is not already clear.
- Never guess at reviewer handles. If the workflow cannot resolve a required reviewer from repository context, stop and report the missing configuration.
- Never use a vague title like `Update` or `Misc fixes` unless the diff is genuinely broad and unavoidable.
- Never create or amend commits here; that belongs to `implement`.
- Never implement new issue work in this skill; only package, push, and publish the branch that `implement` already prepared.
- Never merge the PR or close the issue here; that belongs to `ship-subissue`.
- Never override the linked issue's labels or milestone unless the user explicitly asked for a metadata change.

## Failure Modes

If the workflow stalls, follow [Failure Modes](references/failure-modes.md) before trying to push through the problem.
