/**
 * RegimePolicyEngine: deterministic Regime Policy Engine (issue #35).
 *
 * Maps each regime to a RegimePolicy (permissions, limits, enabled
 * strategies, emergency actions). Enforces the core invariant:
 *   - Regime changes never increase permissions without deterministic
 *     validation (fail-closed).
 *   - Every regime change is audited (RegimeChange record).
 *   - Per-regime performance is tracked (RegimePerformanceRecord).
 *
 * The engine is stateful between evaluate() calls (tracks current regime,
 * performance, change history) but all evaluation logic is deterministic —
 * no LLM, no I/O.
 */

import {
  type MarketRegime,
  MARKET_REGIMES,
  type RegimeChange,
  type RegimeClassification,
  type RegimePerformanceRecord,
  type RegimePolicy,
  type RegimePolicyConfig,
  DEFAULT_REGIME_POLICY_CONFIG,
} from "@agenttrading/contracts";

// ── Performance Tracker ──────────────────────────────────────────────

/**
 * Accumulates per-regime performance data. Tracks trade outcomes
 * under each regime for analysis.
 */
export class RegimePerformanceTracker {
  private records: Map<MarketRegime, RegimePerformanceRecord> = new Map();
  private confidenceCounts: Map<MarketRegime, number> = new Map();

  constructor() {
    // Initialize all regimes with zeroed records.
    for (const regime of MARKET_REGIMES) {
      this.records.set(regime, {
        regime,
        tradeCount: 0,
        totalPnlUsd: 0,
        winCount: 0,
        lossCount: 0,
        maxDrawdownUsd: 0,
        avgConfidence: 0,
        totalTimeMs: 0,
      });
      this.confidenceCounts.set(regime, 0);
    }
  }

  /** Record a trade outcome under a regime. */
  recordTrade(
    regime: MarketRegime,
    pnlUsd: number,
    nowMs: number,
  ): void {
    const rec = this.records.get(regime)!;
    rec.tradeCount += 1;
    rec.totalPnlUsd += pnlUsd;
    if (pnlUsd > 0) rec.winCount += 1;
    if (pnlUsd < 0) rec.lossCount += 1;
    // Track max drawdown as the most negative cumulative PnL in this regime.
    if (rec.totalPnlUsd < -rec.maxDrawdownUsd) {
      rec.maxDrawdownUsd = Math.abs(rec.totalPnlUsd);
    }
  }

  /** Update the average confidence for a regime. */
  updateConfidence(
    regime: MarketRegime,
    newConfidence: number,
  ): void {
    const rec = this.records.get(regime)!;
    const count = (this.confidenceCounts.get(regime) ?? 0) + 1;
    this.confidenceCounts.set(regime, count);
    rec.avgConfidence =
      (rec.avgConfidence * (count - 1) + newConfidence) / count;
  }

  /** Accumulate time spent in a regime. */
  addTime(regime: MarketRegime, elapsedMs: number): void {
    const rec = this.records.get(regime)!;
    rec.totalTimeMs += elapsedMs;
  }

  /** Get the performance record for a specific regime. */
  get(regime: MarketRegime): RegimePerformanceRecord {
    return { ...this.records.get(regime)! };
  }

  /** Get all performance records. */
  getAll(): Record<MarketRegime, RegimePerformanceRecord> {
    const result: Record<string, RegimePerformanceRecord> = {};
    for (const [regime, rec] of this.records) {
      result[regime] = { ...rec };
    }
    return result as Record<MarketRegime, RegimePerformanceRecord>;
  }
}

// ── Permission Validator ─────────────────────────────────────────────

/**
 * Determines whether a new policy reduces permissions compared to
 * the current policy. Regime changes must never increase permissions
 * without deterministic validation (fail-closed invariant).
 *
 * Returns { valid: true } if the new policy is a subset (or equal) of
 * the current policy, or { valid: false, reason } if it would increase
 * permissions.
 */
