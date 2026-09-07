# Deep Analysis — Meridian (AgentTrading)

Date: 2026-09-06
Scope: algorithms, mathematics, market microstructure ("physics"), and tech stack of the Meridian algorithmic trading system, evaluated through its stated purpose of generating money from multi-venue crypto fragmentation.

Primary sources: repo source code, `CONTEXT.md`, `docs/ARCHITECTURE.md`, `docs/RISK.md`, `docs/adr/*`. Every claim cites the source that owns it.

---

## 1. System overview and money-making thesis

Meridian is a multi-agent algorithmic trading infrastructure for hybrid crypto markets (CEX + DEX), currently wired for live trading across Bybit and PancakeSwap v4 (`CONTEXT.md:5-9`). The money-making mechanism is liquidity-fragmentation arbitrage: the same asset trades at different prices across venues, and the system captures the difference only when the net profit figure — gross spread minus every modeled cost — is positive and survives deterministic risk review (`CONTEXT.md:13-15`, `docs/RISK.md:48-62`).

The thesis is sound in structure: it is an execution infrastructure with a complete cost stack, a deterministic risk authority that owns all approval, a fail-closed defensive ladder, and full auditability (`CONTEXT.md:15-33`, `docs/ARCHITECTURE.md:3-7`, `docs/RISK.md:3-19`). The profit-shaping number is `expectedNetProfitUsd`, computed twice by two different aggregators (see §3 and §6), and every upstream assumption about fees, slippage, gas, latency, and failure degrades correctness of that number. The system's edge therefore depends almost entirely on how faithfully those estimates model reality — and it is those approximations, not the graph algorithms, that carry the highest financial risk.

---

## 2. Algorithms

### 2.1 MarketGraph (typed, weighted, versioned)
- Typed nodes (`ASSET, VENUE, CHAIN, POOL, ACCOUNT, STRATEGY`) and edges (`ORDER_BOOK, SWAP, BRIDGE, TRANSFER, FUNDING, CORRELATION`) with weights for price, fee, slippage, gas, funding, latency, liquidity, failure probability, confidence, risk — `packages/graph/src/market-graph.ts:10-30`, `packages/contracts/src/graph.ts`.
- Every structural mutation bumps a version counter; a `snapshot()` captures a versioned, decision-tied state — `packages/graph/src/market-graph.ts:39-64, 157-180`.
- The graph is a pure state container; event ingestion is delegated to `GraphEventProcessor` (`packages/graph/src/market-graph.ts:23-30`).

### 2.2 Route discovery (DFS)
- Depth-limited DFS enumerates all acyclic routes between two nodes over the tradable subgraph; defaults `maxHops = 8`, `maxRoutes = 100` — `packages/graph/src/pathfinding.ts:96-137`.
- Complexity: worst case exponential in a dense graph (each node visited once per path), bounded only by `maxHops`/`maxRoutes` caps — `packages/graph/src/pathfinding.ts:116-117`.

### 2.3 Arbitrage cycle detection (Bellman-Ford over log-rates)
- Edge price weights are treated as exchange rates; a cycle is profitable when the product of rates > 1, equivalently sum of log-rates > 0 — `packages/graph/src/pathfinding.ts:139-148`.
- A Bellman-Ford variant runs on the negative-log rate graph (`logRate = -log(rate)`) and detects negative cycles by relaxing over `n` iterations and walking back from the last-updated node — `packages/graph/src/pathfinding.ts:187-239`. A DFS cycle search over the rate product complements it — `packages/graph/src/pathfinding.ts:251-296`; node count is capped at `maxNodes = 20` to keep the search tractable — `packages/graph/src/pathfinding.ts:153, 178`.
- Soundness: negative-cycle logic is standard arbitrage theory; the cap on `maxNodes` (`[...nodeIds].slice(0, maxNodes)`) can silently drop nodes, so a profitable cycle crossing the cut may be missed in large graphs — `packages/graph/src/pathfinding.ts:178-185`.

