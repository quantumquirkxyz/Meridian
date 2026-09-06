---
name: deployment
category: platform
maturity: stable
version: 1
description: Define how a project is built, released, and rolled back as a safe operational seam.
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


# Deployment

Use this skill when the project needs a clear release path. It should define how an immutable build artifact moves from repo to runtime, what can fail, and how to recover without guessing. It covers deployment mechanics; release policy and cadence belong to `release-management`.

## Contract

- Input: deployment brief, runtime context, and release constraints.
- Output: a deployment seam proposal, release path, rollback guidance, and deployment safety gates.
- Scope: design release mechanics, not the actual deployment execution.
- Rule: every deployment path needs an explicit rollback path.
- Rule: keep the release seam as small as possible while still covering the operational reality.
- Rule: identify what must be observable before a rollout is safe to continue.
- Rule: promote the same identified artifact through environments; do not rebuild implicitly between gates.
- Rule: state whether the rollout is all-at-once, rolling, blue-green, canary, or another strategy and why it fits the failure domain.
- Rule: treat destructive or incompatible data migrations as a separate compatibility problem; application rollback alone must not be called sufficient.
- Rule: define who or what can halt promotion and what evidence permits resumption.

## Steps

1. Identify the environments, runtime target, artifact identity, and deployment constraints.
2. Describe the build, artifact promotion, configuration, and secret-injection seams.
3. Choose the rollout strategy and define health, readiness, and abort gates.
4. Define rollback, forward-fix, migration compatibility, and failure ownership.
5. State what must be observable and what evidence makes the deployment safe to continue or complete.

## Completion criteria

- the release path is named
- the rollback path is named
- the artifact and rollout strategy are named
- health and abort gates are concrete
- migration and configuration failure modes are addressed
