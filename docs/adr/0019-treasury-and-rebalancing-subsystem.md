# 0019 — Treasury and rebalancing subsystem: inventory precedes opportunity

Status: proposed
Date: 2026-09-20

## Context

The `MarketGraph` maps the market, not the system's pocket. The current model states this explicitly ("Avoid: storing inventory or order state inside the graph") but provides no alternative location for inventory awareness. The **OpportunityDetector** can discover a route that requires WBNB on BSC and USDT on Bybit, but if all WBNB is already on Bybit, the route is unrunnable.

Transferring WBNB from Bybit to BSC via a bridge during the execution window destroys the temporal edge that makes the arbitrage profitable. The system must hold the right inventory in the right place *before* the opportunity appears.

The current model mentions "inventory-aware routing" in "What it is NOT" but never defines **Inventory**, **Treasury**, or **Rebalancing** as first-class domain concepts.

## Decision

Introduce a **Treasury** subsystem separate from the Execution Loop:

- **Treasury** monitors balances across all venues (CEX exchange accounts, on-chain wallets, bridges in transit).
- **Treasury** maintains a **Delta Neutral Inventory** target for each venue and asset, based on the opportunity set the Cognitive Loop expects to encounter.
- **Rebalancing** is the scheduled or event-driven transfer of assets between venues to move actual inventory toward the target. It occurs during low-volatility windows or low-gas periods and is never executed in the hot path of an opportunity.
- The **OpportunityDetector** (Execution Loop) only produces `OpportunityCandidate` objects for routes where the required source-venue balance is confirmed available by Treasury. Routes with insufficient source inventory are filtered out before risk evaluation.

## Consequences

- Positive: The system executes only opportunities for which it already holds the required inventory. Bridge transfers do not block the temporal edge.
- Positive: Treasury operates on a slower cycle than the Execution Loop, so rebalancing decisions do not add latency to opportunity detection.
- Negative: Capital is immobilized in pre-positioned inventory across venues, reducing capital efficiency compared to a centralized inventory.
- Negative: Rebalancing during high-volatility or high-gas periods can be costly or impossible; the Treasury must define fallback behavior (e.g., skip rebalancing, reduce target inventory).
- Follow-up: Define the Treasury cycle frequency, the Delta Neutral Inventory target calculation, and the bridge-cost model used by Rebalancing.
