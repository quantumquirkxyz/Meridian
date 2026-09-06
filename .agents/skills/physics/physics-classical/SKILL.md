---
name: physics-classical
category: skill-dev/sandbox
maturity: experimental
version: 1
description: Solve classical mechanics problems — Newton's laws, Lagrangian, Hamiltonian, rigid body, orbital — with free-body diagrams, energy accounting, and dimensional checks.
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


# Classical Mechanics

Solve a **classical mechanics** problem — Newton's laws, Lagrangian, Hamiltonian, or orbital — with free-body analysis, energy accounting, and dimensional checks.

## When to use

- A mechanical system needs its motion solved (forces, trajectories, equilibrium).
- Engineering, robotics, aerospace, or sports analysis.
- Rigid body rotation, orbital mechanics, or vibrations.

## Process

1. Identify system — particles, rigid body, continuous; degrees of freedom.
2. Draw free-body diagram — all forces with direction, labels, and units.
3. Choose formulation — Newtonian (F=ma), Lagrangian (L=T−V), Hamiltonian (H=T+V), or energy methods.
4. Write equations — Newton's 2nd / Euler-Lagrange / Hamilton's equations; include constraints (holonomic / nonholonomic).
5. Solve — analytically (harmonic oscillator, projectile, central force) or numerically (RK4 for ODEs, finite elements).
6. Dimensional check — verify [force]=[mass][acceleration]; no hidden unit mismatches.
7. Physical limits — check limiting cases (small angle, large mass, friction → 0).
8. Deliver — artifact: diagram, formulation, equations, solution, dimensional check, and limiting cases.
