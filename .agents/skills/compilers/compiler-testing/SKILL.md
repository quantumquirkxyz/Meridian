---
name: compiler-testing
category: compilers
maturity: stable
version: 1
description: Test compilers and interpreters — parser tests, semantic tests, IR validation, golden tests, and regression checks — with explicit oracle design.
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

# compiler-testing

- **Propósito**: Test compilers and interpreters — parser tests, semantic tests, IR validation, golden tests, and regression checks — with explicit oracle design.
- **Contenido sugerido**: test matrix, oracles, fixtures, and failure cases.
- **Estado**: defined as a practical compiler specialization.
