---
name: web3-defi
category: skill-dev/sandbox
maturity: experimental
version: 1
description: Analyse DeFi protocols — AMMs, lending, stablecoins, derivatives — across protocol mechanics, economic security, and composability risks.
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


# DeFi Protocol Analysis

Analyse a **DeFi protocol** — AMM, lending, stablecoin, or derivative — for mechanics, economic security, composability, and regulatory posture.

## When to use

- The user wants to understand, build on, or invest in a DeFi protocol.
- A protocol needs an economic or security due-diligence pass.
- A quant or portfolio strategy involves DeFi as an asset class or venue.

## Process

### 1. Classify the protocol type

Name the category and specific protocol:

- **AMM:** Uniswap, Curve, Balancer; bonding curve, fee tiers, concentrated liquidity.
- **Lending / borrowing:** Aave, Compound, Morpho; supply / borrow rates, utilisation curves.
- **Stablecoins:** over-collateralised (DAI), partially (LUSD), algorithmic (logic vs reserve).
- **Derivatives / structured:** GMX, dYdX, Perp; synthetic vs physically-settled.
- **Yield aggregators:** Yearn, Convex; strategy composition, fee sharing.

**Completion criterion:** category and protocol named; brief mechanism described.

### 2. Core mechanics

- **State variables:** what state does the protocol hold? (Reserves, collateral, positions.)
- **Invariant:** what mathematical invariant holds? (x·y=k, utilisation U = borrows/supply, etc.)
- **Mechanisms:** arbitrage, liquidation, fee distribution — state each with its trigger.
- **Parameters:** fee tiers, collateral factors, liquidation thresholds, rate models.

**Completion criterion:** invariant, mechanisms, and parameters all stated.

### 3. Economic security

- **TVL:** total value locked; source and meaning (TVL ≠ value; can be inflated).
- **Collateral:** over-collateralisation ratio; worst-case if collateral drops 50%.
- **Oracle:** how is price obtained? Chainlink? TWAP? Univ3? What if it fails?
- **Attack surface:** oracle manipulation, insolvency cascade, liquidation spiral, governance attack.

**Completion criterion:** TVL, collateral ratio, oracle, and at least one attack surface documented.

### 4. Composability and systemic risk

- **Composability:** does it call other protocols? Can a reentrancy or price-manipulation cascade occur?
- **Contagion:** if one major protocol fails (UST-style), what is the contagion path?
- **Fee sustainability:** are