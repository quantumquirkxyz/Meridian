---
name: release-management
description: Plan the release train, CI handoff, and rollback posture for a project so shipping stays controlled.
version: 1
capabilities:
  - design-release-train
  - plan-ci-handoff
  - define-release-rollback
inputs:
  - release brief
  - delivery context
  - pipeline constraints
outputs:
  - release train guidance
  - CI handoff guidance
  - rollback posture
  - release decision record
dependencies:
  - deployment
  - observability
sideEffects:
  - read-only
stopCondition: The release train, CI handoff, and rollback posture are explicit enough to implement safely.
risk: medium
---

# Release Management

Use this skill when a project needs governance for getting changes into production without turning shipping into guesswork. It should define the release train, the CI handoff, approvals, and the conditions for backing out. It decides when a release may advance; `deployment` decides how the runtime promotion works.

## Contract

- Input: release brief, delivery context, and pipeline constraints.
- Output: release train guidance, CI handoff guidance, rollback posture, and a release decision record.
- Scope: shape release mechanics, not the actual pipeline implementation.
- Rule: keep the release path explicit enough that a failed build or bad deploy has a named recovery path.
- Rule: prefer predictable release trains over ad hoc shipping.
- Rule: call out which checks must pass before the release can advance.
- Rule: distinguish required gates from advisory signals and record who owns each decision.
- Rule: define the release candidate, its provenance, and the change set included; avoid silently mixing unrelated work.
- Rule: make approval, freeze, emergency-release, and rollback authority explicit.
- Rule: require post-release verification and a decision to continue, pause, roll back, or forward-fix.

## Steps

1. Identify the release cadence, change surface, release candidate, and provenance.
2. Define required CI gates, advisory checks, approvals, and the handoff into `deployment`.
3. Define freeze, emergency-release, rollback, and forward-fix authority.
4. Describe post-release verification, evidence retention, and the decision owner for each outcome.
5. Note coordination required across repositories, runtime, operators, or external dependencies.

## Completion criteria

- the release cadence is named
- the release candidate and required CI gates are named
- approval and rollback authority are named
- post-release verification and evidence are named
