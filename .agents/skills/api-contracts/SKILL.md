---
name: api-contracts
description: Define the request and response contracts, versioning rules, and compatibility boundaries for APIs.
version: 1
capabilities:
  - define-api-contract
  - shape-request-response
  - specify-versioning
inputs:
  - API contract brief
  - consumer context
  - compatibility constraints
outputs:
  - contract shape
  - versioning guidance
  - compatibility notes
dependencies:
  - api-design
  - domain-modeling
sideEffects:
  - read-only
stopCondition: The contract shape and compatibility rules are explicit enough to implement or review.
risk: low
---

# API Contracts

Use this skill when the request and response surfaces need to be pinned down precisely. It should define what callers send, what they receive, and how the contract can evolve without surprising consumers.

## Contract

- Input: API contract brief, consumer context, and compatibility constraints.
- Output: contract shape, versioning guidance, and compatibility notes.
- Scope: define the contract, not the implementation.
- Rule: keep the request and response shapes minimal and explicit.
- Rule: call out backward compatibility expectations before the first change lands.
- Rule: name the versioning strategy when the contract is expected to evolve.

## Steps

1. Identify the consumer's job.
2. Define the request and response shapes.
3. Specify the versioning and compatibility rules.
4. Note any error or pagination conventions that callers must know.

## Completion criteria

- the request and response shapes are named
- the versioning strategy is named
- the compatibility rules are explicit
