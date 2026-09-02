# Architecture — Multi-agent CEX/DEX trading system

## Governing principle

> The system can live without agents, but it cannot live without risk, reconciliation, and audit.

No AI agent executes orders. Execution is deterministic and governed by the Risk Engine. See ADR-0003.

## System flow

```
Market Data Connectors (Bybit REST/WS, Binance REST, PancakeSwap RPC)
    ↓
DataQualityMonitor → per-source health tracking
    ↓
Normalizer → MarketDataSnapshot
    ↓
Market Graph Engine → versioned MarketGraph with weighted edges
    ↓
OpportunityDetector → OpportunityCandidate with full cost stack
    ↓
StateGraph Orchestrator
    ↓
AI Advisory Layer → only observes/classifies/debates/explains
    ↓  (when LLM configured: OpenRouter via Vercel AI SDK)
    ↓  (without LLM: deterministic behavioral adapters)
Risk Engine → authority: approve/reject/reduce
    ↓
Execution Engine → the only component that sends approved orders
    ↓
Reconciliation Engine → internal vs exchange state
    ↓
Audit / Event Store → JSONL + SQLite
    ↓
Learning Loop → generates hypotheses, does not mutate production
```

Mandatory flow per signal: **data → graph → candidate signal → agent review → Risk Engine → OrderIntent → Execution Engine → Reconciliation → Audit → Learning**. No step may skip the Risk Engine.

## StateGraph (deterministic core)

States: `IDLE, INGEST_MARKET_DATA, NORMALIZE_MARKET_STATE, UPDATE_MARKET_GRAPH, DETECT_OPPORTUNITY, BUILD_ORDER_INTENT, REQUEST_AGENT_REVIEW, RISK_VALIDATE, EXECUTION_PRECHECK, EXECUTE_ORDER, RECONCILE, AUDIT_DECISION` plus defensive modes reachable from any state (`HALT, DEGRADED_MODE, CASH_ONLY_MODE, CANCEL_ONLY_MODE, REDUCE_ONLY_MODE`).

Additionally, the Orchestrator layer (implemented in `packages/core/src/stategraph/topology.ts`) runs a per-candidate parallel flow with its own states off the canonical backbone: `DEBATING, RISK_CHECKING, APPROVED, REJECTED, EXECUTING, RECONCILING, AUDITING`. Its flow is `BUILD_ORDER_INTENT → DEBATING → RISK_CHECKING → APPROVED → EXECUTING → RECONCILING → AUDITING → IDLE` (and the `REJECTED → AUDITING → IDLE` reject fork), with the same defensive fan-out to `HALT, DEGRADED_MODE, CASH_ONLY_MODE, CANCEL_ONLY_MODE, REDUCE_ONLY_MODE` from every orchestrator state.

Every transition has **guard conditions** and **mandatory audit**. Example: `RISK_VALIDATE → EXECUTION_PRECHECK` only if data quality ≥ threshold, net profit > minimum edge, slippage/latency within limits, venue available, sufficient inventory, exposure within limits, no active circuit breaker, and a valid recent reconciliation.

Base contracts: `StateName`, `StateContext`, `StateNode`, `Transition`, `TransitionGuard`, `GuardResult`, `AgentReview`, `RiskDecision`. All live in `packages/contracts`.

## Agent layers

1. **Perception** — interpret market state, data quality, liquidity, microstructure (Market Data Sentinel, Graph Builder, Liquidity & Microstructure).
2. **Analytical** — generate hypotheses (Arbitrage, Strategy Research, Market Regime, Inventory).
3. **Deliberative** — compare and debate (Planner/Supervisor, Bull, Bear, Skeptic, Risk Analyst, Execution Advisor). Activate with LLM (OpenRouter); deterministic fallback without.
4. **Control and audit** — consistency and traceability (Audit, Learning, Memory, Policy, Infrastructure Guardian, Reconciliation). Behavioral runtimes always available.
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
| No LLM configured | Operate deterministically with behavioral adapters |

## Monorepo

```
packages/
  contracts    types, schemas, events, reason codes (shared frontier)
  core         StateGraph, Risk, Execution, Reconciliation, Inventory, Loops, canary subsystems
  events       in-memory event bus, SQLite event store, deterministic replay
  connectors   bybit (REST/WS), binance (REST), pancakeswap-v4 (RPC + market data)
  chain        on-chain execution (DEXExecutor via viem) — PancakeSwap swaps
  graph        MarketGraph, pathfinder, arbitrage-cycles, systemic-risk
  harness      backtest, replay, simulators (fill/gas/funding/latency/failure), stress
  agents       AgentAdapter + catalog (11 agents) + behavioral runtimes + OpenRouter adapter
  infra        DataQualityMonitor, ObservabilityService, InfrastructureEngine, CanaryControlTUI
  cli          LiveRunner (demo/live), config, manifest, status display
```

Boundary rules: `agents` never imports `core`; `core` never imports LLMs or `connectors` (it uses `contracts`); `events`, `graph`, `connectors` depend only on `contracts`; `chain` depends only on `contracts` and `viem` (on-chain execution seam — this is where real signing/swapping lives, kept out of `connectors` so `connectors` stays dependency-light); `harness` depends on `contracts`, `events`, and `graph` (ADR-0007); `infra` depends on `contracts`, `events`, `ink`, and `react` (ADR-0008, ADR-0010); `cli` depends on `contracts`, `core`, `connectors`, `chain`, `infra`, and `agents` (wiring layer).

## Persistence

- SQLite (`bun:sqlite`): event store, audit, trade journal. See ADR-0006.
- In-memory event bus; Redis/NATS/Kafka evaluated if volume or multi-process needs arise.
- Agent memory: durable JSON storage for behavioral runtime recall.

## LLM Integration

- **Provider:** OpenRouter via OpenAI-compatible API
- **SDK:** Vercel AI SDK (`ai` package) with `@ai-sdk/openai` provider
- **Pattern:** `generateFn` injection — agents package never imports `ai` directly
- **Activation:** When `LLM_API_KEY` is set in `.env`, deliberative agents use real LLM reasoning
- **Fallback:** Without LLM, behavioral adapters (audit, memory, policy) provide deterministic operation

## Stack

TypeScript + Bun (monorepo). Human control TUI with Ink. Testing with `bun test`. See ADR-0001.
