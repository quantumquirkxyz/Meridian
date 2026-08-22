/**
 * LearningEngine: the governed learning loop orchestrator (issue #36).
 *
 * Acceptance criteria:
 *   AC1: Trade journal records every outcome automatically.
 *   AC2: Edge decay is detected and flagged.
 *   AC3: No strategy change reaches live without
 *        backtest → paper → review → canary.
 *   AC4: Learning never modifies production directly.
 *
 * The learning engine is deterministic — no LLM, no I/O. It
 * orchestrates the TradeJournal, EdgeDecayDetector, and
 * PromotionPipeline to produce LearningRecommendations. It never
 * mutates production state directly — all changes must be approved
 * by a human or external automation.
 */

import type {
  EdgeDecaySignal,
  LearningLoopConfig,
  LearningRecommendation,
  PromotionRecord,
  StrategyPerformance,
  TradeJournalEntry,
} from "@agenttrading/contracts";
import { DEFAULT_LEARNING_LOOP_CONFIG } from "@agenttrading/contracts";
import { TradeJournal } from "./trade-journal.ts";
import { EdgeDecayDetector } from "./edge-decay-detector.ts";
import { PromotionPipeline } from "./promotion-pipeline.ts";

// ── Learning Engine ──────────────────────────────────────────────────

/**
 * LearningEngine: the governed learning loop.
 *
 * Usage:
 * ```ts
 * const engine = new LearningEngine();
 * // Record trades (called automatically by the execution layer)
 * engine.recordTrade(entry);
 * // Run a learning cycle
 * const recommendations = engine.runCycle();
 * // Review and act on recommendations
 * engine.acknowledgeRecommendation(rec.recommendationId);
 * ```
 */
export class LearningEngine {
  readonly journal: TradeJournal;
  readonly decayDetector: EdgeDecayDetector;
  readonly promotionPipeline: PromotionPipeline;

  private readonly config: LearningLoopConfig;
  private readonly now: () => number;
  private readonly recommendations: LearningRecommendation[] = [];
  private readonly acknowledgedIds = new Set<string>();

  constructor(
    config: LearningLoopConfig = DEFAULT_LEARNING_LOOP_CONFIG,
    now?: () => number,
  ) {
    this.config = { ...config };
    this.now = now ?? (() => Date.now());
    this.journal = new TradeJournal(config, now);
    this.decayDetector = new EdgeDecayDetector(this.journal, config, now);
    this.promotionPipeline = new PromotionPipeline(this.journal, config, now);
  }

  // ── AC1: Record every outcome ────────────────────────────────

  /**
   * Record a trade outcome. This is the primary entry point for
   * feeding trade data into the learning loop.
   */
  recordTrade(entry: TradeJournalEntry): void {
    this.journal.record(entry);
  }

  /**
   * Convenience: record a filled trade.
   */
  recordFill(params: {
    tradeId: string;
    strategyId: string;
    regime: string;
    venue: string;
    symbol: string;
    side: "BUY" | "SELL";
    entryPrice: number;
    exitPrice: number;
    filledQuantity: number;
    feesUsd?: number;
    enteredAtMs: number;
    exitedAtMs: number;
    metadata?: Record<string, unknown>;
  }): TradeJournalEntry {
    return this.journal.recordFill(params);
  }

  // ── Learning Cycle ──────────────────────────────────────────

  /**
   * Run a full learning cycle:
   *   1. Detect edge decay for all strategies
   *   2. Evaluate active promotions against gate criteria
   *   3. Generate recommendations based on findings
   *
   * Returns all new recommendations generated in this cycle.
   * Recommendations are advisory only — never mutate production.
   */
  runCycle(): LearningRecommendation[] {
    const newRecommendations: LearningRecommendation[] = [];
    const now = this.now();

    // Step 1: Detect edge decay.
    const decaySignals = this.decayDetector.detectAll();
    for (const signal of decaySignals) {
      const rec = this.generateDecayRecommendation(signal, now);
      if (rec !== null) {
        newRecommendations.push(rec);
        this.recommendations.push(rec);
      }
    }

    // Step 2: Evaluate active promotions.
    const activePromos = this.promotionPipeline.getActivePromotions();
    for (const promo of activePromos) {
      const rec = this.evaluatePromotion(promo, now);
      if (rec !== null) {
        newRecommendations.push(rec);
        this.recommendations.push(rec);
      }
    }

    // Step 3: Check for strategies that should be promoted.
    const strategyIds = this.journal.distinctStrategyIds();
    for (const strategyId of strategyIds) {
      const rec = this.checkPromotionOpportunity(strategyId, now);
      if (rec !== null) {
        newRecommendations.push(rec);
        this.recommendations.push(rec);
      }
    }

    return newRecommendations;
  }

  // ── Recommendation Management ────────────────────────────────

  /**
   * Get all recommendations (optionally filtered).
   */
  getRecommendations(filters?: {
    strategyId?: string;
    type?: LearningRecommendation["type"];
    acknowledged?: boolean;
  }): LearningRecommendation[] {
    let result = this.recommendations;
    if (filters?.strategyId !== undefined) {
      result = result.filter((r) => r.strategyId === filters.strategyId);
    }
    if (filters?.type !== undefined) {
      result = result.filter((r) => r.type === filters.type);
    }
    if (filters?.acknowledged !== undefined) {
      result = result.filter((r) =>
        filters.acknowledged
          ? this.acknowledgedIds.has(r.recommendationId)
          : !this.acknowledgedIds.has(r.recommendationId),
      );
    }
    return result;
  }

