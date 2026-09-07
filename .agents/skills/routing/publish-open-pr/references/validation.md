# Validation

Run the smallest relevant validation for the branch you are about to publish.

- Prefer the repo's canonical check command.
- If no repo command exists, run a targeted test or lint command that exercises the changed files.
- Do not open the PR if validation is already failing.
