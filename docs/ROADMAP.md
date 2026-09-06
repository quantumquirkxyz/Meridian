# Roadmap — Multi-agent CEX/DEX trading system

Progression is by **eliminated risk**, not feature count. Work is grouped by engineering area, not by phase. The operational promotion path is defined in `docs/OPERATING_FLOW.md`: `demo` first, `live` last.

## Invariants, contracts, and orchestration

1. Bun monorepo (workspaces) + `packages/contracts` with base types.
2. Minimal StateGraph: `StateContext`, `StateNode`, `Transition`, `TransitionGuard`, `Permission`.
3. Permission system per agent/module.
4. Operational modes: normal, degraded, signal-only, cancel-only, reduce-only, cash-only, halt.
5. Risk Engine as the mandatory gate (deterministic authority).
6. Separate Execution Engine (no LLM reasoning).
7. Explicit prohibition of direct execution by AI Agents (boundary test).
8. Mandatory `AuditEvent` per transition.
9. Default-fail-safe: any data, risk, execution, reconciliation, or audit failure reduces permissions.

**Exit criterion (MET):** the system walks a simulated opportunity → reject/approve flow without any LLM, with verifiable permissions and logs.

## Market data foundation — COMPLETE (ADR-0009, Issue #9)

Deterministic loops (not cognitive agents): Market Data Sentinel, Data Quality, Graph Builder, Liquidity & Microstructure, Strategy Research (shadow), Audit (basic), Infrastructure Guardian (basic). No agents with `OrderIntent` capability.

- **Data Connectors**: Bybit (CEX), PancakeSwap v4 on BNB Chain (DEX). REST + WebSocket + DEX/RPC, symbol normalization, latency measurement, gaps, and rate-limit handling.
- **Event Bus**: base events, idempotency keys, replay, persistence.
- **Market Graph Engine**: nodes/edges, versioned snapshots, pathfinder, cycle detection, net costs, discarding non-executable routes, risk scoring, concentration.
- **Data Quality Scoring**: HEALTHY / DEGRADED / STALE / DISCONNECTED.
- **Harness Engineering**: backtest, replay, order book replay, DEX/slippage/gas/funding/latency/partial-fill/API-failure simulators, stress tests, reports.

**Exit criterion (MET):** observes at least one normalized CEX and DEX, functional event bus, versioned graph, candidate routes by net profit, quality scoring, reproducible harness, base observability, no real execution, every hypothesis recorded.

## Cognitive layer

Consultative agents (catalog of 11): Planner/Supervisor, Arbitrage-Alpha, Market Regime, Bull, Bear, Skeptic, Risk Analyst, Execution Advisor, Memory, Audit, Policy — observation-only, deployed per trading scope as sub-agents of a general agent (ADR-0013).

- **Agent Definitions and Runtime**: AgentRegistry, AgentRuntime, schemas, validation, memory, logging, budget, timeout, deterministic fallback. Hybrid AI SDK + Mastra layer (ADR-0004). General-agent deployment per trading scope — (venue × pool × pair) on DEX, (venue × pair) on CEX; the 11 consultative sub-agents bound per scope (ADR-0013).

## Orchestration and loops

- **Loop Engineering**: data, graph, alpha, debate, risk, execution, reconciliation, audit loops (frequency + stopping criteria).
- **Orchestrator**: state machine, per-agent permissions, handoffs, valid/forbidden routes, timeouts, retry/fallback policy, degraded mode, kill switch.

## Risk, execution, and inventory

- **Risk Engine**: per-trade/day/week limits, exposure per token/venue/chain, max slippage/gas/latency, min data quality, min edge, min liquidity, max funding, concentration.
- **Simulated Execution Engine**: submit ≠ accepted ≠ filled; fill/cancellation/rejection/slippage/fees/funding simulators, WebSocket-style confirmation.
- **Reconciliation Engine**: orders/fills/positions/balances vs external state; detection of orphans and mismatches; cancel-only/halt.
- **Inventory Engine**: balances, free/locked/exposed capital, gas reserves, rebalancing, pre-positioned inventory.

**Exit gate:** complete loop works, agents produce structured analysis, Risk approves/rejects everything, reconciliation detects inconsistencies, inventory managed, every decision audited, no real capital, fails closed. This does not authorize live trading; it authorizes the separate `demo` mode.

## Live readiness, adaptation, and hardening

Additional modules: Live Execution Engine, Deployment Gatekeeper, Strategy Promotion Engine. Temporal optional (durable execution). Agents still never execute directly.

- **Live Canary**: bounded capital, few strategies, few venues, small size, max orders/day, very low daily loss, no automatic scaling, manual+automatic kill switch, reduce-only, separate read/trading keys. One general agent per trading scope in the canary — (venue × pool × pair) on DEX, (venue × pair) on CEX; agent reasoning never raises capital limits.
- **Regime Adaptation**: classifier + deterministic policy that changes permissions by regime (trend/range/chop/high volatility/low liquidity/gas spike/degraded RPC or CEX/drawdown).
- **Governed Learning Loop**: trade journal, performance analysis, edge decay detection; flow live → hypothesis → backtest → review → canary. Never mutates production directly.
- **Graph Engineering at scale**: opportunities (CEX-CEX, DEX-DEX, CEX-DEX, cross-chain, funding basis, inventory-aware) and systemic risks (concentration, RPC dependence, hidden correlation, evaporated liquidity, long routes).
- **Infrastructure Hardening**: health checks, heartbeats, WS/REST/RPC failover, queues, rate limits, error budget, secrets, key rotation, runbooks, incident replay, alerting.
- **Full Audit**: reconstruction of every trade (data → signal → debate → risk → order → fill → reconciliation → PnL), daily/weekly reports, TXT/JSON/CSV export.

**Exit gate:** operates live with bounded capital, preserves limits, adapts by regime, learns without mutating production directly, failover + kill switch, full audit, safe degradation, scales only with evidence. Entry into the live canary requires `demo` evidence plus explicit human approval.