# Scope

Use this when deciding what belongs in the subissue commit and PR.

## Scope Check

- Run `git status -sb`.
- Inspect the changed files and the relevant hunks in `git diff`.
- Identify the smallest set of files that belong to the finished subissue.

## Mixed Worktree

If unrelated changes are present:

- Stage only explicit file paths that belong to the subissue.
- Leave unrelated tracked and untracked files unstaged.
- If the boundary is ambiguous, stop and ask the user which files are in scope.

## Staging Rules

- Prefer `git add <path>` with explicit paths.
- Avoid `git add -A`.
- Do not stage by directory unless every file in that directory belongs to the subissue.
