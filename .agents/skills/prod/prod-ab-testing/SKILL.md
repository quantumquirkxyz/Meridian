---
name: prod-ab-testing
category: skill-dev/sandbox
maturity: experimental
version: 1
description: Design A/B tests — hypothesis, control/treatment, randomization, metrics, statistical power, duration — with valid inference and rollback rules.
capabilities:
  - formulate testable hypotheses
  - design treatment and control with randomisation
  - compute sample size / power / minimum detectable effect
  - define success and guardrail metrics
  - design rollback / escalation rules
outputs:
  - Test design document (hypothesis, metrics, duration, sample size)
  - Analysis plan (statistical test, segmentation, interaction)
  - Rollback / escalation rules
sideEffects: []
dependencies: []
stopCondition: Test design saved; analysis plan saved; rollback rules defined; statistical power computed.
risk: medium
trustTier: 3
maxIterations: 5
---

## Contract

- **Input:** feature change, user segment, metric of interest.
- **Output:** test design with power analysis and rollback rules.
- **Side effects:** none (design only; execution requires deployment and user exposure).
- **Dependencies:** analytics platform (for measurement), experiment platform (for assignment).
- **Stop condition:** design complete; power computed; rollback rules defined.
- **Risk:** medium — bad test design leads to false conclusions; exposure to users requires ethical review.
- **Boundary:** designs experiment; does not expose users to unapproved changes.

# A/B Testing Design

Design an **A/B test** — hypothesis, randomisation, metrics, statistical power — with valid inference.

## Process

### 1. Hypothesis
State a clear, testable statement:
- "Changing the checkout button from grey to green increases conversion rate by ≥ 2%."
- Must specify: metric, direction, magnitude, user segment.

**Completion criterion:** hypothesis saved with metric, direction, magnitude.

### 2. Selection
- **Control:** current experience.
- **Treatment:** new experience.
- **Randomisation:** user-level assignment (cookie / account / session); must be independent of behaviour.
- **Segmentation:** if testing on a subset (e.g. new users only), state why.
- **Exclusions:** users with special conditions (e.g. VIP, internal, disabled users) must be handled ethically.

**Completion criterion:** assignment method saved; exclusions noted.

### 3. Metrics
- **Primary:** the metric that determines success (e.g. conversion rate, click-through rate, retention).
- **Secondary:** supportive metrics (e.g. revenue per user, time on task, error rate).
- **Guardrail:** metrics that must not degrade (e.g. page load time, accessibility, error rate, support tickets).

**Completion criterion:** metrics defined with direction (increase / decrease / maintain).

### 4. Duration and sample size
Compute:
- **Minimum detectable effect (MDE):** smallest improvement that is practically meaningful.
- **Power:** 1 — β (typically 0.8 or 0.9).
- **Significance level α:** 0.05 (or 0.01 for critical decisions).
- **Sample size per variant:** derived from baseline rate, MDE, α, power.
- **Duration:** sample size / daily traffic per variant; account for weekly seasonality; run at least one full week.

**Completion criterion:** sample size and duration computed.

### 5. Analysis plan
- **Statistical test:** z-test for proportions; t-test for means; Mann-Whitney for non-normal; bootstrap for complex metrics.
- **Segmentation:** analyse by subgroups (device, region, user type) — but do not over-segment (risk of false positives).
- **Interaction:** check if treatment effect varies by subgroup (interaction test).
- **Multiple testing correction:** Bonferroni or FDR if testing many metrics or segments.

**Completion criterion:** analysis plan saved.

### 6. Rollback / escalation rules
- **Early stopping rules:** if guardrail metric degrades beyond threshold during first N% of planned duration, stop.
- **Success criteria:** primary metric improves by ≥ MDE with p < α; guardrail metrics not degraded.
- **Rollback:** revert treatment for all users if success criteria not met by end of planned duration, or if guardrail fails.

**Completion criterion:** rollback and escalation rules saved.
