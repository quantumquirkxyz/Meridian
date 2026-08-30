---
name: payments
description: Design payment flows as a high-trust seam with explicit failure, reconciliation, and rollback posture.
version: 1
capabilities:
  - design-payment-seam
  - shape-money-flow
  - define-reconciliation
inputs:
  - payments brief
  - money flow
  - risk constraints
outputs:
  - payment seam proposal
  - reconciliation guidance
  - failure and rollback posture
dependencies:
  - api-design
  - database-migrations
  - observability
sideEffects:
  - read-only
stopCondition: The payment seam, reconciliation path, and failure posture are explicit enough to implement or review.
risk: high
---

# Payments

Use this skill when money moves through the system. It should keep the seam small, the trust boundary explicit, and the failure and reconciliation story visible before implementation begins.

## Contract

- Input: payments brief, money flow, and risk constraints.
- Output: payment seam proposal, reconciliation guidance, and failure/rollback posture.
- Scope: design the money-flow shape, not the full implementation.
- Rule: make settlement, retries, and reconciliation explicit.
- Rule: prefer the narrowest seam that still respects financial correctness.
- Rule: call out where manual review or operator intervention is required.

## Steps

1. Identify the funds flow and trust boundary.
2. Decide how retries, idempotency, and settlement are handled.
3. Define the reconciliation path and operator responsibilities.
4. State the rollback or compensation posture clearly.

## Completion criteria

- the funds-flow seam is named
- the reconciliation path is named
- the failure posture is explicit
