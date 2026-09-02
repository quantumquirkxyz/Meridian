# 0009 — Initial system delivery: contracts, StateGraph, data layer, graph engine, and harness

Status: accepted
Date: 2026-08-19 (rewritten 2026-09-01 — removed phase framing per project direction)
Deciders: Jhuomar Boskoll Quintero
Supersedes: Issue #9 (original spec)

## Context

The initial delivery established the foundational infrastructure: typed contracts, a deterministic StateGraph, event-driven data flow, a market graph engine, and a reproducible evaluation harness. This ADR records what was delivered and validates that the exit criteria were met.

## Delivered artifacts

### Packages (7 workspace packages)

```
packages/
  contracts   shared typed frontier: 24 source files, 7 test files
  core        StateGraph, RiskGate, PermissionRegistry, AuditLog, simulated flow
  events      in-memory EventBus, SQLite EventStore, deterministic replay
  connectors  Bybit (CEX), Binance (CEX), PancakeSwap v4 (DEX) normalization
  graph       MarketGraph engine, pathfinding, cycle detection, cost routing
  harness     backtest runner, 5 simulators, stress tests, performance reports
  infra       DataQualityMonitor, OpportunityRecorder, ObservabilityService
```

### Core contracts delivered

| Contract | Purpose |
|----------|---------|
| `MarketDataSnapshot` | Normalized venue observation |
| `MarketGraphSnapshot` | Versioned graph state |
| `EdgeWeights` | 10 weight dimensions per edge |
| `OpportunityCandidate` | Scored hypothesis with cost breakdown |
| `OrderIntent` | Typed candidate order with idempotency and expiry |
| `RiskDecision` | Discriminated union: APPROVE / REDUCE_SIZE / REJECT / defensive |
| `DataQualityReport` | Per-source quality state and score |
| `AuditEvent` | Machine-readable transition record |
| `EventEnvelope` | Bus envelope with idempotency key |
| `StateGraph` contracts | `StateName`, `StateContext`, `Transition`, `TransitionGuard`, `Permission` |
| `SystemMode` | 7 operational modes |
| `CostBreakdown` | 8 cost components per the risk net profit formula |

### Testing

| Package | Test files | Notable coverage |
|---------|-----------|-----------------|
| `contracts` | 7 | Schema validation, data quality scoring, events, contracts |
| `core` | 18 | Permission boundary, fail-closed, simulated flow, risk gate, stategraph |
| `events` | 3 | Store, query, events |
| `graph` | 5 | Market graph, pathfinding, cycle detection, quality |
| `harness` | 7 | Backtest, simulators, stress, report, gate, seed |
| `infra` | 5 | Opportunity recorder, observability, data quality monitor |
| `connectors` | 7 | Bybit REST/WS, Binance, PancakeSwap v4 |
| root | 2 | Workspace smoke, package boundary enforcement |

Total: 1114 tests across 60 files, 0 failures.

## Exit criteria — all met

| Criterion | Status | Evidence |
|-----------|--------|----------|
| ≥1 CEX and ≥1 DEX normalized | ✅ | Bybit + Binance + PancakeSwap v4 connectors |
| Event bus functional | ✅ | `EventBus` + `EventStore` (SQLite, idempotent dedup) |
| Versioned graph | ✅ | `MarketGraph.snapshot()` with monotonic version |
| Candidate routes by net profit | ✅ | `findAndScoreRoutes()`, `detectCycleCandidates()` |
| Quality scoring | ✅ | `evaluateDataQuality()` + `DataQualityMonitor` |
| Reproducible harness | ✅ | xorshift32 PRNG, `sameEventStream()`, deterministic backtest |
| Base observability | ✅ | `ObservabilityService` — connector, graph, data quality audit events |
| No real execution | ✅ | Simulated flow only; no live order submission |
| Every hypothesis recorded | ✅ | `OpportunityRecorder` → AUDIT_EVENT with full cost stack |

## ADRs produced during this delivery

| ADR | Title |
|-----|-------|
| ADR-0001 | TypeScript + Bun monorepo |
| ADR-0002 | Own minimal StateGraph (not LangGraph/AutoGen) |
| ADR-0003 | Agents never execute (permission boundary) |
| ADR-0004 | Hybrid agent layer (Vercel AI SDK + Mastra, updated to OpenRouter) |
| ADR-0005 | No KYC — internal policy only (personal project) |
| ADR-0006 | SQLite persistence (bun:sqlite) |
| ADR-0007 | Harness depends on events and graph |
| ADR-0008 | Infra depends on events for observability |

## Consequences

- The typed contracts, StateGraph, permission model, event bus, graph engine, and harness are the foundation for all subsequent development.
- The boundary rules (agents never import core; core never imports LLMs or connectors) are enforced by compile-time checks and boundary tests.
- The system is ready for operational deployment against exchange endpoints.
