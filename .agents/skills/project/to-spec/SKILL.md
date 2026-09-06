---
name: to-spec
category: project
maturity: stable
version: 1
description: Turn the current conversation into a spec and publish it to the project issue tracker — no interview, just synthesis of 
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


This skill takes the current conversation context and codebase understanding and produces a spec (you may know this document as a PRD). Do NOT interview the user — just synthesize what you already know. Write the published issue body in English, and use the this repo's vocabulary consistently.

The issue tracker and triage label vocabulary should have been provided to you — run `/setup-quirk-skills` if not.
The canonical work-item metadata shape is documented in [`docs/agents/work-item-format.md`](../../../docs/agents/work-item-format.md); follow it for labels, milestone, project, fields, and todo/acceptance structure.

## Contract

- Input: current conversation context, codebase understanding, and repo conventions.
- Output: one published spec issue plus the implementation and testing decisions that make the work buildable.
- Scope: synthesize what is already known; do not reopen discovery interviews.
- Rule: prefer one seam, and make any seam choice explicit before publishing.
- Rule: frame the work in terms of this repo's concepts where relevant: context, harness, loop, graph, data plane, execution plane, observability, and safety boundaries.
- Rule: if the spec cannot be made concrete enough to hand off, stop and say what is still missing.

## Process

1. Build a minimal fresh context pack before broad exploration. Route the task against declared capabilities so the work shape is explicit before you draft the spec. Use the project's domain glossary vocabulary throughout the spec, and respect any ADRs in the area you're touching.

2. Sketch out the seams at which you're going to test the feature. Existing seams should be preferred to new ones. Use the highest seam possible. If new seams are needed, propose them at the highest point you can. The fewer seams across the codebase, the better - the ideal number is one.

Check with the user that these seams match their expectations.

3. Write the spec using `references/spec-template.md`, then publish it to the project issue tracker. Apply the repo defaults from `docs/agents/issue-tracker.md`: for this repo that means labels `spec` plus `ready-for-agent` - no need for additional triage. The entire published issue, including headings, user stories, and notes, must be in English. Also apply the work-item format defaults: set the milestone when one is known, add the issue to the matching project board when relevant, and keep the todo/acceptance content aligned with the metadata.

The template shape still needs the familiar sections that make specs ticket-ready:

- Goals
- Non-goals
- Acceptance Criteria
- Risks and Open Questions

Professional spec standard: the template must be compact, traceable, and ticket-ready. Do not leave placeholder text in the published issue. Use `TBD` only when the unknown is explicitly accepted as an open question.

## Completion criteria

- the problem and solution are stated from the user's perspective
- implementation decisions are concrete enough to guide ticketing
- testing decisions identify external behavior and the intended seam
- scope and out-of-scope items are explicit
- the spec is published with the tracker defaults applied

See `references/spec-template.md` for the canonical shape.
