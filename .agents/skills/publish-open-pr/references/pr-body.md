# PR Body

Use this as the source of truth for the pull request body.

## Title Rules

- Prefer conventional commit style.
- Make the title describe the actual diff, not just the workflow.
- Avoid vague titles such as `Update` or `Misc fixes`.

## Body Template

```md
## Summary
<one or two sentences describing the change>

## Why
<why this subissue needed the change>

## Impact
<who benefits, what behavior changes, and any compatibility or migration impact>

## Validation
<tests, checks, or manual verification performed; include skipped checks with reasons>

## Review Focus
<specific files, contracts, risk areas, or "Standard review">

## Notes
<follow-ups, trade-offs, or known limitations>

## Development
Closes #<number>
```

## Issue Traceability

Include this section only when a traceable issue reference is already clear from the branch, commit, or user context.

- Related issue: `#<number>`
- Issue title: <title>
- Issue URL: <url>
- Issue labels: <labels, if useful>

## Writing Rules

- Keep the body short and specific.
- Use the current branch and latest commit to ground the summary.
- Copy the validation text from the actual checks you ran.
- If there are known limitations, name them plainly.
- If no special review focus exists, write `Standard review`.
- Include a closing keyword when the linked issue is known so GitHub populates the PR Development sidebar.
