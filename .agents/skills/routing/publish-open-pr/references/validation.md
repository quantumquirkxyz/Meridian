# Validation

Run the smallest check that exercises the touched area.

## Order

1. Start with `git diff --check`.
2. Run the narrowest test or command that covers the change.
3. If no focused test exists, run the best available lightweight validation and say so in the PR body.

## Validation Rules

- Keep validation local to the change when possible.
- Fix any failure caused by the change before publishing.
- Do not claim validation you did not actually run.

## PR Notes

Record the exact validation in the PR body.

- Mention each command that ran.
- Mention any skipped validation and why it was skipped.
- Mention any manual verification if it was necessary.
