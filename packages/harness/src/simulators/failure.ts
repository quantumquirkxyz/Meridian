/**
 * Failure simulator (issue #21 AC2, AC3). Models API failures, RPC failures,
 * network disconnections, and other operational failures.
 *
 * Deterministic given the same RNG seed. Used by both backtest and stress tests.
 */

import type { SeededRng } from "../seed.ts";

export type FailureType =
  | "API_RATE_LIMIT"
  | "API_TIMEOUT"
  | "API_ERROR"
  | "RPC_FAILURE"
  | "RPC_TIMEOUT"
  | "RPC_BLOCK_HASH_MISMATCH"
  | "NETWORK_DISCONNECTION"
  | "WEBSOCKET_CLOSE"
  | "PARTIAL_FILL_FAILURE"
  | "TX_REVERT"
  | "NONCE_CONFLICT"
  | "SLIPPAGE_BREACH";

export interface FailureSimulatorOptions {
  /** Probability of any failure occurring per operation. Default: 0.05. */
  failureProbability?: number;
  /** Weighted distribution of failure types. Default: uniform. */
  failureTypeWeights?: Partial<Record<FailureType, number>>;
  /** Probability of cascade failures (multiple failures in a row). Default: 0.2. */
  cascadeProbability?: number;
  /** Max consecutive cascade failures. Default: 3. */
  maxCascadeLength?: number;
}

export interface FailureResult {
  /** Whether a failure occurred. */
  failed: boolean;
  /** The type of failure (if failed). */
  failureType?: FailureType;
  /** Whether the failure is retryable. */
  retryable: boolean;
  /** Suggested retry delay in ms (0 if not retryable). */
  retryDelayMs: number;
  /** Whether this was a cascade failure. */
  cascade: boolean;
  /** Human-readable error message. */
  message: string;
}

const FAILURE_DEFAULTS: Required<FailureSimulatorOptions> = {
  failureProbability: 0.05,
  failureTypeWeights: {},
  cascadeProbability: 0.2,
  maxCascadeLength: 3,
};

const ALL_FAILURE_TYPES: FailureType[] = [
  "API_RATE_LIMIT",
  "API_TIMEOUT",
  "API_ERROR",
  "RPC_FAILURE",
  "RPC_TIMEOUT",
  "RPC_BLOCK_HASH_MISMATCH",
  "NETWORK_DISCONNECTION",
  "WEBSOCKET_CLOSE",
  "PARTIAL_FILL_FAILURE",
  "TX_REVERT",
  "NONCE_CONFLICT",
  "SLIPPAGE_BREACH",
];

const FAILURE_MESSAGES: Record<FailureType, string> = {
  API_RATE_LIMIT: "Exchange API rate limit exceeded",
  API_TIMEOUT: "Exchange API request timed out",
  API_ERROR: "Exchange API returned an error",
  RPC_FAILURE: "Blockchain RPC node returned an error",
  RPC_TIMEOUT: "Blockchain RPC request timed out",
  RPC_BLOCK_HASH_MISMATCH: "RPC block hash mismatch during confirmation",
  NETWORK_DISCONNECTION: "Network connection lost",
  WEBSOCKET_CLOSE: "WebSocket connection closed unexpectedly",
  PARTIAL_FILL_FAILURE: "Order partially filled then rejected",
  TX_REVERT: "On-chain transaction reverted",
  NONCE_CONFLICT: "Nonce conflict detected",
  SLIPPAGE_BREACH: "Slippage tolerance breached during execution",
};

const RETRYABLE_FAILURES = new Set<FailureType>([
  "API_RATE_LIMIT",
  "API_TIMEOUT",
  "RPC_TIMEOUT",
  "NETWORK_DISCONNECTION",
  "WEBSOCKET_CLOSE",
]);

