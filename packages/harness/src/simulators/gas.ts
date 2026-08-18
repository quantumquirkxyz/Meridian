/**
 * Gas simulator (issue #21 AC2). Models on-chain gas costs including base
 * gas price, priority fees, congestion multipliers, and L2 cost estimation.
 *
 * Deterministic given the same RNG seed.
 */

import type { SeededRng } from "../seed.ts";

export interface GasSimulatorOptions {
  /** Base gas price in gwei. Default: 20. */
  baseGasPriceGwei?: number;
  /** Congestion multiplier range [min, max]. Default: [1, 5]. */
  congestionMultiplierRange?: [number, number];
  /** Probability of a gas spike (multiplier > 3x). Default: 0.1. */
  gasSpikeProbability?: number;
  /** Gas used by a standard swap. Default: 150000. */
  standardSwapGasUnits?: number;
  /** Gas used by a bridge transaction. Default: 300000. */
  bridgeGasUnits?: number;
  /** ETH/USD price for gas cost estimation. Default: 2500. */
  ethPriceUsd?: number;
}

export interface GasEstimate {
  /** Gas units consumed. */
  gasUnits: number;
  /** Gas price in gwei (after congestion). */
  gasPriceGwei: number;
  /** Total gas cost in USD. */
  gasCostUsd: number;
  /** Congestion multiplier applied. */
  congestionMultiplier: number;
  /** Whether a gas spike occurred. */
  gasSpike: boolean;
}

const GAS_DEFAULTS: Required<GasSimulatorOptions> = {
  baseGasPriceGwei: 20,
  congestionMultiplierRange: [1, 5],
  gasSpikeProbability: 0.1,
  standardSwapGasUnits: 150_000,
  bridgeGasUnits: 300_000,
  ethPriceUsd: 2_500,
};

export class GasSimulator {
  private readonly opts: Required<GasSimulatorOptions>;

  constructor(options: GasSimulatorOptions = {}) {
    this.opts = { ...GAS_DEFAULTS, ...options };
  }

  /**
   * Simulate gas cost for a transaction.
   *
   * @param rng - Seeded PRNG for deterministic simulation.
   * @param type - Transaction type for gas unit estimation.
   * @param gasPriceGwei - Optional override for the base gas price.
   */
  simulateGas(
    rng: SeededRng,
    type: "swap" | "bridge" | "custom" = "swap",
    gasPriceGwei?: number,
  ): GasEstimate {
    const base = gasPriceGwei ?? this.opts.baseGasPriceGwei;

    // Determine gas units by type.
    let gasUnits: number;
    switch (type) {
      case "swap":
        gasUnits = this.opts.standardSwapGasUnits;
        break;
      case "bridge":
        gasUnits = this.opts.bridgeGasUnits;
        break;
      case "custom":
        gasUnits = this.opts.standardSwapGasUnits;
        break;
    }

    // Simulate congestion.
    const [minMult, maxMult] = this.opts.congestionMultiplierRange;
    let congestionMultiplier = minMult + rng.next() * (maxMult - minMult);

    // Gas spike injection.
    let gasSpike = false;
    if (rng.next() < this.opts.gasSpikeProbability) {
      gasSpike = true;
      congestionMultiplier = maxMult * (1.5 + rng.next() * 2); // spike: 1.5x-3.5x of max
    }

    const effectiveGasPrice = base * congestionMultiplier;

    // Convert: gwei * gasUnits * ETH/USD / 1e9 = USD
    const gasCostUsd =
      (effectiveGasPrice * gasUnits * this.opts.ethPriceUsd) / 1e9;

    return {
      gasUnits,
      gasPriceGwei: effectiveGasPrice,
      gasCostUsd,
      congestionMultiplier,
      gasSpike,
    };
  }

  /**
   * Compute a deterministic gas estimate with a fixed base gas price.
   * Useful for non-stochastic gas estimation in stress tests.
   */
  fixedGasEstimate(
    gasUnits: number,
    gasPriceGwei: number,
  ): GasEstimate {
    const gasCostUsd =
      (gasPriceGwei * gasUnits * this.opts.ethPriceUsd) / 1e9;

    return {
      gasUnits,
      gasPriceGwei,
      gasCostUsd,
      congestionMultiplier: gasPriceGwei / this.opts.baseGasPriceGwei,
      gasSpike: false,
    };
  }
}