### 2.4 RouteEngine (per-scope discovery + lifecycle)
- A bounded DFS from every source node finds all paths up to `maxRouteLength`; each path is classified, scored, and run through systemic-risk overlays — `packages/core/src/live/route-engine.ts:195-262`, path DFS at `579-627`.
- Routes get a lifecycle: `LIVE → STALE → EXPIRED` by snapshot age/TTL, `BLOCKED` by overlays or low score — `packages/core/src/live/route-engine.ts:301-354`, invalidation at `434-508`.
- Route type classification (CEX_CEX / DEX_DEX / CEX_DEX / CROSS_CHAIN / FUNDING_BASIS) from node/edge type sets — `packages/core/src/live/route-engine.ts:100-148`.
- Composite score normalizes profit, confidence, liquidity (log), safety, and brevity into `[0,1]` — `packages/core/src/live/route-engine.ts:50-88`.
- Systemic risk: concentration is computed per dimension (VENUE, CHAIN, POOL, RPC provider, wrapped asset) and blocks routes over a threshold — `packages/core/src/live/route-engine.ts:746-813`, `packages/core/src/live/systemic-risk-overlay.ts:38-80`.
- Inventory-awareness: a route is valid only if available capital covers ≥ 10% of `maxCapitalUsd` — `packages/core/src/live/route-engine.ts:407-415`.

### 2.5 StateGraph orchestration (deterministic core)
- A custom, ~300-line state machine with transition guards, permission registry, and mandatory audit on every transition; deliberately replaces LangGraph — `docs/adr/0002-own-minimal-stategraph.md:19-31`.
- Guards are pure functions of context (no LLM, no wall-clock randomness): `alwaysAllow`, `allowWhen`, `allOf`, `modeAllows`, `requiresData`, `dataEquals`, `defensiveEntry` (modes can only become more restrictive), and a fail-closed `dataQualityBlocksSignal` — `packages/core/src/stategraph/guards.ts:12-287`.

### 2.6 Reconciliation (state-diff)
- Internal vs external orders, fills, positions, and balances are indexed by key and compared; orphan orders and missing fills are hard mismatches, balance/position deltas soft — `packages/core/src/reconciliation/reconciliation-engine.ts:110-201`. Numeric compare uses a `1e-9` tolerance — `reconciliation-engine.ts:77-79`.

### 2.7 Deterministic replay
- Persisted events replay in sequence order; a fold produces the same graph snapshot bit-for-bit with a content-addressed FNV-1a snapshot id — `packages/events/src/replay.ts:22-49, 62-189`.

### 2.8 Learning loop (advisory only)
- Trade journal → rolling-window performance → edge-decay detection (Sharpe, win rate, profit factor deltas) → recommendations that never mutate production — `packages/core/src/live/edge-decay-detector.ts:60-222`, `packages/core/src/live/learning-engine.ts:96-131`.

---

## 3. Mathematics

### 3.1 The net-profit cost model (the money number)

`docs/RISK.md:48-62` defines:

```
expectedNetProfitUsd = grossSpreadUsd
                     - tradingFeesUsd
                     - slippageUsd
                     - gasUsd
                     - bridgeCostUsd
                     - fundingCostUsd
                     - latencyRiskUsd
                     - failureRiskUsd
                     - safetyBufferUsd
```

Implemented at `packages/graph/src/pathfinding.ts:305-315` (doc) and `456-467` (`totalCost`). **Critical finding: this formula is not the only one.** There are two independent aggregators with different terms:

| Term | `pathfinding.ts` (`scoreRoute`, 456-467) | `route-engine.ts` (`aggregateEdgeWeights`, 663-694) |
|---|---|---|
| Slippage, fees, gas, funding | summed per edge | subtracts fee/slippage/gas/funding from each edge's `price` |
| Latency risk | added at $0.001/ms (363) | **omitted** |
| Failure risk | `combinedFailureProbability * 100` (394) | **omitted** |
| Bridge cost | `w.fee` for BRIDGE edges, fee un-double-counted (376-381) | **omitted** |
| Safety buffer | added (default $1.0, 325) | **omitted** |

