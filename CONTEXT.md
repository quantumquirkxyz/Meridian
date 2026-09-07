# Project Context

## 1. What the system is

AgentTrading is a multi-agent algorithmic trading infrastructure for hybrid crypto markets. It operates across centralized exchanges (CEXs) and decentralized exchanges (DEXs), integrating APIs, smart contracts, AI agents, orchestration, risk control, and audit into a single coherent system.

The system observes market data from multiple venues, detects opportunities by computing net profit after full cost stacks (fees, slippage, gas, bridges, funding, latency), evaluates them through deterministic risk rules, executes approved orders, reconciles state against exchanges, and records every decision for audit.

**Current operational state:** Multi-agent system configured for live trading across Bybit (CEX) and PancakeSwap (DEX). The cognitive layer runs one general agent per trading scope — (venue, pool, pair) on DEX venues, (venue, pair) on CEX venues — each coordinating the catalog of 11 consultative agents as sub-agents. Without an LLM the per-scope cycles run deterministically through `ScopeObserverAdapter` (market-geometry observations); when an OpenRouter LLM is configured, the analytical/deliberative sub-agents reason through it directly. Source health tracking enabled. Full audit trail with JSONL logging.

## 2. Why it exists

Crypto liquidity is fragmented. The same asset trades simultaneously on Bybit, Binance, PancakeSwap, Uniswap, and dozens of other venues, each with its own price, depth, fees, latency, and execution risk. This fragmentation creates temporary inefficiencies — price differences that can be exploited by an system fast enough to observe, evaluate, and act on them.

A single-exchange bot cannot capture these opportunities. The system exists to operate across multiple venues, compute net profitability after all costs, and execute only when the math works. It is not a signal generator — it is an execution infrastructure with risk control as its primary constraint.

## 3. How it works

The system follows a mandatory flow: **data → graph → candidate → review → risk → order → execution → reconciliation → audit**. No step may skip the Risk Engine.

**Market Data** flows from exchange connectors (Bybit REST/WebSocket, Binance REST, PancakeSwap RPC) through normalization into a versioned **MarketGraph** — a directed weighted graph where nodes are assets/venues/chains and edges carry full cost weights (price, fee, gas, slippage, latency, liquidity, failure probability, risk).

**Opportunity Detection** traverses the graph to find profitable routes — arbitrage cycles, cross-venue spreads, funding basis trades — and produces `OpportunityCandidate` objects with expected net profit after the complete cost stack.

**Agent Layer** provides cognitive reasoning through consultative agents — the umbrella category for observation-only intelligence. One **general agent** is deployed per trading scope: (venue, pool, pair) on a DEX, (venue, pair) on a CEX where liquidity lives in the venue's order book. Each general agent coordinates the 11 catalog sub-agents (planner-supervisor, arbitrage-alpha, market-regime, bull, bear, skeptic, risk-analyst, execution-advisor, memory, audit, policy), scopes their inputs to its venue/pool/pair, aggregates their structured outputs, and emits one recommendation per cycle for the mandatory Risk Engine gate. The agent layer is observation only and never executes; no agent of any kind approves risk or moves funds. When an LLM is configured via OpenRouter, sub-agents reason about market context, classify regimes, debate candidates, and produce structured analyses; without an LLM, the system operates deterministically — the analytical/deliberative sub-agents emit scoped observations from market geometry via `ScopeObserverAdapter`, while audit, memory, and policy use their behavioral adapters.

**Risk Engine** is the deterministic authority. It approves, rejects, reduces, or blocks every `OrderIntent`. No agent has `APPROVE_RISK` permission. The Risk Engine can trigger `HALT_SYSTEM` — a dictamen that instructs the orchestrator to enter `HALT` mode, but never sets `SystemMode` directly.

**Execution Engine** is the only component that sends orders. It only accepts `OrderIntent` objects approved by the Risk Engine. Fails closed, never open.

**Reconciliation** compares internal state against exchange state. On mismatch, the system enters defensive mode and blocks new positions. If WebSocket drops with an active partial fill, the system immediately transitions to `CANCEL_ONLY` and only returns to `NORMAL` after exact mathematical reconciliation.

**Audit** records every transition, decision, order, fill, and state change to JSONL. The `AuditReconstructor` can rebuild the full timeline from data ingestion to PnL for any trade.

## 4. What risks it controls

