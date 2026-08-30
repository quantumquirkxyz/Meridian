---
name: search
description: Design search behavior, indexing, and relevance seams so retrieval stays understandable and adjustable.
version: 1
capabilities:
  - design-search-seam
  - shape-retrieval-flow
  - define-relevance-controls
inputs:
  - search brief
  - retrieval context
  - relevance constraints
outputs:
  - search seam proposal
  - indexing guidance
  - relevance control guidance
dependencies:
  - api-design
  - observability
sideEffects:
  - read-only
stopCondition: The search seam, indexing approach, and relevance controls are explicit enough to implement or review.
risk: medium
---

# Search

Use this skill when the system needs retrieval that users can trust. It should define the retrieval seam, indexing shape, and the controls that keep relevance adjustable instead of opaque.

## Contract

- Input: search brief, retrieval context, and relevance constraints.
- Output: search seam proposal, indexing guidance, and relevance control guidance.
- Scope: design search behavior, not the full implementation.
- Rule: keep retrieval and presentation concerns separate.
- Rule: make indexing and ranking tradeoffs explicit.
- Rule: note how relevance can be tuned without rewriting the whole flow.

## Steps

1. Identify the user search job and the target corpus.
2. Define the retrieval and indexing seams.
3. Describe the ranking and relevance controls.
4. Note what feedback or telemetry can tune the result quality.

## Completion criteria

- the retrieval seam is named
- the indexing approach is named
- the relevance controls are explicit
