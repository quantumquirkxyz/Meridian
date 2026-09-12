# Module Depth Analysis — Meridian AgentTrading System

**Date:** 2026-09-12  
**Analyst:** Kilo (codebase-design skill)  
**Scope:** All packages in `/home/quantumquirkxyz/Meridian/packages/*`

---

## Executive Summary

| Package | Depth Assessment | Primary Seam | Notes |
|---------|------------------|--------------|-------|
| `@agenttrading/contracts` | **Deep** (dependency-free types + validators) | Type definitions + `Validator<T>` | Zero deps, maximum leverage |
| `@agenttrading/graph` | **Deep** | `MarketGraph` + pathfinding functions | Pure computation, in-process |
| `@agenttrading/core` | **Mixed** (deep modules + shallow barrel) | Multiple: `RiskEngine`, `TradingSession`, `ReconciliationEngine` | Barrel exports 30+ modules — consider splitting |
| `@agenttrading/connectors` | **Deep** per-venue | `BybitRESTClient`, `BybitWebSocketClient`, `PancakeSwapMarketDataConnector` | Clean boundary: depends only on contracts |
| `@agenttrading/chain` | **Deep** | `DEXExecutor` | Single responsibility, viem adapter |
| `@agenttrading/agents` | **Shallow barrel** | Multiple: `GeneralAgent`, `AgentAdapter`, `VercelAISDKAdapter` | Too many exports; runtime adapters should be subpath-only |
| `@agenttrading/infra` | **Shallow** | `InfrastructureEngine`, `CanaryControlTuiModel` | TUI + observability + data quality = divergent concerns |
| `@agenttrading/events` | **Deep** | `EventStore` + `EventBus` | SQLite persistence + in-memory bus |
| `@agenttrading/harness` | **Deep** | Simulator/backtest functions | Depends on contracts, graph, events |
| `@agenttrading/cli` | **Shallow** | `LiveRunner`, config loader | Thin orchestration layer; good |

---

## Detailed Analysis by Package

### 1. `@agenttrading/contracts` — **DEEP** ✅

**Interface:** Type definitions + `Validator<T>` runtime schema validators  
**Implementation:** 35 files, ~2,500 lines of pure TypeScript  
**Dependencies:** **None** (by design — ADR-0001)

**Why deep:**
- Small interface: `Validator<T>` is a single function type `(v: unknown) => v is T`
- Huge leverage: every package in the monorepo depends on this for type safety + runtime validation
- Zero dependencies = zero supply chain risk
- Testable directly: validators are pure functions

**Seam placement:** Correct. The seam *is* the TypeScript type system + runtime validators. No adapter needed.

**Deletion test:** If deleted, every other package loses its typed contracts and validation. Complexity would reappear as ad-hoc validation in 9 callers.

---

### 2. `@agenttrading/graph` — **DEEP** ✅

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

### 3. `@agenttrading/core` — **MIXED** ⚠️

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

**Recommendation:** Split `core` into:
```
@agenttrading/core-risk          # RiskEngine + policy
@agenttrading/core-execution     # Execution engines + audit
@agenttrading/core-reconciliation # ReconciliationEngine
@agenttrading/core-graph-consumer # OpportunityDetector + RouteEngine
@agenttrading/core-session       # TradingSession + LoopEngine
@agenttrading/core-inventory     # InventoryEngine
@agenttrading/core-stategraph    # StateGraph + permission + guards (internal)
```

**Rationale:** The current barrel creates a "god package" where callers import everything. Each sub-package above has a clear single responsibility and deep interface.

---

### 4. `@agenttrading/connectors` — **DEEP** ✅

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

---

### 5. `@agenttrading/chain` — **DEEP** ✅

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

### 6. `@agenttrading/agents` — **SHALLOW BARREL** ❌

**Current exports (from `index.ts`):**
- Core adapter: `BaseAgentAdapter`, `AgentAdapter`
- Config: `AgentConfig`, `createDefaultAgentConfig`, `RUNTIME_TYPES`
- Registry: `AgentRegistry`, `CONSULTATIVE_AGENT_CATALOG`
- Memory: `AgentMemory`, behavioral adapters (4)
- Logger: `AgentLogger`
- Budget: `BudgetEnforcer`
- Runtime: `AgentRuntime`
- General agent: `GeneralAgent`, `deployPerScopeGeneralAgents`
- **Plus** re-exports 20+ types from `@agenttrading/contracts`

