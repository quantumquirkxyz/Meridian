---
name: web3-governance
category: skill-dev/sandbox
maturity: experimental
version: 1
description: Design and audit on-chain and off-chain governance — token voting, delegation, quadratic voting, timelock, multisig, and attack vectors.
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


# Web3 Governance Design

Design or audit a **Web3 governance system** — token voting, delegation, on-chain execution — with attack vectors and resilience analysis.

## When to use

- A protocol needs governance designed or audited.
- Token voting or delegation mechanisms need analysis.
- DAO constitution, constitution, or multiphase governance is being designed.

## Process

1. Identify governance type — on-chain (token-weighted vote, quadratic, conviction), off-chain (signal vote → timelock), or hybrid.
2. Define actors — token holders, delegates, multisig signers, core team, foundation.
3. Define proposal lifecycle — temperature check, on-chain vote, quorum, timelock, execution; veto rights.
4. Token distribution analysis — who holds tokens? Concentration vs dispersion; is the distribution stable under voting?
5. Attack vectors — vote buying, plutocracy, low turnout, plutocratic capture, executive attack (multisig override).
6. Resilience — fork rights, constitutional clauses, guardian roles; how can the community override bad governance?
7. Deliver — artifact: governance type, actors, proposal lifecycle, token distribution, attack vectors, and resilience assessment.
