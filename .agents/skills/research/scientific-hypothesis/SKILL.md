---
name: scientific-hypothesis
category: skill-dev/sandbox
maturity: experimental
version: 1
description: Formulate testable scientific hypotheses — null/alternative, variables, controls, falsifiability — with explicit variables and statistical plan.
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


# Scientific Hypothesis Design

Formulate a **scientific hypothesis** that is testable, falsifiable, and tied to measurable variables with controls.

## When to use
- The user wants to design a study, experiment, or observation.
- A claim needs to become a testable prediction.
- A research proposal needs hypothesis formulation.

## Process
1. Problem — the phenomenon to explain.
2. Hypothesis — null (H₀) and alternative (H₁); clearly stated predictions.
3. Variables — independent, dependent, control, confounding; define each with measurement method.
4. Design — experiment vs observation; randomisation; controls; blinding; sample size (power analysis).
5. Statistics — test selection (t-test, ANOVA, chi-square, regression), significance level (α), effect size, confidence intervals.
6. Deliver — artifact with H₀/H₁, variables, design, statistical plan, and limitations.
