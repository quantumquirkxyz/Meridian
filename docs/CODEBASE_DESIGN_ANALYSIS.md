# Codebase Design Analysis — Meridian AgentTrading

**Date:** 2026-09-19  
**Analyst:** Kilo (codebase-design skill)  
**Scope:** All packages in `/home/quantumquirkxyz/Meridian/packages/*`  
**Purpose:** Audit module shape, seam placement, depth, and scalability for a live trading infrastructure

---

## Executive Summary

| Package | Depth | Primary Seam | Scalability Assessment |
|---------|-------|--------------|------------------------|
| `@agenttrading/contracts` | **Deep** | Type definitions + `Validator<T>` | ✅ Excellent — zero deps, all packages depend on it |
| `@agenttrading/graph` | **Deep** | `MarketGraph` + pathfinding functions | ✅ Excellent — pure computation, in-process |
| `@agenttrading/core` | **Mixed** | Multiple seams, barrel antipattern | ⚠️ Scalability risk — 30+ exports from one barrel |
| `@agenttrading/connectors` | **Deep** | Per-venue connector interfaces | ✅ Excellent — clean boundary, depends only on contracts |
| `@agenttrading/chain` | **Deep** | `DEXExecutor` | ✅ Excellent — single responsibility, viem adapter |
| `@agenttrading/agents` | **Shallow barrel** | Multiple divergent concerns | ⚠️ Scalability risk — 15+ distinct interfaces |
| `@agenttrading/infra` | **Shallow** | Multiple divergent concerns | ⚠️ Scalability risk — TUI + observability + health |
| `@agenttrading/events` | **Deep** | `EventBus` + `EventStore` | ✅ Excellent — SQLite persistence + replay |
| `@agenttrading/harness` | **Deep** | Simulator/backtest functions | ✅ Excellent — pure computation |
| `@agenttrading/cli` | **Shallow (by design)** | `LiveRunner` + config loader | ✅ Correct — thin composition root |

**Overall verdict:** The boundary packages (`contracts`, `graph`, `connectors`, `chain`, `events`, `harness`) are well-designed deep modules. The orchestration layer (`core`, `agents`, `infra`) suffers from barrel antipatterns that will block scaling to more venues, pairs, and agent configurations.

---

## 1. Module Interface Analysis

### 1.1 `@agenttrading/contracts` — DEEP ✅

**Interface:** Type definitions + `Validator<T>` runtime schema validators  
**Implementation:** 35 files, ~2,500 lines of pure TypeScript  
**Dependencies:** None (by design — ADR-0001)

**Why deep:**
- Small interface: `Validator<T>` is a single function type `(v: unknown) => v is T`
- Huge leverage: every package in the monorepo depends on this for type safety + runtime validation
- Zero dependencies = zero supply chain risk
- Testable directly: validators are pure functions

**Seam placement:** Correct. The seam *is* the TypeScript type system + runtime validators. No adapter needed.

**Deletion test:** If deleted, every other package loses its typed contracts and validation. Complexity would reappear as ad-hoc validation in 9 callers.

---

### 1.2 `@agenttrading/graph` — DEEP ✅

**Interface:** `MarketGraph` class + 8 pathfinding functions (`findRoutes`, `computeRouteCost`, etc.)  
**Implementation:** `MarketGraph` (nodes/edges/snapshots), `GraphEventProcessor`, `pathfinding.ts` (~1,200 lines)  
**Dependencies:** Only `@agenttrading/contracts`

**Why deep:**
- `MarketGraph` encapsulates complex graph operations (versioned snapshots, cycle detection, cost aggregation) behind ~10 methods
- Pathfinding functions are pure, composable, tested in isolation
- In-process dependency (category 1) — fully deepenable

**Seam placement:** Correct. The external seam is the `MarketGraph` class + pathfinding functions. Internal seams (e.g., `GraphEventProcessor`) are private.

