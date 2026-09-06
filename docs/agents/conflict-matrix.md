# Skill Conflict Matrix

This file records known overlaps, trigger ambiguities, and delegation rules between
quirk Skills. It is the source of truth for routing when more than one skill could
apply to the same request.

## How to read this matrix

| Column | Meaning |
|---|---|
| Primary | The skill that should win when both match |
| Overlap | What the two skills share |
| Rule | The explicit routing rule that resolves the conflict |
| Status | `resolved` = rule is enforced; `known` = documented but not yet enforced by tooling |

## Grilling family

| Primary | Competitor | Overlap | Rule | Status |
|---|---|---|---|---|
| `grill-with-docs` | `grill`, `grill-me`, `grilling` | All share the `/grilling` interview primitive | Use `grill-with-docs` when a codebase exists and the result must be reflected in `CONTEXT.md` and ADRs. Use `grill` or `grill-me` only when there is no codebase or docs must not be mutated. `grilling` is the underlying primitive; do not invoke it directly. | resolved |
| `grill-with-docs` | `wayfinder` | Both sharpen ambiguous intent | `grill-with-docs` handles ideas that fit in one session. `wayfinder` handles effort too large for one session. If the effort is unknown, start with `grill-with-docs` and escalate to `wayfinder` only when the session hits the smart-zone limit before a plan is concrete. | resolved |

## Review family

| Primary | Competitor | Overlap | Rule | Status |
|---|---|---|---|---|
| `review-pr` | `code-review` | Both review diffs against a fixed point along Standards and Spec axes | Use `review-pr` when the target is a GitHub PR that may need the repair workflow (`review-fix-loop`). Use `code-review` for local branches, WIP diffs, or any review that does not need the PR repair loop. | resolved |
| `review-fix-loop` | `implement-review-fixes` | Both apply review findings | `review-fix-loop` orchestrates the full review→plan→implement→re-review cycle. `implement-review-fixes` is a single pass of that cycle; use it only when the plan already exists and the user explicitly asks for one scoped implementation pass. | resolved |

## Spec and ticket family

| Primary | Competitor | Overlap | Rule | Status |
|---|---|---|---|---|
| `to-spec` | `grill-with-docs` | Both can produce a spec | `grill-with-docs` sharpens the idea and writes durable docs; `to-spec` synthesizes the conversation into a published spec issue. Always run `grill-with-docs` before `to-spec` when a codebase exists and the idea is still ambiguous. | resolved |
| `to-tickets` | `wayfinder` | Both decompose work | `to-tickets` splits a spec into tracer-bullet tickets. `wayfinder` produces a map of decision tickets when the path is not yet visible. Use `to-tickets` only after a spec exists. | resolved |

## Routing family

| Primary | Competitor | Overlap | Rule | Status |
|---|---|---|---|---|
| `ask-to` | `capability-router` | Both recommend skills | `ask-to` is the user-facing router with flow awareness (main flow, on-ramps, standalone). `capability-router` is a lower-level primitive that matches declared capabilities; `ask-to` delegates to it internally. Use `ask-to` for user routing; use `capability-router` only inside skills that need capability matching without flow context. | resolved |
| `work-item-router` | `ask-to` | Both read governance before routing | `work-item-router` is a forced pre-read of the governance index; it does not recommend a skill. Run it before any workflow skill when the repo's work-item governance may have changed. | resolved |

## Evaluation and audit family

| Primary | Competitor | Overlap | Rule | Status |
|---|---|---|---|---|
| `evaluate-skill` | `skill-testing-framework` | Both validate skills | `evaluate-skill` checks behavioral fixtures and scenario routes. `skill-testing-framework` runs structural, contract, anti-pattern, and isolated-execution checks. Run both before promotion; `skill-testing-framework` is the stricter gate. | resolved |
| `skill-audit` | `audit-semantics` | Both audit the bundle | `skill-audit` checks bundle parity and lock coverage. `audit-semantics` checks semantic drift, retired names, weak templates, links, and risk signals. `check-all.mjs` runs both in sequence; neither replaces the other. | resolved |

## Cross-cutting concerns

| Primary | Competitor | Overlap | Rule | Status |
|---|---|---|---|---|
| `implement` | `tdd` | Both drive code changes | `implement` calls `tdd` internally at pre-agreed seams. Use `tdd` standalone only when the user explicitly asks for test-first without a full spec or ticket. | resolved |
| `publish-open-pr` | `ship-subissue` | Both touch PR state | `publish-open-pr` opens the PR and leaves it for review. `ship-subissue` merges, closes, and syncs tracker state. Never run `ship-subissue` before `review-pr` reports clean. | resolved |

## Automated enforcement

`validate-skills.mjs` checks for description similarity > 50% and shared capabilities between
any two skills and emits a warning. This matrix is the manual override: a `resolved` entry
explains why a detected overlap is intentional.
