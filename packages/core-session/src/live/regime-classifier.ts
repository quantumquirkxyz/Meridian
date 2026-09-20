/**
 * RegimeClassifier: deterministic market regime classifier (issue #35).
 *
 * Produces a RegimeClassification (regime + confidence) from market
 * signals. Stateless — all context is passed in via RegimeClassifierInput.
 *
 * Classification logic (priority order):
 *   1. Drawdown: cumulative PnL below threshold
 *   2. Degraded RPC: RPC health below threshold
 *   3. Degraded CEX: CEX health below threshold
 *   4. Gas spike: gas price above threshold
 *   5. High volatility: realized volatility above threshold
 *   6. Low liquidity: liquidity below threshold
 *   7. Chop: oscillation + moderate volatility
 *   8. Range: low volatility + mean-reverting price
 *   9. Trend: directional price movement
 *
 * The classifier is deterministic — no LLM, no I/O.
 */

import {
  type MarketRegime,
  type RegimeClassification,
} from "@agenttrading/contracts";

// ── Input ────────────────────────────────────────────────────────────

/**
 * Market signals that the classifier evaluates to determine the regime.
 */
export interface RegimeClassifierInput {
  /** Realized volatility (annualized, e.g. 0.5 = 50%). */
  realizedVolatility: number;
  /** Bid-ask spread (basis points). */
  spreadBps: number;
  /** Available liquidity on the book (USD). */
  liquidityUsd: number;
  /** Gas price (USD per swap or unit). */
  gasPriceUsd: number;
  /** Cumulative PnL since session start (USD). Negative = loss. */
  cumulativePnlUsd: number;
  /** Maximum drawdown from peak equity (USD). */
  maxDrawdownUsd: number;
  /** Whether the RPC endpoint is healthy. */
  rpcHealthy: boolean;
  /** Whether the CEX endpoint is healthy. */
  cexHealthy: boolean;
  /** Number of consecutive up/down price moves (directional streak). */
  directionalStreak: number;
  /** Number of price direction reversals in the lookback window. */
  reversalCount: number;
  /** Current timestamp (Unix ms). */
  nowMs: number;
}

// ── Thresholds ───────────────────────────────────────────────────────

/**
 * Configurable thresholds for regime classification.
 * Each threshold controls the boundary for a specific regime.
 */
export interface RegimeClassifierThresholds {
  /** Cumulative loss (USD) at which drawdown regime triggers. */
  drawdownThresholdUsd: number;
  /** Maximum drawdown (USD) at which drawdown regime triggers. */
  maxDrawdownThresholdUsd: number;
  /** Realized volatility above which high_volatility triggers. */
  highVolatilityThreshold: number;
  /** Liquidity (USD) below which low_liquidity triggers. */
  lowLiquidityThresholdUsd: number;
  /** Gas price (USD) above which gas_spike triggers. */
  gasSpikeThresholdUsd: number;
  /** Spread (bps) above which low_liquidity regime is considered. */
  highSpreadBpsThreshold: number;
  /** Minimum directional streak for trend regime. */
  trendDirectionalStreakMin: number;
  /** Minimum reversal count for chop regime. */
  chopReversalCountMin: number;
  /** Maximum volatility for range regime. */
  rangeVolatilityMax: number;
  /** Confidence boost for single-signal regimes. */
  singleSignalConfidence: number;
  /** Confidence for dual-signal regimes (chop). */
  dualSignalConfidence: number;
  /** Confidence for directional regimes (trend/range). */
  directionalConfidence: number;
}

export const DEFAULT_REGIME_THRESHOLDS: RegimeClassifierThresholds = {
  drawdownThresholdUsd: 100,
  maxDrawdownThresholdUsd: 200,
  highVolatilityThreshold: 0.8,
  lowLiquidityThresholdUsd: 5_000,
  gasSpikeThresholdUsd: 50,
  highSpreadBpsThreshold: 100,
  trendDirectionalStreakMin: 5,
  chopReversalCountMin: 4,
  rangeVolatilityMax: 0.3,
  singleSignalConfidence: 0.9,
  dualSignalConfidence: 0.75,
  directionalConfidence: 0.7,
};

// ── Classifier ───────────────────────────────────────────────────────

/**
 * RegimeClassifier: deterministic market regime classifier.
 *
 * Usage:
 * ```ts
 * const classifier = new RegimeClassifier();
 * const classification = classifier.classify(input);
 * ```
 */
export class RegimeClassifier {
  private readonly thresholds: RegimeClassifierThresholds;

  constructor(
    thresholds: RegimeClassifierThresholds = DEFAULT_REGIME_THRESHOLDS,
  ) {
    this.thresholds = { ...thresholds };
  }

