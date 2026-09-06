---
name: search
category: integrations
maturity: stable
version: 1
description: Design search behavior, indexing, and relevance seams so retrieval stays understandable and adjustable.
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
