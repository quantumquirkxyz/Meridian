---
name: web3-consensus
category: skill-dev/sandbox
maturity: experimental
version: 1
description: Analyse and compare consensus mechanisms — PoW, PoS, BFT, DA — with security properties, finality guarantees, and economic incentive alignment.
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


# Consensus Mechanism Analysis

Analyse a **consensus mechanism** — its security model, finality, liveness, and economic incentives — and compare it against alternatives for a given threat model.

## When to use

- The user wants to choose, design, or audit a blockchain consensus protocol.
- A protocol upgrade changes the consensus layer.
- A security or decentralisation assessment is needed.

## Process

### 1. Classify the mechanism

Name the class and specific protocol:

- **Nakamoto (PoW):** Bitcoin, Ethereum PoW; probabilistic finality.
- **Classical BFT:** PBFT, Tendermint, HotStuff; deterministic finality within quorum.
- **PoS + finality gadget:** Ethereum PoS, Cosmos (Tendermint-based), Polkadot (GRANDPA/BABE).
- **PoS + chain-based:** Ouroboros (Cardano), Algorand.
- **DAG-based:** Avalanche (Snow family), Hashgraph.
- **Data Availability (DA):** Celestia-style DA, Ethereum Danksharding.

**Completion criterion:** protocol named; class stated; brief description of how it works.

### 2. Security properties

For each, state the guarantee:

- **Safety:** can two conflicting blocks be finalised simultaneously? Under what adversarial power?
- **Liveness:** does the chain keep producing blocks under adversarial conditions?
- **Finality:** deterministic (BFT) or probabilistic (Nakamoto)? Time to finality?
- **Sybil resistance:** how does it prevent a 51% attack?
- **Censorship resistance:** can a coalition of validators censor transactions?

**Completion criterion:** each property answered with yes/no/conditional and the threshold.

### 3. Economic incentives

- **Rewards:** block reward source (inflation, fees, MEV); amount; schedule.
- **Slashing:** conditions, penalty magnitude, percent of stake at risk.
- **Disincentives:** what prevents selfish mining, MEV extraction, validator bribery?
- **Decentralisation:** are rewards concentrated? What is the minimum stake to participate?

**Completion criterion:** reward source, slashing conditions, and decentralisation state reported.

### 4. Threat model comparison

Compare the chosen consensus against alternatives under:

- **51% attack:** cost to attack (ASIC, stake, colluding validators).
- **Censorship:** under what conditions can censoring occur?
- **Network partition:** what happens during an internet split (e.g. Ethereum vs Cosmos)?
- **Collusion:** can a minority coalition finalise malicious blocks?

**Completion criterion:** threat model comparison completed for at least 3 attack vectors.

### 5. Deliver

Markdown artifact: classification, security properties, economic incentives, threat model, and a **recommendation** — which consensus fits a given use case (high-security store of value, high-throughput DeFi, censorship-resistant social, etc.).

**Completion criterion:** deliverable complete; recommendation tied to use case.