**Problems:**
1. **Too many exports** — callers must learn 15+ distinct interfaces
2. **Runtime adapters leaked** — `VercelAISDKAdapter`, `createOpenRouterGenerateFn` should be subpath-only (package.json exports them correctly, but barrel re-exports contracts types unnecessarily)
3. **Divergent concerns** — config, registry, memory, logger, budget, runtime, general agent = 7 reasons to change
3. **GeneralAgent is deep but buried** — `GeneralAgent` + `deployPerScopeGeneralAgents` is the real deep module here

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

### 7. `@agenttrading/infra` — **SHALLOW** ❌

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

**Recommendation:** Split into:
```
@agenttrading/infra-observability    # ObservabilityService, DataQualityMonitor
@agenttrading/infra-opportunity-audit # OpportunityRecorder
@agenttrading/infra-control          # InfrastructureEngine, CanaryControlTuiModel (or move TUI to cli)
@agenttrading/infra-secrets          # (future) secrets management
```

---

### 8. `@agenttrading/events` — **DEEP** ✅

**Interface:** `EventBus` (publish, subscribe) + `EventStore` (SQLite persistence, replay)  
**Implementation:** In-memory bus with idempotency + SQLite store with prepared statements

**Why deep:**
- Encapsulates event persistence, deduplication, replay, time-range queries
- Pure in-process (category 1) — fully testable with `:memory:` DB
- Single responsibility: event durability + ordering

**Seam placement:** Correct. `EventStore` is the deep module; `EventBus` is a thin adapter over it.

---

### 9. `@agenttrading/harness` — **DEEP** ✅

**Interface:** Simulator functions, backtest runner, stress test orchestrator  
**Dependencies:** `@agenttrading/contracts`, `@agenttrading/graph`, `@agenttrading/events`

**Why deep:**
- Encapsulates simulation logic (fill simulators, market generators, stress scenarios)
- Pure computation — testable deterministically

---

### 10. `@agenttrading/cli` — **SHALLOW (by design)** ✅

**Interface:** `LiveRunner` + `loadConfig()`  
**Implementation:** Thin orchestration — wires together all other packages

**Why shallow is correct here:**
- CLI *should* be thin — it's the composition root
- `LiveRunner` is deep internally (orchestrates session, connectors, agents, risk)
- Config loader validates and merges — good seam

---

## Module Deletion Test Summary

| Module | If Deleted, Complexity... |
|--------|---------------------------|
| `contracts` | Reappears in 9 packages (types + validation) |
| `graph` | Reappears in `core` (OpportunityDetector) + `harness` |
| `core` (as monolith) | **Vanishes** — it's a barrel; sub-modules are the real modules |
| `connectors` | Reappears in `cli` (LiveRunner) |
| `chain` | Reappears in `cli` (DEX execution) |
| `agents` (as monolith) | **Vanishes** — sub-modules (GeneralAgent, adapters) are the real modules |
| `infra` (as monolith) | **Vanishes** — 5 unrelated concerns |
| `events` | Reappears in `infra` (ObservabilityService) + `harness` |
| `harness` | Vanishes (test-only) |
| `cli` | Vanishes (entry point only) |

---

## Concrete Recommendations

### Priority 1: Split `core` (highest impact)
```bash
# Create focused packages
packages/core-risk/
packages/core-execution/
packages/core-reconciliation/
packages/core-session/
packages/core-inventory/
packages/core-stategraph/  # internal
```
**Effort:** Medium (move files, update imports, fix tests)  
**Impact:** Eliminates god package; each sub-package is deep and independently testable

### Priority 2: Split `agents`
```bash
packages/agents-core/
packages/agents-catalog/
packages/agents-general/      # The deep module per ADR-0013
packages/agents-runtime-*/    # Subpath exports only
```
**Effort:** Medium  
**Impact:** Isolates the general-agent-per-scope deep module; removes LLM framework deps from core agent logic

### Priority 3: Split `infra`
```bash
packages/infra-observability/
packages/infra-opportunity-audit/
packages/infra-control/       # or move TUI to cli
```
**Effort:** Low-Medium  
**Impact:** Removes divergent change; TUI can evolve independently

### Priority 4: Consider merging `stategraph` modules in `core`
The 6 files in `core/src/stategraph/` (`permission-registry`, `audit-log`, `guards`, `topology`, `state-graph`, `orchestrator`) are tightly coupled and change together. Merge into a single `StateGraph` module with internal helpers.

---

## Seam Discipline Checklist

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

---

## Conclusion

The codebase has **strong deep modules** at the boundaries (`contracts`, `graph`, `connectors`, `chain`, `events`, `harness`) but **shallow barrels** at the orchestration layer (`core`, `agents`, `infra`). 

**Primary action:** Split the three god packages (`core`, `agents`, `infra`) along their natural seams. Each resulting package will be deep, independently testable, and have a clear single responsibility — matching the "deep module" vocabulary in CONTEXT.md.