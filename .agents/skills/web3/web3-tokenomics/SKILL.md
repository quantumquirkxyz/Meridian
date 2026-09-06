---
name: web3-tokenomics
category: skill-dev/sandbox
maturity: experimental
version: 1
description: Design token economics — supply, emission, incentives, governance, value capture — with economic sustainability checks and adversarial stress tests.
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


# Tokenomics Design

Design the **economics of a token** — supply schedule, incentives, governance, value capture — and stress-test it for sustainability and attack surfaces.

## When to use

- A project needs a token economy designed or audited.
- The user wants to understand a token's sustainability or compare token models.
- A governance or incentive mechanism needs economic analysis.

## Process

### 1. Define purpose and type

State the token's core purpose: medium of exchange, governance, staking/reward, utility access, security (staking to secure network), or hybrid. Name the token type: fungible (ERC-20 / similar), non-fungible (NFT), or a hybrid.

**Completion criterion:** purpose and token type explicit.

### 2. Supply mechanics

Specify:

- **Initial supply** — genesis amount, mint mechanism, pre-mint / initial distribution.
- **Max supply / cap** — hard cap, soft cap, or uncapped (inflationary).
- **Emission schedule** — linear decay, exponential, or event-triggered (block rewards, staking yield).
- **Burn / buyback** — how tokens leave circulation; is it automatic or manual?
- **Vesting** — team / investor / ecosystem lockups; linear, cliff, or schedule.

**Completion criterion:** initial supply, cap, emission, vesting all present with numerical values.

### 3. Incentive design

Name who earns tokens, how, and for what behaviour:

- **Validators / stakers:** yield rate, slashing conditions, unbonding period.
- **Users:** rewards for participation, discounts, rebates.
- **Treasury / ecosystem:** funding mechanism (fee capture, inflation share).
- **Liquidity providers:** rewards, impermanent loss, lockup.

**Completion criterion:** each participant class has an explicit reward mechanism and risk (slashing, lockup, impermanent loss).

### 4. Governance

Describe who decides protocol changes, parameter updates, treasury use. Include:

- Voting mechanism (token-weighted, quadratic, delegated, time-weighted).
- Quorum requirements.
- Execution mechanism (timelock, multi-sig, direct execution).
- Governance attacks — vote-buying, low-turnout capture.

**Completion criterion:** voting mechanism, quorum, execution, and at least one governance attack scenario documented.

### 5. Economic stress tests

Test for sustainability:

- **Demand shock:** what if token price falls 90%? Do incentives collapse?
- **Inflation spiral:** does emission outpace adoption?
- **Governance capture:** can a single actor acquire veto or proposal rights?
- **Value capture:** does the protocol actually capture value (fees, burns), or is it purely speculative?
- **Regulatory risk:** is the token a security under major jurisdictions?

**Completion criterion:** each stress scenario described; the weakest point named.

### 6. Deliver

Markdown artifact: purpose, supply, incentives, governance, stress tests, and a **sustainability verdict** — sustainable, fragile, speculative, or unsustainable.

**Completion criterion:** deliverable present; verdict is honest and supported by stress tests.
