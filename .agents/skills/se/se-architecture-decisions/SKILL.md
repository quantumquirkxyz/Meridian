---
name: se-architecture-decisions
category: skill-dev/sandbox
maturity: experimental
version: 1
description: Record and evaluate architecture decisions (ADR format) — context, decision, consequences, trade-offs — with a review step.
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


# Architecture Decisions

Document and evaluate a **software architecture decision** using the ADR format — context, decision, consequences — with an explicit trade-off review.

## When to use

- The user needs to record or review a major architecture choice.
- A decision has long-lasting impact (language, framework, database model, deployment model).
- A team needs a durable explanation of why a system is shaped a certain way.

## Process

1. Title — short, unique identifier.
2. Status — proposed / accepted / deprecated / superseded.
3. Context — what problem, constraints, and forces led to this decision? Use leading words.
4. Decision — what we decided, with the decision stated as positive (not negative) behaviour.
5. Consequences — positive, negative, and neutral. Explicit trade-offs.
6. Alternatives considered — with brief evaluation of each.
7. Review — adversarial pass: what assumption could turn wrong? What is the rollback / change path if the decision is superseded?
8. Deliver — artifact: ADR document with all sections present; no vague language.
