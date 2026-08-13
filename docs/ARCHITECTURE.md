# Architecture — Multi-agent CEX/DEX trading system

## Governing principle

> The system can live without agents, but it cannot live without risk, reconciliation, and audit.

No AI agent executes orders. Execution is deterministic and governed by the Risk Engine. See ADR-0003.

## System flow

```
Market Data Engine
    ↓
Normalizer
    ↓
Market Graph Engine
    ↓
Opportunity Scanner
    ↓
StateGraph Orchestrator
    ↓
AI Advisory Layer  →  only comments/classifies/debates/explains
    ↓
Risk Engine        →  authority: approve/reject/reduce
    ↓
Execution Engine   →  the only component that sends approved orders
    ↓
Reconciliation Engine
    ↓
Audit / Event Store
    ↓
Learning Loop      →  generates hypotheses, does not mutate production
```

Mandatory flow per signal: **data → graph → candidate signal → agent review → Risk Engine → OrderIntent → Execution Engine → Reconciliation → Audit → Learning**. No step may skip the Risk Engine.

## StateGraph (deterministic core)

States: `IDLE, INGEST_MARKET_DATA, NORMALIZE_MARKET_STATE, UPDATE_MARKET_GRAPH, DETECT_OPPORTUNITY, BUILD_ORDER_INTENT, REQUEST_AGENT_REVIEW, RISK_VALIDATE, EXECUTION_PRECHECK, EXECUTE_ORDER, RECONCILE, AUDIT_DECISION` plus defensive modes reachable from any state (`HALT, DEGRADED_MODE, CASH_ONLY_MODE, CANCEL_ONLY_MODE, REDUCE_ONLY_MODE`).

Every transition has **guard conditions** and **mandatory audit**. Example: `RISK_VALIDATE → EXECUTION_PRECHECK` only if data quality ≥ threshold, net profit > minimum edge, slippage/latency within limits, venue available, sufficient inventory, exposure within limits, no active circuit breaker, and a valid recent reconciliation.

Base contracts: `StateName`, `StateContext`, `StateNode`, `Transition`, `TransitionGuard`, `GuardResult`, `AgentReview`, `RiskDecision`. All live in `packages/contracts`.

## Agent layers

1. **Perception** — interpret market state, data quality, liquidity, microstructure (Market Data Sentinel, Graph Builder, Liquidity & Microstructure).
2. **Analytical** — generate hypotheses (Arbitrage Alpha, Strategy Research, Market Regime, Inventory).
3. **Deliberative** — compare and debate (Planner/Supervisor, Bull, Bear, Skeptic, Risk Analyst, Execution Advisor).
4. **Control and audit** — consistency and traceability (Audit, Learning, Memory, Policy, Infrastructure Guardian, Reconciliation).
5. **Deterministic non-agentic** — the real authority: Risk Engine, Execution Engine, Reconciliation Engine, Circuit Breakers, Kill Switch.

Data path: `Market data → Graph state → Agent analysis → Candidate signal → Risk decision → Order intent → Execution → Reconciliation → Audit`.

## Permission model

- **Never granted to agents**: `APPROVE_RISK`, `SUBMIT_ORDER`, `SIGN_TRANSACTION`, `MOVE_FUNDS`, `MODIFY_RISK_LIMITS`.
- **Only deterministic engines**: Risk Engine (`APPROVE_RISK`), Execution Engine (`SUBMIT_ORDER`, `CANCEL_ORDER`, `SIGN_TRANSACTION` depending on mode).
- Typical agents: market/state/audit reads + `PROPOSE_SIGNAL` / `PROPOSE_EXECUTION_PLAN` / `PROPOSE_RISK_REVIEW` / `REQUEST_MORE_DATA`. Reconciliation and Infrastructure Guardian may `TRIGGER_DEGRADED_MODE` / `TRIGGER_CANCEL_ONLY`.

## Fallbacks (fail closed)

| Failure | Action |
|---|---|
| Stale data / degraded venue | `DEGRADED_MODE`, block entries |
| Non-critical agent | Continue without it |
| Mandatory agent for review | Reject the operation |
| Risk Engine | `HALT` — never execute |
| Execution Engine | Reconcile, `CANCEL_ONLY_MODE`, alert |
| Failed reconciliation | `HALT` / `REDUCE_ONLY_MODE`, no new positions |
| DEX / RPC | Disable DEX routes, CEX-only if allowed |
| CEX API | Block venue, reconcile on recovery |
| Audit unavailable | Do not trade |

## Monorepo

```
packages/
  contracts    types, schemas, events, reason codes (shared frontier)
  core         StateGraph, Risk, Execution, Reconciliation, Inventory, Loops
  connectors   bybit, pancakeswap-v4, rpc
  graph        MarketGraph, pathfinder, arbitrage-cycles, systemic-risk
  harness      backtest, replay, simulators, stress
  agents       AgentAdapter + runtimes (Vercel AI SDK, Mastra) + agents
  infra        health, failover, circuit breakers, secrets, control TUI
```

Boundary rules: `agents` never imports `core`; `core` never imports LLMs or `connectors` (it uses `contracts`); `graph`, `harness`, `connectors` depend only on `contracts`.

## Persistence

- SQLite (`bun:sqlite`): event store, audit, trade journal (Alpha/Beta). See ADR-0006.
- In-memory event bus; Redis/NATS/Kafka deferred to Gamma.

## Stack

TypeScript + Bun (monorepo). Human control TUI with Ink. Testing with `bun test`. See ADR-0001.