**Deletion test:** If deleted, route discovery, cost computation, and cycle detection logic would need to be reimplemented in `@agenttrading/core` (OpportunityDetector) and `@agenttrading/harness`.

---

### 1.3 `@agenttrading/core` — MIXED ⚠️

**Current state:** Barrel file exports **30+ modules** from a single entry point.

**Deep modules (good):**

| Module | Interface | Why Deep |
|--------|-----------|----------|
| `RiskEngine` | `evaluate(input: RiskGateInput): RiskDecision` | 18 rules, complex logic, single method |
| `TradingSession` | `start()`, `control()`, `wireAgentAdapter()` | Orchestrates full cycle; hides subsystem wiring |
| `ReconciliationEngine` | `reconcile(input): ReconciliationReport` | Pure computation, deterministic |
| `OpportunityDetector` | `ingestMarketData()`, `detect()` | Encapsulates graph traversal + cost stack |
| `LoopEngine` | `runCycle()` | Encapsulates loop logic |
| `InventoryEngine` | `updateBalances()`, `getAvailableCapital()` | Encapsulates inventory logic |

**Shallow modules (should be internal or split):**

| Module | Issue |
|--------|-------|
| `stategraph/*` (6 files) | Permission registry, guards, topology, audit-log, state-graph, orchestrator — tightly coupled, could be one module |
| `execution/*` (4 files) | Simulated engine, audit logger, trade record, session report — split by concern but shallow individually |
| `live/*` (18 files!) | Kill switch, live execution, canary session, regime classifier, route engine, stats, trade journal, edge decay, promotion pipeline, learning engine, systemic risk, audit reconstructor, report generator, audit exporter, audit availability, opportunity detector — **too many shallow modules** |

**Seam issue:** The barrel file (`src/index.ts`) re-exports everything, forcing callers to learn 30+ distinct interfaces. This violates the "small interface" principle.

**Recommendation:** Split `core` into focused sub-packages:
```
@agenttrading/core-risk          # RiskEngine + policy
@agenttrading/core-execution     # Execution engines + audit
@agenttrading/core-reconciliation # ReconciliationEngine
@agenttrading/core-session       # TradingSession + LoopEngine
@agenttrading/core-inventory     # InventoryEngine
@agenttrading/core-stategraph    # StateGraph + permission + guards (internal)
```

**Rationale:** Each sub-package above has a clear single responsibility and deep interface. The barrel creates a "god package" where callers import everything.

---

### 1.4 `@agenttrading/connectors` — DEEP ✅

**Interface per venue:**
- **Bybit:** `BybitRESTClient` (placeOrder, cancelOrder, getAccountInfo, getPositions) + `BybitWebSocketClient` (onMarketData, onOrderUpdate events)
- **Binance:** `BinanceRESTClient` + `buildBinanceSnapshot()`
- **PancakeSwap:** `PancakeSwapMarketDataConnector` (`fetchSnapshots()`)

**Why deep:**
- Each connector encapsulates venue-specific protocol details (REST signing, WS auth, RPC calls)
- Normalizes to `MarketDataSnapshot` contract — callers don't know Bybit vs Binance vs PancakeSwap
- Depends only on `@agenttrading/contracts` (enforced by ARCHITECTURE.md)

**Seam placement:** Correct. The seam is the connector interface. Internal: HMAC signing, WS reconnection, RPC batching are hidden.

**Deletion test:** If deleted, `LiveRunner` and `cli` would need to reimplement all exchange protocols.

**Scalability:** Adding a new venue (e.g., Uniswap) means adding one new connector file. The interface is stable. ✅

---

### 1.5 `@agenttrading/chain` — DEEP ✅

**Interface:** `DEXExecutor` class with:
- `getPoolReserves()`
- `simulateSwap()`
- `executeSwap()`
- `waitForTransaction()`
- `getGasInfo()`
- `getNonce()`

**Implementation:** ~430 lines wrapping `viem` (public + wallet clients)

