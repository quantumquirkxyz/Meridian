---
name: devops-sre-observability
category: skill-dev/sandbox
maturity: experimental
version: 1
description: Design SRE / observability — SLIs, SLOs, SLAs, dashboards, alerts, incident response — with clear operational signals.
capabilities:
  - define SLIs (Service Level Indicators) for critical user journeys
  - define SLOs (Service Level Objectives) with error budgets
  - design dashboards (metrics, logs, traces, alerts)
  - create incident response runbooks
outputs:
  - SLI / SLO / SLA specification
  - Dashboard design
  - Alert rules (thresholds, routing, escalation)
  - Incident response runbook
sideEffects: []
dependencies: []
stopCondition: SLI/SLO defined; dashboards designed; alert rules; runbook saved.
risk: medium
trustTier: 3
maxIterations: 5
---

## Contract

- **Input:** system architecture, user journeys, critical paths, available telemetry.
- **Output:** SLI/SLO spec + dashboard design + alert rules + runbook.
- **Side effects:** none (design only; execution requires access to telemetry platform).
- **Dependencies:** telemetry platform (Prometheus / Grafana / Datadog / CloudWatch / New Relic / Jaeger).
- **Stop condition:** all outputs saved.
- **Risk:** medium — wrong alerts cause fatigue or miss critical events.
- **Boundary:** defines observability; does not configure production alerts alone.

# SRE Observability Design

Design **operational signals** — SLIs, SLOs, dashboards, alerts, runbooks — so the system stays understandable under load.

## Process

### 1. Identify critical user journeys
- What must always work? (login, checkout, search, data retrieval, payment).
- For each journey: what is the user-facing outcome?

**Completion criterion:** journeys listed.

### 2. Define SLIs
For each journey, pick 2–4 indicators:
- **Latency:** request latency (p50 / p95 / p99).
- **Availability:** success rate (HTTP 2xx / total) or error rate.
- **Quality:** result relevance, correctness rate, data freshness.
- **Freshness:** data delay (time from source update to available to user).

**Completion criterion:** SLIs defined per journey.

### 3. Set SLOs
Target values per SLO (e.g. 99.9% availability over 30 days; p95 latency < 200ms; error rate < 0.1%).
Compute error budget (1 — SLO target) — available for planned maintenance / risk-taking.

**Completion criterion:** SLO targets stated; error budgets computed.

### 4. Design alerts
- **Critical:** page immediately (availability < SLO, latency spike, error rate surge).
- **Warning:** investigate within 15 min (gradual degradation, resource exhaustion).
- **Info:** log for trend analysis (slow growth, seasonal patterns).
- **Routing:** to on-call, team, or manager based on severity.
- **Escalation:** if not acknowledged, auto-escalate.

**Completion criterion:** alert rules defined with thresholds, routing, escalation.

### 5. Dashboards
- **Overview:** key SLIs, current SLO status, error budget consumed.
- **Detail:** per-service, per-journey, per-region.
- **Trace:** link to tracing for debugging.
- **Historical:** trends over 30/90/365 days.

**Completion criterion:** dashboard design saved.

### 6. Incident runbook
For each critical alert: what to check first? (metrics, logs, traces, recent deploys, dependency status). What is the rollback / mitigation action? Who to page?

**Completion criterion:** runbook saved for each critical alert.
