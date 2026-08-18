/**
 * Funding simulator (issue #21 AC2). Models perpetual funding costs including
 * funding rate simulation, funding payment computation, and rate regime changes.
 *
 * Deterministic given the same RNG seed.
 */

import type { SeededRng } from "../seed.ts";

export interface FundingSimulatorOptions {
  /** Mean funding rate per 8h interval. Default: 0.0001 (1 bps). */
  meanFundingRate?: number;
  /** Std dev of funding rate noise. Default: 0.00005. */
  fundingRateVolatility?: number;
  /** Probability of a funding rate spike (> 10x mean). Default: 0.05. */
  spikeProbability?: number;
  /** Funding interval in milliseconds (8 hours). Default: 28_800_000. */
  fundingIntervalMs?: number;
}

export interface FundingEstimate {
  /** Simulated funding rate for this interval. */
  fundingRate: number;
  /** Funding cost in USD for the given position. */
  fundingCostUsd: number;
  /** Whether a funding spike occurred. */
  spike: boolean;
  /** Number of funding intervals elapsed. */
  intervalsElapsed: number;
}

const FUNDING_DEFAULTS: Required<FundingSimulatorOptions> = {
  meanFundingRate: 0.0001,
  fundingRateVolatility: 0.00005,
  spikeProbability: 0.05,
  fundingIntervalMs: 28_800_000,
};

export class FundingSimulator {
  private readonly opts: Required<FundingSimulatorOptions>;

  constructor(options: FundingSimulatorOptions = {}) {
    this.opts = { ...FUNDING_DEFAULTS, ...options };
  }

  /**
   * Simulate the funding cost for a position held over a time span.
   *
   * @param rng - Seeded PRNG for deterministic simulation.
   * @param params - Position parameters.
   * @returns Funding estimate with rate, cost, and spike information.
   */
  simulateFunding(
    rng: SeededRng,
    params: {
      /** Position size in units (e.g. BTC). */
      positionSize: number;
      /** Mark price at funding time. */
      markPrice: number;
      /** Time span in ms to simulate funding over. */
      timeSpanMs: number;
      /** Whether the position is long (pays funding when rate > 0). */
      isLong: boolean;
    },
  ): FundingEstimate {
    const { positionSize, markPrice, timeSpanMs, isLong } = params;

    const intervalsElapsed = Math.max(
      1,
      Math.floor(timeSpanMs / this.opts.fundingIntervalMs),
    );

    let totalFundingCostUsd = 0;
    let maxRate = 0;
    let spike = false;

    for (let i = 0; i < intervalsElapsed; i++) {
      // Simulate funding rate for this interval.
      let rate = this.opts.meanFundingRate;

      // Add Gaussian-like noise via Box-Muller approximation.
      const u1 = rng.next();
      const u2 = rng.next();
      const noise = Math.sqrt(-2 * Math.log(Math.max(u1, 1e-10))) * Math.cos(2 * Math.PI * u2);
      rate += noise * this.opts.fundingRateVolatility;

      // Spike injection.
      if (rng.next() < this.opts.spikeProbability) {
        rate *= 10 + rng.next() * 20; // 10x-30x spike
        spike = true;
      }

      // Clamp rate to [-0.01, 0.01] (±1% per 8h).
      rate = Math.max(-0.01, Math.min(0.01, rate));

      if (Math.abs(rate) > Math.abs(maxRate)) {
        maxRate = rate;
      }

      // Funding cost = positionSize * markPrice * rate.
      // Longs pay when rate > 0; shorts pay when rate < 0.
      const direction = isLong ? 1 : -1;
      const cost = positionSize * markPrice * Math.abs(rate) * Math.sign(rate) * direction;
      totalFundingCostUsd += Math.max(0, cost); // only count what the position pays
    }

    return {
      fundingRate: maxRate,
      fundingCostUsd: totalFundingCostUsd,
      spike,
      intervalsElapsed,
    };
  }
}
