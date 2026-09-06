# localization

Design internationalization (i18n) and localization (l10n) — string management, locale handling, RTL support, cultural adaptation — so the product works across languages and regions.

## Goals
- Externalize all user-facing strings from code
- Support locale-aware formatting (dates, numbers, currencies)
- Handle RTL layouts and bidirectional text
- Integrate translation workflow with the development process

## Contract

### Input
A product or feature to localize: supported locales, content volume, RTL requirements.

### Output
A localization specification with:
- String extraction and management strategy
- Locale formatting rules
- RTL adaptation plan
- Translation workflow integration

## i18n vs. l10n

| Concern | i18n (internationalization) | l10n (localization) |
|---|---|---|
| What | Code structure | Cultural adaptation |
| Who | Developers | Translators, local teams |
| When | Before shipping | Per locale |
| Examples | String IDs, ICU, format APIs | Translation, dates, currency |

## Steps

1. **Audit user-facing strings** — extract from code, templates, DB
2. **Choose a framework** — ICU MessageFormat, gettext, Fluent
3. **Define locale hierarchy** — en → en-GB → en-AU
4. **Handle formatting** — dates (Intl.DateTimeFormat), numbers, currencies
5. **Adapt UI** — text expansion (±30%), RTL layout, icons
6. **Integrate translations** — TMS integration, glossary, placeholders
7. **Test** — pseudolocalization, native speaker review

## References
- `../cms-architecture/SKILL.md` — content localization
- `../../frontend/frontend-design/SKILL.md` — RTL design
- `../../accessibility/accessibility/SKILL.md` — language in a11y
