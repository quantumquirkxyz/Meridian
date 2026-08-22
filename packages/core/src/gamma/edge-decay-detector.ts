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
  StrategyPerformance,
} from "@agenttrading/contracts";
import { DEFAULT_LEARNING_LOOP_CONFIG } from "@agenttrading/contracts";
import { type TradeJournal } from "./trade-journal.ts";
import {
  mean,
  computeSharpe,
  computeProfitFactor,
  computeMaxDrawdown,
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
    let worstSeverity: "low" | "medium" | "high" | "critical" | null = null;

    // Check Sharpe degradation.
    if (sharpeDelta < 0) {
      if (
        currentPerf.sharpeRatio <=
        this.config.decaySharpeCriticalThreshold
      ) {
        reasons.push(
          `Sharpe ${currentPerf.sharpeRatio.toFixed(3)} <= critical threshold ${this.config.decaySharpeCriticalThreshold}`,
        );
        worstSeverity = "critical";
      } else if (
        currentPerf.sharpeRatio <= this.config.decaySharpeHighThreshold
      ) {
        reasons.push(
          `Sharpe ${currentPerf.sharpeRatio.toFixed(3)} <= high threshold ${this.config.decaySharpeHighThreshold}`,
        );
        if (worstSeverity === null || worstSeverity === "low" || worstSeverity === "medium") {
          worstSeverity = "high";
        }
      } else if (
        currentPerf.sharpeRatio <= this.config.decaySharpeMediumThreshold
      ) {
        reasons.push(
          `Sharpe ${currentPerf.sharpeRatio.toFixed(3)} <= medium threshold ${this.config.decaySharpeMediumThreshold}`,
        );
        if (worstSeverity === null || worstSeverity === "low") {
          worstSeverity = "medium";
        }
      } else if (
        currentPerf.sharpeRatio <= this.config.decaySharpeLowThreshold
      ) {
        reasons.push(
          `Sharpe ${currentPerf.sharpeRatio.toFixed(3)} <= low threshold ${this.config.decaySharpeLowThreshold}`,
        );
        if (worstSeverity === null) {
          worstSeverity = "low";
        }
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
      if (
        worstSeverity === null ||
        (worstSeverity !== "high" && worstSeverity !== "critical")
      ) {
        worstSeverity = "medium";
      }
    }

    // Check profit factor degradation.
    if (
      currentPerf.profitFactor < this.config.decayProfitFactorThreshold &&
      profitFactorDelta < 0
    ) {
      reasons.push(
        `Profit factor ${currentPerf.profitFactor.toFixed(2)} < threshold ${this.config.decayProfitFactorThreshold}`,
      );
      if (
        worstSeverity === null ||
        (worstSeverity !== "high" && worstSeverity !== "critical")
      ) {
        worstSeverity = "medium";
      }
    }

    // No decay detected.
    if (reasons.length === 0 || worstSeverity === null) {
      return null;
    }

    // Determine recommendation based on severity.
    let recommendation: EdgeDecaySignal["recommendation"];
    switch (worstSeverity) {
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
      severity: worstSeverity,
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
   * This computes the performance over the window of trades immediately
   * before the current window.
   */
  private getPreviousWindowPerformance(
    strategyId: string,
    currentWindowSize: number,
    prevWindowSize: number,
  ): StrategyPerformance | null {
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

    const winCount = prevEntries.filter((e) => e.outcome === "WIN").length;
    const lossCount = prevEntries.filter((e) => e.outcome === "LOSS").length;
    const totalPnl = prevEntries.reduce((a, e) => a + e.netPnlUsd, 0);
    const pnlValues = prevEntries.map((e) => e.netPnlUsd);
    const durations = prevEntries
      .filter((e) => e.durationMs !== null)
      .map((e) => e.durationMs!);

    return {
      strategyId,
      tradeCount: prevEntries.length,
      winCount,
      lossCount,
      winRate: prevEntries.length > 0 ? winCount / prevEntries.length : 0,
      totalPnlUsd: totalPnl,
      avgPnlUsd: totalPnl / prevEntries.length,
      sharpeRatio: computeSharpe(pnlValues),
      maxDrawdownUsd: computeMaxDrawdown(pnlValues),
      profitFactor: computeProfitFactor(pnlValues),
      avgDurationMs:
        durations.length > 0 ? mean(durations) : 0,
      windowStartMs: prevEntries[0].enteredAtMs,
      windowEndMs: prevEntries[prevEntries.length - 1].enteredAtMs,
    };
  }
}