The RouteEngine model is a **min-edge bottleneck** (`expectedNetProfitUsd = min(price − fee − slippage − gas − funding)` across edges, 686-694), so it both uses a different cost set *and* a different aggregation (minimum instead of sum). Identical graph state yields different `expectedNetProfitUsd` depending on which code path computed it — and this number is the gate that turns a candidate into a `OrderIntent` (`risk-gate.ts:532-541`).

### 3.2 Slippage
- Linear impact model: `slippageBps = baseSlippageBps + floor(orderSizeUsd / liquidityUsd * 1000)` — `packages/core/src/utils/slippage.ts:19-29`. Claimed as "1% of liquidity = 10bps".
- At detection time slippage is instead estimated as `spread / 2` on the midpoint — `packages/core/src/live/opportunity-detector.ts:113, 132`.
- Dependency on the constant-product AMM is exercised only at execution simulation, not at detection — `packages/chain/src/dex-executor.ts:248-251` (the exact `x·y=k` swap with 0.3% fee: `amountInWithFee = amountIn * 997/1000`; `expectedOutput = amountInWithFee·reserveOut / (reserveIn + amountInWithFee)`).

### 3.3 Gas, bridges, latency, failure — the crude terms
- Gas in USD: fixed `150_000` gas units and a **hardcoded native token price** (`$500` for BSC, `$3000` for ETH) — `packages/chain/src/dex-executor.ts:183-191` ("best-effort since a live price oracle is out of scope").
- Bridges: flat `$0.5` per bridge edge in `opportunity-detector.ts:259`, versus `w.fee` in `pathfinding.ts:376-381` — again two formulas.
- Latency risk: `latencyRiskUsd += latencyMs * 0.001` (default `latencyRiskPerMs = 0.001`, USD/ms) — `packages/graph/src/pathfinding.ts:70-72, 363`. DEX snapshots report `latencyMs: 0` — `packages/chain/src/dex-executor.ts:364`.
- Failure risk: `combinedFailureProbability * 100` (a probability scaled to USD by an arbitrary constant) — `packages/graph/src/pathfinding.ts:342-384, 394`; versus `maxCapitalUsd * averageFailureProbability` in `opportunity-detector.ts:261-263`. Two different definitions of the same cost line.
- Safety buffer default `$1.0` per route and `minNetProfitUsd = 0.5` — `pathfinding.ts:325`, `opportunity-detector.ts:46-51`.

### 3.4 Risk math
- `notionalUsd = quantity * price`; exposure rules project `current exposure + notional` against token/venue/chain limits and `REDUCE_SIZE` to `allowedAdditional / price` — `packages/core/src/risk/risk-gate.ts:413-468, 579-592`.
- **The RiskEngine is stateless** — all loss/exposure context is passed in via `RiskGateInput`; the caller owns cumulative tracking (`risk-gate.ts:316-320`). The **default policy omits `maxDailyLossUsd` and `maxWeeklyLossUsd`** (rules 2-3 are not in the enforced `Required` pick) — `risk-gate.ts:123-154`. If a caller does not pass loss state or a stricter policy, the two loss cap rules are inert; in the canary the loss caps come from the pre-check instead (`canary-live.json:4-9, 31-38`).
- Defaults: `maxRiskPerTradeUsd = $1,000,000`, `minEdgeUsd = $1`, `maxSlippageBps = 50`, `maxGasUsd = $50`, `maxLatencyMs = 5,000`, `minLiquidityDepthUsd = $10,000`, `maxCorrelationConcentration = 0.8` — `risk-gate.ts:140-154`.

### 3.5 Statistical metrics (learning loop)
- Sharpe is the **per-trade** mean/std of PnL (not annualized, not risk-free-adjusted) — `packages/core/src/live/stats.ts:20-26`.
- Profit factor and peak-to-trough max drawdown are standard — `stats.ts:28-50`.

### 3.6 Regime math
- Deterministic threshold classifier: drawdown (cumulative ≤ −$100 or max DD ≥ $200), degraded RPC/CEX, gas spike (≥ $50), high volatility (realized vol ≥ 0.8), low liquidity (< $5k or spread > 100bps), chop (reversals ≥ 4 with vol ≥ 0.3), range (vol ≤ 0.3), trend (directional streak ≥ 5) — `packages/core/src/live/regime-classifier.ts:89-102, 128-236`. Confidence per regime is a fixed constant, not calibrated to data — `regime-classifier.ts:97-102, 132-236`.

