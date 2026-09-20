/**
 * PromotionPipeline: enforces the strict promotion pipeline for strategy
 * changes (issue #36).
 *
 * Acceptance criteria:
 *   AC1: No strategy change reaches live without
 *        backtest → review → canary.
 *   AC2: Each stage must pass before advancing to the next.
 *   AC3: Human approval is required at the review stage (configurable).
 *   AC4: Learning never modifies production directly.
 *
 * The pipeline is deterministic — no LLM, no I/O. It evaluates
 * promotion records against gate criteria at each stage and decides
 * whether to advance, hold, or reject.
 */

import type {
  LearningLoopConfig,
  PromotionRecord,
  PromotionStage,
  StrategyPerformance,
} from "@agenttrading/contracts";
import {
  DEFAULT_LEARNING_LOOP_CONFIG,
  PROMOTION_STAGES,
  nextStage,
} from "@agenttrading/contracts";
import { type TradeJournal } from "@agenttrading/core-session";

// ── Pipeline ─────────────────────────────────────────────────────────

/**
 * PromotionPipeline: manages the lifecycle of strategy promotions
 * through the mandatory pipeline.
 *
 * Usage:
 * ```ts
 * const pipeline = new PromotionPipeline(journal, config);
 * const record = pipeline.createPromotion("my-strategy", "Improve mean reversion");
 * pipeline.advanceStage(record.promotionId, backtestResults);
 * ```
 */
export class PromotionPipeline {
  private readonly journal: TradeJournal;
  private readonly config: LearningLoopConfig;
  private readonly now: () => number;
  private readonly records: Map<string, PromotionRecord> = new Map();

  constructor(
    journal: TradeJournal,
    config: LearningLoopConfig = DEFAULT_LEARNING_LOOP_CONFIG,
    now?: () => number,
  ) {
    this.journal = journal;
    this.config = { ...config };
    this.now = now ?? (() => Date.now());
  }

  // ── Promotion Lifecycle ───────────────────────────────────────

  /**
   * Create a new promotion record at the hypothesis stage.
   */
  createPromotion(
    strategyId: string,
    description: string,
  ): PromotionRecord {
    const now = this.now();
    const stageOutcomes: Record<PromotionStage, "pass" | "fail" | "pending" | "skipped"> = {
      hypothesis: "pass",
      backtest: "pending",
      review: "pending",
      canary: "pending",
      scale: "pending",
    };
    const stageNotes: Record<PromotionStage, string> = {
      hypothesis: "Created",
      backtest: "",
      review: "",
      canary: "",
      scale: "",
    };

    const record: PromotionRecord = {
      promotionId: `promo-${strategyId}-${now}`,
      strategyId,
      description,
      currentStage: "hypothesis",
      stageOutcomes,
      stageNotes,
      createdAtMs: now,
      lastTransitionAtMs: now,
      completedAtMs: null,
      active: true,
      humanApproved: false,
    };

    this.records.set(record.promotionId, record);
    return record;
  }

  /**
   * Advance a promotion to the next stage, evaluating gate criteria.
   *
   * Returns the updated record. If the gate fails, the record is
   * marked as rejected at the current stage.
   */
  advanceStage(
    promotionId: string,
    gateData?: {
      performance?: StrategyPerformance;
      humanApproved?: boolean;
      notes?: string;
    },
  ): PromotionRecord {
    const record = this.records.get(promotionId);
    if (record === undefined) {
      throw new Error(`promotion ${promotionId} not found`);
    }
    if (!record.active) {
      throw new Error(`promotion ${promotionId} is no longer active`);
    }

    const currentIdx = PROMOTION_STAGES.indexOf(record.currentStage);
    if (currentIdx >= PROMOTION_STAGES.length - 1) {
      // Already at scale — cannot advance further.
      return record;
    }

    // Guard: all prior stages must have been passed.
    for (let i = 0; i < currentIdx; i++) {
      const priorStage = PROMOTION_STAGES[i];
      if (record.stageOutcomes[priorStage] !== "pass") {
        return record; // Cannot advance — prior stage not passed.
      }
    }

    // Evaluate gate criteria for the current stage.
    const gateResult = this.evaluateGate(
      record.currentStage,
      record.strategyId,
      gateData,
    );

    if (!gateResult.passed) {
      // Reject: mark the current stage as failed.
      record.stageOutcomes[record.currentStage] = "fail";
      record.stageNotes[record.currentStage] = gateResult.reason;
      record.active = false;
      record.completedAtMs = this.now();
      return record;
    }

    // Gate passed: mark current stage as passed and advance.
    record.stageOutcomes[record.currentStage] = "pass";
    if (gateData?.notes !== undefined) {
      record.stageNotes[record.currentStage] = gateData.notes;
    }

    const next = nextStage(record.currentStage);
    if (next === null) {
      // Reached scale — complete the promotion.
      record.currentStage = "scale";
      record.stageOutcomes.scale = "pass";
      record.active = false;
      record.completedAtMs = this.now();
      record.lastTransitionAtMs = this.now();
      return record;
    }

    record.currentStage = next;
    record.lastTransitionAtMs = this.now();

    // If advancing to scale, mark as completed.
    if (next === "scale") {
      record.active = false;
      record.completedAtMs = this.now();
    }

    return record;
  }

  /**
   * Record human approval at the review stage.
   */
  approveReview(
    promotionId: string,
    approved: boolean,
    notes?: string,
  ): PromotionRecord {
    const record = this.records.get(promotionId);
    if (record === undefined) {
      throw new Error(`promotion ${promotionId} not found`);
    }
    if (!record.active) {
      throw new Error(`promotion ${promotionId} is no longer active`);
    }

    record.humanApproved = approved;
    if (notes !== undefined) {
      record.stageNotes.review = notes;
    }

    return record;
  }

