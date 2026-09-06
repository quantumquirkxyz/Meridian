# accessibility

Design inclusive products — WCAG compliance, assistive technology support, keyboard navigation, color contrast — so all users can access the product regardless of ability.

## Goals
- Meet WCAG 2.1 AA as a baseline (AAA where possible)
- Support screen readers (NVDA, JAWS, VoiceOver)
- Ensure keyboard-only navigation
- Design for cognitive and motor accessibility

## Contract

### Input
A UI component, page, or product to audit for accessibility.

### Output
An accessibility audit with:
- WCAG compliance checklist (perceivable, operable, understandable, robust)
- Issues ranked by severity (A, AA, AAA)
- Fix recommendations with code examples

## WCAG 2.1 Principles

1. **Perceivable** — alternative text, captions, sufficient contrast
2. **Operable** — keyboard navigation, no seizure triggers
3. **Understandable** — clear language, error identification
4. **Robust** — valid HTML, ARIA when needed

## Common Issues

| Issue | Severity | Fix |
|---|---|---|
| Missing alt text | A | Add descriptive alt to all images |
| Low contrast | AA | Use ≥4.5:1 (text) or ≥3:1 (large text) |
| No keyboard focus | A | Ensure all interactive elements are focusable |
| Missing form labels | A | Associate `<label>` with `<input>` |
| Autoplay media | A | Provide pause/stop controls |
| Missing skip links | AA | Add "skip to main content" link |

## Tools

- **Automated**: axe, Lighthouse, WAVE
- **Manual**: keyboard nav, screen reader testing
- **Color**: Colour Contrast Analyser, WebAIM contrast checker

## Steps

1. **Audit with automated tools** — catch low-hanging fruit
2. **Test with keyboard** — tab through every flow
3. **Test with screen reader** — announce each element
4. **Review color contrast** — check all text/background pairs
5. **Fix by severity** — A first, then AA
6. **Document** — accessibility statement and test results

## References
- `../../ux/interaction-design/SKILL.md` — interaction patterns
- `../../frontend/frontend-design/SKILL.md` — visual design