export function validatePermissionReduction(
  current: RegimePolicy,
  next: RegimePolicy,
): { valid: true } | { valid: false; reason: string } {
  // Check 1: If trading is currently enabled, disabling is always valid.
  // But enabling trading when it was disabled requires validation.
  if (!current.tradingEnabled && next.tradingEnabled) {
    return {
      valid: false,
      reason: `cannot enable trading: current regime ${current.regime} has trading disabled`,
    };
  }

  // Check 2: If trading was enabled in both, next must not exceed limits.
  if (current.tradingEnabled && next.tradingEnabled) {
    if (next.maxOpenOrders > current.maxOpenOrders) {
      return {
        valid: false,
        reason: `maxOpenOrders would increase: ${current.maxOpenOrders} -> ${next.maxOpenOrders}`,
      };
    }
    if (next.maxOrderNotionalUsd > current.maxOrderNotionalUsd) {
      return {
        valid: false,
        reason: `maxOrderNotionalUsd would increase: ${current.maxOrderNotionalUsd} -> ${next.maxOrderNotionalUsd}`,
      };
    }
    if (next.maxDailyNotionalUsd > current.maxDailyNotionalUsd) {
      return {
        valid: false,
        reason: `maxDailyNotionalUsd would increase: ${current.maxDailyNotionalUsd} -> ${next.maxDailyNotionalUsd}`,
      };
    }
    if (next.maxSlippageBps > current.maxSlippageBps) {
      return {
        valid: false,
        reason: `maxSlippageBps would increase: ${current.maxSlippageBps} -> ${next.maxSlippageBps}`,
      };
    }
    if (next.maxGasUsd > current.maxGasUsd) {
      return {
        valid: false,
        reason: `maxGasUsd would increase: ${current.maxGasUsd} -> ${next.maxGasUsd}`,
      };
    }
    // Check enabled strategies: next must be a subset of current.
    for (const s of next.enabledStrategies) {
      if (!current.enabledStrategies.includes(s)) {
        return {
          valid: false,
          reason: `strategy ${s} is enabled in next but not in current policy`,
        };
      }
    }
  }

  return { valid: true };
}

// ── Policy Engine ────────────────────────────────────────────────────

export interface RegimePolicyEngineOptions {
  /** Custom policy config; defaults to DEFAULT_REGIME_POLICY_CONFIG. */
  config?: RegimePolicyConfig;
  /** Injectable clock; defaults to Date.now. */
  now?: () => number;
}

/**
 * RegimePolicyEngine: deterministic mapping from regime → policy.
 *
 * Tracks:
 *   - Current regime and policy
 *   - Regime change history (audit trail)
 *   - Per-regime performance records
 *
 * Usage:
 * ```ts
 * const engine = new RegimePolicyEngine();
 * const result = engine.evaluate(classification);
 * if (result.changed) {
 *   // result.change is the audit record
 *   // result.policy is the effective policy
 * }
 * ```
 */
export class RegimePolicyEngine {
  private readonly config: RegimePolicyConfig;
  private readonly now: () => number;
  private readonly performance: RegimePerformanceTracker;

  private currentRegime: MarketRegime | null = null;
  private currentPolicy: RegimePolicy;
  private changeHistory: RegimeChange[] = [];
  private lastRegimeChangedAtMs: number;

  constructor(options: RegimePolicyEngineOptions = {}) {
    this.config = options.config ?? DEFAULT_REGIME_POLICY_CONFIG;
    this.now = options.now ?? (() => Date.now());
    this.performance = new RegimePerformanceTracker();
    this.currentPolicy = this.config.policies["range"]; // initial default
    this.lastRegimeChangedAtMs = this.now();
  }

  /** Current effective regime (null if no classification yet). */
  get regime(): MarketRegime | null {
    return this.currentRegime;
  }

  /** Current effective policy. */
  get policy(): RegimePolicy {
    return { ...this.currentPolicy };
  }