**Why deep:**
- Single responsibility: on-chain DEX execution
- Hides `viem` complexity (ABI, chain config, wallet client, gas estimation)
- Testable via injected `fetchFn` / `wsFactory` / `nowMs`

**Seam placement:** Correct. The seam is `DEXExecutor`. Production uses viem; tests can inject fakes.

**Deletion test:** If deleted, `LiveRunner` loses DEX execution capability entirely.

---

### 1.6 `@agenttrading/agents` — SHALLOW BARREL ❌

**Current exports (from `index.ts`):**
- Core adapter: `BaseAgentAdapter`, `AgentAdapter`
- Config: `AgentConfig`, `createDefaultAgentConfig`, `RUNTIME_TYPES`
- Registry: `AgentRegistry`, `CONSULTATIVE_AGENT_CATALOG`
- Memory: `AgentMemory`, behavioral adapters (4)
- Logger: `AgentLogger`
- Budget: `BudgetEnforcer`
- Runtime: `AgentRuntime`
- General agent: `GeneralAgent`, `deployPerScopeGeneralAgents`
- Plus re-exports 20+ types from `@agenttrading/contracts`

**Problems:**
1. **Too many exports** — callers must learn 15+ distinct interfaces
2. **Runtime adapters leaked** — `VercelAISDKAdapter`, `createOpenRouterGenerateFn` should be subpath-only (package.json exports them correctly, but barrel re-exports contracts types unnecessarily)
3. **Divergent concerns** — config, registry, memory, logger, budget, runtime, general agent = 7 reasons to change
4. **GeneralAgent is deep but buried** — `GeneralAgent` + `deployPerScopeGeneralAgents` is the real deep module here

**Seam issue:** The barrel forces callers to import the entire agents surface even if they only need one concern.

**Recommendation:** Split into:
```
@agenttrading/agents-core        # AgentAdapter, AgentConfig, AgentRegistry, AgentMemory, BudgetEnforcer, AgentLogger
@agenttrading/agents-catalog     # CONSULTATIVE_AGENT_CATALOG, behavioral adapters
@agenttrading/agents-general     # GeneralAgent, deployPerScopeGeneralAgents (THE deep module)
@agenttrading/agents-runtime-vercel   # VercelAISDKAdapter (subpath export)
@agenttrading/agents-runtime-mastra   # Mastra adapter (subpath export)
@agenttrading/agents-runtime-openrouter # OpenRouter adapter (subpath export)
```

**Why:** The "general agent per scope" (ADR-0013) is the deep module. Everything else is infrastructure for it.

---

### 1.7 `@agenttrading/infra` — SHALLOW ❌

**Exports:**
- `DataQualityMonitor` — health tracking per source
- `OpportunityRecorder` — audit of opportunities
- `ObservabilityService` — metrics/logs/traces
- `InfrastructureEngine` — health/failover/circuit breakers
- `CanaryControlTuiModel` — Ink TUI for operator control

**Problems:**
- **Divergent change**: TUI, observability, data quality, opportunity recording, infrastructure health — 5 unrelated reasons to change
- **CanaryControlTuiModel** is large (~500 lines) with Ink/React deps — should be its own package
- **InfrastructureEngine** is a "middle man" — delegates to other modules

**Seam issue:** One package, five unrelated concerns. Any change to the TUI forces a rebuild of the observability module.

**Recommendation:** Split into:
```
@agenttrading/infra-observability    # ObservabilityService, DataQualityMonitor
@agenttrading/infra-opportunity-audit # OpportunityRecorder
@agenttrading/infra-control          # InfrastructureEngine, CanaryControlTuiModel (or move TUI to cli)
@agenttrading/infra-secrets          # (future) secrets management
```

---

### 1.8 `@agenttrading/events` — DEEP ✅

**Interface:** `EventBus` (publish, subscribe) + `EventStore` (SQLite persistence, replay)  
**Implementation:** In-memory bus with idempotency + SQLite store with prepared statements

**Why deep:**
- Encapsulates event persistence, deduplication, replay, time-range queries
- Pure in-process (category 1) — fully testable with `:memory:` DB
- Single responsibility: event durability + ordering

