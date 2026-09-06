# accessibility-testing

Test web interfaces for accessibility compliance — automated scans, manual keyboard navigation, screen reader validation — so barriers are found and fixed before users encounter them.

## Goals
- Catch WCAG violations automatically where possible
- Validate manually what automation cannot detect
- Produce a ranked issue list by severity (A, AA, AAA)
- Verify fixes with re-testing and regression checks

## Contract

### Input
A URL, local path, or component to test. Optionally: target WCAG level (AA default), list of known patterns to skip.

### Output
An accessibility test report with:
- Automated scan results (violations, warnings, passes)
- Manual test results (keyboard, screen reader, contrast)
- Issues ranked by severity with element selectors
- Fix suggestions with code examples
- Re-test checklist for each fixed issue

## Tools

| Tool | Type | What it catches |
|---|---|---|
| `axe` / `axe-core` | Automated | Contrast, missing labels, invalid ARIA |
| `Lighthouse` | Automated | WCAG summary, accessibility score |
| `WAVE` | Automated | Errors, alerts, features, structural issues |
| `Colour Contrast Analyser` | Manual | Text/background contrast ratios |
| Keyboard (Tab/Enter/Escape) | Manual | Focus traps, missing focus styles |
| Screen reader (NVDA/VoiceOver) | Manual | Announcements, reading order |

## Process

### 1. Automated Scan

Run at least two automated tools in parallel:
```bash
# axe via CLI
npx @axe-core/cli https://example.com

# Lighthouse in CI
lighthouse https://example.com --only-categories=accessibility
```
Collect violations and deduplicate. Ignore known-false-positives with documented rationale.

### 2. Keyboard Navigation Test

Step through every interactive flow manually:
- `Tab` forward through all focusable elements
- `Shift+Tab` backward
- `Enter` activate buttons and links
- `Space` activate buttons
- `Escape` close modals and dropdowns
- `Arrow keys` navigate menus and radio groups
- Check that focus indicator is always visible (not `outline: none` without alternative)

Document: which element failed, what expected behavior is, what the page should do.

### 3. Screen Reader Test

Test with at least one screen reader on one target platform:
- **Windows**: NVDA + Firefox (most tested combo)
- **macOS / iOS**: VoiceOver + Safari
- **Android**: TalkBack + Chrome

Check:
- All images have meaningful `alt` text (or `alt=""` for decorative)
- Form inputs have associated labels
- Buttons announce their role, name, and state
- Modal/dialog announces on open and traps focus inside
- Page regions have landmarks (`<main>`, `<nav>`, `<aside>`)

### 4. Color Contrast Check

Use Colour Contrast Analyser or WebAIM Contrast Checker for every text/background pair:
- Normal text: ≥ 4.5:1 (AA), ≥ 7:1 (AAA)
- Large text (≥18pt regular or ≥14pt bold): ≥ 3:1 (AA), ≥ 4.5:1 (AAA)
- UI components and graphical objects: ≥ 3:1

### 5. Document and Prioritize

Build the issue list:

| # | Issue | Element | WCAG | Severity | Fix |
|---|---|---|---|---|---|
| 1 | Missing alt | `img[src="logo.svg"]` | 1.1.1 | A | Add `alt="Company name"` |
| 2 | Low contrast | `.error-text` | 1.4.3 | AA | Change color to `#c00` |
| 3 | Focus lost | Modal close | 2.1.2 | A | Return focus to trigger |

Fix A first, then AA. Track each fix with a re-test step.

## Completion Criteria

- Automated scan run with ≥2 tools
- Keyboard navigation tested across all flows
- Screen reader tested on ≥1 platform
- Contrast ratios checked for all text/background pairs
- Issues ranked by severity (A → AA → AAA)
- Each issue has a fix suggestion with code
- Each fixed issue has a re-test step

## References

- `../accessibility-design/SKILL.md` — design patterns that prevent issues
- `../../frontend/frontend-design/SKILL.md` — visual design integration
- `../../ux/interaction-design/SKILL.md` — interaction patterns
- WCAG 2.1: https://www.w3.org/WAI/WCAG21/quickref/
- axe API: https://github.com/dequelabs/axe-core
