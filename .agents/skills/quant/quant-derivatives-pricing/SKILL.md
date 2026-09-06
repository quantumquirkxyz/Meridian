---
name: quant-derivatives-pricing
category: skill-dev/sandbox
maturity: experimental
version: 1
description: Price and calibrate derivatives (options, exotics, structured products) — Black-Scholes, trees, Monte Carlo — with Greeks, model risk, and calibration validation.
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


# Derivatives Pricing & Calibration

Price a **derivative** — vanilla option, exotic, structured — using a model, compute Greeks, and validate calibration against market data.

## When to use

- The user wants to price an option, swap, exotic, or structured product.
- A risk desk needs Greeks for hedging.
- A quant strategy involves derivatives as a building block.

## Process

### 1. Define the instrument

Name the instrument type (European call, American put, barrier, Asian, quanto, swaption, etc.). Specify underlier, notional, maturity, strike, currency, exercise style (European / American / Bermudan), and payoff structure.

**Completion criterion:** instrument fully specified with all contractual terms.

### 2. Choose the model

- **Black-Scholes** — European options on log-normal underliers; closed-form.
- **Black-76** — futures / forward options; cap/floor.
- **Binomial / Trinomial trees** — American options, early exercise premium.
- **Monte Carlo** — path-dependent exotics, stochastic vol.
- **Heston** — stochastic vol; semi-closed form (characteristic function) or MC.
- **Local vol** — calibrated to vol surface.
- **Jump-diffusion** — Merton, Kou; for gaps and fat tails.

Name the model and state the SDE.

**Completion criterion:** model named; SDE or pricing equation written.

### 3. Price

Run the model:

- Analytical (closed-form formula).
- Numerical (tree steps, MC paths, PDE grid).
- Report the price; state the risk-neutral vs physical measure if relevant.

**Completion criterion:** price computed; method, steps / paths, and seed (if MC) reported.

### 4. Compute Greeks

Report at minimum: Δ, Γ, ν (vega), ρ (rho), θ. For American options, also report early exercise boundary. Greeks should be computed via bump-and-reprice or finite differences on the model.

**Completion criterion:** Δ, Γ, ν, ρ, θ all present; method (bump-and-reprice or finite diff) stated.

### 5. Calibrate to market

If using a model with free parameters (Heston k, θ, ν, ρ; local vol volatility):

- Fit to market-implied vol surface (minimise squared-error weighted by vega).
- Report calibration error (RMSE in vol points).
- Stress the calibration: what happens to price if one vol parameter changes?

**Completion criterion:** calibration done; RMSE reported; stressed parameters.

### 6. Deliver

Markdown artifact: instrument, model, SDE, price, Greeks, calibration (if applicable), and a **model risk note** — what the model ignores and what the gap to market means.

**Completion criterion:** deliverable complete; model risk addressed.
