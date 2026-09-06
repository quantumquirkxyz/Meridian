---
name: cs-algorithms
category: skill-dev/sandbox
maturity: experimental
version: 1
description: Design and analyse algorithms — correctness proof, complexity analysis (time and space), and stability — with explicit proof of invariants and termination.
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


# CS Algorithms

Design, analyse, and verify an **algorithm** — its correctness, complexity, stability, and invariants — with an explicit proof structure.

## When to use

- The user needs an algorithm designed or analysed.
- A data structure choice needs justification.
- Performance or correctness requires proof.

## Process

1. Problem statement — input, output, pre/post conditions.
2. Algorithm design — strategy (divide and conquer, greedy, dynamic programming, backtracking, etc.); justify why it fits.
3. Pseudocode / code — clean, with clear variable names.
4. Correctness proof — loop invariant; termination; initialisation, maintenance, termination. Or proof by contradiction / induction for non-loop structures.
5. Complexity analysis — time (best/average/worst), space; use Big-O with justification (count operations, recursion depth).
6. Stability — if numerical, numerical stability; if combinatorial, output stability.
7. Deliver — artifact: problem, design, code/pseudocode, correctness proof, complexity, stability note.
