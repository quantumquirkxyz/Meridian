import type { CostBreakdown } from "./opportunity.ts";

/**
 * Compute the canonical expected net profit (USD) from a gross spread and
 * the full RISK.md cost stack (ADR-0014).
 *
 * ```
 * expectedNetProfitUsd = grossSpreadUsd
 *                      - tradingFeesUsd
 *                      - slippageUsd
 *                      - gasUsd
 *                      - bridgeCostUsd
 *                      - fundingCostUsd
 *                      - latencyRiskUsd
 *                      - failureRiskUsd
 *                      - safetyBufferUsd
 * ```
 *
 * Both `@agenttrading/graph` and `@agenttrading/core` must use this single
 * source of truth so that identical graph state yields identical
 * `expectedNetProfitUsd` regardless of which code path scored the route.
 */
export function computeExpectedNetProfitUsd(
  grossSpreadUsd: number,
  costs: CostBreakdown,
): number {
  return (
    grossSpreadUsd
    - costs.tradingFeesUsd
    - costs.slippageUsd
    - costs.gasUsd
    - costs.bridgeCostUsd
    - costs.fundingCostUsd
    - costs.latencyRiskUsd
    - costs.failureRiskUsd
    - costs.safetyBufferUsd
  );
}
