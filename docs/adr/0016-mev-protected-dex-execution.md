# 0016 — MEV-protected DEX execution: private RPCs and builder bribes mandatory

Status: proposed
Date: 2026-09-20

## Context

The system executes DEX swaps on PancakeSwap v4 (BNB Chain), which operates over a public mempool. The current `DEXExecutor` definition and implementation route transactions through generic RPC endpoints. If a profitable arbitrage transaction is visible to the public mempool, MEV searchers will front-run or sandwich it, pushing the execution price to the exact limit of the slippage tolerance and stealing the net margin.

The existing **Multi-RPC Consensus (2/3)** pattern (ADR-S03) protects market-data reads from a single provider lie. It does not protect execution from mempool visibility. The **Cost Stack** (ADR-0014) and `expectedNetProfitUsd` formula currently omit any MEV-protection cost.

## Decision

DEX execution transactions are submitted exclusively through **Private RPCs** or **Order Flow Auctions (OFAs)**. Public mempool submission is prohibited for any route where `expectedNetProfitUsd` exceeds the builder-bribe threshold.

The **Cost Stack** is extended to include MEV protection cost:
- **Builder Bribe**: the portion of gross profit paid to a block builder or OFA provider to include the transaction in a private bundle.
- **Private RPC Premium**: any additional fee charged by the private endpoint provider.

`expectedNetProfitUsd` must deduct these costs before the Risk Engine evaluates `MIN_EDGE`.

## Options considered

1. **Public mempool with slippage tolerance increase** — Rejected. Increasing slippage tolerance does not prevent sandwich attacks; it only raises the attacker's profit ceiling. The net margin after attack is still negative.
2. **Private RPC only, no builder bribe in cost stack** — Rejected. If the builder bribe is not deducted from `expectedNetProfitUsd`, the Risk Engine will approve routes that are net-negative after the bribe is paid.
3. **Time-based exclusive execution window** — Rejected. Cooperative sequencers or timed locks are not available on BNB Chain; this would require a custom L2 or side chain.

## Consequences

- Positive: DEX execution is protected from front-running and sandwich attacks. Net margin calculations reflect the true cost of privacy.
- Positive: The Cost Stack remains the single source of truth for all execution costs (ADR-0014 extended).
- Negative: Execution latency may increase slightly due to private-builder routing; reliability depends on the private RPC provider's uptime.
- Negative: Builder bribe rates fluctuate with network conditions and must be fed into the Cost Stack as a dynamic weight.
- Follow-up: Integrate a builder-bribe oracle or estimator into the Cognitive Loop so the Execution Loop can consume an up-to-date bribe weight.
