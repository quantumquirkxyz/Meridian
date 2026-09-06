---
name: make-project
category: project
maturity: stable
version: 1
description: Use when the user wants a new board in GitHub Projects, or another skill needs one — create the project, wire its fields
capabilities:
  - execute the core process defined in the skill body
  - produce a Markdown artifact or structured result
outputs:
  - Markdown artifact with process steps and completion criteria
sideEffects: []
dependencies: []
stopCondition: All process steps executed; artifact saved; criteria met.
risk: low
trustTier: 1
maxIterations: 6
---

## Contract

- **Input:** problem or task defined by the skill body.
- **Output:** Markdown artifact or structured result with completion criteria met.
- **Side effects:** none (design/review/documentation only unless explicitly stated).
- **Dependencies:** none (self-contained unless linked to other skills).
- **Stop condition:** all process steps completed; artifact saved; criteria checked.
- **Risk:** low.
- **Boundary:** produces reasoning or documentation artifacts; does not modify external systems unless explicitly instructed.


# Make Project

Make a GitHub Projects (V2) **board** from scratch: create it, wire its fields and views, link the repositories it tracks, and populate it with items. Run the full setup every time.

The exact queries and mutations live in [`references/graphql.md`](references/graphql.md) — load it before the first step and use the snippet named in each step.

## Contract

- Input: an owner, a title, and the agreed scope (repos, fields, views, items).
- Output: a live board URL, confirmed by verification.
- Scope: full setup — create, configure, link, populate. Not a quick create-and-done.
- Rule: never create a board that already exists under the same title.
- Rule: item field values are set only after the item is added — you cannot add and update an item in one call.

## Repo Context

Use the current repository's `CONTEXT.md`, `docs/agents/domain.md`, and issue tracker configuration when naming fields, views, and items. Default to portable project fields unless the repo already declares stronger domain fields:

- **Work Type** — feature, bug, chore, docs, research, release, review-fix
- **Repo Scope** — the repository, package, app, service, or module that owns the item
- **Phase** — spec, tickets, ready-for-agent, in-progress, review, blocked, done
- **Priority** — low, medium, high, urgent
- **Risk** — low, medium, high
- **Release Train** — the milestone, train, or target version when the repo uses one

Use the project's domain glossary when adding domain-specific fields. Avoid synonyms the glossary explicitly rejects.

## Steps

### 1. Confirm the target

Ask for or confirm:

- **Owner** — which org or user the board belongs to (default: `quantumquirkxyz`).
- **Title** — exact string.
- **Scope** — which repositories to link, which custom fields and views to create, which items to add, and any field values to set.

Completion: the owner, title, and full scope are written down and agreed before any mutation runs.

### 2. Resolve the owner's node ID

Run `resolve-owner` to get the owner's GraphQL node ID (org, user, or the repo's owner).

Completion: an owner node ID is in hand.

### 3. Check for an existing board

Run `list-boards`; if a board with the exact title already exists, stop and ask — reuse or rename.

Completion: no same-titled board exists, or the user has chosen to reuse or rename.

### 4. Create the board and set its defaults

Run `create-board`. Capture the project's node ID and URL. Then run `update-board` to set the readme/short description and visibility (public or private) to match the agreement.

Completion: the mutation returned a project ID and URL, and description and visibility match the agreement.

### 5. Link repositories

For every repository in the agreed scope, run `link-repo`.

Completion: every agreed repository is linked.

### 6. Add custom fields

For every field in the agreed scope, run `create-field` (single-select, multi-select, text, number, date, or iteration). Capture each field's node ID and, for select fields, its option IDs.

Completion: every agreed field exists with its options, and field and option IDs are captured for the item step.

### 7. Add views

For every view in the agreed scope, run `create-view` (board layout grouped by a field, or table layout).

Completion: every agreed view exists.

### 8. Add items

For every item in the agreed scope, run `add-item` (an existing issue or PR by node ID) or `add-draft` (a draft issue). Capture each item's node ID.

Completion: every agreed item is on the board.

### 9. Set item field values

For every agreed (item, field, value) triple, run `update-item-field`. Do this only after step 8 — you cannot add and update an item in the same call.

Completion: every agreed triple is set.

### 9b. Align metadata with issue labels and milestones

When the source item is an issue or PR that already carries labels or a milestone, make sure the board item fields and the issue metadata do not contradict each other. The board item should express the same Work Type, Repo Scope, Phase, Priority, Risk, Sprint, and Release Train story that the issue labels and milestone already imply.

### 10. Verify and report

Run `verify-board`. Confirm the title, linked repositories, fields, views, and item count all match the agreement. Report the board URL.

Completion: verification matches the agreement on every axis, and the URL is reported.

## Guardrails

- The GraphQL API cannot create Projects **automation rules** (workflows like "auto-add labeled issues" or "move to Done on close") — those are configured in the UI or via GitHub Actions. Say so rather than pretending to set them.
- `updateProjectV2ItemFieldValue` cannot change Assignees, Labels, Milestone, or Repository — those are properties of the issue or PR itself, set through the issue/PR APIs, not the project item.
- Adding an item that's already on the board returns the existing item — no duplicate.
- Global node IDs are required everywhere; never pass REST numeric IDs.