Risk is the dominant property of the system, not a secondary module. The Risk Engine enforces:

- Maximum risk per trade, daily loss, weekly loss
- Maximum exposure per token, venue, chain
- Maximum open orders, slippage, gas, latency
- Minimum data quality, edge, liquidity
- No trading during degraded state or unresolved reconciliation

**System modes** reduce activity, never increase it: `NORMAL → OBSERVE_ONLY → SIGNAL_ONLY → CANCEL_ONLY → REDUCE_ONLY → CASH_ONLY → HALT`.

**Kill switch** activates on: orphan orders, reconciliation mismatch, daily/weekly loss limits, order count limits. Identical in all modes.

**Regime classification** adapts permissions based on market state (trend, range, chop, high volatility, low liquidity, gas spike, degraded venue, drawdown). Regime changes can only reduce permissions.

**Fail closed:** Every failure reduces permissions and exposure. The system never increases risk on error. If the Risk Engine fails, the system halts. If reconciliation fails, no new positions. If audit is unavailable, no trading.

## 5. What it is NOT

- **Not a signal generator.** It computes net profitability after full costs, not raw price differences.
- **Not a manual trading tool.** It operates algorithmically with no human intervention in the execution path.
- **Not a black box.** Every decision is auditable with full traceability from data to PnL.
- **Not a single-exchange bot.** It operates across multiple venues with inventory-aware routing.
- **Not autonomous.** AI agents observe and reason, but the Risk Engine governs action. No agent — general or sub-agent — executes orders.
- **Not a single global agent.** The cognitive layer is decomposed: one general agent per trading scope — (venue, pool, pair) on DEX, (venue, pair) on CEX — each delegating to the catalog of role-specialized sub-agents. There is no all-seeing agent covering every venue at once.
- **Not a commercial product.** Personal project without KYC/AML. Regulatory knowledge is used only to understand structural risks. See ADR-0005.
- **Not infinitely adaptable.** No statistical advantage is eternal. The system must detect when a strategy loses edge and stop trading.

---

## System Language

