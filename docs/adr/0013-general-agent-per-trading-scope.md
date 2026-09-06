# 0013 — General agent per trading scope (venue × pool × pair on DEX, venue × pair on CEX) with catalog sub-agents

Status: accepted
Date: 2026-09-05

## Context

The cognitive layer (ADR-0004) defines 11 consultative agents in a catalog, but the current operational wiring instantiates them once per session: a single "market-observer" adapter and one LLM adapter behind one `AgentAdapter` bound to the `TradingSession`. As the system scales across venues (Bybit, Binance, PancakeSwap) and pairs, a single global instantiation leaves analysis, memory, and debate unattached to the concrete trading unit being evaluated. There is no cognitive owner for a trading scope, no per-scope state, and no clear place to scope sub-agent invocation, budgets, or memory.

A **trading scope** is the pair's liquidity context at a venue: (venue, pool, pair) on a DEX (a pool is DEX-only smart-contract liquidity), and (venue, pair) on a CEX, where the functional equivalent of the pool is the venue's **order book** — e.g. BTC/USDT on Bybit has no pool; its scope is the pair against Bybit's order book.

Operator intent: a general agent should operate per venue, within each pool, per pair — one cognitive coordinator per trading scope — and it should hold the catalog agents as sub-agents bound to that scope.

## Decision

Deploy one **general agent** per trading scope — (venue, pair) on a CEX, and (venue, pool, pair) on a DEX. Each general agent is the cognitive coordinator of its scope: it decides which sub-agents to invoke, feeds them inputs scoped to its venue/pool/pair (or venue/pair), aggregates their structured outputs, and emits one recommendation per cycle for the mandatory Risk Engine gate.

The shared catalog of 11 consultative agents (planner-supervisor, arbitrage-alpha, market-regime, bull, bear, skeptic, risk-analyst, execution-advisor, memory, audit, policy) becomes the **sub-agent** library. A **consultative agent** is the umbrella category — observation-only — covering both general agents and sub-agents. Sub-agents are bound to a general agent's scope, carry the same observation-only permissions, and may be skipped when non-mandatory. No agent of either kind executes orders, approves risk, signs transactions, or moves funds (ADR-0003 remains in force for every scope).

## Consequences

- Positive: each trading unit has a cognitive owner with scoped inputs, scoped state, and an auditable recommendation per cycle.
- Positive: per-scope memory and debate are possible; sub-agent reuse keeps the catalog role-defined instead of duplicated per instrument.
- Positive: the Risk Engine stays the sole execution authority; the new deployment changes nothing about who can act.
- Negative: footprint scales with trading scopes (venues × pairs; × pools on DEX); budgets, timeouts, and lifecycle management must be per scope, and not every sub-agent should run an LLM call on every cycle.
- Negative: the current single-adapter wiring in `LiveRunner` must be refactored to instantiate a general agent per configured scope and to scope sub-agent invocation accordingly.
- Follow-up: refactor `packages/cli/src/live-runner.ts` wiring to per-scope general agents; add per-scope budget/lifecycle controls; confirm memoized/fallback sub-agent paths scale before `live`.