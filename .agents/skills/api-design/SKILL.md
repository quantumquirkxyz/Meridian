---
name: api-design
description: Design a small, durable API seam that keeps the backend deep and the caller contract explicit.
version: 1
capabilities:
  - design-api-seam
  - shape-backend-contract
  - reduce-caller-burden
inputs:
  - API brief
  - backend context
  - integration constraints
outputs:
  - API seam proposal
  - contract guidance
  - error and versioning guidance
dependencies:
  - codebase-design
  - domain-modeling
sideEffects:
  - read-only
stopCondition: The API seam and contract are concrete enough to implement or review.
risk: low
---

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
