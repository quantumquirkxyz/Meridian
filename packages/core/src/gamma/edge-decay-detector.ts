/**
 * EdgeDecayDetector: detects and flags edge decay for trading strategies
 * (issue #36).
 *
 * Acceptance criteria:
 *   AC1: Edge decay is detected and flagged.
 *   AC2: Detection is based on rolling performance windows (Sharpe, win
 *        rate, profit factor).
 *   AC3: Severity escalates as decay worsens.
 *   AC4: Learning never modifies production directly — only emits signals.
 *
 * The detector is deterministic — no LLM, no I/O. It compares the
 * current rolling window against the previous rolling window and
 * flags decay when metrics degrade beyond configured thresholds.
 */

import type {
  EdgeDecaySignal,
  LearningLoopConfig,
} from "@agenttrading/contracts";
import { DEFAULT_LEARNING_LOOP_CONFIG } from "@agenttrading/contracts";
import { type TradeJournal } from "./trade-journal.ts";
import {
  classifySeverity,
  worstSeverity,
  type SeverityThresholds,
} from "./stats.ts";

// ── Detector ─────────────────────────────────────────────────────────

/**
 * EdgeDecayDetector: compares rolling performance windows and emits
 * EdgeDecaySignal when metrics degrade.
 *
 * Usage:
 * ```ts
 * const detector = new EdgeDecayDetector(journal, config);
 * const signals = detector.detectAll();
 * ```
 */
export class EdgeDecayDetector {
  private readonly journal: TradeJournal;
  private readonly config: LearningLoopConfig;
  private readonly now: () => number;

  constructor(
    journal: TradeJournal,
    config: LearningLoopConfig = DEFAULT_LEARNING_LOOP_CONFIG,
    now?: () => number,
  ) {
    this.journal = journal;
    this.config = { ...config };
    this.now = now ?? (() => Date.now());
  }

  /**
   * Detect edge decay for a specific strategy.
   * Returns null if insufficient data.
   */
  detect(strategyId: string): EdgeDecaySignal | null {
    const windowSize = this.config.decayWindowTrades;
    const prevWindowSize = this.config.decayPreviousWindowTrades;
    const minTrades = this.config.minTradesForAnalysis;

    // Need at least minTrades before we start detecting.
    const currentPerf = this.journal.computePerformanceByCount(
      strategyId,
      windowSize,
    );
    if (currentPerf === null || currentPerf.tradeCount < minTrades) {
      return null;
    }

    // Get the previous window: trades [-(windowSize+prevWindowSize) : -windowSize]
    const prevPerf = this.journal.computePerformanceByCount(
      strategyId,
      windowSize + prevWindowSize,
    );
    // We can also compute it more precisely by slicing the journal.
    // For simplicity, use the full previous window as a baseline.
    const prevPerfExact = this.getPreviousWindowPerformance(
      strategyId,
      windowSize,
      prevWindowSize,
    );

    const prev = prevPerfExact ?? prevPerf;
    if (prev === null) return null;

    // Compare metrics and determine severity.
    const sharpeDelta = currentPerf.sharpeRatio - prev.sharpeRatio;
    const winRateDelta = currentPerf.winRate - prev.winRate;
    const profitFactorDelta = currentPerf.profitFactor - prev.profitFactor;

    const reasons: string[] = [];
    let overallSeverity: "low" | "medium" | "high" | "critical" | null = null;

    // Check Sharpe degradation.
    if (sharpeDelta < 0) {
      const sharpeThresholds: SeverityThresholds = {
        low: this.config.decaySharpeLowThreshold,
        medium: this.config.decaySharpeMediumThreshold,
        high: this.config.decaySharpeHighThreshold,
        critical: this.config.decaySharpeCriticalThreshold,
      };
      const sev = classifySeverity(currentPerf.sharpeRatio, sharpeThresholds);
      if (sev !== null) {
        reasons.push(
          `Sharpe ${currentPerf.sharpeRatio.toFixed(3)} <= ${sev} threshold ${sharpeThresholds[sev]}`,
        );
        overallSeverity = worstSeverity(overallSeverity, sev);
      }
    }

    // Check win rate degradation.
    if (
      currentPerf.winRate < this.config.decayWinRateThreshold &&
      winRateDelta < 0
    ) {
      reasons.push(
        `Win rate ${(currentPerf.winRate * 100).toFixed(1)}% < threshold ${(this.config.decayWinRateThreshold * 100).toFixed(1)}%`,
      );
      overallSeverity = worstSeverity(overallSeverity, "medium");
    }

    // Check profit factor degradation.
    if (
      currentPerf.profitFactor < this.config.decayProfitFactorThreshold &&
      profitFactorDelta < 0
    ) {
      reasons.push(
        `Profit factor ${currentPerf.profitFactor.toFixed(2)} < threshold ${this.config.decayProfitFactorThreshold}`,
      );
      overallSeverity = worstSeverity(overallSeverity, "medium");
    }

    // No decay detected.
    if (reasons.length === 0 || overallSeverity === null) {
      return null;
    }

    // Determine recommendation based on severity.
    let recommendation: EdgeDecaySignal["recommendation"];
    switch (overallSeverity) {
      case "critical":
        recommendation = "demote";
        break;
      case "high":
        recommendation = "pause";
        break;
      case "medium":
        recommendation = "reduce_exposure";
        break;
      case "low":
        recommendation = "monitor";
        break;
    }

    return {
      signalId: `decay-${strategyId}-${this.now()}`,
      strategyId,
      severity: overallSeverity,
      reason: reasons.join("; "),
      currentSharpe: currentPerf.sharpeRatio,
      previousSharpe: prev.sharpeRatio,
      currentWinRate: currentPerf.winRate,
      previousWinRate: prev.winRate,
      currentProfitFactor: currentPerf.profitFactor,
      previousProfitFactor: prev.profitFactor,
      detectedAtMs: this.now(),
      recommendation,
    };
  }

  /**
   * Detect edge decay for all strategies in the journal.
   */
  detectAll(): EdgeDecaySignal[] {
    const signals: EdgeDecaySignal[] = [];
    for (const strategyId of this.journal.distinctStrategyIds()) {
      const signal = this.detect(strategyId);
      if (signal !== null) {
        signals.push(signal);
      }
    }
    return signals;
  }

  /**
   * Get the previous window performance for a strategy.
   * Delegates to TradeJournal.computePerformanceFromEntries to avoid
   * duplicating metric computation logic (fixes S1).
   */
  private getPreviousWindowPerformance(
    strategyId: string,
    currentWindowSize: number,
    prevWindowSize: number,
  ): ReturnType<TradeJournal["computePerformanceFromEntries"]> {
    const allEntries = this.journal.getEntries({ strategyId });
    const filledEntries = allEntries.filter(
      (e) =>
        e.outcome === "WIN" || e.outcome === "LOSS" || e.outcome === "BREAKEVEN",
    );

    const totalNeeded = currentWindowSize + prevWindowSize;
    if (filledEntries.length < totalNeeded) return null;

    // Slice the previous window.
    const prevEntries = filledEntries.slice(
      filledEntries.length - totalNeeded,
      filledEntries.length - currentWindowSize,
    );

    if (prevEntries.length < 2) return null;

    return this.journal.computePerformanceFromEntries(
      prevEntries,
      strategyId,
      prevEntries[0].enteredAtMs,
      prevEntries[prevEntries.length - 1].enteredAtMs,
    );
  }
}