  /**
   * Classify the current market regime from the given signals.
   * Returns a RegimeClassification with regime, confidence, and reason.
   */
  classify(input: RegimeClassifierInput): RegimeClassification {
    // Priority 1: Drawdown — most defensive regime
    if (this.isDrawdown(input)) {
      return {
        regime: "drawdown",
        confidence: this.thresholds.singleSignalConfidence,
        reason: this.describeDrawdown(input),
        classifiedAtMs: input.nowMs,
      };
    }

    // Priority 2: Degraded RPC — infrastructure failure
    if (!input.rpcHealthy) {
      return {
        regime: "degraded_rpc",
        confidence: this.thresholds.singleSignalConfidence,
        reason: "RPC endpoint is unhealthy",
        classifiedAtMs: input.nowMs,
      };
    }

    // Priority 3: Degraded CEX — exchange failure
    if (!input.cexHealthy) {
      return {
        regime: "degraded_cex",
        confidence: this.thresholds.singleSignalConfidence,
        reason: "CEX endpoint is unhealthy",
        classifiedAtMs: input.nowMs,
      };
    }

    // Priority 4: Gas spike
    if (input.gasPriceUsd >= this.thresholds.gasSpikeThresholdUsd) {
      return {
        regime: "gas_spike",
        confidence: this.thresholds.singleSignalConfidence,
        reason: `gas price ${input.gasPriceUsd} >= threshold ${this.thresholds.gasSpikeThresholdUsd}`,
        classifiedAtMs: input.nowMs,
      };
    }

    // Priority 5: High volatility
    if (
      input.realizedVolatility >= this.thresholds.highVolatilityThreshold
    ) {
      return {
        regime: "high_volatility",
        confidence: this.thresholds.singleSignalConfidence,
        reason: `realized volatility ${input.realizedVolatility} >= threshold ${this.thresholds.highVolatilityThreshold}`,
        classifiedAtMs: input.nowMs,
      };
    }

    // Priority 6: Low liquidity
    if (
      input.liquidityUsd < this.thresholds.lowLiquidityThresholdUsd ||
      input.spreadBps > this.thresholds.highSpreadBpsThreshold
    ) {
      return {
        regime: "low_liquidity",
        confidence: this.thresholds.singleSignalConfidence,
        reason: this.describeLowLiquidity(input),
        classifiedAtMs: input.nowMs,
      };
    }

    // Priority 7: Chop — oscillating price with moderate volatility
    if (
      input.reversalCount >= this.thresholds.chopReversalCountMin &&
      input.realizedVolatility >= this.thresholds.rangeVolatilityMax
    ) {
      return {
        regime: "chop",
        confidence: this.thresholds.dualSignalConfidence,
        reason: `${input.reversalCount} reversals with volatility ${input.realizedVolatility.toFixed(2)}`,
        classifiedAtMs: input.nowMs,
      };
    }

    // Priority 8: Range — low volatility, few reversals
    if (input.realizedVolatility <= this.thresholds.rangeVolatilityMax) {
      return {
        regime: "range",
        confidence: this.thresholds.directionalConfidence,
        reason: `low volatility ${input.realizedVolatility.toFixed(2)} within range`,
        classifiedAtMs: input.nowMs,
      };
    }

    // Priority 9: Trend — directional movement
    if (
      input.directionalStreak >= this.thresholds.trendDirectionalStreakMin
    ) {
      return {
        regime: "trend",
        confidence: this.thresholds.directionalConfidence,
        reason: `directional streak of ${input.directionalStreak}`,
        classifiedAtMs: input.nowMs,
      };
    }

    // Fallback: range (low volatility, no clear direction)
    return {
      regime: "range",
      confidence: 0.5,
      reason: "no dominant signal; defaulting to range",
      classifiedAtMs: input.nowMs,
    };
  }

  // ── Private Helpers ──────────────────────────────────────────────

  private isDrawdown(input: RegimeClassifierInput): boolean {
    return (
      input.cumulativePnlUsd <= -this.thresholds.drawdownThresholdUsd ||
      input.maxDrawdownUsd >= this.thresholds.maxDrawdownThresholdUsd
    );
  }

  private describeDrawdown(input: RegimeClassifierInput): string {
    const parts: string[] = [];
    if (input.cumulativePnlUsd <= -this.thresholds.drawdownThresholdUsd) {
      parts.push(
        `cumulative PnL ${input.cumulativePnlUsd} <= -${this.thresholds.drawdownThresholdUsd}`,
      );
    }
    if (input.maxDrawdownUsd >= this.thresholds.maxDrawdownThresholdUsd) {
      parts.push(
        `max drawdown ${input.maxDrawdownUsd} >= ${this.thresholds.maxDrawdownThresholdUsd}`,
      );
    }
    return parts.join("; ");
  }

  private describeLowLiquidity(input: RegimeClassifierInput): string {
    const parts: string[] = [];
    if (input.liquidityUsd < this.thresholds.lowLiquidityThresholdUsd) {
      parts.push(
        `liquidity ${input.liquidityUsd} < threshold ${this.thresholds.lowLiquidityThresholdUsd}`,
      );
    }
    if (input.spreadBps > this.thresholds.highSpreadBpsThreshold) {
      parts.push(
        `spread ${input.spreadBps}bps > threshold ${this.thresholds.highSpreadBpsThreshold}bps`,
      );
    }
    return parts.join("; ");
  }
}
