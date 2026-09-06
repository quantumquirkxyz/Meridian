---
name: quant-backtest
category: skill-dev/sandbox
maturity: experimental
version: 1
description: Run a backtest with full audit hygiene — biases, costs, out-of-sample, regime splits — and produce a verdict on whether a strategy is robust.
capabilities:
  - specify a trading strategy with signal, universe, sizing, and cost model
  - audit data for survivorship bias, look-ahead, and delisting handling
  - run backtest with out-of-sample split and transaction costs
  - validate coverage and stress-test across market regimes
outputs:
  - Backtest audit report (strategy spec, data audit, performance statistics, stress tests, verdict)
sideEffects: []
dependencies: []
stopCondition: Audit report complete with strategy spec, data audit, statistics, stress tests, and verdict.
risk: low
trustTier: 1
maxIterations: 6
---

## Contract

- **Input:** trading strategy definition (signal, universe, sizing, costs).
- **Output:** backtest audit report with strategy spec, data audit, statistics, stress tests, and verdict.
- **Side effects:** none.
- **Dependencies:** data source access.
- **Stop condition:** audit report complete with verdict.
- **Risk:** low.
- **Boundary:** produces audit report; does not execute live trading.

# Quant Backtest Audit

Take a **strategy** and produce a **backtest result you can defend**. A backtest that can't survive audit is decoration.

## When to use

- The user has a strategy and wants its historical performance.
- A claimed alpha or Sharpe needs independent verification.
- A live-trading decision will be made from the result.

## Process

### 1. Spec the strategy

Capture in writing:

- **Signal(s)** — input → score → decision.
- **Universe** — assets and any filtering rules.
- **Schedule** — rebalance dates, holding period.
- **Sizing** — equal weight, vol-targeted, Kelly-fraction.
- **Costs** — commissions, spread, borrow, impact.

No ambiguity. If a parameter is unspecified, ask.

**Completion criterion:** the strategy could be re-implemented from the spec alone.

### 2. Audit the data

- **Survivorship bias:** use point-in-time dataset; keep delisted names.
- **Look-ahead:** features computed only on data available at the decision timestamp.
- **Adjustments:** splits, dividends, mergers consistent with provider.
- **Corporate actions:** delistings reflected in returns (delisting return ≠ 0).

**Completion criterion:** each bias named and the dataset policy is documented.

### 3. Run the backtest

- **Transaction-cost model:** not zero. Commissions + spread + impact estimate.
- **Out-of-sample split:** train / test / walk-forward, not just one backtest window.
- **Benchmark:** explicit (e.g. cap-weighted universe, risk-free, SPY).
- Report: Sharpe, Sortino, max drawdown, Calmar, annualised return, annualised vol, win rate.

**Completion criterion:** backtest run; out-of-sample period honoured; all statistics present.

### 4. Stress tests

- **Subperiods:** does it survive across decades / regimes (2008, 2020, 2022)?
- **Sectors / geographies:** is the effect localised to one slice?
- **Turnover:** annualised; high turnover often eats alpha.
- **Crowding:** is the strategy correlated with known crowded trades?

**Completion criterion:** each stress test reported; weakest point named.

### 5. Coverage validation

Does VaR 95% cover ~95% of out-of-sample days? If not, recalibrate.

**Completion criterion:** coverage check completed; discrepancy addressed.

### 6. Verdict

Deliver the verdict:

- **Robust:** survives stress tests, stable across subperiods, reasonable turnover, Sharpe > 1 after costs.
- **Weak:** passes some tests but fragile under regime change or high turnover.
- **Fails:** does not survive out-of-sample or stress tests.

**Completion criterion:** verdict stated with evidence; recommendation (deploy / do not deploy / revise).

### 7. Deliver

Markdown artifact: strategy spec, data audit, backtest statistics, stress tests, coverage validation, and verdict with explicit conditions.

**Completion criterion:** report complete; all sections present; verdict honest.
