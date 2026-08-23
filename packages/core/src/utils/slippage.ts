/**
 * Shared slippage computation utility.
 *
 * SP1 (review fix): Extract computeSlippageBps from paper-runner.ts and
 * live-runner.ts into a single shared function. Used by both paper and
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
