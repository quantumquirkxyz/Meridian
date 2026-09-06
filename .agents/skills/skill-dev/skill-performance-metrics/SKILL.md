---
name: skill-performance-metrics
category: skill-dev
maturity: experimental
version: 1
description: Summarize Skill execution duration, success rate, and available run evidence; use when measuring Skill performance from 
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


# Skill Performance Metrics

## Contract

- Input: an execution-record directory.
- Output: sample count, explicit duration availability, average duration, success rate, and cognitive-complexity estimates.
- Boundary: report only available evidence; missing duration data is not zero.

Run `node .agents/skills/platform/skill-lab.mjs metrics`. Use enough execution records to avoid drawing conclusions from one run; report missing duration data instead of treating it as zero.