---

## 4. Physics / market microstructure

Strictly, the system contains no physics models — there is no stochastic process, no diffusion/GBM, no volatility-of-volatility. What exists is **microstructure modeled as deterministic friction terms**, using physical analogies:

- **Latency as drag**: priced linearly at $0.001/ms and hard-capped at 5,000ms — `pathfinding.ts:363`, `risk-gate.ts:146, 508-518`. But venue latency is largely *measured as zero* on DEX snapshots (`dex-executor.ts:364`) and RPC latency is only captured on a health probe (`dex-executor.ts:377-393`), so the drag term is frequently zeroed out. Latency is the decisive variable for arbitrage (fastest runner wins); a constant zero makes the route model blind to the race.
- **Slippage = impact × depth**: linear depth impact (`slippage.ts:19-29`) and spread/2 at detection (`opportunity-detector.ts:113`) — a first-order book model with no queue position, no multi-level book shape, and no AMM-impact coupling at detection time.
- **Data freshness as half-life-style decay**: confidence 1.0 ≤ 5s, 0.8 ≤ 10s, 0.6 ≤ 30s, 0.3 beyond — `opportunity-detector.ts:208-214`.
- **Regime as phase classification**: trend/range/chop as discrete phases inferred from directional streaks and reversal counts, with defensive regimes for gas spikes and degraded infrastructure — `regime-classifier.ts:128-236`. The mean-reversion used for "range" and "chop" is heuristic (reversal counting), not a fitted mean-reversion process.
- **Adversarial microstructure**: MEV protection covers slippage tolerance, deadlines, front-running/sandwich detection, and private-mempool structure — `packages/core/src/risk/mev-protection.ts:1-60`.
- **Assessment**: as a first-order friction model it is coherent and fail-closed in spirit, but three assumptions are fragile for money generation: (1) zero/default latency masking the race, (2) linear slippage against deep or thin books, (3) regime confidence constants with no calibration. None of these can be validated without measured data, and the harness (`packages/harness`) is where that validation belongs.

---

## 5. Tech stack

- **TypeScript + Bun monorepo** (10 packages) with Bun workspaces; `bun test` and `tsc --noEmit --project tsconfig.json` as the check surfaces — `package.json:6-15`, `docs/adr/0001-ts-bun-monorepo.md:21-35`. Decisions rejected Node (WS/SQLite overhead), Python hybrid (cross-runtime type friction), and Go/Rust (velocity) for the current scale — `ADR-0001:29-35`.
- **Package boundary rules** enforced at compile time: `agents` never imports `core`; `core` never imports LLMs or `connectors`; `chain` depends only on `contracts` + `viem`; `infra` depends on `contracts`/`events`/`ink`/`react`; `cli` is the wiring layer — `docs/ARCHITECTURE.md:104`. This is genuinely well-layered for the mission (risk-critical core stays deterministic, ADR-0002/ADR-0003).
- **Persistence**: SQLite via `bun:sqlite` (WAL, ACID) for the event store; in-memory event bus — `docs/adr/0006-sqlite-persistence.md:13-17`. Single-process by design; the ADR itself flags the multi-process ceiling (`ADR-0006:33`).
- **DEX execution**: `viem` public + wallet clients on BSC, nonce management, EIP-1559 gas, swap simulation, and `swapExactTokensForTokens` submission — `packages/chain/src/dex-executor.ts:15-24, 169-200, 278-327`.
- **Connectors**: Bybit REST/WebSocket, Binance REST, PancakeSwap RPC — `docs/ARCHITECTURE.md:95`, package listing.
- **LLM layer**: OpenRouter via Vercel AI SDK (`ai` + `@ai-sdk/openai`), `generateFn` injection so `agents` never imports `ai` directly, with a Mastra second runtime behind `AgentAdapter`; fully deterministic `ScopeObserverAdapter` fallback when no LLM is configured — `docs/ARCHITECTURE.md:112-120`, `CONTEXT.md:9`.
- **Human control**: Ink-based TUI (ADR-0010) — `docs/ARCHITECTURE.md:104`.
- **Fit assessment**: excellent for a deterministic, auditable, single-process canary; the two structural limits for scaling toward real returns are (a) single-process SQLite/in-memory bus under multi-venue volume and (b) Bun's younger ecosystem — both already documented as follow-ups (`ADR-0001:43-45`, `ADR-0006:33`).

