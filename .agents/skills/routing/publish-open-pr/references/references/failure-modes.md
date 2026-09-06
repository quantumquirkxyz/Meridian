# Failure Modes

Use these responses when the workflow cannot continue cleanly.

## Missing GitHub CLI

- Stop.
- Tell the user `gh` is required for this workflow.
- Do not try to fake PR creation with a different path.

## Authentication Failure

- Stop.
- Report that `gh auth status` failed.
- Ask the user to authenticate before continuing.

## No Push Access

- Stop.
- Report that the current branch cannot be pushed to `origin`.
- Ask the user to fix remote access or branch configuration.

## Mixed Scope

- Stop if you cannot separate the subissue changes from unrelated changes.
- Ask which files belong to the subissue.

## Validation Failure

- Fix the change if the failure is caused by it.
- If the failure is unrelated, call it out in the PR body.

## PR Already Exists

- Check whether the branch already has an open PR before creating another one.
- Reuse the existing PR if it already matches the branch and scope.

## Diff Resolution Error

- If GitHub rejects the non-draft PR path for a prepared branch with a diff-resolution error, retry once as a draft PR.
- If the draft attempt also fails, stop and report the GitHub error text verbatim.
