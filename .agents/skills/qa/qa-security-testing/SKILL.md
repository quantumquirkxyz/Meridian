---
name: qa-security-testing
category: qa
maturity: stable
version: 1
description: Test security posture — auth flows, authorization boundaries, injection paths, session handling, and misconfiguration checks — with adversarial scenarios.
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

# qa-security-testing

- **Propósito**: Test security posture — auth flows, authorization boundaries, injection paths, session handling, and misconfiguration checks — with adversarial scenarios.
- **Contenido sugerido**: threat scenarios, security test cases, and regression coverage.
- **Estado**: defined as a practical QA specialization.
