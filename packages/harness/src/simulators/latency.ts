/**
 * Latency simulator (issue #21 AC2). Models network and execution latency
 * including base latency, jitter, and probability of latency spikes.
 *
 * Deterministic given the same RNG seed.
 */

import type { SeededRng } from "../seed.ts";

export interface LatencySimulatorOptions {
  /** Base latency in milliseconds. Default: 50. */
  baseLatencyMs?: number;
  /** Jitter range in milliseconds [min, max]. Default: [5, 50]. */
  jitterRangeMs?: [number, number];
  /** Probability of a latency spike. Default: 0.1. */
  spikeProbability?: number;
  /** Latency spike range in milliseconds [min, max]. Default: [200, 2000]. */
  spikeRangeMs?: [number, number];
  /** Latency cost per ms in USD. Default: 0.001. */
  latencyCostPerMs?: number;
}

export interface LatencyEstimate {
  /** Total latency in milliseconds. */
  latencyMs: number;
  /** Latency cost in USD. */
  latencyCostUsd: number;
  /** Whether a latency spike occurred. */
  spike: boolean;
  /** Whether latency exceeded the threshold (e.g. deadline). */
  exceededDeadline: boolean;
}

const LATENCY_DEFAULTS: Required<LatencySimulatorOptions> = {
  baseLatencyMs: 50,
  jitterRangeMs: [5, 50],
  spikeProbability: 0.1,
  spikeRangeMs: [200, 2000],
  latencyCostPerMs: 0.001,
};

export class LatencySimulator {
  private readonly opts: Required<LatencySimulatorOptions>;

  constructor(options: LatencySimulatorOptions = {}) {
    this.opts = { ...LATENCY_DEFAULTS, ...options };
  }

  /**
   * Simulate latency for a network/execution operation.
   *
   * @param rng - Seeded PRNG for deterministic simulation.
   * @param deadlineMs - Optional deadline; if latency exceeds this, exceededDeadline is true.
   */
  simulateLatency(
    rng: SeededRng,
    deadlineMs?: number,
  ): LatencyEstimate {
    // Base jitter.
    const [minJitter, maxJitter] = this.opts.jitterRangeMs;
    const jitter = minJitter + rng.next() * (maxJitter - minJitter);
    let latencyMs = this.opts.baseLatencyMs + jitter;

    // Spike injection.
    let spike = false;
    if (rng.next() < this.opts.spikeProbability) {
      spike = true;
      const [minSpike, maxSpike] = this.opts.spikeRangeMs;
      latencyMs += minSpike + rng.next() * (maxSpike - minSpike);
    }

    const latencyCostUsd = latencyMs * this.opts.latencyCostPerMs;
    const exceededDeadline =
      deadlineMs !== undefined ? latencyMs > deadlineMs : false;

    return {
      latencyMs,
      latencyCostUsd,
      spike,
      exceededDeadline,
    };
  }
}
