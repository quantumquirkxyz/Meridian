/**
 * Fill simulator (issue #21 AC2). Models order fills including slippage,
 * partial fills, and fill probability based on market conditions.
 *
 * Every simulation step is deterministic given the same RNG seed —
 * two runs with seed 42 produce identical fills.
 */

import type { SeededRng } from "../seed.ts";

/** The result of a simulated fill attempt. */
export interface FillResult {
  /** Whether the order was filled (even partially). */
  filled: boolean;
  /** Fraction of the requested quantity that was filled, in [0, 1]. */
  fillRatio: number;
  /** Actual fill price after slippage. */
  fillPrice: number;
  /** Actual quantity filled. */
  filledQuantity: number;
  /** Realized slippage in USD. */
  slippageUsd: number;
  /** Realized slippage in basis points. */
  slippageBps: number;
  /** Human-readable reason for partial or no fill. */
  reason?: string;
}

/** Parameters controlling the fill simulation. */
export interface FillSimulatorOptions {
  /** Base slippage in basis points (applied to every fill). Default: 5. */
  baseSlippageBps?: number;
  /** Additional slippage per unit of order size relative to depth. Default: 0.1. */
  depthImpactFactor?: number;
  /** Maximum slippage in basis points before fill is rejected. Default: 500. */
  maxSlippageBps?: number;
  /** Probability of a partial fill when liquidity is constrained. Default: 0.3. */
  partialFillProbability?: number;
  /** Minimum fillable fraction for a partial fill. Default: 0.1. */
  minPartialFillRatio?: number;
  /** Whether to simulate maker/taker dynamics. Default: false. */
  simulateMakerTaker?: boolean;
}

const DEFAULTS: Required<FillSimulatorOptions> = {
  baseSlippageBps: 5,
  depthImpactFactor: 0.1,
  maxSlippageBps: 500,
  partialFillProbability: 0.3,
  minPartialFillRatio: 0.1,
  simulateMakerTaker: false,
};

export class FillSimulator {
  private readonly opts: Required<FillSimulatorOptions>;

  constructor(options: FillSimulatorOptions = {}) {
    this.opts = { ...DEFAULTS, ...options };
  }

  /**
   * Simulate filling an order.
   *
   * @param rng - Seeded PRNG for deterministic simulation.
   * @param params - Order parameters.
   * @returns The fill result with realized slippage and fill ratio.
   */
  simulateFill(
    rng: SeededRng,
    params: {
      side: "BUY" | "SELL";
      price: number;
      quantity: number;
      /** Available depth at the order level (in quote units). */
      depthUsd: number;
      /** Optional: current spread in bps. */
      spreadBps?: number;
    },
  ): FillResult {
    const { side, price, quantity, depthUsd, spreadBps = 10 } = params;

    if (quantity <= 0 || price <= 0 || depthUsd <= 0) {
      return {
        filled: false,
        fillRatio: 0,
        fillPrice: price,
        filledQuantity: 0,
        slippageUsd: 0,
        slippageBps: 0,
        reason: "INVALID_ORDER_PARAMS",
      };
    }

    // Compute depth impact: larger orders relative to depth eat more book.
    const orderValueUsd = price * quantity;
    const depthRatio = orderValueUsd / Math.max(depthUsd, 1);

    // Total slippage = base + depth impact + spread noise.
    const baseSlippage = this.opts.baseSlippageBps;
    const depthSlippage = depthRatio * this.opts.depthImpactFactor * 10_000;
    const spreadNoise = rng.next() * spreadBps * 0.5;
    const totalSlippageBps = baseSlippage + depthSlippage + spreadNoise;

    // Reject if slippage exceeds maximum.
    if (totalSlippageBps > this.opts.maxSlippageBps) {
      return {
        filled: false,
        fillRatio: 0,
        fillPrice: price,
        filledQuantity: 0,
        slippageUsd: 0,
        slippageBps: totalSlippageBps,
        reason: "SLIPPAGE_EXCEEDED",
      };
    }

    // Apply slippage to price.
    const slippageMultiplier = totalSlippageBps / 10_000;
    const fillPrice =
      side === "BUY"
        ? price * (1 + slippageMultiplier)
        : price * (1 - slippageMultiplier);

    // Determine fill ratio.
    let fillRatio = 1;

    // If order is large relative to depth, partial fill is likely.
    if (depthRatio > 0.5 && rng.next() < this.opts.partialFillProbability) {
      const minRatio = this.opts.minPartialFillRatio;
      // Fill ratio is inversely proportional to depth ratio.
      fillRatio = Math.max(minRatio, Math.min(1, 1 / depthRatio + rng.next() * 0.3));
    }

    // Maker/taker simulation: ~40% chance of maker (better price) if enabled.
    let effectiveSlippage = totalSlippageBps;
    if (this.opts.simulateMakerTaker && rng.next() < 0.4) {
      // Maker fill: no taker slippage, just base.
      effectiveSlippage = baseSlippage * 0.5;
    }

    const finalSlippageMultiplier = effectiveSlippage / 10_000;
    const finalFillPrice =
      side === "BUY"
        ? price * (1 + finalSlippageMultiplier)
        : price * (1 - finalSlippageMultiplier);

    const filledQuantity = Math.round(quantity * fillRatio * 1e8) / 1e8; // 8 decimal precision
    const slippageUsd =
      Math.abs(finalFillPrice - price) * filledQuantity;
    const slippageBps = effectiveSlippage;

    return {
      filled: filledQuantity > 0,
      fillRatio,
      fillPrice: finalFillPrice,
      filledQuantity,
      slippageUsd,
      slippageBps,
      reason: fillRatio < 1 ? "PARTIAL_FILL" : undefined,
    };
  }
}