  /**
   * Acknowledge a recommendation (marks it as reviewed).
   */
  acknowledgeRecommendation(recommendationId: string): boolean {
    const rec = this.recommendations.find(
      (r) => r.recommendationId === recommendationId,
    );
    if (rec === undefined) return false;
    rec.actedUpon = true;
    this.acknowledgedIds.add(recommendationId);
    return true;
  }

  // ── AC4: Learning never modifies production ──────────────────

  /**
   * Generate a promotion record from a recommendation.
   * This creates the promotion in the hypothesis stage — it does NOT
   * advance it automatically. A human or automation must explicitly
   * advance the promotion through each stage.
   */
  initiatePromotion(
    recommendationId: string,
  ): PromotionRecord | null {
    const rec = this.recommendations.find(
      (r) => r.recommendationId === recommendationId,
    );
    if (rec === undefined) return null;
    if (rec.type !== "promote") return null;

    return this.promotionPipeline.createPromotion(
      rec.strategyId,
      rec.summary,
    );
  }

  // ── Internal ────────────────────────────────────────────────

  /**
   * Generate a recommendation from an edge decay signal.
   */
  private generateDecayRecommendation(
    signal: EdgeDecaySignal,
    nowMs: number,
  ): LearningRecommendation | null {
    // Don't duplicate recommendations for the same strategy if
    // an unacknowledged one already exists.
    const existingUnacked = this.recommendations.find(
      (r) =>
        r.strategyId === signal.strategyId &&
        r.type === "demote" &&
        !this.acknowledgedIds.has(r.recommendationId),
    );
    if (existingUnacked !== undefined) return null;

    let type: LearningRecommendation["type"];
    switch (signal.recommendation) {
      case "demote":
        type = "demote";
        break;
      case "pause":
        type = "pause";
        break;
      case "reduce_exposure":
        type = "adjust_parameters";
        break;
      case "monitor":
        return null; // Don't generate a recommendation for monitoring.
    }

    return {
      recommendationId: `rec-decay-${signal.strategyId}-${nowMs}`,
      type,
      strategyId: signal.strategyId,
      summary: `Edge decay detected: ${signal.reason}`,
      evidence: {
        signalId: signal.signalId,
        severity: signal.severity,
        currentSharpe: signal.currentSharpe,
        previousSharpe: signal.previousSharpe,
        currentWinRate: signal.currentWinRate,
        previousWinRate: signal.previousWinRate,
      },
      confidence: signal.severity === "critical" ? 0.95 : 
                  signal.severity === "high" ? 0.85 :
                  signal.severity === "medium" ? 0.7 : 0.5,
      requiresApproval: true,
      createdAtMs: nowMs,
      actedUpon: false,
    };
  }

  /**
   * Evaluate an active promotion and generate recommendations
   * if the promotion is stuck or failing.
   */
  private evaluatePromotion(
    promo: PromotionRecord,
    nowMs: number,
  ): LearningRecommendation | null {
    const ageMs = nowMs - promo.createdAtMs;
    const staleThreshold = this.config.promotionStaleThresholdMs;

    // Check if the promotion is stale (stuck at a stage for too long).
    if (ageMs > staleThreshold && promo.active) {
      return {
        recommendationId: `rec-stale-${promo.promotionId}-${nowMs}`,
        type: "adjust_parameters",
        strategyId: promo.strategyId,
        summary: `Promotion ${promo.promotionId} has been active for ${(ageMs / (24 * 60 * 60 * 1000)).toFixed(1)} days — review or close`,
        evidence: {
          promotionId: promo.promotionId,
          currentStage: promo.currentStage,
          ageMs,
        },
        confidence: 0.6,
        requiresApproval: false,
        createdAtMs: nowMs,
        actedUpon: false,
      };
    }

    return null;
  }

  /**
   * Check if a strategy without an active promotion should be
   * considered for promotion.
   */
  private checkPromotionOpportunity(
    strategyId: string,
    nowMs: number,
  ): LearningRecommendation | null {
    // Only suggest promotion for strategies with strong performance.
    const perf = this.journal.computePerformanceByCount(strategyId, 100);
    if (perf === null) return null;
    if (perf.tradeCount < this.config.minTradesForAnalysis) return null;

    // Check if there's already an active promotion for this strategy.
    const activePromos =
      this.promotionPipeline.getPromotionsForStrategy(strategyId);
    const hasActive = activePromos.some((p) => p.active);
    if (hasActive) return null;

    // Check if performance exceeds promotion thresholds.
    if (
      perf.winRate >= this.config.promotionBacktestMinWinRate &&
      perf.sharpeRatio >= this.config.promotionBacktestMinSharpe &&
      perf.totalPnlUsd > 0
    ) {
      // Don't duplicate promotion recommendations.
      const existingUnacked = this.recommendations.find(
        (r) =>
          r.strategyId === strategyId &&
          r.type === "promote" &&
          !this.acknowledgedIds.has(r.recommendationId),
      );
      if (existingUnacked !== undefined) return null;

      return {
        recommendationId: `rec-promote-${strategyId}-${nowMs}`,
        type: "promote",
        strategyId,
        summary: `Strategy "${strategyId}" shows strong performance (win rate ${(perf.winRate * 100).toFixed(1)}%, Sharpe ${perf.sharpeRatio.toFixed(2)}) — consider promotion`,
        evidence: {
          winRate: perf.winRate,
          sharpeRatio: perf.sharpeRatio,
          totalPnlUsd: perf.totalPnlUsd,
          tradeCount: perf.tradeCount,
          profitFactor: perf.profitFactor,
        },
        confidence: 0.75,
        requiresApproval: true,
        createdAtMs: nowMs,
        actedUpon: false,
      };
    }

    return null;
  }
}
