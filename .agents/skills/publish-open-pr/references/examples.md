# Examples

## Clean Worktree

- `git status -sb` shows only the subissue files.
- Stage explicit paths.
- Commit once.
- Run the narrowest validation.
- Push and open the PR.

## Mixed Worktree

- `git status -sb` shows unrelated edits.
- Stage only the files for the subissue.
- Leave the unrelated files untouched.
- If the boundary is fuzzy, stop and ask.

## Traceable Issue

- The branch or commit already contains a clear issue reference.
- Include the issue in the PR body.
- Fill the issue title and URL if they are known.

## No Clear Issue

- Do not guess from open issues.
- Leave the issue traceability section out.
- Keep the PR body focused on the actual diff and validation.