**Seam placement:** Correct. `EventStore` is the deep module; `EventBus` is a thin adapter over it.

---

### 1.9 `@agenttrading/harness` — DEEP ✅

**Interface:** Simulator functions, backtest runner, stress test orchestrator  
**Dependencies:** `@agenttrading/contracts`, `@agenttrading/graph`, `@agenttrading/events`

**Why deep:**
- Encapsulates simulation logic (fill simulators, market generators, stress scenarios)
- Pure computation — testable deterministically

---

### 1.10 `@agenttrading/cli` — SHALLOW (by design) ✅

**Interface:** `LiveRunner` + `loadConfig()`  
**Implementation:** Thin orchestration — wires together all other packages

**Why shallow is correct here:**
- CLI *should* be thin — it's the composition root
- `LiveRunner` is deep internally (orchestrates session, connectors, agents, risk)
- Config loader validates and merges — good seam

---

## 2. Dependency Graph Health

```
contracts (zero deps)
  ├── graph
  ├── events
  ├── connectors
  ├── chain
  ├── agents
  └── core
       ├── graph
       └── events (via harness)
            ├── harness
            └── infra
                 ├── events
                 └── cli (wiring layer)
                      ├── core
                      ├── agents
                      ├── chain
                      ├── connectors
                      └── infra
```

**Assessment:** The dependency graph is correctly layered. No circular dependencies. The boundary rules from ARCHITECTURE.md are enforced:
- `agents` never imports `core` ✅
- `core` never imports LLMs or `connectors` ✅
- `chain` depends only on `contracts` + `viem` ✅
- `cli` is the wiring layer ✅

**Scalability concern:** As more venues and pairs are added, the `core` barrel will become a compilation bottleneck. Splitting `core` into sub-packages will improve build times and enable independent testing.

---

## 3. Critical Seam Issues

### 3.1 RouteEngine vs. Pathfinding — Conflicting Net-Profit Formulas

**Issue:** Two independent aggregators compute `expectedNetProfitUsd` differently:

| Term | `pathfinding.ts` (`scoreRoute`) | `route-engine.ts` (`aggregateEdgeWeights`) |
|------|--------------------------------|-------------------------------------------|
| Slippage, fees, gas, funding | summed per edge | subtracts fee/slippage/gas/funding from each edge's `price` |
| Latency risk | added at $0.001/ms | **omitted** |
| Failure risk | `combinedFailureProbability * 100` | **omitted** |
| Bridge cost | `w.fee` for BRIDGE edges | **omitted** |
| Safety buffer | added (default $1.0) | **omitted** |
| Aggregation | **sum** | **min-edge** |

**Impact:** The number that gates order approval (`risk-gate.ts:532-541`) is not unique. A route can be "profitable" under one model and not the other.

**Seam proposal:** Extract a single `CostStackAggregator` module in `@agenttrading/graph` or a new `@agenttrading/risk` package. Both `pathfinding.ts` and `route-engine.ts` must consume this single source of truth.

**Why this is the highest-priority seam:** This is a financial correctness issue, not just a design issue. The ADR-0014 already mandates this fix; the implementation is pending.

---

### 3.2 StateGraph Internal Coupling

**Issue:** Six files in `core/src/stategraph/` (`permission-registry`, `audit-log`, `guards`, `topology`, `state-graph`, `orchestrator`) are tightly coupled and change together.

**Seam proposal:** Merge into a single `StateGraph` module with internal helpers. The external seam remains `StateGraph` + `StateGraphOptions` + `TransitionInput` + `TransitionOutcome`.

**Rationale:** These six files are never used independently. They form one conceptual module. Keeping them separate adds navigational overhead without adding testability.

---

### 3.3 GeneralAgent Deep Module Buried in Shallow Barrel

**Issue:** `GeneralAgent` + `deployPerScopeGeneralAgents` is the real deep module in `agents`, but it's buried under 15+ other exports.

