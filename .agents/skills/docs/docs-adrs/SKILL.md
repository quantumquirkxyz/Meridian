---
name: docs-adrs
category: skill-dev/sandbox
maturity: experimental
version: 1
description: Create and maintain Architecture Decision Records — context, decision, consequences, alternatives, status — with periodic review.
capabilities:
  - execute the core process defined in the skill body
  - produce a Markdown artifact satisfying completion criteria
outputs:
  - Markdown artifact with all process steps completed
sideEffects: []
dependencies: []
stopCondition: All process steps executed; artifact saved with all required sections present.
risk: low
trustTier: 1
maxIterations: 6
---

## Contract

- **Input:** problem description and inputs defined by the skill body.
- **Output:** Markdown artifact with completed process steps.
- **Side effects:** none.
- **Dependencies:** none.
- **Stop condition:** all process steps executed; artifact saved with required sections.
- **Risk:** low.
- **Boundary:** produces reasoning artifact only; no system changes.


# ADR Creation

Create an **Architecture Decision Record** (context, decision, consequences, alternatives, status) with an explicit review cycle.

## When to use
- A significant architecture choice is made.
- The team needs a durable explanation of design.
- A decision needs to be revisited over time.

## Process
1. Title, number, date.
2. Status — proposed / accepted / deprecated / superseded.
3. Context — driving forces, constraints, alternatives considered briefly.
4. Decision — positive statement of what was chosen.
5. Consequences — positive, negative, neutral; risks and trade-offs.
6. Alternatives — listed with brief evaluation.
7. Links — related ADRs, PRs, docs.
8. Review — set a review date; document why it might be superseded.
9. Deliver — Markdown artifact in docs/adr/ directory with the full template.
