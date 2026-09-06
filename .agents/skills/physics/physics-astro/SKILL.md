---
name: physics-astro
category: skill-dev/sandbox
maturity: experimental
version: 1
description: Model astrophysical systems — stellar structure, orbital dynamics, cosmology, gravitational waves — with physical scales, order-of-magnitude estimates, and scaling laws.
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


# Astrophysics Modeling

Model an **astrophysical system** — stellar, galactic, cosmological — with physical scales, order-of-magnitude estimates, and known scaling laws.

## When to use

- A stellar, planetary, galactic, or cosmological problem needs a quantitative model.
- Order-of-magnitude estimates for astrophysical phenomena.
- Connecting observations to physical theory.

## Process

1. Identify the astrophysical regime — stellar (fusion, HR diagram, mass-radius), orbital (Kepler's laws, n-body), galactic (dynamics, spiral structure), cosmological (FLRW, CMB, dark matter).
2. State physical scales — distances (AU, parsec, Mpc), masses (M☉), times (Myr, Gyr), temperatures.
3. Choose the governing physics — gravity (Newton/Einstein), thermodynamics, nuclear physics, radiation transport.
4. Apply scaling laws — Virial theorem, Jeans equations, mass-luminosity relation, Kepler's 3rd, Chandrasekhar limit, Schwarzschild radius.
5. Estimate numerically — order-of-magnitude before exact calculation; use the scaling to catch errors.
6. Check against observations — known values for comparable objects (e.g. Sun, Jupiter, Milky Way mass).
7. Deliver — artifact: regime, scales, governing physics, scaling laws applied, numerical estimate, observational check.
