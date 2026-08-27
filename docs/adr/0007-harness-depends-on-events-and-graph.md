# ADR-0007: Harness depends on events and graph

**Date:** 2026-08-18
**Status:** Accepted
**Deciders:** Jhuomar Boskoll Quintero
**Updated:** 2026-08-27

## Context

ARCHITECTURE.md documents a boundary rule: `harness` depends only on `contracts`. Issue #21 requires the Harness to:
1. Fold recorded events into graph snapshots (`foldGraphState` from `@agenttrading/events`)
2. Discover and score opportunities (`findAndScoreRoutes`, `detectCycleCandidates` from `@agenttrading/graph`)

These functions are pure, stateless, and essential for a deterministic backtest pipeline. Inlining them would duplicate ~200 lines of tested graph logic; wrapping them behind a `contracts` interface would add indirection with no real decoupling benefit since both `events` and `graph` are workspace-local and co-versioned.

**Update (2026-08-27):** The Harness must also inject historical market-state into the graph during replay. The rule is **snapshot inmutable**: Harness lifts an ephemeral `MarketGraph` per temporal block, injecting historical weights (`fee`, `gas`, `slippage`, `latency`, `liquidity`, `failureProbability`) without ever mutating the live production graph. If replay crashes, only the ephemeral snapshot is lost; the live graph remains clean. The `Loop` and `MarketGraph` operate in separate domains (time/internal-state vs. space/external-friction); they cross only at `OpportunityCandidate` costeo.

## Decision

Accept the dependency: `harness` depends on `contracts`, `events`, and `graph`. Update ARCHITECTURE.md accordingly. Snapshot-inmutable rule applies: no mutation of the live graph during replay; ephemeral historical graphs are the only vehicle for backtest state injection.

## Consequences

- `harness` gains a clean backtest pipeline without duplicating graph-folding or pathfinding logic.
- The boundary rule in ARCHITECTURE.md must be updated: `harness` depends on `contracts`, `events`, and `graph`.
- If `events` or `graph` break their APIs, `harness` must update — this is acceptable because all three are workspace-local and co-versioned in the same monorepo.
- The `agents` package boundary (never imports `core`) remains unchanged.
- Two loops (arbitrage + inventory) running in parallel reading from the same graph node for balances are prevented by design: `Reconciliation` is the source of balances, not the graph.
