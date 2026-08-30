---
name: observability
description: Define the logs, metrics, traces, and alerts needed to understand a system in production.
version: 1
capabilities:
  - design-observability
  - define-signal-surface
  - plan-production-diagnostics
inputs:
  - system surface
  - production risk
  - operational context
outputs:
  - observability plan
  - signal priorities
  - diagnostic coverage
dependencies:
  - codebase-design
sideEffects:
  - read-only
stopCondition: The signal surface and diagnostic priorities are clear enough to implement.
risk: low
---

# Observability

Use this skill when a system needs to be understood in production, not just in tests. It should identify the smallest useful signal surface and make the diagnostic path explicit.

## Contract

- Input: system surface, production risk, and operational context.
- Output: an observability plan, signal priorities, and diagnostic coverage.
- Scope: design observability, not the alerting implementation.
- Rule: prioritize signals that explain user-visible failures first.
- Rule: avoid noisy telemetry that does not help diagnosis.
- Rule: connect signals to the seam where the system actually fails or slows down.

## Steps

1. Identify the user-visible failure modes.
2. Map each one to logs, metrics, traces, or alerts.
3. Prioritize the smallest set of signals that gives real diagnostic value.
4. Define what "healthy" and "broken" should look like.

## Completion criteria

- the signal surface is named
- the most important signals are prioritized
- the diagnostic path is concrete enough to build
