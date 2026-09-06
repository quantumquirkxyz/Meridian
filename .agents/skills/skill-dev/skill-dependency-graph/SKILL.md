---
name: skill-dependency-graph
category: skill-dev
maturity: experimental
version: 1
description: Build a dependency graph that exposes central Skills, cycles, and unnecessary coupling; use when analyzing Skill modular
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


# Skill Dependency Graph

## Contract

- Input: the canonical Skills directory.
- Output: Mermaid or JSON graph, cycle list, central Skills, and modularity findings.
- Boundary: analyze declared dependencies only; do not rewrite Skill contracts.

Run `node .agents/skills/platform/skill-lab.mjs graph --format mermaid` for a diagram or `--format json` for analysis input. Use incoming-edge counts to identify central Skills and inspect every cycle before adding another dependency.
