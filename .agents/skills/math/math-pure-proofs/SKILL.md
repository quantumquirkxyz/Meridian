---
name: math-pure-proofs
category: skill-dev/sandbox
maturity: experimental
version: 1
description: Write and verify pure-math proofs (number theory, algebra, analysis, combinatorics) with rigorous step-by-step reasoning and explicit proof strategies.
capabilities:
  - parse a mathematical statement into shape and domain
  - select the proof strategy that fits the claim type
  - construct a step-by-step proof with explicit logical rules
  - verify the proof by substitution, adversarial pass, and limit checks
outputs:
  - Markdown artifact containing: statement, strategy, numbered steps, verification, and cited theorems
sideEffects: []
dependencies: []
stopCondition: Markdown artifact exists with all five sections (statement, strategy, steps, verification, cited theorems); every proof step is justified with a named rule.
risk: low
trustTier: 1
maxIterations: 5
---

## Contract

- **Input:** a mathematical statement to prove (or a set of statements to evaluate).
- **Output:** a Markdown proof artifact saved to the repo, with statement, strategy, steps, verification, and theorem citations.
- **Side effects:** none.
- **Dependencies:** none.
- **Stop condition:** all proof steps justified; verification passed; artifact saved.
- **Risk:** low — reasoning-only, no code execution.
- **Boundary:** generates reasoning only; no code execution, no file system writes beyond the Markdown artifact.

# Pure-Math Proofs

Construct a **proof** — an airtight argument from accepted axioms to a stated statement — using the strategy that fits the shape of the claim.

## When to use

- User asks to "prove", "demonstrate", "show rigorously" a mathematical statement.
- The statement lives in number theory, algebra, analysis, combinatorics, or topology.
- A claim from another skill (e.g. `cs-formal-methods`) needs a mathematical underpinning.

## Process

### 1. Diagnose the claim

State the claim in your own words; identify its **shape** — universal (∀), existential (∃), implication, equivalence — and the **domain** (ℕ, ℤ, ℝ, groups, rings, vector spaces, metric spaces). A wrong diagnosis wastes every step after.

**Completion criterion:** the claim is restated with shape, domain, and the smallest hypothesis set that makes it true.

### 2. Pick the proof strategy

Choose the strategy that matches the shape:

- **Direct** — chain of implications.
- **Contradiction** — for "no such object exists" / "P implies Q" when direct fails.
- **Contrapositive** — for implications whose converse is easier.
- **Induction** — for statements indexed by ℕ; check base and inductive step explicitly.
- **Strong induction** — when the inductive step needs more than one previous case.
- **Construction** — for existential claims; exhibit the witness and verify.
- **Pigeonhole / extremal / counting** — for combinatorial statements.
- **Diagonalisation** — for non-constructive existence.

**Completion criterion:** strategy is named and one sentence justifies it.

### 3. Build the argument

Write the proof as numbered steps. Each step carries one logical move. State the rule you used (e.g. "by the axiom of choice", "since G is a group, inverses exist"). No gaps; a reader with the prerequisites should follow without filling in.

**Completion criterion:** every step is justified; no step is hand-waved with "clearly" or "obviously" on a non-trivial claim.

### 4. Verify

Sanity-check the proof three ways:

- **Substitute a small instance** (n = 1, 2, 3) and confirm the claim holds and the proof still applies.
- **Look for the contrapositive / converse** — does the proof accidentally prove something stronger or weaker?
- **Adversarial pass** — try to break it: find an edge case the proof ignores, a quantifier flip, an off-by-one.

**Completion criterion:** at least one verification pass completed; any flaw found is fixed before delivery.

### 5. Deliver

Produce the proof in a Markdown file with: statement, strategy, steps, verification notes, and any assumptions called out. Cite definitions or theorems used by name.

**Completion criterion:** Markdown artifact exists; statement, strategy, steps, verification all present; no step is unjustified.
