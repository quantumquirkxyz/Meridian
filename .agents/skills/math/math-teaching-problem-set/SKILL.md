---
name: math-teaching-problem-set
category: skill-dev/sandbox
maturity: experimental
version: 1
description: Design and grade math problem sets and exams — difficulty progression, rubric, anti-cheating variants, accessibility, and LaTeX layout.
capabilities:
  - design problem sets with difficulty progression
  - generate multiple variants for exam integrity
  - write grading rubrics with partial credit rules
  - produce accessible LaTeX output (alt-text, screen-reader friendly)
outputs:
  - LaTeX problem-set source with multiple variants
  - Rubric table (Markdown or LaTeX)
  - Grader's checklist with point allocations
sideEffects: []
dependencies: []
stopCondition: Problem-set + rubric + variants saved; difficulty progression documented.
risk: low
trustTier: 1
maxIterations: 5
---

## Contract

- **Input:** topic(s), audience level, problem count.
- **Output:** LaTeX problem set + rubric + variants.
- **Side effects:** none.
- **Dependencies:** none.
- **Stop condition:** artifacts saved; variants distinct.
- **Risk:** low.
- **Boundary:** produces teaching artifacts; no live grading.

# Math Teaching — Problem Sets and Exams

Design a **problem set or exam** that tests the right concepts at the right difficulty, with grading rules and exam-ready variants.

## When to use

- A course needs a problem set, midterm, or final.
- An instructor wants multiple variants for exam integrity.
- A grader needs a rubric with partial credit.

## Process

### 1. Define the scope

- **Course level** — undergrad / graduate / competition.
- **Topics** — explicit list of concepts to test.
- **Time** — exam length; per-problem estimate.
- **Allowed aids** — open-book, calculator, none.

**Completion criterion:** scope explicit.

### 2. Build difficulty progression

Order problems so each builds on the prior:

- **Tier 1 — recall:** definitions, standard computations.
- **Tier 2 — apply:** use a known method in a new setting.
- **Tier 3 — analyse:** choose a method, justify.
- **Tier 4 — synthesise / prove:** construct a new argument or counterexample.

Each problem tags its tier.

**Completion criterion:** tiers labelled; progression tested.

### 3. Generate variants

For each problem, generate **N variants** (default 4) by:

- Permuting numerical parameters within the same difficulty.
- Swapping roles (e.g. domain/codomain swap).
- Re-arranging order without changing difficulty.

Variants must be **provably distinct** (different numerical answer or different proof).

**Completion criterion:** N variants exist; distinctness argued.

### 4. Rubric

For each problem, write a rubric:

- **Total points.**
- **Per-step credit** — which sub-step earns how much.
- **Common mistakes** — and their deductions.
- **Proofs vs computation** — partial credit for partial proofs.

**Completion criterion:** rubric saved with concrete point allocations.

### 5. Accessibility and layout

- Use LaTeX with semantic commands (`\theorem`, `\lemma`).
- Add `alt` text for figures (TikZ).
- Avoid colour-only signalling.
- Provide a print-friendly PDF and a screen-reader-friendly version.

**Completion criterion:** accessibility checklist completed.

## Notes

- Pair with `math-paper-collaboration` for sharing and versioning.
- Use Overleaf for collaborative editing; tag each term's set.
