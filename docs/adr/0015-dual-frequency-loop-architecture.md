# 0015 — Dual-frequency loop architecture: cognitive loop and execution loop separated

Status: proposed
Date: 2026-09-20

## Context

The system needs both cognitive reasoning (regime classification, opportunity debate, parameter tuning) and sub-millisecond deterministic execution (opportunity detection, risk evaluation, order placement). A single unified loop forces these two concerns into the same frequency, which is impossible when the cognitive layer uses LLM sub-agents whose Time to First Token (TTFT) ranges from hundreds of milliseconds to several seconds.

In a hybrid CEX/DEX arbitrage environment, price inefficiencies close in milliseconds. If the LLM-based sub-agents debate metrics inside the opportunity-detection hot path, the opportunity disappears before the Risk Engine sees the candidate, and the resulting order is filled with negative slippage.

## Decision

Split the system's governed recurring cycle into two distinct loops:

1. **Cognitive Loop** (slow, wall-clock interval: 1–5 minutes): consultative agents observe market geometry, classify regimes, update `MarketGraph` parameters, weights, limits, and edge classifications. It produces no `OpportunityCandidate` and no `OrderIntent`. It never mutates the graph for backtest purposes.
2. **Execution Loop** (fast, sub-millisecond): consumes a **versioned graph state** produced by the Cognitive Loop, detects profitable routes, and produces `OpportunityCandidate` objects. It contains no agent reasoning and no LLM calls. The swap from one graph version to the next is atomic between Execution Cycles; the Execution Loop never reads a graph while it is being mutated.

The **OpportunityDetector** operates exclusively in the Execution Loop. The general agent and its sub-agents operate exclusively in the Cognitive Loop. A single pass of either loop is a **Cycle**; the terms are not interchangeable.

## Consequences

- Positive: LLM latency is removed from the execution hot path. Arbitrage windows are not lost to cognitive deliberation.
- Positive: The Cognitive Loop can tune parameters (e.g., slippage models, regime thresholds, cost-stack weights) without blocking the Execution Loop.
- Positive: The Execution Loop is 100% deterministic and testable without any LLM dependency.
- Negative: The orchestration layer must manage two distinct cycles with different frequencies and lifecycles.
- Negative: Agent outputs can only influence the market picture between Execution Cycles, not within one. This is an acceptable trade-off for latency.
- Follow-up: Define the exact handoff contract between Cognitive and Execution cycles (e.g., atomic parameter snapshot, versioned graph state).
