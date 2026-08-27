# ADR-0010: Infra owns the Ink control TUI

**Date:** 2026-08-21
**Status:** Accepted
**Deciders:** Jhuomar Boskoll Quintero
**Updated:** 2026-08-27

## Context

Issue #33 requires a minimal operator control TUI built with Ink for Beta paper
trading. The control surface belongs with infrastructure concerns: health,
failover, circuit breakers, secrets, observability, and operator intervention.

Before this decision, ADR-0008 documented `infra` as depending on
`contracts` and `events`. Adding the Ink UI introduces two runtime dependencies:
`ink` for terminal rendering and `react` because Ink components are React
components. Leaving that undocumented would make the package boundary
ambiguous.

**Update (2026-08-27):** Operator intervention via the TUI (e.g. panic button) raises the question of who holds authority to change `SystemMode`. The TUI must not mutate `SystemMode` or `StateGraph` directly. Its role is strictly unidirectional event emission.

## Decision

Accept the dependency: `infra` depends on `contracts`, `events`, `ink`, and
`react`. Ink and React are allowed only for the operator control TUI surface.
They must not become a path for LLM frameworks, connectors, or deterministic
core imports into `infra`.

**TUI authority rule (2026-08-27):** The TUI is a pure event emitter, not a mutation layer. When the operator presses the panic button, `infra` publishes a typed event (e.g. `OperatorHaltRequested`) to the event bus — it does not set `SystemMode` or transition `StateGraph`. The `StateGraph` / orchestrator consumes this event, evaluates it deterministically, and transitions the system to `HALT` / `CANCEL_ONLY_MODE` with mandatory audit. The `Execution Engine` blocks or rejects pending `OrderIntent` according to the new mode. Permitting the TUI to mutate state directly would break traceability and introduce a race condition where a recently approved `OrderIntent` could reach the market before the mode change takes effect.

## Consequences

- `infra` can host the Beta operator control TUI without introducing a separate
  package for one UI component.
- Boundary tests must enforce the explicit dependency set rather than the older
  `contracts` + `events` rule.
- If the control UI grows beyond a small operator surface, a future ADR should
  reconsider splitting it into a dedicated UI package.
- Event-driven panic protocol: TUI emits → bus propagates → `StateGraph` transitions → audit records → `Risk Engine` enforces new mode. No direct write path from `infra` to `StateGraph` or `SystemMode`.
