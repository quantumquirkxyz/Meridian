---
name: finance-portfolio-theory
category: skill-dev/sandbox
maturity: experimental
version: 1
description: Modern Portfolio Theory — efficient frontier, CAPM, APT, risk attribution, and performance measurement — with explicit assumptions and regime analysis.
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


# Portfolio Theory

Apply **Modern Portfolio Theory** — efficient frontier, CAPM, APT, performance attribution — with explicit assumptions and regime analysis.

## When to use

- The user wants to understand portfolio construction theory.
- CAPM / factor models are used for expected returns or risk attribution.
- Performance attribution or benchmark comparison is needed.

## Process

1. Define universe — assets, time window, currency.
2. Compute moments — expected returns (historical, factor, or blended), covariance matrix (shrinkage justified), correlations.
3. Efficient frontier — compute frontier; identify minimum-variance portfolio, tangency portfolio, and efficient set.
4. CAPM / APT — estimate beta for each asset; APT: factor exposures (Fama-French 3/5, momentum, quality).
5. Performance attribution — Brinson-Hood-Beebower: allocation, selection, interaction effects.
6. Regime analysis — does the factor model / efficient frontier hold across economic regimes?
7. Deliver — artifact: efficient frontier, CAPM betas / APT factor exposures, attribution decomposition, and a note on model assumptions and regime robustness.
