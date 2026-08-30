---
name: ask-to
description: Ask which skill or flow fits your situation. A router over the skills in this repo that recommends the next step without doing the work itself.
disable-model-invocation: true
version: 1
capabilities:
  - route-work
  - select-skill-flow
inputs:
  - user intent
  - repo state
  - available skills
outputs:
  - recommended skill path
  - rationale
  - fallback path
dependencies:
  - context-pack
  - capability-router
sideEffects:
  - recommend-only
stopCondition: A single best next skill path is identified with rationale.
risk: low
---

# Ask To

You don't remember every skill, so ask.

Start by building a minimal fresh context pack and then route against declared capabilities instead of memory.

## Contract

- Input: one user intent, the current repo state, and the available skills registry.
- Output: one recommended skill path, one rationale, and one fallback path only when the choice is genuinely ambiguous.
- Scope: recommend the next skill, not the implementation plan.
- Rule: if the answer is "insufficient context," say what is missing instead of guessing.
- Rule: the recommendation must be grounded in declared capabilities and side effects, not recall.
- Rule: do not draft the spec, issue, PR, or code here; only recommend the next skill path.

A **flow** is a path through the skills. Most paths run along one **main flow**, and two **on-ramps** merge onto it. Everything else is standalone, or a vocabulary layer that runs underneath.

## The main flow: idea → ship

The route most work travels. You have an idea and want it built.

1. **`/grill-with-docs`** — sharpen the idea by interview. Start here when you **have a codebase** and want the result reflected in `CONTEXT.md`, ADRs, and adjacent durable docs. (No codebase? Use `/grill` or `/grill-me` — see Standalone. These run the same `/grilling` primitive; `grill-with-docs` is the one that leaves a paper trail.)
2. **Branch — can you settle every question in conversation?** If a question needs a runnable answer (state, business logic, a UI you have to see), detour through a prototype, bridged by **`/handoff`** in both directions (see Crossing sessions):
   - **`/handoff`** out, then open a fresh session against that file,
   - **`/prototype`** to answer the question with throwaway code,
   - **`/handoff`** back what you learned, and reference it from the original idea thread.
