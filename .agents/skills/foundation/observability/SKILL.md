---
name: observability
category: foundation
maturity: stable
version: 1
description: Define the logs, metrics, traces, and alerts needed to understand a system in production.
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