---

## 6. Money-generation analysis

**Thesis (one sentence):** Meridian monetizes fragmented liquidity by converting a graph-level arbitrage signal into an order only when a deterministic cost model says net profit is positive and risk approves — so profitability is bounded precisely by how faithfully that cost model predicts what the venue actually charges and what actually happens between signal and fill.

**Where the edge decays** — the system itself acknowledges no statistical advantage is eternal (`CONTEXT.md:62`) and ships a detector for it on Sharpe/win-rate/profit-factor windows (`edge-decay-detector.ts:91-157`) whose outputs are advisory only (`learning-engine.ts:96-131`). That is the correct shape; the risk is that the *cost model* decays silently, which no detector watches.

**Top five money-leak vectors, ranked:**

1. **Two conflicting net-profit definitions.** `pathfinding.ts:456-467` vs `route-engine.ts:663-694` disagree on both cost terms (latency/failure/bridge/safety missing in the latter) and aggregation (sum vs min-edge). A route can be "profitable" under one model and not the other; the number that gates orders is not unique.
2. **Gas cost is a hardcoded approximation.** Fixed 150k gas units and `$500`/`$3000` native prices with no live oracle — `dex-executor.ts:183-191`. BSC gas spikes (the system even *defines* a `gas_spike` regime at ≥ $50, `regime-classifier.ts:94`) can make real cost exceed modeled cost many times over; with canary `maxGasUsd = $10` (`canary-live.json:42`) the margin is thin.
3. **Slippage is not coupled to the venue's order book or AMM at detection.** Linear `orderSize/liquidity` (`slippage.ts:27`) and `spread/2` (`opportunity-detector.ts:113`) ignore book shape; the exact constant-product impact exists only in `simulateSwap` at execution time (`dex-executor.ts:248-256`).
4. **Failure risk has two non-equivalent definitions and no true USD basis.** `probability × 100` in `pathfinding.ts:394` is a scaling hack; `maxCapitalUsd × averageProbability` in `opportunity-detector.ts:261-263` is dimensionally real but averages rather than combines (`1 − ∏(1−pᵢ)` exists only in `pathfinding.ts:384`). The money-loss event (failed fill, stuck bridge, revert) is never priced as an expected loss.
5. **Cancels: default policy omits the daily/weekly loss caps** (`risk-gate.ts:123-154`, rules 2-3 stated in `docs/RISK.md:24-25`), relying on callers to supply loss state and stricter policies; the canary's own rules (`canary-live.json:4-9`) currently back-stop this.

Secondary: bridge cost flat `$0.5/edge` vs `w.fee`; fixed position size 0.001 (`opportunity-detector.ts:355`) that ignores `maxCapitalUsd`/bottleneck; uncalibrated regime thresholds (`regime-classifier.ts:89-102`).

**Single weakest mathematical assumption:** the *net-profit formula is not unique* — the discrepancy between `pathfinding.ts:456-467` and `route-engine.ts:663-694` means the exact value that determines whether capital trades and what the RiskEngine checks (`risk-gate.ts:532-541`) depends on which code path computed it. Every other leak (gas, slippage, failure) is a calibration error within a single formula; this one is a *consistency* error between formulas, and it silently undermines the gate that exists to protect the money.

---

## 7. Completion criteria

- [x] Single Markdown file artifact: `docs/ANALYSIS.md`
- [x] All four areas covered: algorithms (§2), mathematics (§3), physics/microstructure (§4), tech stack (§5)
- [x] Money-generation analysis with ranked leak vectors and weakest assumption (§6)
- [x] Every claim cites its primary source (file:line or ADR/doc)
- [x] No source, config, or other repo files modified (write-only artifact)