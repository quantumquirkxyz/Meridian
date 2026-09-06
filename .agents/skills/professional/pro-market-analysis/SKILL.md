---
name: pro-market-analysis
category: skill-dev/sandbox
maturity: experimental
version: 1
description: Conduct professional market research — TAM/SAM/SOM, competitor analysis, pricing, and trend forecasting — with source citation and data quality checks.
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


# Professional Market Research

Conduct **market analysis** — TAM/SAM/SOM, competitor mapping, pricing analysis, trend forecasting — with explicit sources and data quality checks.

## When to use
- The user needs market sizing for a business plan.
- A competitive landscape needs mapping.
- A pricing or go-to-market strategy needs data.

## Process
1. Scope — market definition, geography, time horizon.
2. TAM / SAM / SOM — total, serviceable, obtainable; justify with data sources.
3. Competitors — direct / indirect / substitutes; mapping with positioning and pricing.
4. Pricing — price points, cost structure, willingness-to-pay signals.
5. Trends — technology, regulation, demographic, macroeconomic; sources (reports, news, data APIs).
6. Data quality — primary vs secondary; date; bias; missing data acknowledged.
7. Deliver — Markdown report with sections, source citations, and a recommendation (enter / niche / avoid / watch).