const RETRY_DELAYS: Record<FailureType, [number, number]> = {
  API_RATE_LIMIT: [1000, 5000],
  API_TIMEOUT: [500, 2000],
  RPC_TIMEOUT: [500, 3000],
  NETWORK_DISCONNECTION: [1000, 10_000],
  WEBSOCKET_CLOSE: [500, 3000],
  API_ERROR: [0, 0],
  RPC_FAILURE: [0, 0],
  RPC_BLOCK_HASH_MISMATCH: [0, 0],
  PARTIAL_FILL_FAILURE: [0, 0],
  TX_REVERT: [0, 0],
  NONCE_CONFLICT: [0, 0],
  SLIPPAGE_BREACH: [0, 0],
};

export class FailureSimulator {
  private readonly opts: Required<FailureSimulatorOptions>;
  private readonly typeWeights: Map<FailureType, number>;

  constructor(options: FailureSimulatorOptions = {}) {
    this.opts = { ...FAILURE_DEFAULTS, ...options };

    // Build cumulative weight distribution.
    this.typeWeights = new Map();
    for (const ft of ALL_FAILURE_TYPES) {
      this.typeWeights.set(ft, this.opts.failureTypeWeights[ft] ?? 1);
    }
  }

  /**
   * Simulate whether a failure occurs for an operation.
   *
   * @param rng - Seeded PRNG for deterministic simulation.
   * @param context - Optional context to bias failure type selection.
   */
  simulateFailure(
    rng: SeededRng,
    context?: { isCex?: boolean; isDex?: boolean; isWs?: boolean },
  ): FailureResult {
    // Check if failure occurs.
    if (rng.next() >= this.opts.failureProbability) {
      return {
        failed: false,
        retryable: false,
        retryDelayMs: 0,
        cascade: false,
        message: "",
      };
    }

    // Select failure type based on context and weights.
    const type = this.selectFailureType(rng, context);
    const retryable = RETRYABLE_FAILURES.has(type);
    const [minDelay, maxDelay] = RETRY_DELAYS[type];
    const retryDelayMs = retryable
      ? minDelay + Math.floor(rng.next() * (maxDelay - minDelay))
      : 0;

    // Check for cascade.
    const cascade =
      rng.next() < this.opts.cascadeProbability && this.opts.maxCascadeLength > 1;

    return {
      failed: true,
      failureType: type,
      retryable,
      retryDelayMs,
      cascade,
      message: FAILURE_MESSAGES[type],
    };
  }

  /**
   * Simulate a sequence of cascade failures.
   */
  simulateCascade(
    rng: SeededRng,
    context?: { isCex?: boolean; isDex?: boolean; isWs?: boolean },
  ): FailureResult[] {
    const results: FailureResult[] = [];
    const first = this.simulateFailure(rng, context);
    results.push(first);

    if (first.cascade) {
      const maxAdditional = this.opts.maxCascadeLength - 1;
      for (let i = 0; i < maxAdditional; i++) {
        const next = this.simulateFailure(rng, context);
        if (!next.failed) break;
        results.push(next);
      }
    }

    return results;
  }

  private selectFailureType(
    rng: SeededRng,
    context?: { isCex?: boolean; isDex?: boolean; isWs?: boolean },
  ): FailureType {
    // Context-biased selection.
    const candidates: FailureType[] = [];
    if (context?.isCex) {
      candidates.push("API_RATE_LIMIT", "API_TIMEOUT", "API_ERROR");
    }
    if (context?.isDex) {
      candidates.push("RPC_FAILURE", "RPC_TIMEOUT", "TX_REVERT", "NONCE_CONFLICT");
    }
    if (context?.isWs) {
      candidates.push("WEBSOCKET_CLOSE", "NETWORK_DISCONNECTION");
    }

    // If context provided relevant candidates, weight them higher.
    if (candidates.length > 0 && rng.next() < 0.7) {
      return candidates[Math.floor(rng.next() * candidates.length)];
    }

    // Weighted random selection across all types.
    let totalWeight = 0;
    for (const weight of this.typeWeights.values()) {
      totalWeight += weight;
    }

    let r = rng.next() * totalWeight;
    for (const [type, weight] of this.typeWeights) {
      r -= weight;
      if (r <= 0) return type;
    }

    return ALL_FAILURE_TYPES[ALL_FAILURE_TYPES.length - 1];
  }
}
