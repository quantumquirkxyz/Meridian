---
name: web3-l2-scaling
category: skill-dev/sandbox
maturity: experimental
version: 1
description: Analyse Layer-2 scaling solutions — Rollups (optimistic, ZK), validiums, state channels — with security assumptions, data availability, and cost trade-offs.
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


# Layer-2 Scaling Analysis

Analyse a **Layer-2 scaling solution** — rollups, validiums, state channels — for security assumptions, throughput, cost, and trade-offs vs L1.

## When to use

- The user wants to choose or build on an L2 solution.
- An L2 protocol needs an architecture review.
- Cost / throughput comparison between L1 and L2 is needed.

## Process

1. Classify — Optimistic Rollup (Arbitrum, Optimism), ZK Rollup (zkSync, StarkNet, Polygon zkEVM), Validium (StarkEx), State Channels (Lightning Network), Plasma.
2. Architecture — where is the state? Who is the sequencer/validator? How is dispute resolution handled?
3. Data availability — on-chain (calldata, blobs) vs off-chain DA; trade-off (cost vs trust assumption).
4. Security assumptions — honest verifier assumption, ZK soundness, fraud proof window (7 days for Optimistic); slashing conditions.
5. Throughput & cost — TPS ceiling; cost per transaction (L1 settlement vs L2 execution); compare to L1.
6. Composability — can L2 contracts call each other? Is cross-L2 communication needed?
7. Deliver — artifact: L2 type, architecture, security assumptions, throughput/cost, and a recommendation based on use case (high security = ZK, high throughput = validium, maximum compatibility = optimistic).
