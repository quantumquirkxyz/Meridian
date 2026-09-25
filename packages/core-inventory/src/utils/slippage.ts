/**
 * Shared slippage computation utility.
 *
 * SP1 (review fix): Extract computeSlippageBps from
 * live-runner.ts into a single shared function. Used by both
 * live runners to compute dynamic slippage based on order size and
 * available liquidity depth.
 */

/**
 * Compute slippage in basis points from order size and liquidity depth.
 * Larger orders relative to available liquidity incur higher slippage.
 *
 * @param orderSizeUsd - Notional value of the order in USD.
 * @param liquidityUsd - Total resting depth on both sides in USD.
 * @param baseSlippageBps - Minimum slippage in basis points.
 * @returns Slippage in basis points.
 */
export function computeSlippageBps(
  orderSizeUsd: number,
  liquidityUsd: number,
  baseSlippageBps: number,
): number {
  if (liquidityUsd <= 0) return baseSlippageBps;
  const impactRatio = orderSizeUsd / liquidityUsd;
  // Linear impact: 1% of liquidity = 10bps additional slippage
  const impactBps = Math.floor(impactRatio * 1000);
  return baseSlippageBps + impactBps;
}

/**
 * Estimate slippage in basis points using venue-aware models.
 *
 * - CEX: uses the observed spread plus a linear depth-impact term.
 * - DEX: uses the constant-product approximation (simplified).
 *
 * Falls back to the base spread when depth data is unavailable.
 *
 * @param orderSizeUsd - Notional value of the order in USD.
 * @param depthUsd - Available liquidity depth on the venue in USD.
 * @param spreadBps - Observed spread in basis points (0 for DEX).
 * @param venueType - Venue category determining the model.
 * @returns Estimated slippage in basis points.
 */
export function estimateSlippageBps(
  orderSizeUsd: number,
  depthUsd: number,
  spreadBps: number,
  venueType: "CEX" | "DEX",
): number {
  if (depthUsd <= 0 || orderSizeUsd <= 0) return spreadBps;

  const impactRatio = orderSizeUsd / depthUsd;

  if (venueType === "DEX") {
    return impactRatio * 100;
  }

  const depthImpactBps = impactRatio * 10000;
  return spreadBps + depthImpactBps;
}
