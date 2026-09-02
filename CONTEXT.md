# Project Context

## 1. What the system is

AgentTrading is a multi-agent algorithmic trading infrastructure for hybrid crypto markets. It operates across centralized exchanges (CEXs) and decentralized exchanges (DEXs), integrating APIs, smart contracts, AI agents, orchestration, risk control, and audit into a single coherent system.

The system observes market data from multiple venues, detects opportunities by computing net profit after full cost stacks (fees, slippage, gas, bridges, funding, latency), evaluates them through deterministic risk rules, executes approved orders, reconciles state against exchanges, and records every decision for audit.

**Current operational state:** Connected to Bybit Demo Trading with virtual assets. 11 consultative agents defined. DataQualityMonitor tracking source health. OpenRouter LLM adapter wired for agent reasoning when configured. Full audit trail with JSONL logging.

## 2. Why it exists

Crypto liquidity is fragmented. The same asset trades simultaneously on Bybit, Binance, PancakeSwap, Uniswap, and dozens of other venues, each with its own price, depth, fees, latency, and execution risk. This fragmentation creates temporary inefficiencies — price differences that can be exploited by an system fast enough to observe, evaluate, and act on them.

A single-exchange bot cannot capture these opportunities. The system exists to operate across multiple venues, compute net profitability after all costs, and execute only when the math works. It is not a signal generator — it is an execution infrastructure with risk control as its primary constraint.

## 3. How it works

The system follows a mandatory flow: **data → graph → candidate → review → risk → order → execution → reconciliation → audit**. No step may skip the Risk Engine.

**Market Data** flows from exchange connectors (Bybit REST/WebSocket, Binance REST, PancakeSwap RPC) through normalization into a versioned **MarketGraph** — a directed weighted graph where nodes are assets/venues/chains and edges carry full cost weights (price, fee, gas, slippage, latency, liquidity, failure probability, risk).

**Opportunity Detection** traverses the graph to find profitable routes — arbitrage cycles, cross-venue spreads, funding basis trades — and produces `OpportunityCandidate` objects with expected net profit after the complete cost stack.

**Agent Layer** provides cognitive reasoning through consultative agents (observation only, never execution). When an LLM is configured via OpenRouter, agents can reason about market context, classify regimes, debate candidates, and produce structured analyses. Without an LLM, the system operates deterministically using behavioral adapters (audit, memory, policy).

**Risk Engine** is the deterministic authority. It approves, rejects, reduces, or blocks every `OrderIntent`. No agent has `APPROVE_RISK` permission. The Risk Engine can trigger `HALT_SYSTEM` — a dictamen that instructs the orchestrator to enter `HALT` mode, but never sets `SystemMode` directly.

**Execution Engine** is the only component that sends orders. It only accepts `OrderIntent` objects approved by the Risk Engine. Fails closed, never open.

**Reconciliation** compares internal state against exchange state. On mismatch, the system enters defensive mode and blocks new positions. If WebSocket drops with an active partial fill, the system immediately transitions to `CANCEL_ONLY_MODE` and only returns to `NORMAL` after exact mathematical reconciliation.

**Audit** records every transition, decision, order, fill, and state change to JSONL. The `AuditReconstructor` can rebuild the full timeline from data ingestion to PnL for any trade.

## 4. What risks it controls

Risk is the dominant property of the system, not a secondary module. The Risk Engine enforces:

- Maximum risk per trade, daily loss, weekly loss
- Maximum exposure per token, venue, chain
- Maximum open orders, slippage, gas, latency
- Minimum data quality, edge, liquidity
- No trading during degraded state or unresolved reconciliation

**System modes** reduce activity, never increase it: `NORMAL → OBSERVE_ONLY → SIGNAL_ONLY → CANCEL_ONLY → REDUCE_ONLY → CASH_ONLY → HALT`.

**Kill switch** activates on: orphan orders, reconciliation mismatch, daily/weekly loss limits, order count limits. Identical in demo and live modes.

**Regime classification** adapts permissions based on market state (trend, range, chop, high volatility, low liquidity, gas spike, degraded venue, drawdown). Regime changes can only reduce permissions.

**Fail closed:** Every failure reduces permissions and exposure. The system never increases risk on error. If the Risk Engine fails, the system halts. If reconciliation fails, no new positions. If audit is unavailable, no trading.

## 5. What it is NOT

- **Not a signal generator.** It computes net profitability after full costs, not raw price differences.
- **Not a manual trading tool.** It operates algorithmically with no human intervention in the execution path.
- **Not a black box.** Every decision is auditable with full traceability from data to PnL.
- **Not a single-exchange bot.** It operates across multiple venues with inventory-aware routing.
- **Not autonomous.** AI agents observe and reason, but the Risk Engine governs action. No agent executes orders.
- **Not a commercial product.** Personal project without KYC/AML. Regulatory knowledge is used only to understand structural risks. See ADR-0005.
- **Not infinitely adaptable.** No statistical advantage is eternal. The system must detect when a strategy loses edge and stop trading.

---

## System Language

**Agent:**
A specialized module that produces typed observations, hypotheses, evaluations, or recommendations. It never executes orders, does not approve risk, and does not move funds.
_Avoid_: autonomous bot, entity with freedom of action, executing agent.

**AgentAdapter:**
A typed contract that isolates the deterministic core from LLM frameworks (Vercel AI SDK via OpenRouter). The StateGraph only consumes typed, validated outputs.
_Avoid_: core coupled to an LLM provider.

**AgentCatalog:**
The registry of all consultative agents with their configurations, permissions, runtime declarations, and fallback strategies. Defines 11 agents across perception, analytical, deliberative, and control layers.
_Avoid_: ad-hoc agent definitions outside the catalog.

