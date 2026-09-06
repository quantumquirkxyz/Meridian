---
name: api-design
category: foundation
maturity: stable
version: 1
description: Design a small, durable API seam that keeps the backend deep and the caller contract explicit.
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


# API Design

Use this skill when the backend needs a stable public contract. It should decide what the caller must know, what stays behind the seam, and how the contract handles errors, versioning, and evolution.

## Contract

- Input: API brief, backend context, and integration constraints.
- Output: an API seam proposal, contract guidance, and error/versioning guidance.
- Scope: design the contract, not the full implementation.
- Rule: keep the API as small as possible while still supporting the real use case.
- Rule: name errors and versioning choices explicitly when they affect callers.
- Rule: prefer a contract that can survive backend refactors without churn.

## Steps

1. Identify the caller's core job.
2. Choose the smallest seam that supports that job.
3. Define success, failure, and evolution behavior.
4. Describe what remains hidden behind the API.

## Completion criteria

- the API seam is named
- the caller contract is explicit
- the error and versioning approach is named
