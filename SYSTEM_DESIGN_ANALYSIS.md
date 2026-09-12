# System Design Analysis — Meridian AgentTrading System

**Date:** 2026-09-12  
**Analyst:** Kilo (se-system-design skill)  
**Scope:** Full architecture of the AgentTrading multi-agent algorithmic trading infrastructure

---

## 1. Component Diagram

```mermaid
graph TB
    subgraph "External Systems"
        BYBIT[(Bybit CEX<br/>REST + WS)]
        BINANCE[(Binance CEX<br/>REST)]
        PANCAKE[(PancakeSwap DEX<br/>RPC + Smart Contracts)]
        OPENROUTER[(OpenRouter LLM<br/>API)]
    end

    subgraph "CLI Layer"
        CLI[CLI Entry Point<br/>live-runner.ts]
        CONFIG[Config Loader<br/>loadConfig()]
    end

    subgraph "Orchestration Layer"
        LR[LiveRunner<br/>Session Orchestrator]
        TS[TradingSession<br/>State Graph Orchestrator]
        SG[StateGraph<br/>Mode Transitions]
        KR[KillSwitch<br/>Emergency Controls]
    end

    subgraph "Cognitive Layer (ADR-0013)"
        GA[GeneralAgent<br/>Per Trading Scope]
        SA[Sub-Agents ×11<br/>Catalog: planner, arbitrage, regime,<br/>bull, bear, skeptic, risk, execution,<br/>memory, audit, policy]
        AD[AgentAdapter<br/>LLM or Deterministic]
    end

    subgraph "Core Trading Engine"
        OD[OpportunityDetector<br/>MarketGraph + RouteEngine]
        RE[RiskEngine<br/>18 Rules from RISK.md]
        EE[ExecutionEngine<br/>OrderRouter → Connectors]
        IE[InventoryEngine<br/>Capital/Exposure Tracking]
        RG[ReconciliationEngine<br/>Internal vs Exchange State]
    end

    subgraph "Market Data & Graph"
        MG[MarketGraph<br/>Versioned Directed Weighted Graph]
        GP[GraphEventProcessor<br/>Normalization]
        BD[Bybit Connector<br/>REST + WS]
        BND[Binance Connector<br/>REST]
        PC[PancakeSwap Connector<br/>RPC Market Data]
    end

    subgraph "DEX Execution"
        DEX[DEXExecutor<br/>viem + Private Key]
    end

    subgraph "Infrastructure"
        EV[EventBus + EventStore<br/>SQLite Persistence]
        DQ[DataQualityMonitor<br/>Per-Source Metrics]
        OBS[ObservabilityService<br/>Metrics/Logs/Traces]
        TUI[CanaryControlTUI<br/>Ink/React Operator Console]
        AR[AuditLogger<br/>JSONL + Reconstructor]
    end

    %% Data Flow
    BYBIT -->|Market Data + Orders| BD
    BINANCE -->|Market Data| BND
    PANCAKE -->|Pool Reserves| PC
    PANCAKE -.->|Swap Execution| DEX
    OPENROUTER -.->|LLM Reasoning| AD

    BD -->|MarketDataSnapshot| GP
    BND -->|MarketDataSnapshot| GP
    PC -->|MarketDataSnapshot| GP
    GP --> MG
    MG --> OD
    OD -->|OpportunityCandidate| RE
    RE -->|RiskDecision| LR
    LR -->|OrderIntent| EE
    EE -->|Route to Venue| BD
    EE -.->|DEX Route| DEX
    DEX -.->|On-chain Tx| PANCAKE

    BD -.->|Order Updates| LR
    LR --> IE
    LR --> RG
    RG -->|Unresolved?| KR
    KR -->|HALT| TS
    TS --> SG

    GA --> AD
    AD --> SA
    SA -->|Recommendation| LR

    LR --> AR
    LR --> EV
    LR --> DQ
    LR --> OBS
    TUI -->|Commands| LR
```

---

## 2. Component Responsibilities

