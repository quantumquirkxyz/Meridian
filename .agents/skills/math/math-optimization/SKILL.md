---
name: math-optimization
category: skill-dev/sandbox
maturity: experimental
version: 1
description: Formulate and solve optimization problems (linear, convex, non-convex, combinatorial) — model, choose solver, verify optimality, report sensitivity.
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


# Mathematical Optimization

Turn a real problem into a **mathematical program**, solve it with an appropriate solver, and report what was found — including the gap to optimality when the optimum is not proven.

## When to use

- The user wants to maximize/minimize something under constraints (cost, time, risk, distance, utility).
- A decision can be cast as variables + objective + constraints.
- Other skills (logistics, finance, ML) need an optimization backbone.

## Process

### 1. Model

Define:

- **Decision variables** — what the agent controls.
- **Objective** — single scalar to extremize (or a Pareto front if multi-objective).
- **Constraints** — equalities, inequalities, integrality, bounds.
- **Parameters** — fixed inputs that distinguish instances.

State the canonical class: LP, QP, SOCP, SDP, convex, MIP, non-convex, combinatorial.

**Completion criterion:** variables, objective, constraints, parameters all explicit; canonical class named.

### 2. Diagnose hardness

Identify why the problem is hard (or easy):

- LP: poly-time (interior point / simplex).
- Convex: poly-time in practice.
- MIP: NP-hard in general; LP relaxation gives a bound.
- Non-convex / combinatorial: NP-hard; need heuristic or approximation with a guarantee.

**Completion criterion:** hardness class stated; relaxation or approximation strategy named if not convex.

### 3. Choose solver

Pick by class:

- **LP/MIP:** HiGHS, Gurobi, CPLEX, OR-Tools.
- **Convex (QP/SOCP/SDP):** CVXPY, SCS, MOSEK.
- **Non-convex smooth:** scipy.optimize, IPOPT, PyTorch (gradient-based).
- **Combinatorial:** greedy + local search, simulated annealing, tabu, ALNS, MILP relaxation.
- **Multi-objective:** weighted sum, ε-constraint, or NSGA-II.

**Completion criterion:** solver named with one reason it fits.

### 4. Solve

Run the solver; for non-trivial models:

- Warm-start when possible.
- Set tolerances and iteration caps explicitly.
- Log progress (objective, gap, time) at meaningful checkpoints.

**Completion criterion:** solver run with explicit tolerances and a logged trace.

### 5. Verify optimality / bound

- **LP/Convex:** verify dual feasibility or KKT conditions.
- **MIP:** report the optimality gap (e.g. 0.2% within time limit).
- **Heuristic:** report best-known value and a lower bound from a relaxation.
- Always run a **sensitivity check** — perturb a parameter by 1–5% and confirm the solution behaves sensibly.

**Completion criterion:** bound, gap, or sensitivity result reported.

### 6. Deliver

Markdown artifact with: model formulation, hardness, solver, trace summary, optimal (or best-known) solution, gap, sensitivity, and a sanity check against intuition.

**Completion criterion:** all six sections present; solution reproducible from the code shown.
