---
name: finance-corporate-val
category: skill-dev/sandbox
maturity: experimental
version: 1
description: Corporate valuation — DCF, multiples, sum-of-parts, scenario analysis — with explicit assumptions, sensitivity, and cross-checks.
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


# Corporate Valuation

Compute a **corporate valuation** — not a price target, but a disciplined range with assumptions exposed — using DCF, multiples, and scenario analysis.

## When to use

- The user wants to value a company, business unit, or asset.
- A deal, M&A, or investment decision depends on a valuation range.
- A back-of-envelope valuation needs to be made defensible.

## Process

### 1. Define scope

Name: the company / unit, the valuation date, the purpose (fair market value, strategic value, liquidation), and the currency / currency-adjusted scenario.

**Completion criterion:** scope, valuation date, purpose, currency all explicit.

### 2. Choose methods

Select at least two independent methods:

- **DCF:** forecast free cash flow, terminal growth, WACC.
- **Multiples:** P/E, EV/EBITDA, EV/Revenue, P/B — with comparable company selection criteria.
- **Sum-of-parts:** for conglomerates; each segment with its own method.
- **Asset-based / liquidation:** for distressed cases.

State why each method fits.

**Completion criterion:** at least two methods named with selection rationale.

### 3. Make assumptions explicit

Every number comes from a source or an explicit assumption:

- **Forecasts:** revenue growth, margins, capex, working-capital — with a source (management, analyst, industry).
- **WACC / discount rate:** risk-free rate, beta, equity risk premium, debt cost, capital structure.
- **Terminal growth:** not automatically 3%; tie to GDP / inflation / sector.
- **Multiples:** how comparables selected; adjustments for size, growth, profitability.

**Completion criterion:** every major assumption is either cited or explicitly stated.

### 4. Run the numbers

Compute each method. For DCF, report:

- Projected FCF by year.
- Terminal value and terminal-value-to-enterprise-value ratio.
- Sensitivity table (WACC ±2%, terminal growth ±1%).

For multiples, show the comparable list and adjustments.

**Completion criterion:** computation executed; sensitivity table present for DCF.

### 5. Cross-check and reconcile

Compare methods:

- Is the DCF range consistent with the multiples range?
- If they diverge, which assumption drives it?
- Scenario analysis: base / optimistic / pessimistic case.
- Sanity against market price: premium / discount to current price, and why.

**Completion criterion:** at least two methods compared; divergence explained.

### 6. Deliver

Markdown artifact with: scope, methods, assumptions (with sources or notes), computation, cross-check, scenario analysis, and a **valuation range** with a narrative about its reliability.

**Completion criterion:** range delivered; reliability note included; sources cited.
