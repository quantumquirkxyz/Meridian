# ADR-0010: Infra owns the Ink control TUI

**Date:** 2026-08-21
**Status:** Accepted
**Deciders:** Jhuomar Boskoll Quintero

## Context

Issue #33 requires a minimal operator control TUI built with Ink for Beta paper
trading. The control surface belongs with infrastructure concerns: health,
failover, circuit breakers, secrets, observability, and operator intervention.

Before this decision, ADR-0008 documented `infra` as depending on
`contracts` and `events`. Adding the Ink UI introduces two runtime dependencies:
`ink` for terminal rendering and `react` because Ink components are React
components. Leaving that undocumented would make the package boundary
ambiguous.

## Decision

Accept the dependency: `infra` depends on `contracts`, `events`, `ink`, and
`react`. Ink and React are allowed only for the operator control TUI surface.
They must not become a path for LLM frameworks, connectors, or deterministic
core imports into `infra`.

## Consequences

- `infra` can host the Beta operator control TUI without introducing a separate
  package for one UI component.
- Boundary tests must enforce the explicit dependency set rather than the older
  `contracts` + `events` rule.
- If the control UI grows beyond a small operator surface, a future ADR should
  reconsider splitting it into a dedicated UI package.