**BehavioralRuntime:**
A deterministic agent implementation that operates without an LLM. Provides audit scoring, memory recall, and policy review using structured logic. Used as fallback when no LLM is configured.
_Avoid_: treating behavioral runtimes as LLM-dependent.

**OpenRouterAdapter:**
A factory that creates a `generateFn` compatible with `VercelAISDKAdapter`, routing through OpenRouter's OpenAI-compatible endpoint. Uses `generateFn` injection to keep the agents package free of LLM framework dependencies.
_Avoid_: importing `ai` or `@ai-sdk/openai` in the agents package.

**DataQualityMonitor:**
Per-source quality tracking that evaluates latency, staleness, gaps, WS/REST consistency, and RPC health. Produces `DataQualityReport` objects that gate signal generation and route tradability.
_Avoid_: trading on data from degraded or disconnected sources.

**StateGraph:**
The project's own minimal deterministic orchestrator that models the system as a state graph. Every transition has guard conditions, per-agent/module permissions, fallbacks, and mandatory audit.
_Avoid_: agent framework as the core (LangGraph, AutoGen).

**Loop:**
A closed perception → decision → action → learning cycle, with explicit frequency, inputs, outputs, permissions, and stopping criteria. Reads balances from `Reconciliation`, not from `MarketGraph`. Never mutates `MarketGraph`; never uses untyped agent output.
_Avoid_: reactive processing without frequency or stopping criteria; treating the graph as inventory; allowing agent suggestions to become `OrderIntent` without `OpportunityCandidate`.

**MarketGraph:**
Representation of the market as a directed, weighted graph. Nodes: assets, venues, chains, pools. Edges: order book, swap, bridge, transfer, funding, correlation. Weights: price, fee, gas, slippage, latency, liquidity, failure probability, risk.
_Avoid_: superficial price without net cost; mutating the live graph for backtest; storing inventory or order state inside the graph.

**OpportunityCandidate:**
An opportunity hypothesis with expected net profit (after fees, slippage, gas, bridges, funding, latency, and safety buffer), route, costs, and invalidation reasons.
_Avoid_: arbitrage signal without net costs.

**OpportunityDetector:**
Component that ingests `MarketDataSnapshot` objects, feeds the `MarketGraph`, discovers routes via `RouteEngine`, and produces `OpportunityCandidate` objects with `OrderIntent` pairs for risk evaluation.
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

**RegimeClassifier:**
Deterministic classifier that produces `RegimeClassification` (regime + confidence) from market signals (volatility, spread, liquidity, gas, RPC health, CEX health, drawdown, directional streak, reversals).
_Avoid_: fixed regime thresholds without adaptation.

**SystemMode:**
Global permission state: `NORMAL`, `OBSERVE_ONLY`, `SIGNAL_ONLY`, `CANCEL_ONLY`, `REDUCE_ONLY`, `CASH_ONLY`, `HALT`. Modes can only reduce activity, never increase it. Defensive states are suffixed (`CASH_ONLY_MODE`, `CANCEL_ONLY_MODE`, `REDUCE_ONLY_MODE`) while modes are not.
_Avoid_: trading always active; conflating mode names across namespaces.

**TradingSession:**
Top-level integration that wires CanarySession, RegimeClassifier, RegimePolicyEngine, LearningEngine, AuditReconstructor, and RouteEngine into a single operational session. Orchestrates the full cycle from regime classification through opportunity detection to audit.
_Avoid_: treating as a standalone component; bypassing its subsystem wiring.

**CanarySession:**
Deterministic live canary session that enforces bounded capital, per-trade/day/venue limits, kill switch, and emergency modes. Identical logic in demo and live; only the exchange endpoints differ.
_Avoid_: treating demo and live as different codepaths.

**LearningEngine:**
Governed learning loop that orchestrates TradeJournal, EdgeDecayDetector, and PromotionPipeline. Records every trade outcome, detects edge decay, and generates recommendations. Never mutates production directly.
_Avoid_: autonomous strategy changes; learning without audit trail.

**AuditReconstructor:**
Assembles end-to-end trade timelines from audit events and trade journal entries. Produces `TradeReconstruction` objects with full phase mapping, incident flags, and lessons.
_Avoid_: partial reconstruction; reconstructing without journal entries.

**Harness:**
Reproducible environment for evaluating strategies and agents: backtest, replay, fill/slippage/gas/latency/failure simulators, and stress tests. Uses deterministic PRNG for bit-exact reproducibility.
_Avoid_: promoting to production without reproducible evidence.

**Demo Trading:**
Bybit's simulated trading environment (`api-demo.bybit.com`) with virtual assets. Exercises the full execution/reconciliation/audit pipeline against real exchange endpoints. Required validation before live.
_Avoid_: treating demo as live capital; treating it as pure internal simulation.

**Live:**
Bybit's real trading environment with real balances, real API keys, and capital at risk. Requires explicit human approval, demo evidence, canary limits, and rollback path.
_Avoid_: any mode without real credentials or without capital exposure.

**Seam (unified runner):**
Single `LiveRunner` receives `bybitEndpoints` from `AppConfig`. `MODE=demo` → demo endpoints; `MODE=live` → mainnet endpoints. No parallel runners. `AgentAdapter` is identical across modes.

**Kill switch:**
Manual (TUI) + automatic (drawdown, orphans, reconciliation mismatch). Identical in demo and live. Activates `HALT` mode and blocks all new `OrderIntent` objects.
_Avoid_: treating kill switch as optional; different behavior between modes.
