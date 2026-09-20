# 0020 — Sub-agent roles are strategy-aligned: directional agents retasked for delta-neutral strategies

Status: proposed
Date: 2026-09-20

## Context

The system's delta-neutral hybrid-arb strategy does not care whether the underlying asset price rises or falls. Net profitability depends only on whether the gross spread exceeds the full cost stack (fees, slippage, gas, bridge, funding, latency, failure risk, safety buffer, MEV protection). Directional price forecasts are irrelevant to opportunity evaluation.

The current sub-agent catalog includes `bull`, `bear`, and `skeptic` roles whose documented function is to "debate candidates." If these agents produce directional forecasts (price up, price down) as inputs to the OpportunityDetector or the Risk Engine, the system is evaluating candidates against criteria that do not affect the strategy's PnL. Worse, if the Risk Engine weights opportunity evaluation by a directional consensus, it may reject or delay a profitable delta-neutral trade because the bull/bear debate is inconclusive.

## Decision

For delta-neutral scopes, `bull`, `bear`, and `skeptic` are **retasked to structural and liquidity risk evaluation**. Their output is restricted to:
- Funding rate sustainability
- Liquidity depth and resilience
- Network congestion indicators
- Pool health and reserve stability

They do **not** produce directional price forecasts, and their output is not used to evaluate `OpportunityCandidate` objects. Opportunity evaluation for delta-neutral scopes is handled exclusively by `arbitrage-alpha`, `risk-analyst`, `execution-advisor`, and `market-regime`.

`bull`, `bear`, and `skeptic` may retain their original directional role in non-arb scopes where the strategy is explicitly directional, gated by a strategy-type flag. For the canary deployment (delta-neutral hybrid arb), they are retasked.

## Consequences

- Positive: The cognitive layer does not waste LLM latency on irrelevant directional debate for delta-neutral opportunities.
- Positive: The Risk Engine receives opportunity evaluations that are aligned with the strategy's actual risk drivers (structural, not directional).
- Negative: The retasked agents must be re-prompted and their output contracts changed. Existing prompt templates and eval suites for `bull`/`bear` are not directly reusable.
- Follow-up: Update the `CONSULTATIVE_AGENT_CATALOG` output schema to reflect the retasked role; update `ScopeObserverAdapter` fallback to match.
