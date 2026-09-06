---
name: quant-risk-modeling
category: skill-dev/sandbox
maturity: experimental
version: 1
description: Model market/portfolio/credit risk (VaR, CVaR, drawdown, stress) with explicit distributions, assumptions, and validation against historical stress events.
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


# Quant Risk Modeling

Build a **risk measure** — VaR, CVaR, drawdown, stress — with explicit distributions, assumptions, and historical validation. A risk number without context is misleading.

## When to use

- The user needs a risk metric for a portfolio or strategy.
- A backtest needs a drawdown / stress profile.
- A strategy needs a position-size or leverage cap based on risk.

## Process

### 1. Define the risk object

State exactly what needs measurement: portfolio-level P&L, a single factor, a strategy, an instrument. Time horizon (1-day / 10-day / monthly) matters.

**Completion criterion:** risk object and horizon named; measurement unit (absolute / % / $) specified.

### 2. Choose distribution / model

- **Parametric:** Normal, Student-t, GARCH, multivariate Normal / t.
- **Non-parametric:** historical simulation, bootstrap.
- **Scenario / stress:** specific shocks (rates +200bp, equity crash 2008).
- **Credit / default:** CVaR for defaults, PD/LGD/EAD framework.

Name the choice and why it fits the regime (e.g. "t-distribution for fat tails").

**Completion criterion:** model named; assumption (distribution, correlation, independence) listed.

### 3. Compute

Run with explicit parameters. Report:

- **VaR** at chosen confidence (e.g. 95%, 99%).
- **CVaR / ES** (expected shortfall) — more stable than VaR.
- **Drawdown:** max, average, recovery time.
- **Stress:** impact of named historical or hypothetical shock.

**Completion criterion:** all requested measures present with exact parameters.

### 4. Validate

- **Backtest coverage:** does VaR 95% cover ~95% of out-of-sample days? If not, recalibrate.
- **Stress test:** does the model predict known historical losses within a factor?
- **Stability:** does the risk measure jump wildly on small data changes?

**Completion criterion:** out-of-sample coverage or stability check completed; discrepancy addressed.

### 5. Deliver

Markdown artifact: risk definition, model, measures, validation, and a note on what the number means operationally (e.g. "VaR 99% = $1.2M; expected loss beyond is CVaR 99% = $2.5M").

**Completion criterion:** deliverable includes measures, validation, and an operational interpretation.
