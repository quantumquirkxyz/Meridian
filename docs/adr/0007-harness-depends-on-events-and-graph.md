# ADR-0007: Harness depends on events and graph

**Date:** 2026-08-18
**Status:** Accepted
**Deciders:** Jhuomar Boskoll Quintero

## Context

ARCHITECTURE.md documents a boundary rule: `harness` depends only on `contracts`. Issue #21 requires the Harness to:
1. Fold recorded events into graph snapshots (`foldGraphState` from `@agenttrading/events`)
2. Discover and score opportunities (`findAndScoreRoutes`, `detectCycleCandidates` from `@agenttrading/graph`)

These functions are pure, stateless, and essential for a deterministic backtest pipeline. Inlining them would duplicate ~200 lines of tested graph logic; wrapping them behind a `contracts` interface would add indirection with no real decoupling benefit since both `events` and `graph` are workspace-local and co-versioned.

## Decision

Accept the dependency: `harness` depends on `contracts`, `events`, and `graph`. Update ARCHITECTURE.md accordingly.

## Consequences

- `harness` gains a clean backtest pipeline without duplicating graph-folding or pathfinding logic.
- The boundary rule in ARCHITECTURE.md must be updated: `harness` depends on `contracts`, `events`, and `graph`.
- If `events` or `graph` break their APIs, `harness` must update — this is acceptable because all three are workspace-local and co-versioned in the same monorepo.
- The `agents` package boundary (never imports `core`) remains unchanged.
