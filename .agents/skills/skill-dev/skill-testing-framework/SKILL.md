---
name: skill-testing-framework
category: skill-dev
maturity: stable
version: 1
description: Validate Skill structure, contracts, dependencies, anti-patterns, and isolated execution; use when checking a Skill befo
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


# Skill Testing Framework

## Contract

- Input: a Skill path and optional sandbox execution request.
- Output: structural findings and, for sandbox Skills, execution evidence and a promotion recommendation.
- Boundary: use existing repository validators; do not silently mutate canonical Skills.

Run the shared validator with `node .agents/skills/platform/skill-lab.mjs validate <path> --json`, then run the existing sandbox and behavioral validators for execution evidence. Treat unknown dependencies, missing outputs, placeholder text, and contradictory risk declarations as failures or warnings rather than silently accepting them.
