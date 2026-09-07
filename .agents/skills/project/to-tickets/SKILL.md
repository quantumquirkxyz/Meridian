---
name: to-tickets
category: project
maturity: stable
version: 1
description: Break a plan, spec, or the current conversation into a set of tracer-bullet tickets, each declaring its blocking edges, 
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


# To Tickets

Break a plan, spec, or conversation into a set of **tickets** — tracer-bullet vertical slices, each declaring the tickets that **block** it.

The issue tracker and triage label vocabulary should have been provided to you — run `/setup-quirk-skills` if not.
The canonical work-item metadata shape is documented in [`docs/agents/work-item-format.md`](../../../docs/agents/work-item-format.md); follow it so tickets, labels, milestones, and project fields stay aligned with specs and boards.

## Contract

- Input: a plan, a spec, or conversation context.
- Output: an ordered set of published tickets with explicit blockers.
- Scope: produce tracer bullets, not a horizontal task dump.
- Rule: frame slices in this repo's terms where relevant: context, harness, loop, graph, data plane, execution plane, observability, and safety boundaries.
- Rule: every ticket must be independently understandable and claimable.
- Rule: every blocking edge must correspond to a genuine prerequisite.
- Rule: every published ticket must carry the canonical metadata from `docs/agents/work-item-format.md` for labels, milestone, project item, and project fields.
- Rule: when the input is corrective, preserve the parent spec metadata and the minimal missing behavior only.

## Process

### 1. Gather context

Build a minimal fresh context pack first, then route the task against declared capabilities so the ticket shape is chosen deliberately. Work from whatever is already in the conversation context. If the user passes a reference (a spec path, an issue number or URL) as an argument, fetch it and read its full body and comments. If the input is a corrective recommendation, inherit the parent requirement quote, blockers, and metadata from the upstream audit output.

### 2. Explore the codebase (optional)

If you have not already explored the codebase, do so to understand the current state of the code. Ticket titles and descriptions should use the project's domain glossary vocabulary, and respect ADRs in the area you're touching. Prefer terms from `CONTEXT.md` when they define the slice boundary more precisely than generic wording.

Look for opportunities to prefactor the code to make the implementation easier. "Make the change easy, then make the easy change."

### 3. Draft vertical slices

Break the work into **tracer bullet** tickets.

<vertical-slice-rules>

- Each slice cuts a narrow but COMPLETE path through every layer (schema, API, UI, tests) — vertical, NOT a horizontal slice of one layer
- A completed slice is demoable or verifiable on its own
- Each slice is sized to fit in a single fresh context window
- Any prefactoring should be done first

</vertical-slice-rules>

Give each ticket its **blocking edges** — the other tickets that must complete before it can start. A ticket with no blockers can start immediately.

If the input is corrective, do not expand scope beyond the missing requirement; publish the smallest ticket that closes the audited gap.

**Wide refactors are the exception to vertical slicing.** A **wide refactor** is one mechanical change — rename a column, retype a shared symbol — whose **blast radius** fans across the whole codebase, so a single edit breaks thousands of call sites at once and no vertical slice can land green. Don't force it into a tracer bullet; sequence it as **expand–contract**. First expand: add the new form beside the old so nothing breaks. Then migrate the call sites over in batches sized by blast radius (per package, per directory), each batch its own ticket blocked by the expand, keeping CI green batch to batch because the old form still exists. Finally contract: delete the old form once no caller remains, in a ticket blocked by every migrate batch. When even the batches can't stay green alone, keep the sequence but let them share an integration branch that all block a final integrate-and-verify ticket — green is promised only there.

### 4. Quiz the user

Present the proposed breakdown as a numbered list. For each ticket, show:

- **Title**: short descriptive name
- **Blocked by**: which other tickets (if any) must complete first
- **What it delivers**: the end-to-end behaviour this ticket makes work

Ask the user:

- Does the granularity feel right? (too coarse / too fine)
- Are the blocking edges correct — does each ticket only depend on tickets that genuinely gate it?
- Should any tickets be merged or split further?

Iterate until the user approves the breakdown.

For corrective inputs, the user approval step may be skipped only when the audit explicitly marked the recommendation as ready for handoff and the user already asked to publish corrections.

## Completion criteria

- every ticket cuts a narrow but complete path through the work
- each ticket has an explicit blocker set or none
- the frontier can be taken without guessing about order
- the user has approved the granularity before publication
- the published tickets follow the canonical metadata shape in `docs/agents/work-item-format.md`

### 5. Publish the tickets to the configured tracker

Publish the approved tickets. **How** depends on the tracker `/setup-quirk-skills` configured — the tickets are the same either way, only the shape of the blocking edges changes:

- **Local files** → write one file per ticket under `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01` in dependency order (blockers first). Each file's "Blocked by" lists the numbers/titles it depends on. Use `references/issue-template.md` for the per-ticket shape — one ticket per file, never a single combined file.
- **A real issue tracker (GitHub, Linear, …)** → publish one issue per ticket in dependency order (blockers first) so each ticket's blocking edges can reference real identifiers. When the input came from `/to-spec`, create the tickets as subissues of that spec issue so the execution tree stays attached to the published spec. Use the platform's native blocking / sub-issue relationship where it has one; otherwise set each ticket's "Blocked by" to the blocking issues. Apply the tracker defaults from `docs/agents/issue-tracker.md`: for this repo that means `ready-for-agent` plus any justified area or priority labels inherited from the source spec or parent issue. The ticket body itself must also be written in English and should preserve this repo's vocabulary rather than backsliding to generic trading wording.

The ticket template still needs the familiar sections that keep slices actionable:

- Acceptance criteria
- Validation
- Blocked by

Work the **frontier**: any ticket whose blockers are all done. For a purely linear chain that means top to bottom.

Do NOT close or modify any parent issue.

See `references/issue-template.md` for the canonical ticket shape.
