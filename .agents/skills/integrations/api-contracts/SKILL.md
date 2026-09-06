---
name: api-contracts
category: integrations
maturity: stable
version: 1
description: Define the request and response contracts, versioning rules, and compatibility boundaries for APIs.
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
