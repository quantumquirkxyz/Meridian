---
name: project-development
category: project
maturity: stable
version: 1
description: Evaluate a project's shape, agent fit, and architectural starting point before the main workflow begins.
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


# Project Development

Use this skill to decide what kind of project you are dealing with before the workflow commits to a path. A standard project can still be unusual in shape: batch pipeline, agentic system, interactive app, toolchain, or mixed stack. The point of this skill is to classify the shape and choose the right first seam, not to design the whole system.

## Contract

- Input: project brief, repo state, and target stack.
- Output: a project fit assessment, a project shape classification, and an initial flow recommendation.
- Scope: decide the project shape and the first workflow step; do not draft the spec or implementation plan.
- Rule: prefer the smallest workflow that can still respect the project's risk and interface complexity.
- Rule: call out when the project is a poor fit for agent-heavy workflow rather than forcing one.
- Rule: if the project is multi-surface, identify the first surface that should become the seam.

## Steps

1. Read the minimum repo context needed to understand the stack and current constraints.
2. Classify the project shape: interactive app, batch pipeline, agentic system, library, backend service, or hybrid.
3. Identify whether the first useful seam is in UI, API, data, execution, or governance.
4. Recommend the next workflow skill and explain why it is the thinnest safe path.

## Completion criteria

- the project shape is named
- the likely first seam is named
- the next workflow skill is recommended with rationale