**Consultative Agent:**
The umbrella category for every agent in the cognitive layer: a specialized module that produces typed observations, hypotheses, evaluations, or recommendations and never executes orders, approves risk, or moves funds. It manifests in two forms — a **general agent** (cognitive coordinator of one trading scope) and **sub-agents** (catalog roles bound to a general agent's scope).
_Avoid_: autonomous bot, entity with freedom of action, executing agent.

**General Agent:**
An agent instance deployed over one trading scope — (venue, pool, pair) on a DEX, (venue, pair) on a CEX (such as BTC/USDT on Bybit or WBNB/BTCB in a PancakeSwap v4 pool). It is the cognitive coordinator of that scope: it decides which sub-agents to invoke, scopes their inputs to its venue/pool/pair (or venue/pair), aggregates their structured outputs, and emits one recommendation for the Risk Engine. It never executes orders, does not approve risk, and does not move funds.
_Avoid_: one global agent covering every venue; an autonomous per-exchange bot.

**Sub-agent:**
A consultative agent from the catalog of 11 (planner-supervisor, arbitrage-alpha, market-regime, bull, bear, skeptic, risk-analyst, execution-advisor, memory, audit, policy) bound to a general agent's scope. Each implements one cognitive function — planning, arbitrage, regime classification, bull/bear/skeptic debate, risk narration, execution planning, memory recall, audit scoring, policy review — and carries the same observation-only permissions as the general agent. A general agent may skip a non-mandatory sub-agent without blocking its cycle; no sub-agent exists outside a scope (there is exactly one "free" deployment per scope in the canary).
_Avoid_: free-roaming global expert; execution-capable worker.

**Loop:**
A governed recurring subsystem — a closed perception → decision → action → learning cycle with explicit frequency, inputs, outputs, permissions, and stopping criteria. Reads balances from `Reconciliation`, not from `MarketGraph`. Never mutates `MarketGraph`; never uses untyped agent output. A single pass of a loop is a **Cycle**.
_Avoid_: reactive processing without frequency or stopping criteria; treating the graph as inventory; allowing agent suggestions to become `OrderIntent` without `OpportunityCandidate`.

**Cycle:**
One concrete iteration of a **Loop** — e.g. a session's main runCycle (regime → detect → risk → execute → reconcile → audit).
_Avoid_: using "cycle" and "loop" interchangeably.

**MarketGraph:**
Representation of the market as a directed, weighted graph. Nodes: assets, venues, chains, pools. Edges: order book, swap, bridge, transfer, funding, correlation. Weights: price, fee, gas cost, expected slippage, latency, liquidity, funding cost, failure probability, confidence, risk.
_Avoid_: superficial price without net cost; mutating the live graph for backtest; storing inventory or order state inside the graph.

**Venue:**
A market where an asset trades, identified by a stable id such as `bybit` or `pancakeswap-v4`. A venue is a node in the `MarketGraph` and the unit across which exposure, limits, and reconciliation are tracked.
_Avoid_: conflating venue with connector or with a specific instrument.

**CEX:**
A centralized exchange venue (`venueModel: "cex"`), such as Bybit, where trading is governed by the operator's order book and matching engine.
_Avoid_: treating the exchange's REST/WebSocket connector as the venue itself.

**DEX:**
A decentralized exchange venue (`venueModel: "dex"`), such as PancakeSwap, where trading occurs against on-chain liquidity pools via smart contracts.
_Avoid_: conflating a pool with a venue; a venue hosts multiple pools.

**Pool:**
A smart contract that holds reserves of one pair of tokens and executes swaps automatically; the engine of DEX venues. A pool hosts exactly one pair; a DEX venue hosts multiple pools (e.g. one per fee tier). Pools do not exist on a CEX — there the functional equivalent is the venue's **order book** for that pair.
_Avoid_: calling a CEX order book a "pool"; conflating with staking or mining pools; conflating a pool with its venue.

**Order Book:**
The list of open buy and sell orders for one pair on a CEX, priced by supply and demand and matched by the venue's matching engine. It is the CEX counterpart of a DEX **pool**: the liquidity context where a pair trades.
_Avoid_: naming an order book "pool"; treating the order book as a component the system operates (the system only reads it as market data).

**Trading Scope:**
The deployment unit of a **general agent** and the liquidity context of a pair at a venue: (venue, pool, pair) on a DEX, (venue, pair) on a CEX — on a CEX the liquidity context is the venue's **order book**. Each trading scope gets exactly one general agent with its bound sub-agents.
_Avoid_: a scope covering multiple venues; confusing a scope with a route in the `MarketGraph`.

**Pair:**
The tradable two-token instrument with an identity independent of the venue — base/quote, e.g. `BTC/USDT` (encoded as the symbol `BTCUSDT` on Bybit). It is the "pair" dimension of a trading scope.
_Avoid_: "symbol" as a synonym — a symbol is a venue's opaque encoding of a pair.

**Connector:**
A venue-specific adapter that translates external market data (CEX REST/WebSocket, DEX RPC) into the shared `MarketDataSnapshot` contract that feeds the `MarketGraph`. Each venue has its own connector implementation. Connectors are the isolation boundary between venue-specific I/O and the normalized graph; the core never imports them directly.
_Avoid_: treating the venue's raw API client as the connector; importing connector internals into the core.

**DEXExecutor:**
The on-chain execution component for DEX venues. It connects to EVM-compatible chains via RPC, manages nonces and gas, simulates swaps, and signs and submits transactions on-chain.
_Avoid_: using a DEX market-data connector as if it could execute swaps; treating the executor as the venue itself.

**Expected Net Profit (`expectedNetProfitUsd`):**
The single canonical net-profit figure after the full cost stack prescribed by the net profit formula: `grossSpreadUsd` minus trading fees, slippage, gas, bridge cost, funding, latency risk, failure risk, and safety buffer (ADR-0014). It is the money number the Risk Engine checks (`MIN_EDGE`).
_Avoid_: per-edge minimum margins; any net-profit figure not produced by the canonical cost-stack sum.

**Cost Stack:**
The complete set of costs a route must clear for an opportunity to exist: trading fees, slippage, gas, bridge cost, funding, latency risk, failure risk, and safety buffer.
_Avoid_: gross spread without costs; a partial cost list treated as the full stack.

**Failure Risk (`failureRiskUsd`):**
The expected loss of a route: `maxCapitalUsd × combinedFailureProbability`. It is a USD figure, not a raw probability.
_Avoid_: a probability scaled by an arbitrary constant; an averaged per-edge failure probability in place of the combined one.

**Combined Failure Probability:**
`1 − ∏(1 − pᵢ)` over a route's edges, the probability that at least one edge fails assuming independent edge failures.
_Avoid_: a plain average of per-edge failure probabilities.

**Bridge Cost (`bridgeCostUsd`):**
A dedicated weight on `BRIDGE` edges (cost, latency, and failure of the bridge), summed along the route. It is not a trading fee and must not be folded into the trading-fee weight.
_Avoid_: a flat per-edge surcharge; reusing the trading-fee weight `w.fee` for bridges.

**Loss Limit (daily/weekly):**
The maximum cumulative loss allowed over a rolling 24h / 7d window before the system defers or reduces activity. Enforced by default in the risk policy.
_Avoid_: calendar-day/week interpretation that resets on local midnight; treating daily/weekly loss as optional policy.

**Hypothesis:**
A retrospective analysis artifact produced by the **Learning Loop** — patterns, lessons, and edge-decay observations derived from trade outcomes. It never becomes an `OrderIntent`; it only proposes candidate definitions for human review, then iteration.
_Avoid_: prospective signal; synonym of `OpportunityCandidate`.

**OpportunityDetector:**
Component that ingests market data, feeds the `MarketGraph`, discovers profitable routes, and produces `OpportunityCandidate` objects with `OrderIntent` pairs for risk evaluation.
_Avoid_: manual opportunity selection; opportunities without cost breakdown.

**OrderIntent:**
A typed candidate order that only becomes a real order if the Risk Engine approves it. Includes idempotency key, limits, and expiry.
_Avoid_: direct order generated by an agent.

**Risk Engine:**
The deterministic authority that approves, rejects, reduces, or blocks every `OrderIntent`. Emits a `RiskDecision` with `decision: RiskDecisionOutcome` (`APPROVE`, `REJECT`, `REDUCE_SIZE`, `EXIT_ONLY`, `CANCEL_ONLY`, `CASH_ONLY`, `HALT_SYSTEM`). The defensive outcome `HALT_SYSTEM` is a risk dictamen, not a mode — it instructs the orchestrator to enter `HALT`, but the Engine never sets `SystemMode` directly.
_Avoid_: advisory risk agent, optional layer, or conflating `HALT_SYSTEM` with `HALT`.

**Execution Engine:**
The only component that sends orders. Only accepts `OrderIntent` objects approved by the Risk Engine. Fails closed, never open.
_Avoid_: execution delegated to an agent or to LLM reasoning.

**Reconciliation:**
Comparison between internal state and real exchange/wallet/chain state. On mismatch, blocks new positions and may activate defensive modes. If WebSocket drops with active partial fill, immediately transitions to defensive mode; only returns to `NORMAL` after exact mathematical reconciliation.
_Avoid_: trusting internal state without external verification; executing expired approvals.

**Regime:**
Classification of market state (trend, range, high volatility, low liquidity, chop, gas spike, degraded venue, drawdown) that adjusts operational permissions. Can only reduce permissions; never increases them without deterministic validation.
_Avoid_: fixed limits ignoring market state.

**SystemMode:**
Global permission state: `NORMAL`, `OBSERVE_ONLY`, `SIGNAL_ONLY`, `CANCEL_ONLY`, `REDUCE_ONLY`, `CASH_ONLY`, `HALT`. Modes can only reduce activity, never increase it. Defensive states are reachable as `SystemMode` values with no mode suffix (`CASH_ONLY`, `CANCEL_ONLY`, `REDUCE_ONLY`).
_Avoid_: trading always active; conflating mode names across namespaces.

**TradingSession:**
The top-level orchestration root of the operational system. It drives the full cycle from regime classification through opportunity detection to audit, and owns the operational state of a running session.
_Avoid_: treating as a standalone component; bypassing its subsystem wiring.

**Live:**
Real-capital trading across the system's venues: Bybit (CEX) and PancakeSwap (DEX). Uses real API keys and real balances with capital at risk. Requires explicit human approval, canary limits, and rollback path.
_Avoid_: any operation without real credentials or without capital exposure; conflating with demo or simulated trading.

**Kill switch:**
Manual (TUI) + automatic (drawdown, orphans, reconciliation mismatch). Identical across all modes. Activates `HALT` mode and blocks all new `OrderIntent` objects.
_Avoid_: treating kill switch as optional; different behavior between modes.