| Component | Responsibility | Key Invariants |
|-----------|---------------|----------------|
| **LiveRunner** | Top-level session orchestration; wires all subsystems; manages cycle loop | Single writer to execution engine; owns audit logger |
| **TradingSession** | StateGraph-driven mode transitions; owns operational state | Mode only degrades (NORMAL → HALT); never upgrades autonomously |
| **StateGraph** | Permission registry, guards, audit log, topology | Single source of truth for SystemMode; fail-closed transitions |
| **KillSwitch** | Manual + automatic HALT triggers (drawdown, orphans, reconciliation) | Identical behavior across all modes; blocks all new OrderIntent |
| **GeneralAgent** | Per-scope cognitive coordinator (venue/pool/pair) | One per trading scope; never executes; only recommends |
| **Sub-Agents (11)** | Specialized observation/reasoning roles | Observation-only; no APPROVE_RISK permission |
| **AgentAdapter** | Seam for LLM vs deterministic reasoning | Two adapters: VercelAISDKAdapter (LLM) + ScopeObserverAdapter (deterministic) |
| **OpportunityDetector** | Graph traversal → profitable routes → OpportunityCandidate | Uses canonical cost stack (ADR-0014); minEdgeUsd gate |
| **RiskEngine** | 18 deterministic rules; approves/rejects/reduces OrderIntent | No LLM; fail-closed; loss state mandatory when limits configured |
| **ExecutionEngine** | Only component that sends orders; accepts only approved OrderIntent | Fails closed; idempotency keys; venue routing |
| **InventoryEngine** | Capital, exposure, balance tracking per token/venue/chain | Reads from ReconciliationEngine; never from MarketGraph |
| **ReconciliationEngine** | Compares internal vs exchange state; unresolved → defensive mode | WS drop with partial fill → CANCEL_ONLY; exact math to recover |
| **MarketGraph** | Versioned directed weighted graph (nodes: assets/venues/chains/pools) | Never mutated for backtest; inventory separate |
| **GraphEventProcessor** | Normalizes connector data → MarketDataSnapshot → MarketGraph | Single normalization seam |
| **Connectors (Bybit/Binance/PancakeSwap)** | Venue-specific protocol handling → MarketDataSnapshot | Depends only on contracts; no core imports |
| **DEXExecutor** | On-chain swap simulation + execution via viem | Private key only for signing; market data separate |
| **EventBus/Store** | Idempotent event persistence + deterministic replay | SQLite; append-only; sequence ordering |
| **DataQualityMonitor** | Per-source latency, staleness, gap count, RPC health | Feeds RiskEngine MIN_DATA_QUALITY rule |
| **AuditLogger** | JSONL append-only; session correlation; reconstructor | Every decision, order, fill, mode change recorded |

---

## 3. Data Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
                        TRADING CYCLE (5s default)
└─────────────────────────────────────────────────────────────────────────────┘

1. MARKET DATA INGESTION
   Bybit WS (orderbook.50, trade) ──┐
   Bybit REST (ticker fallback) ────┤
   Binance REST (multi-venue) ──────┼──► GraphEventProcessor ──► MarketGraph
   PancakeSwap RPC (pool reserves) ─┘       (normalize)

2. REGIME CLASSIFICATION
   MarketGraph + price history ──► RegimeClassifier ──► SystemMode (NORMAL/OBSERVE_ONLY/...)

3. OPPORTUNITY DETECTION
   MarketGraph ──► RouteEngine (pathfinding) ──► ScoredRoute (net profit after full cost stack)
   ──► OpportunityDetector ──► OpportunityCandidate (OrderIntent pair + expectedNetProfitUsd)

4. COGNITIVE LAYER (ADR-0013)
   Per-scope GeneralAgent ──► 11 Sub-Agents (via AgentAdapter)
   ──► GeneralAgentRecommendation (signal, confidence, reasoning)

5. RISK EVALUATION (DETERMINISTIC GATE)
   OpportunityCandidate + GeneralAgentRecommendation + Inventory + Reconciliation
   ──► RiskEngine (18 rules) ──► RiskDecision (APPROVE/REJECT/REDUCE/HALT_SYSTEM)

6. CANARY PRE-CHECK (OPERATIONAL LIMITS)
   RiskDecision.APPROVE ──► CanarySession pre-check (capital/exposure/order limits)
   ──► OrderIntent (idempotency key, limits, expiry)

7. EXECUTION
   ExecutionEngine ──► OrderRouter ──► BybitRESTClient.placeOrder() / DEXExecutor.executeSwap()
   ──► WebSocket fill confirmation (AC6)

8. RECONCILIATION (periodic + on WS drop)
   Internal state (orders, positions, balances) vs Exchange state
   ──► Mismatch ──► Defensive mode (CANCEL_ONLY) ──► Exact math ──► NORMAL

