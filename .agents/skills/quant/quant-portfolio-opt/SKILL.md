---
name: quant-portfolio-opt
category: skill-dev/sandbox
maturity: experimental
version: 1
description: Construct and optimise portfolios — mean-variance, Black-Litterman, risk-parity, factor — with explicit objectives, constraints, and robustness checks.
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


# Portfolio Optimisation

Build a **portfolio** from first principles — return model, risk model, objective, constraints — and solve for weights with explicit robustness checks.

## When to use

- The user wants to construct an optimal portfolio (minimum variance, max Sharpe, risk-parity, etc.).
- Asset allocation decisions need a quantitative basis.
- A factor strategy or multi-asset portfolio needs weight optimisation.

## Process

### 1. Define the problem

State:

- **Universe** — assets, time window, currency.
- **Return model** — historical mean, CAPM alpha, factor model; if historical, use shrinkage.
- **Risk model** — sample covariance, factor model covariance, shrinkage (Ledoit-Wolf), or realised vol.
- **Objective** — minimum variance, maximum Sharpe, risk-parity, maximum diversification, minimum drawdown.
- **Constraints** — long-only, box, sector, turnover, leverage, carbon / ESG screens.

**Completion criterion:** universe, return model, risk model, objective, and constraints all explicit.

### 2. Handle estimation error

Historical covariance and mean are noisy. Address:

- **Shrinkage** on covariance (Ledoit-Wolf or oracle approximating).
- **Resampled efficiency** or Bayesian posterior for mean.
- **Black-Litterman** to blend market-implied equilibrium with views.
- **Dropout estimation** — what fraction of estimated alpha survives out-of-sample?

**Completion criterion:** at least one technique to combat estimation error applied.

### 3. Solve

Run the optimisation:

- Quadratic solver (QP) for mean-variance.
- Non-linear for risk-parity (risk budgeting).
- MIP if cardinality constraints (max N assets).
- Report weights, expected return, expected vol, Sharpe ratio.

**Completion criterion:** weights computed; metrics (return, vol, Sharpe) reported.

### 4. Robustness checks

- **Sensitividad** — perturb each input by ±10%; which weights change most?
- ** turnover** — if rebalanced monthly, annual turnover and transaction cost drag.
- **Regime** — does the portfolio behave in 2008 / 2020 as it did in calm markets?
- **Corner solutions** — if weights are extreme (e.g. 90% in one asset), re-run with tighter constraints.

**Completion criterion:** each check completed; extreme or fragile weights flagged.

### 5. Deliver

Markdown artifact: universe, return/risk models, objective, constraints, weights (table), metrics, robustness checks, and the **key sensitivity** — which input moves the most.

**Completion criterion:** deliverable complete; extreme weights acknowledged.
