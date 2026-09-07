# Spike 0001 — Depth-faithful slippage (issue #132)

Status: spike notes (design only, no code changes)
Date: 2026-09-07
Parent: #128 — single source of truth for the net-profit cost stack (ADR-0014)

## Problem

The static, linear slippage impact model does not track real liquidity:

- `packages/core/src/utils/slippage.ts:19-29` — `computeSlippageBps` uses a linear
  coefficient: `impactBps = floor((orderSizeUsd / liquidityUsd) * 1000)`. **Only used** at the
  reporting seam (`packages/cli/src/live-runner.ts:1050` → `TradeRecord.slippageBps`); it never
  reaches the net-profit money number.
- The money number `slippageUsd` in `CostBreakdown` comes from the edge weight
  `expectedSlippage`, set by `packages/core/src/live/opportunity-detector.ts:113,132` to
  `spread / 2` — a **static half-spread** that reacts to neither order size nor depth.
  `packages/graph/src/pathfinding.ts:360` and `opportunity-detector.ts:255` sum it straight
  into the stack.

Net effect: `slippageUsd` is a fixed constant per edge. Larger orders and thinner books do not
cost more; the gate (MIN_EDGE) cannot see when an arbitrage is only profitable "near the best".

## What already exists

- AMM constant-product shape: `packages/chain/src/dex-executor.ts:248-256` (`simulateSwap`)
  already computes the exact price impact for a swap from real pool reserves
  (`expectedOutput`, `priceImpact`).
- Per-venue depth on `MarketDataSnapshot`: Bybit WS tallies all book levels into `depth`
  (quote USD, `packages/connectors/src/bybit-ws.ts:385-391`); PancakeSwap sets
  `depth = reserve0 + reserve1` plus raw `reserve0`/`reserve1`
  (`packages/connectors/src/pancakeswap-v4.ts:37`, `dex-executor.ts:363`).
- The graph already distinguishes `ORDER_BOOK` vs `SWAP` edge types, so the impact model can
  branch per venue shape (`packages/contracts/src/graph.ts:33-42`).

## Design

Replace the linear model with a **venue-shaped impact function** that is shared across the
reporting seam and the cost stack. One function, two branches, both driven by real depth:

```
computeImpactBps(input: {
  orderSizeUsd: number;
  edge: { type: "ORDER_BOOK" | "SWAP"; venue: string };
  book?: { levels: { price, size }[] };   // CEX ladder (new normalization)
  reserves?: { reserveIn, reserveOut };   // DEX constant-product (existing)
}): number
```

### DEX / SWAP — constant-product (exact)

Reuse the `simulateSwap` math (`dex-executor.ts:248-256`): given `reserveIn`, `reserveOut`
and an in-ratio of the order, compute `priceImpact` and convert to bps:
`priceImpactBps = priceImpact * 10_000`. This is the AMM's own answer to "how far does the
execution price move" — no coefficient, no calibration constant. The graph already reads raw
`reserve0`/`reserve1` from `MarketDataSnapshot`; the impact function consumes **reserves
directly**, never the summed `depth` (which for PancakeSwap is a raw mixed-token sum, not
quote notional — a calibration bug to be fixed rather than fed into the model).

### CEX / ORDER_BOOK — depth ladder walk

The linear model collapses the whole book to one number. A depth-faithful version walks the
book: iterate levels best → worst, accumulating fillable notional until `orderSizeUsd` is
filled; price impact = clearing price − best price, in bps. Requires per-level book
normalization on the CEX snapshot (currently only the summed `depth` is kept) — add an
optional `levels` ladder to `MarketDataSnapshot` fed by the Bybit WS orderbook levels already
received (`bybit-ws.ts:380-391`). Until ladder data exists, keep the current linear formula as
an explicit, tagged fallback (so `slippageUsd` = 0-depth-safe), not silently.

### How it feeds the cost stack — field decision

**The stack keeps its existing `slippageUsd` dollar term; it is fed from a new weight field.**

- New primary weight: `expectedSlippageBps` on `EdgeWeights`
  (`packages/contracts/src/graph.ts:53-70`), set by the connectors/updaters from
  `computeImpactBps` at the order's intended notional.
- The cost stack converts once: `slippageUsd = notionalUsd * expectedSlippageBps / 10_000`,
  summed as today (`pathfinding.ts:360`, `opportunity-detector.ts:255`). Additive, in USD, fits
  the RISK.md sum formula (`docs/RISK.md:48-62`) unchanged.
- `expectedSlippage` (half-spread) is **not removed**; it becomes the documented fallback when
  no depth data is available (conservative floor), keeping `isEdgeWeights` and every consumer
  backward compatible.
- `computeSlippageBps` (the linear function at `slippage.ts`) is replaced by
  `computeImpactBps`; `live-runner.ts:1050` calls the shared function so the reporting seam and
  the money number can never disagree again.

### Consequence: slippage becomes order-size-dependent

Today `slippageUsd` is a constant per edge, summable before sizing. Depth-faithful slippage is
a function of the actual order size, so the canonical aggregator must evaluate it at the
**intended notional** (route `maxCapitalUsd` / bottleneck), not as a per-edge constant summed
first. This is a real interaction with ADR-0014: when ADR-0014 lands, the canonical
`computeRouteCost` should accept a sizing notional and re-derive `expectedSlippageBps` per edge
at that size before summing. Design risk to call out in that spec's implementation: an
arbitrage sized down to survive the book may flip from profitable to unprofitable as depth
falls — the gate must re-check net profit at the reduced size, not just at the original.

## Feed-through / rollout path (tracer bullets)

1. Add `expectedSlippageBps` to `EdgeWeights` + `expectedSlippage` legacy fallback semantics
   (contracts only; additive validator update).
2. Add shared `computeImpactBps` to `packages/core/src/utils/slippage.ts` with the DEX
   constant-product branch wired to reserves; unit-test against `simulateSwap`.
3. Wire `opportunity-detector.ts` edge writing to set `expectedSlippageBps` when reserves exist;
   keep `expectedSlippage` fallback. Convert to USD in the two aggregators.
4. CEX ladder: normalize `levels` on `MarketDataSnapshot` from `bybit-ws`; implement the ladder
   walk branch; then it is exercised on live CEX edges too.
5. Deprecate `computeSlippageBps` linear usage in `live-runner.ts`; route it through
   `computeImpactBps`.
6. Post-ADR-0014: integrate notional-dependent re-derivation in the canonical aggregator and
   re-run the ANALYSIS.md leak-vector review.

## Declarations

- **New weight field:** `EdgeWeights.expectedSlippageBps` feeds `slippageUsd`; the existing
  `slippageUsd` term and the `slippageUsd` field in `CostBreakdown` are unchanged.
- **Existing field retained:** `expectedSlippage` stays as the no-depth-data fallback.
- **No behavior change to:** the net-profit sum formula, `expectedNetProfitUsd`, MIN_EDGE, or
  any cost aggregator beyond how `slippageUsd` is computed.
- **Calibration bug noted (fix in slice 2):** PancakeSwap `depth = reserve0 + reserve1` is a
  raw mixed-token sum, not quote notional; the impact model reads reserves, never this depth.

## Open questions

- Should the CEX ladder truncate to the top-N levels that a real taker order can consume, or
  use the full book? (Recommendation: per-level from the WS message, truncate to a fixed
  notional cap for CPU bound.)
- At what granularity does `notionalUsd` get passed to the aggregator (route-level bottleneck
  vs per-hop)? (Recommendation: route bottleneck notional per ADR-0014's canonical figure;
  revisit after that spec ships.)