  /**
   * Reject a promotion at any stage.
   */
  reject(
    promotionId: string,
    reason: string,
  ): PromotionRecord {
    const record = this.records.get(promotionId);
    if (record === undefined) {
      throw new Error(`promotion ${promotionId} not found`);
    }

    record.stageOutcomes[record.currentStage] = "fail";
    record.stageNotes[record.currentStage] = reason;
    record.active = false;
    record.completedAtMs = this.now();

    return record;
  }

  // ── Gate Evaluation ──────────────────────────────────────────

  /**
   * Evaluate the gate criteria for a specific stage.
   */
  private evaluateGate(
    stage: PromotionStage,
    strategyId: string,
    gateData?: {
      performance?: StrategyPerformance;
      humanApproved?: boolean;
    },
  ): { passed: boolean; reason: string } {
    switch (stage) {
      case "hypothesis":
        // Hypothesis stage always passes — it's just documentation.
        return { passed: true, reason: "hypothesis documented" };

      case "backtest":
        return this.evaluateBacktestGate(strategyId, gateData?.performance);

      case "review":
        return this.evaluateReviewGate(gateData?.humanApproved ?? false);

      case "canary":
        return this.evaluateCanaryGate(strategyId, gateData?.performance);

      case "scale":
        // Reaching scale is the final stage — always passes.
        return { passed: true, reason: "promoted to scale" };
    }
  }

  private evaluateBacktestGate(
    strategyId: string,
    performance?: StrategyPerformance,
  ): { passed: boolean; reason: string } {
    // Use provided performance or compute from journal.
    const perf =
      performance ??
      this.journal.computePerformanceByCount(
        strategyId,
        this.config.promotionMinBacktestTrades,
      );

    if (perf === null) {
      return {
        passed: false,
        reason: `insufficient backtest data: need ${this.config.promotionMinBacktestTrades} trades`,
      };
    }

    if (perf.tradeCount < this.config.promotionMinBacktestTrades) {
      return {
        passed: false,
        reason: `insufficient backtest trades: ${perf.tradeCount} < ${this.config.promotionMinBacktestTrades}`,
      };
    }

    if (perf.winRate < this.config.promotionBacktestMinWinRate) {
      return {
        passed: false,
        reason: `backtest win rate ${(perf.winRate * 100).toFixed(1)}% < ${(this.config.promotionBacktestMinWinRate * 100).toFixed(1)}%`,
      };
    }

    if (perf.sharpeRatio < this.config.promotionBacktestMinSharpe) {
      return {
        passed: false,
        reason: `backtest Sharpe ${perf.sharpeRatio.toFixed(3)} < ${this.config.promotionBacktestMinSharpe}`,
      };
    }

    return { passed: true, reason: "backtest gate passed" };
  }

  private evaluateReviewGate(
    humanApproved: boolean,
  ): { passed: boolean; reason: string } {
    if (this.config.promotionRequireHumanApproval && !humanApproved) {
      return {
        passed: false,
        reason: "human approval required at review stage",
      };
    }
    return { passed: true, reason: "review gate passed" };
  }

  private evaluateCanaryGate(
    strategyId: string,
    performance?: StrategyPerformance,
  ): { passed: boolean; reason: string } {
    const perf =
      performance ??
      this.journal.computePerformanceByCount(
        strategyId,
        this.config.promotionMinCanaryTrades,
      );

    if (perf === null) {
      return {
        passed: false,
        reason: `insufficient canary data: need ${this.config.promotionMinCanaryTrades} trades`,
      };
    }

    if (perf.tradeCount < this.config.promotionMinCanaryTrades) {
      return {
        passed: false,
        reason: `insufficient canary trades: ${perf.tradeCount} < ${this.config.promotionMinCanaryTrades}`,
      };
    }

    if (perf.winRate < this.config.promotionCanaryMinWinRate) {
      return {
        passed: false,
        reason: `canary win rate ${(perf.winRate * 100).toFixed(1)}% < ${(this.config.promotionCanaryMinWinRate * 100).toFixed(1)}%`,
      };
    }

    return { passed: true, reason: "canary gate passed" };
  }

  // ── Queries ──────────────────────────────────────────────────

  /**
   * Get a promotion record by ID.
   */
  getRecord(promotionId: string): PromotionRecord | undefined {
    return this.records.get(promotionId);
  }

  /**
   * Get all promotion records.
   */
  getAllRecords(): readonly PromotionRecord[] {
    return [...this.records.values()];
  }

  /**
   * Get active promotions.
   */
  getActivePromotions(): PromotionRecord[] {
    return [...this.records.values()].filter((r) => r.active);
  }

  /**
   * Get promotions for a specific strategy.
   */
  getPromotionsForStrategy(strategyId: string): PromotionRecord[] {
    return [...this.records.values()].filter(
      (r) => r.strategyId === strategyId,
    );
  }

  /**
   * Verify that no promotion has skipped a stage.
   * Returns null if valid, or an error message if a stage was skipped.
   */
  validateNoSkippedStages(
    promotionId: string,
  ): { valid: true } | { valid: false; reason: string } {
    const record = this.records.get(promotionId);
    if (record === undefined) {
      return { valid: false, reason: `promotion ${promotionId} not found` };
    }

    for (const stage of PROMOTION_STAGES) {
      const outcome = record.stageOutcomes[stage];
      if (outcome === "skipped") {
        return {
          valid: false,
          reason: `stage "${stage}" was skipped — all stages must be passed`,
        };
      }
    }

    return { valid: true };
  }
}
