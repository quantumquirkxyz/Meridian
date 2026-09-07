# 0014 — Single source of truth for the net-profit cost stack

Status: accepted
Date: 2026-09-06
Deciders: quantumquirkz

## Context

The research in `docs/ANALYSIS.md` (2026-09-06) found that `expectedNetProfitUsd` — the figure that gates order approval (rule MIN_EDGE, `packages/core/src/risk/risk-gate.ts`) — is not a single quantity in the code. Two aggregators compute different numbers under the same name:

- `packages/graph/src/pathfinding.ts` sums the full cost stack per the RISK.md formula.
- `packages/core/src/live/route-engine.ts` takes the minimum per-edge margin (`price − fee − slippage − gas − funding`), omitting latency risk, failure risk, bridge cost, and the safety buffer.

The same cost terms are also defined inconsistently across the codebase: `failureRiskUsd` as a probability scaled by a constant (`pathfinding.ts`) versus capital multiplied by an averaged probability (`opportunity-detector.ts`); `bridgeCostUsd` as a flat \$0.5 per bridge edge (`opportunity-detector.ts`) versus reusing the trading-fee weight `w.fee` (`pathfinding.ts`). By default, the RiskEngine policy also leaves the daily/weekly loss limit rules (RISK.md rules 2–3) unenforced.

`docs/RISK.md:48-62` already prescribes the sum formula; the code drifted from the documented contract. Because the number controls whether real capital is deployed, the ambiguity is not cosmetic.

## Decision

Make the net-profit computation a **single source of truth**:

1. **One canonical aggregator.** The sum-formula cost stack of `docs/RISK.md:48-62` is the only definition of `expectedNetProfitUsd`. `route-engine` consumes this aggregator instead of computing a min-edge figure; the min-edge quantity is not renamed and kept — it is removed.
2. **`failureRiskUsd = maxCapitalUsd × combinedFailureProbability`**, with `combinedFailureProbability = 1 − ∏(1 − pᵢ)`. The `× 100` scaling hack and the average-based variant are removed.
3. **`bridgeCostUsd` becomes a dedicated weight** on bridge edges (cost, latency, failure), replacing both the flat \$0.5 and the reuse of `w.fee`.
4. **Daily/weekly loss limits are enforced by default** in the risk policy (`maxDailyLossUsd`, `maxWeeklyLossUsd`) with rolling 24h/7d windows, matching the canary thresholds (\$50 / \$100).

Gas-cost and slippage modeling (hardcoded native price, linear depth impact) are recognized as calibration gaps but are out of scope here; they are tracked as separate non-blocking design spikes.

## Consequences

- Positive: one number, one formula, reproducible across graph and core; the money gate and its tests have a stable contract.
- Positive: fail-closed posture is restored — the two loss-limit rules become active by default.
- Negative: `route-engine` scoring semantics change (the composite score now uses the canonical figure); `contracts` weights gain a bridge field; migration of existing reports/canary config.
- Follow-up: implement via spec → tickets (ADR referenced); re-run `docs/ANALYSIS.md` leak-vector review after migration to confirm the remaining vectors are the two calibration spikes.