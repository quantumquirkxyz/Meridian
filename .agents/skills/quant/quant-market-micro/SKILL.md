---
name: quant-market-micro
category: skill-dev/sandbox
maturity: experimental
version: 1
description: Analyse market microstructure — order book dynamics, price formation, execution costs (slippage, spread, impact), and optimal execution strategies.
capabilities:
  - execute the core process defined in the skill body
  - produce a Markdown artifact satisfying completion criteria
outputs:
  - Markdown artifact with all process steps completed
sideEffects: []
dependencies: []
stopCondition: All process steps executed; artifact saved with all required sections present.
risk: low
trustTier: 1
maxIterations: 6
---

## Contract

- **Input:** problem description and inputs defined by the skill body.
- **Output:** Markdown artifact with completed process steps.
- **Side effects:** none.
- **Dependencies:** none.
- **Stop condition:** all process steps executed; artifact saved with required sections.
- **Risk:** low.
- **Boundary:** produces reasoning artifact only; no system changes.


# Market Microstructure

Analyse **market microstructure** — order book, price formation, execution costs, and optimal execution — with quantitative models.

## When to use

- The user wants to analyse or minimise execution costs.
- An algo trading or execution strategy needs a market model.
- A quant strategy needs realistic slippage / spread estimates.

## Process

1. Identify venue type — lit exchange, dark pool, OTC, CEX vs DEX.
2. Order book model — queueing theory (Geometric Brownian Motion of queue), Glosten-Milgrom (adverse selection), or Kyle's lambda.
3. Spread decomposition — bid-ask spread = adverse selection + inventory + order processing cost.
4. Execution costs — slippage vs arrival price, market impact (temporary vs permanent), timing risk from delay.
5. Optimal execution — Almgren-Chriss framework (minimise expected cost + variance of execution); VWAP, TWAP, POV benchmarks.
6. Data requirements — tick data, order log, trade reporting; NO OHLCV-only backtests for microstructure claims.
7. Deliver — artifact: venue model, spread decomposition, cost estimate (bps), and optimal execution schedule.
