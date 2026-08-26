# ADR-0012: Synthetic Paper Feed for Paper Mode

Status: Proposed

## Context

The repository's `paper` mode is the internal simulation harness for validating the local decision chain without Bybit demo or live capital. The existing paper harness is conservative and can produce long runs with little or no interaction when real market data is quiet. The project needs a way to exercise the paper loop with more varied conditions while preserving the paper contract and keeping the behavior explicitly opt-in.

## Decision

`paper` may be configured with a synthetic market feed that generates crypto-like price action from an ephemeral random seed.

- The synthetic feed is explicitly selected, not implicit.
- The feed is generic across symbols; it is not asset-specific calibration.
- The generator should mix regimes, shocks, liquidity variation, and mild mean reversion so the runner sees more opportunities, rejections, fills, reconciliation events, and shutdown paths.
- Each run uses a fresh random seed.
- The generated seed is not persisted in session artifacts, so synthetic runs are intentionally not reproducible for forensic replay.
- The synthetic feed is a paper-only harness feature; it must not alter demo or live semantics.

## Consequences

- Paper can be exercised with more interaction coverage without depending on real market activity.
- Operators lose exact replayability for synthetic sessions by design.
- The paper contract remains the same: audit, summary, reconciliation, and clean shutdown still matter more than PnL.
- Future specs and tickets can refer to `Synthetic Paper Feed` as a stable domain term.