3. **Branch — is this a multi-session build?**
    - **Yes** → **`/to-spec`** (turn the thread into a spec using that skill's spec template), then **`/to-tickets`** to split it into tracer-bullet tickets using that skill's ticket template, each declaring its **blocking edges** and, on a real tracker, as subissues of the spec issue. On a local tracker that's one file per ticket under `.scratch/<feature>/issues/`, worked blockers-first by hand; on a real tracker the edges become native blocking links, so any ticket whose blockers are done can be grabbed — kick off **`/implement`** per ticket, **clearing context between each one**.
   - **No** → **`/implement`** right here, in the same context window.

   Either way, **`/implement`** builds each issue by driving **`/tdd`** internally — one red-green slice at a time — then follows the issue workflow in `AGENTS.md`. When the branch should ship, **`/publish-open-pr`** opens the PR, **`/review-pr`** reviews the PR, and then **`/ship-subissue`** finishes the merge, issue closure, and tracker sync once review is clean. If review finds problems, use **`/review-fix-loop`** to run `/review-pr` -> `/plan-review-fixes` -> `/implement-review-fixes` until Standards and Spec are clean or blocked. Reach for **`/tdd`** on its own when you just want to build a concrete behaviour test-first without a full spec, **`/review-pr`** when a GitHub PR needs a published review, and **`/code-review`** when you want a local branch or working diff reviewed against a fixed point without the PR repair workflow.

### Context hygiene

Keep steps 1–3 in **one unbroken context window** — don't compact or clear until after `/to-tickets` — so the grilling, spec, and tickets all build on the same thinking. Each `/implement` then starts fresh, working from the ticket.

The limit on this is the **[smart zone](https://www.aihero.dev/ai-coding-dictionary/smart-zone)**: the window (~120k tokens on state-of-the-art models) within which the model still reasons sharply. If a session approaches it before `/to-tickets`, don't push on degraded — `/handoff` and continue in a fresh thread.

## Completion criteria

- exactly one primary skill path is recommended
- the rationale distinguishes the chosen path from the nearest alternative
- any fallback path is actionable and named
- missing-context cases are explicit rather than implied

## On-ramps

A starting situation that generates work, then merges onto the main flow.

- **Bugs and requests piling up** → **`/triage`**. It moves issues through triage roles and produces agent-ready issues, which **`/implement`** later picks up.

  Triage is only for issues **you didn't create** — bug reports, incoming feature requests, anything that arrives raw. Tickets that `/to-tickets` produced are already agent-ready, so **don't triage them**.

- **Something's broken** → **`/diagnosing-bugs`**. For the hard ones: the bug that resists a first glance, the intermittent flake, the regression that crept in between two known-good states. It refuses to theorise until it has a **tight feedback loop** — one command that already goes red on *this* bug — then fixes with a regression test. If the post-mortem shows there is no good seam to lock the bug down, route the design repair through **`/codebase-design`** before returning to `/implement`.

- **A huge, foggy effort — a greenfield project or a huge feature build, too big for one session** → **`/wayfinder`**, the most cognitively demanding flow here. When the way from here to the destination isn't visible yet, it charts a **map** of **decision tickets** on the issue tracker and resolves them one at a time — producing **decisions, not deliverables** — until the fog is pushed back and the way is clear. Where **`/grill-with-docs`** sharpens an idea you can hold in one session, wayfinder is for the idea you can't — and it's slower and denser, so save it for exactly that, never a well-scoped feature.

  When the map clears, **it hands off, it doesn't build**: merge onto the main flow at **`/to-spec`**, which collapses the map's linked decisions into a buildable plan, then `/to-tickets` and `/implement` as usual. Looping the map straight into `/implement` skips that collapse and throws the linked detail away — go straight to `/implement` only when the effort turned out genuinely small.

## Codebase health

Not feature work — upkeep.

- **`/codebase-design`** — run when a module's interface, seam, testability, or agent navigability is the actual problem. It surfaces deepening opportunities; picking one generates an idea you can take into the main flow at `/grill-with-docs`.

## Vocabulary underneath

Two model-invoked references that run *beneath* the other skills — each the single source of truth for its vocabulary. Reach for them directly when the **words**, not the process, are the problem; or let the skills above pull them in.

- **`/domain-modeling`** — sharpen the project's *domain* language: challenge a fuzzy term, resolve an overloaded word, and record a hard-to-reverse decision as an ADR. It's the active discipline `/grill-with-docs` drives to keep `CONTEXT.md` a clean project glossary.
- **`/codebase-design`** — the deep-module vocabulary (module, interface, depth, seam, adapter, leverage, locality) for designing a module's *shape*: a lot of behaviour behind a small interface at a clean seam. `/tdd`, `/api-design`, `/frontend-design`, and the stack skills can all speak it.

## Crossing sessions

- **`/handoff`** — when a thread is full or you need to branch off (e.g. into a `/prototype` session), this compacts the conversation into a markdown file. You don't continue in place — you **open a new session and reference that file** to carry the context across. It's the bridge between context windows, in either direction. Use it when you want a **fresh session** but need the **current conversation preserved**.
- **`/compact`** (built-in) — stay in the **same conversation**, letting the earlier turns be summarized. Use it at **intentional breaks between phases**, when you don't mind losing the verbatim history. Don't compact mid-phase — the agent can lose its way. `/handoff` forks; `/compact` continues.

## Standalone

Off the main flow entirely.

- **`/grill`** / **`/grill-me`** — the same relentless interview as `/grill-with-docs`, but for when you have **no codebase** or do not want docs updated. Stateless: it saves nothing locally, builds no `CONTEXT.md`. Reach for it to sharpen any plan or design that doesn't live in a repo.
- **`/prototype`** — a small, throwaway program that answers one design question: does this state model feel right, or what should this UI look like. Throwaway from day one — keep the answer, delete the code. It's the detour in step 2 of the main flow, but reach for it any time a design question is hard to settle on paper.
- **`/research`** — delegate reading legwork to a **background agent**: it investigates a question against **primary sources**, then leaves a cited Markdown file in the repo. Keep working while it reads. The file it produces is something to take *into* the main flow at `/grill-with-docs` — research feeds the thinking, it doesn't replace it.
- **`/plan-review-fixes`** — turn dirty `/code-review` findings into a durable GitHub PR comment headed `Review Fix Plan`. Use it alone when you want a human-readable correction plan before anyone edits code.
- **`/implement-review-fixes`** — read the latest `Review Fix Plan` PR comment, apply the scoped corrections through `/implement`, validate locally, and leave an implementation note. Use it alone when the plan already exists.
- **`/review-fix-loop`** — orchestrate the PR review repair cycle: `/review-pr`, plan, implement, then review again until clean or blocked. Use it when a PR should be driven to a clean review before a ship step.
- **`/writing-great-skills`** — reference for writing and editing skills well.

## Precondition

**`/setup-qquirk-skills`** — run before your first engineering flow to configure the issue tracker, triage labels, and doc layout the other skills assume. Custom issue trackers also work.
