---
name: monitoring-alerting
category: platform
maturity: stable
version: 1
description: Define the alerts, dashboards, and runtime signals that keep a project understandable in production.
capabilities:
  - execute the core process defined in the skill body
  - produce a Markdown artifact or structured result
outputs:
  - Markdown artifact with process steps and completion criteria
sideEffects: []
dependencies: []
stopCondition: All process steps executed; artifact saved; criteria met.
risk: low
trustTier: 1
maxIterations: 6
---

## Contract

- **Input:** problem or task defined by the skill body.
- **Output:** Markdown artifact or structured result with completion criteria met.
- **Side effects:** none (design/review/documentation only unless explicitly stated).
- **Dependencies:** none (self-contained unless linked to other skills).
- **Stop condition:** all process steps completed; artifact saved; criteria checked.
- **Risk:** low.
- **Boundary:** produces reasoning or documentation artifacts; does not modify external systems unless explicitly instructed.


# Monitoring and Alerting

Use this skill when a project needs to stay visible after deploy. It should decide what to watch, what to alert on, who responds, and what a human should inspect first when something goes wrong. `observability` defines the signal vocabulary; this skill turns the relevant signals into operational decisions.

## Contract

- Input: monitoring brief, runtime surface, and failure modes.
- Output: a monitoring plan, alert priorities, diagnostic signals, and response ownership.
- Scope: design the alert surface, not the monitoring stack implementation.
- Rule: prioritize user-visible failures and operational regressions.
- Rule: avoid alert spam that does not change a maintainer's decision.
- Rule: connect alerts to the seam where the system actually degrades.
- Rule: every paging alert needs a threshold or condition, owner, severity, response target, and runbook or first diagnostic action.
- Rule: prefer symptoms and service-level indicators for paging; use causes as supporting diagnostics unless they require immediate action.
- Rule: define retention, sampling, cardinality, and redaction constraints for signals that may contain user or secret data.
- Rule: state how deploy markers and release identity correlate with alerts so regressions can be attributed.

## Steps

1. Identify the user-visible failure modes, service-level indicators, and operational risks that matter most.
2. Map each failure mode to signals, dashboards, deploy markers, and alerts with explicit thresholds.
3. Assign severity, owner, response target, escalation, and a runbook or first diagnostic action.
4. Check signal cost and safety: retention, sampling, cardinality, redaction, and false-positive risk.
5. Define the smallest useful alert set and the evidence needed to tune it after real incidents.

## Completion criteria

- the top failure modes are named
- alert conditions, severity, and ownership are named
- the initial diagnostic path and escalation are explicit
- signal privacy and operational cost constraints are addressed
