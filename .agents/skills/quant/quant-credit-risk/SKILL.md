---
name: quant-credit-risk
category: skill-dev/sandbox
maturity: experimental
version: 1
description: Model credit risk — PD, LGD, EAD, expected loss, loss distribution, credit VaR — with default correlation and portfolio-level risk aggregation.
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


# Credit Risk Modeling

Model **credit risk** at the instrument and portfolio level — PD, LGD, EAD, EL, UL — with default correlation and aggregation.

## When to use

- The user wants to model credit exposure, expected loss, or portfolio credit risk.
- A loan book, bond portfolio, or corporate credit desk needs risk quantification.
- A Basel / IFRS 9 / CECL calculation is needed.

## Process

1. Define scope — single name / portfolio; rating grade; time horizon (1Y PD, lifetime PD).
2. Estimate PD — historical default frequency,迁移矩阵, KMV-Merton model, or logistic regression on financial ratios.
3. Estimate LGD — workout LGD vs market LGD; recovery rate; downturn LGD (regulatory).
4. Estimate EAD — drawn amount + credit conversion factor (CCF) for off-balance-sheet.
5. Compute Expected Loss (EL) = PD × LGD × EAD; Unexpected Loss (UL) = √(variance of loss).
6. Default correlation — Basel rho formula (equity-based), or copula (Gaussian, t-copula). Aggregate portfolio loss distribution.
7. Stress testing — PD + 2 grades, LGD × 1.5, portfolio loss at 99.9%.
8. Deliver — artifact: PD/LGD/EAD estimates with methodology, EL/UL, correlation, stress test, and regulatory compliance note (Basel III / IFRS 9).
