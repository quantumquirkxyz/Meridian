---
name: math-formal-proof
category: skill-dev/sandbox
maturity: experimental
version: 1
description: Develop formal mathematical proofs in proof assistants (Lean 4, Coq, Isabelle, Agda) with literate programming, tactic-driven construction, and verification.
capabilities:
  - represent mathematical statements in a proof assistant's type system
  - build proofs using tactics, lemmas, and libraries (mathlib)
  - verify proofs with the assistant's kernel
  - produce literate proofs (Lean + LaTeX, Coq + LaTeX) for publication
outputs:
  - Source file with verified proof
  - Markdown narrative explaining strategy and key tactics
  - Optional LaTeX export for paper inclusion
sideEffects: []
dependencies: []
stopCondition: source file compiles in the target assistant with no errors; verification report attached.
risk: low
trustTier: 1
maxIterations: 8
---

## Contract

- **Input:** mathematical statement to prove and target proof assistant.
- **Output:** verified source + Markdown narrative.
- **Side effects:** none.
- **Dependencies:** none.
- **Stop condition:** proof verified by the assistant's kernel.
- **Risk:** low.
- **Boundary:** produces verified proof artifacts; no new external system changes.

# Formal Proof Development

Build a **proof** in a proof assistant — Lean 4, Coq, Isabelle, Agda — that the assistant's kernel can verify, with a literate narrative for publication.

## When to use

- A proof needs machine-verifiable rigour.
- A paper's appendix should include a formal proof (increasing trust).
- The researcher is formalising a known result or building a library (e.g. `mathlib`).

## Process

### 1. Pick the assistant

- **Lean 4 + mathlib** — large library, active community, default for many.
- **Coq** — mature; MathComp library for combinatorics.
- **Isabelle / HOL** — strong for analysis, logic, and computer-science theorems.
- **Agda** — small, expressive, dependent types.

State the choice and why.

**Completion criterion:** assistant named; rationale stated.

### 2. Encode the statement

Translate the mathematical statement into the assistant's syntax:

- Use existing types (`ℕ`, `ℝ`, `Group`, `TopologicalSpace`).
- Match the statement's quantifier structure.
- State the theorem header with named variables and explicit hypotheses.

**Completion criterion:** theorem header compiles; types check.

### 3. Choose proof strategy

- **Library search** — `library_search` / `Search` / `find` for an existing lemma.
- **Tactic decomposition** — `intro`, `apply`, `cases`, `induction`, `simp`.
- **Manual proof** — explicit term construction (`exact`, `λ`).
- **Proof by reflection** — for decidable equalities.
- **Proof by automation** — `aesop`, `omega`, `nlinarith`, `field_simp`.

**Completion criterion:** strategy named.

### 4. Build and verify

Write the proof step by step. After each step:

- Run the assistant's checker (`lake build`, `coqc`, `isabelle build`).
- Replace `sorry` and `Admitted` with verified tactics.
- Record the verified proof's hash or kernel confirmation.

**Completion criterion:** proof fully verified (no `sorry`/`Admitted`).

### 5. Literate export

For a paper:

- Use `preprint` / Lean+LaTeX integration, or extract the proof as LaTeX with a translator.
- Annotate key tactics with comments explaining the mathematical intuition.
- Cite the formal proof in the paper ("Verified in Lean 4; see Appendix B").

**Completion criterion:** narrative + verified proof saved; cross-reference to paper present.

## Notes

- Pair with `math-pure-proofs` for informal reasoning.
- For paper inclusion, use a versioned Git tag of the formal proof.