9. AUDIT & LEARNING
   Every step → AuditLogger (JSONL)
   Fills → LearningEngine (governed learning loop, 10-cycle cadence)
   ──► Hypotheses → Human review → Iteration
```

---

## 4. Scalability Strategy

| Dimension | Current Approach | Limitation | Recommended Evolution |
|-----------|------------------|------------|----------------------|
| **Horizontal (venues)** | Add connector package (depends only on contracts) | Connector per venue; good isolation | ✅ Current design supports this |
| **Horizontal (scopes)** | One GeneralAgent per (venue, pool, pair) | Linear growth in agent processes | Consider agent pooling for 50+ scopes |
| **Vertical (cycle frequency)** | 5s default; configurable | Bybit WS rate limits (120 req/min) | Sub-second requires WS-only; no REST polling |
| **Data volume** | SQLite event store (single file) | Single writer; ~10K events/sec max | Partition by session; consider TimescaleDB for audit |
| **MarketGraph** | In-memory; full snapshot per cycle | O(nodes×edges) memory; single process | Shard by venue/chain; distributed graph (future) |
| **LLM reasoning** | OpenRouter per sub-agent call | Latency (2-10s); cost; rate limits | Batch sub-agent calls; cache regime classifications |

**Key bottleneck:** The 5s cycle is dominated by LLM calls (when enabled) and market data freshness. Deterministic mode (no LLM) can run faster.

---

## 5. Failure Points & Tolerance

| Failure Point | Detection | Response | Recovery |
|---------------|-----------|----------|----------|
| **Bybit WS disconnect** | `onDisconnected` handler | If partial fill active → CANCEL_ONLY; cancel all; block new | Reconnect with backoff; reconcile; exact math → NORMAL |
| **Bybit REST 429/5xx** | `BybitRESTClient` retry logic | Exponential backoff (1s→2s→4s→max 30s); max 3 retries | Auto-retry; circuit breaker after repeated failures |
| **Reconciliation mismatch** | Periodic + startup check | `ReconciliationEngine` → `unresolved=true` → RiskEngine REJECT | Manual investigation; exact balance correction |
| **Daily/weekly loss limit** | RiskEngine (rolling 24h/7d) | CASH_ONLY / CANCEL_ONLY / HALT_SYSTEM | Human intervention; reset requires new session |
| **LLM API failure** | AgentAdapter timeout/retry | Fallback to deterministic `ScopeObserverAdapter` | Automatic; logs `LLM_ADAPTER_WIRED` failure |
| **DEX RPC failure** | `PancakeSwapMarketDataConnector` health | Marks pool `rpcHealth: "unavailable"`; DataQualityMonitor flags | Multi-RPC fallback; circuit breaker |
| **Private key compromise** | N/A (prevention only) | Withdrawals disabled on API keys; DEX key separate | Rotate keys; revoke sessions |
| **Audit logger unavailable** | `AuditLogger` constructor throws | RiskEngine rule 18: `AUDIT_UNAVAILABLE` → REJECT all | Fix disk/permissions; restart |
| **Kill switch activated** | Manual (TUI) or automatic | `HALT` mode; cancel all; close WS; flush logs | Human review; new session required |

**Fail-closed principle:** Every failure reduces permissions/activity. System never increases risk on error.

---

## 6. Architectural Trade-offs

| Decision | Trade-off | Rationale |
|----------|-----------|-----------|
| **Monorepo with workspace packages** | Single version, easy refactoring vs. independent deploy | Trading system needs atomic cross-package changes; single deploy |
| **Deterministic RiskEngine (no LLM)** | No adaptive risk vs. auditable, testable, no hallucination | Risk is the dominant property; must be explainable |
| **Agent layer observation-only** | No autonomous execution vs. human-aligned control | ADR-0003: "AI Agents do not replace deterministic trading logic" |
| **One GeneralAgent per scope** | More processes vs. isolated failure domains | ADR-0013: scope isolation prevents cascade failures |
| **MarketGraph as in-memory graph** | Fast traversal vs. not durable | Reconciliation provides durability; graph is derived |
| **SQLite for event store** | Simple, embedded vs. not distributed | Single-node trading; replay deterministic; no coordination needed |
| **Bun runtime** | Fast startup, native TS, built-in SQLite vs. smaller ecosystem | Performance-critical; native crypto, WS, SQLite |
| **No external message queue** | Lower latency, simpler ops vs. no durability across crashes | In-process EventBus + SQLite sufficient for single-node |
| **Vercel AI SDK for LLM** | Structured output, streaming vs. vendor lock-in | Adapter pattern isolates; can swap to Mastra |
| **PancakeSwap v4 only (DEX)** | Deep integration vs. limited venues | MVP scope; connector pattern allows Uniswap v3, etc. |

---

## 7. Implicit Assumptions (Risk if Invalid)

| Assumption | If Invalid → Impact |
|------------|---------------------|
| **Bybit Demo Trading ≈ Live behavior** | Demo fills differently; slippage/latency not representative | Live promotion requires evidence (OPERATING_FLOW.md) |
| **Rolling loss windows (not calendar)** | Calendar reset would allow "fresh start" mid-day | Implemented correctly in `trailingWindowLoss()` |
| **Independent edge failures for `failureRiskUsd`** | Correlated failures (e.g., chain outage) underestimate risk | Conservative `maxCorrelationConcentration` (0.8) mitigates |
| **Single-node deployment** | No HA; crash = downtime | Canary limits bound loss; manual restart acceptable |
| **RPC provider honest** | Malicious RPC → bad reserves → bad swaps | Multi-RPC consensus needed for production |
| **OpenRouter model availability** | Model deprecation breaks agent reasoning | `openrouter/auto` fallback; deterministic adapter always works |
| **Gas price estimation accuracy** | `nativePriceUsd` fixed (BNB=$500) | Dynamic oracle needed for high-gas periods |
| **No MEV on BSC** | Sandwich attacks on DEX swaps | `mev-protection.ts` exists but basic; needs flashbots-style |
| **Clock sync with exchanges** | Clock drift → stale data → bad decisions | `measureBybitClockDriftMs` tracked; maxLatencyMs rule |

---

## 8. Improvement Recommendations (Priority Order)

### P0 — Critical (Do Before Live Capital)
1. **Secret management**: Replace `.env` with HashiCorp Vault / AWS Secrets Manager / 1Password CLI injection
2. **DEX private key**: Move to HSM (AWS KMS, Ledger via viem) or dedicated signer process
3. **Multi-RPC consensus**: Require 2/3 RPC agreement for pool reserves before DEX execution
4. **Certificate pinning**: Pin Bybit/Binance TLS certs in connectors

### P1 — High (Before Scaling)
5. **Split god packages** (`core`, `agents`, `infra`) — see Module Depth Analysis
6. **Distributed audit log**: Replicate JSONL to S3/GCS for durability
7. **Circuit breakers**: Add per-venue circuit breakers in `InfrastructureEngine`
8. **MEV protection**: Integrate Flashbots Protect or similar for BSC
9. **Dynamic gas oracle**: Replace fixed `nativePriceUsd` with real-time price feed

### P2 — Medium (Operational Excellence)
10. **Observability stack**: Prometheus + Grafana + Loki for metrics/logs (currently JSONL only)
11. **Automated canary promotion**: Gate live promotion on demo evidence checklist
12. **Agent pooling**: For 50+ scopes, share LLM adapter across GeneralAgents
13. **Backtest CI gate**: Require `quant-backtest` skill pass on strategy changes

### P3 — Long-term (Architecture Evolution)
14. **Multi-node HA**: Leader election for TradingSession; shared EventStore
15. **Distributed MarketGraph**: CRDT or event-sourced graph for multi-process
16. **Policy as code**: Move RiskEngine policy to OPA/Rego for external audit
17. **Formal verification**: Model-check StateGraph transitions (TLA+)

---

## 9. Summary

The Meridian AgentTrading system is a **well-architected, security-conscious trading infrastructure** with:

**Strengths:**
- Clean architectural boundaries (ADR-0001, ADR-0011, ADR-0013)
- Deterministic risk engine as single authority (18 rules, fail-closed)
- Deep modules at boundaries (contracts, graph, connectors, chain, events)
- Comprehensive audit trail with deterministic replay
- Defense-in-depth: RiskEngine + CanarySession + Reconciliation + KillSwitch

**Critical Gaps:**
- Secrets in `.env` (rotate immediately)
- DEX private key in memory (HSM required)
- God packages (`core`, `agents`, `infra`) need splitting
- No TLS cert pinning, no multi-RPC consensus

**Overall Architecture Grade: B+** — Strong foundation with clear seams; operational security hardening needed before live capital at scale.