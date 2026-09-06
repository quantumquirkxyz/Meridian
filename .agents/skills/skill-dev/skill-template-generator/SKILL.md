---
name: skill-template-generator
category: skill-dev
maturity: sandbox
version: 1
description: Generate an interactive, contract-complete Skill template in the sandbox; use when starting a new Skill with the lab's s
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


# Skill Template Generator

## Contract

- Input: skill name, domain, description, and optional capability list.
- Output: a non-overwriting sandbox Skill, completed frontmatter, and validation command.
- Boundary: generate only under `.skill-sandbox/`; promotion remains a separate decision.

Use `node .agents/skills/platform/skill-lab.mjs template <name> --domain <domain>` to create a safe starting point in `.skill-sandbox/`. Ask for the problem, users, capabilities, outputs, dependencies, and risk before generating; never overwrite an existing template.

Validate the result with `node .agents/skills/platform/skill-lab.mjs validate .skill-sandbox/<name> --json`, then promote only after the sandbox checks pass.
