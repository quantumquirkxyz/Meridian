---
name: quant-factors
category: skill-dev/sandbox
maturity: experimental
version: 1
description: Define, test, and stress-test a quantitative factor (momentum, value, carry, quality) with explicit universe, signal, weighting, and statistical checks.
capabilities:
  - define a factor signal with universe and rebalance rules
  - run a backtest with cost model and out-of-sample split
  - stress-test across subperiods, sectors, and turnover
  - report statistics with significance tests
outputs:
  - Markdown artifact: signal definition, biases, backtest setup, stress tests, statistics, verdict
sideEffects: []
dependencies: []
stopCondition: Artifact present with all six sections; verdict is honest and grounded.
risk: low
trustTier: 1
maxIterations: 6
---

## Contract

- **Input:** factor concept and universe definition.
- **Output:** Markdown backtest artifact.
- **Side effects:** none.
- **Dependencies:** none.
- **Stop condition:** artifact complete with verdict.
- **Risk:** low.
- **Boundary:** reasoning and optional code; no system changes.
---

# Quant Factors

Build a **factor** — a signal that explains cross-sectional returns — and test it with discipline. A factor without a robust test is a story.

## When to use

- The user wants to construct, validate, or critique an investment factor.
- A trading strategy needs its alpha source decomposed.
- An existing backtest needs the "is this real?" sanity pass.

## Process

### 1. Define the signal

State the factor in one sentence: *f(asset) → score*. Examples: trailing-12-month return (momentum), book-to-price (value), term-spread (carry).

Specify:

- **Universe** — what assets are eligible (equities, futures, FX pairs, crypto).
- **Rebalance frequency** — daily / weekly / monthly.
- **Lookback** — explicit window; no implicit defaults.
- **Score direction** — long top, short bottom, or long-only.

**Completion criterion:** signal, universe, rebalance, lookback, direction all stated.

### 2. Handle data honestly

- **Survivorship bias:** use a point-in-time dataset; delisted names kept.
- **Look-ahead bias:** features computed only on data available at decision time.
- **Corporate actions:** splits, dividends, mergers adjusted consistently.
- **Missing data:** explicit policy (drop, fill, cap).

**Completion criterion:** each bias named and the mitigation is in code.

### 3. Build the backtest

Run a backtest with:

- **Transaction-cost model** — not zero. Commissions + spread + market impact estimate.
- **Position sizing** — equal weight, inverse-vol, or factor-weighted.
- **Benchmark** — explicit (e.g. cap-weighted universe, risk-free, SPY).
- **Out-of-sample split** — train / test / walk-forward, not just one backtest window.

**Completion criterion:** backtest code runs; out-of-sample period exists and is honoured.

### 4. Stress tests

Attack the signal:

- **Subperiods:** does it survive across decades / regimes (2008, 2020, 2022)?
- **Sectors / geographies:** is the effect localised to one slice?
- **Turnover:** annualised; high turnover often eats alpha.
- **Capacity:** does Sharpe decay as AUM grows (impact model)?
- **Crowding:** is the factor correlated with known crowded trades?

**Completion criterion:** each stress test reported, even if the answer is "passed".

### 5. Statistics

Report with discipline:

- **Sharpe**, **Sortino**, **max drawdown**, **Calmar**.
- **t-stat of alpha** vs benchmark, not just raw return.
- **Information ratio** if it's an active strategy.
- **p-values** and **multiple-testing correction** if many variants were tried.

**Completion criterion:** Sharpe, drawdown, t-stat (or alpha) all present; multiple-testing acknowledged.

### 6. Deliver

Markdown artifact with: signal definition, biases mitigated, backtest setup, stress tests, statistics, and a **verdict** — "robust", "weak", "fragile", or "fails".

**Completion criterion:** artifact present; verdict is honest and grounded in the numbers, not in narrative.
