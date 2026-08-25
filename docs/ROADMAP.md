# Roadmap — Multi-agent CEX/DEX trading system

Structure: **3 SCRUM boards** (Alpha, Beta, Gamma). **Phase Zero** runs as **Sprint 0 of the Alpha board**. Progression is by **eliminated risk**, not feature count. The operational promotion path is defined in `docs/OPERATING_FLOW.md`: `paper` first, `demo` second, `live` last.

- Alpha eliminates data risk.
- Beta eliminates decision and simulated-execution risk.
- Gamma controls real-capital risk.

## Phase Zero — Invariants, contracts, and orchestration (Sprint 0 of Alpha)

Deliverables:
1. Bun monorepo (workspaces) + `packages/contracts` with base types.
2. Minimal StateGraph: `StateContext`, `StateNode`, `Transition`, `TransitionGuard`, `Permission`.
3. Permission system per agent/module.
4. Operational modes: normal, degraded, signal-only, paper-only, cancel-only, reduce-only, cash-only, halt.
5. Risk Engine as the mandatory gate (deterministic authority).
6. Separate Execution Engine (no LLM reasoning).
7. Separate Reconciliation Engine.
8. Mandatory `AuditEvent` per transition.
9. Explicit prohibition of direct execution by AI Agents (boundary test).
10. Unit tests for critical transitions (risk gate, fallbacks).

**Exit criterion:** the system walks a simulated opportunity → reject/approve flow without any LLM, with verifiable permissions and logs.

## Alpha — See the market as a graph and measure it (Alpha board)

**Status: COMPLETE** (ADR-0009, Issue #9)

Agents: Market Data Sentinel, Graph Builder, Liquidity & Microstructure, Strategy Research (shadow), Audit (basic), Infrastructure Guardian (basic). No agents with OrderIntent capability.

Subprojects:
- **Alpha.1 Data Connectors**: Bybit (CEX 1), PancakeSwap v4 on BNB Chain (DEX 1). REST + WebSocket + DEX/RPC, symbol normalization, latency measurement, gaps, and rate-limit handling.
- **Alpha.2 Event Bus**: base events, idempotency keys, replay, persistence.
- **Alpha.3 Market Graph Engine**: nodes/edges, versioned snapshots, pathfinder, cycle detection, net costs, discarding non-executable routes, risk scoring, concentration.
- **Alpha.4 Data Quality Scoring**: HEALTHY / DEGRADED / STALE / DISCONNECTED.
- **Alpha.5 Harness Engineering**: backtest, replay, order book replay, DEX/slippage/gas/funding/latency/partial-fill/API-failure simulators, stress tests, reports.

**Exit criterion (MET):** observes at least one normalized CEX and DEX, functional event bus, versioned graph, candidate routes by net profit, quality scoring, reproducible harness, base observability, no real execution, every hypothesis recorded.

## Beta — Perceive, decide, and act in a safe mode (Beta board)

Agents: all Alpha agents + Arbitrage Alpha, Strategy Research, Market Regime, Planner/Supervisor, Bull, Bear, Skeptic, Risk Analyst, Execution Advisor, Reconciliation, Memory, Audit, Infrastructure Guardian.
Deterministic modules: Risk Engine, Execution Engine (paper), Reconciliation Engine, Circuit Breakers, Position Sizing, Inventory Engine.

Subprojects:
- **Beta.1 Loop Engineering**: data, graph, alpha, debate, risk, execution, reconciliation, audit loops (frequency + stopping criteria).
- **Beta.2 Orchestrator**: state machine, per-agent permissions, handoffs, valid/forbidden routes, timeouts, retry/fallback policy, degraded mode, kill switch.
- **Beta.3 Agent Definitions and Runtime**: AgentRegistry, AgentRuntime, schemas, validation, memory, logging, budget, timeout, deterministic fallback. Hybrid AI SDK + Mastra layer (ADR-0004).
- **Beta.4 Risk Engine**: per-trade/day/week limits, exposure per token/venue/chain, max slippage/gas/latency, min data quality, min edge, min liquidity, max funding, concentration.
- **Beta.5 Paper Execution Engine**: submit ≠ accepted ≠ filled; fill/cancellation/rejection/slippage/fees/funding simulators, WebSocket-style confirmation.
- **Beta.6 Reconciliation Engine**: orders/fills/positions/balances vs external state; detection of orphans and mismatches; cancel-only/halt.
- **Beta.7 Inventory Engine**: balances, free/locked/exposed capital, gas reserves, rebalancing, pre-positioned inventory.

**Exit criterion:** complete loop works, agents produce structured analysis, Risk approves/rejects everything, paper trading operational, reconciliation detects inconsistencies, inventory managed, every decision audited, no real capital, fails closed. Paper completion does not authorize live trading; it only authorizes the separate `demo` phase.

## Gamma — Live canary, adaptation, and hardening (Gamma board)

Agents: all. Additional modules: Live Execution Engine, Deployment Gatekeeper, Strategy Promotion Engine. Temporal optional (durable execution). Agents still never execute directly.

Subprojects:
- **Gamma.1 Live Canary**: bounded capital, few strategies, few venues, small size, max orders/day, very low daily loss, no automatic scaling, manual+automatic kill switch, reduce-only, separate read/trading keys.
- **Gamma.2 Regime Adaptation**: classifier + deterministic policy that changes permissions by regime (trend/range/chop/high volatility/low liquidity/gas spike/degraded RPC or CEX/drawdown).
- **Gamma.3 Governed Learning Loop**: trade journal, performance analysis, edge decay detection; flow live → hypothesis → backtest → paper → review → canary. Never mutates production directly.
- **Gamma.4 Graph Engineering at scale**: opportunities (CEX-CEX, DEX-DEX, CEX-DEX, cross-chain, funding basis, inventory-aware) and systemic risks (concentration, RPC dependence, hidden correlation, evaporated liquidity, long routes).
- **Gamma.5 Infrastructure Hardening**: health checks, heartbeats, WS/REST/RPC failover, queues, rate limits, error budget, secrets, key rotation, runbooks, incident replay, alerting.
- **Gamma.6 Full Audit**: reconstruction of every trade (data → signal → debate → risk → order → fill → reconciliation → PnL), daily/weekly reports, TXT/JSON/CSV export.

**Exit criterion:** operates live with bounded capital, preserves limits, adapts by regime, learns without mutating production directly, failover + kill switch, full audit, safe degradation, scales only with evidence. Entry into Gamma live canary requires `paper` and `demo` evidence plus explicit human approval.
