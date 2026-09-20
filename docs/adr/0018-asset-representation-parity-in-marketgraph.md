# 0018 — Asset representation parity in MarketGraph: distinct nodes per venue-chain

Status: proposed
Date: 2026-09-20

## Context

The `MarketGraph` currently models nodes as "assets, venues, chains, pools." The **Pair** definition describes the tradable instrument as independent of venue. This implies that 1 USDT on Bybit and 1 USDT on BNB Chain are the same asset node.

In a multi-chain arbitrage system, this assumption is false. A bridge compromise, a stablecoin depeg, or a network-specific panic can cause the same logical token to trade at different values on different venues. If the graph treats them as a single node, a depeg event will appear as a massive spread, and the `OpportunityDetector` will produce `OpportunityCandidate` objects that arbitrage a toxic asset — injecting capital into a losing position.

## Decision

The `MarketGraph` models **Asset Representations** as distinct nodes. An Asset Representation is a specific token instance on a specific venue and chain (e.g., `USDT_BYBIT`, `USDT_BSC`, `WBNB_BSC`). Two representations of the same logical asset are connected by a **Parity Edge** that carries:
- parity risk weight (probability of divergence)
- liquidity risk weight (how easily the representation can be redeemed for the other)
- bridge cost weight (cost, latency, and failure of the bridge between them)

If the price divergence between two Asset Representations exceeds the **Depeg Threshold**, the Parity Edge is marked broken and the representations are treated as independent assets. No arbitrage route may span a broken Parity Edge.

The **risk-analyst** sub-agent (or a dedicated parity monitor in the Cognitive Loop) tracks parity oracles and triggers Parity Edge breakage when thresholds are breached.

## Consequences

- Positive: The system cannot arbitrage a depegged or toxic asset representation. Parity risk is explicit in the graph.
- Positive: The Cognitive Loop can update Parity Edge weights as bridge health or market conditions change.
- Negative: The graph schema and pathfinding algorithm become more complex. Every "same asset" relationship is now an explicit edge with risk weights.
- Negative: Determining the Depeg Threshold requires an external parity oracle or cross-venue price feed, adding a data dependency.
- Follow-up: Design the parity oracle integration and the Parity Edge weight update protocol in the Cognitive Loop.