  /** Regime change audit history. */
  get history(): readonly RegimeChange[] {
    return this.changeHistory;
  }

  /** Performance tracker instance. */
  get performanceTracker(): RegimePerformanceTracker {
    return this.performance;
  }

  /**
   * Evaluate a new classification and produce a policy result.
   *
   * If the regime changed, emits a RegimeChange audit record and
   * enforces the never-increase-invariant.
   *
   * If the regime did not change, updates confidence tracking.
   */
  evaluate(
    classification: RegimeClassification,
  ): {
    changed: boolean;
    policy: RegimePolicy;
    change?: RegimeChange;
    blocked: boolean;
    blockReason?: string;
  } {
    const nextPolicy = this.config.policies[classification.regime];

    // No regime change — same regime.
    if (this.currentRegime === classification.regime) {
      this.performance.updateConfidence(
        classification.regime,
        classification.confidence,
      );
      return {
        changed: false,
        policy: nextPolicy,
        blocked: false,
      };
    }

    // Regime change — validate permissions.
    if (this.currentRegime !== null) {
      const validation = validatePermissionReduction(
        this.currentPolicy,
        nextPolicy,
      );
      if (!validation.valid) {
        // Permission increase blocked — keep current policy.
        return {
          changed: false,
          policy: this.currentPolicy,
          blocked: true,
          blockReason: validation.reason,
        };
      }
    }

    // Record time in previous regime.
    if (this.currentRegime !== null) {
      const elapsed = this.now() - this.lastRegimeChangedAtMs;
      this.performance.addTime(this.currentRegime, elapsed);
    }

    // Compute permissionsReduced: true if the new policy is more restrictive.
    const permissionsReduced =
      this.currentRegime === null
        ? false
        : this.isMoreRestrictive(this.currentPolicy, nextPolicy);

    // Build the audit record.
    const change: RegimeChange = {
      eventId: `regime-change-${this.now()}-${classification.regime}`,
      timestampMs: this.now(),
      previousRegime: this.currentRegime,
      newRegime: classification.regime,
      confidence: classification.confidence,
      reason: classification.reason,
      permissionsReduced,
      appliedPolicy: nextPolicy,
    };

    // Update state.
    this.currentRegime = classification.regime;
    this.currentPolicy = nextPolicy;
    this.lastRegimeChangedAtMs = this.now();
    this.changeHistory.push(change);

    // Update performance tracking.
    this.performance.updateConfidence(
      classification.regime,
      classification.confidence,
    );

    return {
      changed: true,
      policy: nextPolicy,
      change,
      blocked: false,
    };
  }

  /**
   * Record a trade outcome for performance tracking.
   */
  recordTrade(pnlUsd: number): void {
    if (this.currentRegime !== null) {
      this.performance.recordTrade(this.currentRegime, pnlUsd, this.now());
    }
  }

  /**
   * Finalize: record time in the current regime.
   * Call when the session ends.
   */
  finalize(): void {
    if (this.currentRegime !== null) {
      const elapsed = this.now() - this.lastRegimeChangedAtMs;
      this.performance.addTime(this.currentRegime, elapsed);
    }
  }

  // ── Private Helpers ──────────────────────────────────────────────

  /**
   * Determine if the new policy is more restrictive than the current one.
   */
  private isMoreRestrictive(
    current: RegimePolicy,
    next: RegimePolicy,
  ): boolean {
    if (current.tradingEnabled && !next.tradingEnabled) return true;
    if (next.maxOpenOrders < current.maxOpenOrders) return true;
    if (next.maxOrderNotionalUsd < current.maxOrderNotionalUsd) return true;
    if (next.maxDailyNotionalUsd < current.maxDailyNotionalUsd) return true;
    if (next.maxSlippageBps < current.maxSlippageBps) return true;
    if (next.maxGasUsd < current.maxGasUsd) return true;
    if (
      next.enabledStrategies.length < current.enabledStrategies.length
    )
      return true;
    return false;
  }
}
