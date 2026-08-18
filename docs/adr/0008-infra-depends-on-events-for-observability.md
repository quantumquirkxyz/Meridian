# ADR-0008: Infra depends on events for observability and opportunity audit

**Date:** 2026-08-18
**Status:** Accepted
**Deciders:** Jhuomar Boskoll Quintero

## Context

ARCHITECTURE.md documents a boundary rule: `infra` depends only on `contracts`. Issue #22 requires the Infra package to provide:
1. An `OpportunityRecorder` that publishes `OpportunityCandidate` instances as `AUDIT_EVENT`s on the `EventBus` (from `@agenttrading/events`).
2. An `ObservabilityService` that subscribes to the `EventBus` and records connector events, graph updates, and data quality state changes as `AUDIT_EVENT`s.

Both classes need the `EventBus` type to publish and subscribe to events. Inlining the bus logic would duplicate the event persistence and deduplication machinery already in `@agenttrading/events`; wrapping it behind a `contracts` interface would add indirection with no real decoupling benefit since both packages are workspace-local and co-versioned.

## Decision

Accept the dependency: `infra` depends on `contracts` and `events`. Update ARCHITECTURE.md accordingly.

## Consequences

- `infra` gains observability and opportunity audit capabilities without duplicating the event bus infrastructure.
- The boundary rule in ARCHITECTURE.md must be updated: `infra` depends on `contracts` and `events`.
- If `events` breaks its API, `infra` must update — this is acceptable because both are workspace-local and co-versioned in the same monorepo.
- The `agents` package boundary (never imports `core`) remains unchanged.
- This follows the same pattern as ADR-0007, which granted `harness` the same exception for backtest and replay.