**Seam proposal:** Extract `GeneralAgent` into its own package (`@agenttrading/agents-general`). The general agent is the cognitive coordinator per trading scope (ADR-0013) and has a clear, stable interface:
```typescript
interface GeneralAgent {
  cycle(input: GeneralAgentCycleInput): Promise<GeneralAgentCycleResult>;
}
```

**Why deep:** One method, complex internal coordination of 11 sub-agents, scoped inputs, scoped state, auditable recommendation per cycle.

**Deletion test:** If deleted, the entire cognitive layer disappears. Complexity would reappear in `cli` (LiveRunner) as inline agent orchestration.

---

## 4. Scalability Assessment

### 4.1 Current Scalability Limits

| Dimension | Current State | Limit |
|-----------|--------------|-------|
| Venues | 2 CEX + 1 DEX | `connectors` scales linearly; `core` barrel is the bottleneck |
| Pairs per venue | Configurable | `GeneralAgent` per scope is correct (ADR-0013) |
| Sub-agents per scope | 11 catalog agents | `agents` barrel scales poorly with more roles |
| Event volume | Single-process SQLite | `events` package is single-process; ADR-0006 flags multi-process ceiling |
| Build time | Monorepo with 10 packages | `core` barrel forces full rebuild on any change |

### 4.2 Path to Scale

**Short-term (1-2 weeks):**
1. Extract `CostStackAggregator` to fix ADR-0014 (single source of truth for net profit)
2. Merge `stategraph/*` into one module
3. Split `agents` into `agents-core`, `agents-catalog`, `agents-general`, runtime subpaths

**Medium-term (1-2 months):**
4. Split `core` into `core-risk`, `core-execution`, `core-reconciliation`, `core-session`, `core-inventory`, `core-stategraph`
5. Split `infra` into `infra-observability`, `infra-opportunity-audit`, `infra-control`
6. Move `CanaryControlTuiModel` to `cli` or keep in `infra-control`

**Long-term (3+ months):**
7. Evaluate multi-process `events` (Redis/NATS/Kafka) if volume demands it (ADR-0006 follow-up)
8. Extract `MarketGraph` to a standalone library if state graph grows beyond ~50 states (ADR-0002 follow-up)

---

## 5. Seam Discipline Checklist

| Seam | Adapters (Prod + Test) | Status |
|------|------------------------|--------|
| `MarketGraph` | In-memory (prod + test) | ✅ One adapter = hypothetical; but it's pure computation so OK |
| `BybitRESTClient` | Real HTTP + `fetchFn` mock | ✅ Two adapters |
| `BybitWebSocketClient` | Real WS + `wsFactory` mock | ✅ Two adapters |
| `DEXExecutor` | viem + injected fakes | ✅ Two adapters |
| `RiskEngine` | Policy config (prod + test) | ✅ Configuration-driven |
| `TradingSession` | Real subsystems + test doubles | ✅ Multiple injected deps |
| `EventStore` | SQLite file + `:memory:` | ✅ Two adapters |
| `AgentAdapter` | `VercelAISDKAdapter` + `ScopeObserverAdapter` | ✅ Two adapters (LLM + deterministic) |
| `GeneralAgent` | LLM adapter + behavioral adapters | ✅ Multiple adapters per ADR-0013 |
| `CostStackAggregator` | **MISSING** — two competing implementations | ❌ **Critical** |

**One adapter means a hypothetical seam. Two adapters means a real one.** The `CostStackAggregator` has two competing implementations, which means the seam is real but uncontrolled. This is the highest-priority fix.

---

## 6. Completion Criteria

- [x] Module interfaces described in terms callers can use
- [x] Seam choices justified by depth, leverage, and locality
- [x] Adapter roles explicit
- [x] Recommendations concrete enough to test against
- [x] What stays hidden behind each interface is named
- [x] Critical financial seam (`CostStackAggregator`) identified as highest priority
- [x] Scalability path from current state to target architecture documented
