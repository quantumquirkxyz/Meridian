/**
 * TradeJournal: automatic trade journal that records every outcome
 * and computes per-strategy/regime/venue performance analysis (issue #36).
 *
 * Acceptance criteria:
 *   AC1: Trade journal records every outcome automatically.
 *   AC2: Performance is analysable per strategy, regime, and venue.
 *   AC3: Learning never modifies production directly.
 *
 * The journal is deterministic — no LLM, no I/O. It accumulates
 * TradeJournalEntry records and computes rolling performance windows
 * on demand.
 */

import type {
  FillParams,
  LearningLoopConfig,
  StrategyPerformance,
  TradeJournalEntry,
} from "@agenttrading/contracts";
import { DEFAULT_LEARNING_LOOP_CONFIG } from "@agenttrading/contracts";
import {
  mean,
  computeSharpe,
  computeProfitFactor,
  computeMaxDrawdown,
} from "./stats.ts";

// ── Journal ──────────────────────────────────────────────────────────

/**
 * TradeJournal: the automatic trade journal.
 *
 * Usage:
 * ```ts
 * const journal = new TradeJournal();
 * journal.record(entry);
 * const perf = journal.computePerformance("my-strategy", windowMs);
 * ```
 */
export class TradeJournal {
  private readonly config: LearningLoopConfig;
  private readonly entries: TradeJournalEntry[] = [];
  private readonly now: () => number;

  constructor(
    config: LearningLoopConfig = DEFAULT_LEARNING_LOOP_CONFIG,
    now?: () => number,
  ) {
    this.config = { ...config };
    this.now = now ?? (() => Date.now());
  }

  // ── AC1: Record every outcome ────────────────────────────────

  /**
   * Record a trade outcome. Called automatically when an order fills,
   * cancels, or is rejected.
   */
  record(entry: TradeJournalEntry): void {
    this.entries.push(entry);

    // Enforce max retention.
    if (
      this.config.maxJournalEntries > 0 &&
      this.entries.length > this.config.maxJournalEntries
    ) {
      this.entries.splice(
        0,
        this.entries.length - this.config.maxJournalEntries,
      );
    }
  }

  /**
   * Convenience: record a filled trade from its components.
   */
  recordFill(params: FillParams): TradeJournalEntry {
    const notionalUsd = params.filledQuantity * params.entryPrice;
    const pnlUsd =
      params.side === "BUY"
        ? (params.exitPrice - params.entryPrice) * params.filledQuantity
        : (params.entryPrice - params.exitPrice) * params.filledQuantity;
    const feesUsd = params.feesUsd ?? 0;
    const netPnlUsd = pnlUsd - feesUsd;
    const durationMs = params.exitedAtMs - params.enteredAtMs;

    let outcome: TradeJournalEntry["outcome"];
    if (netPnlUsd > 0.01) outcome = "WIN";
    else if (netPnlUsd < -0.01) outcome = "LOSS";
    else outcome = "BREAKEVEN";

    const entry: TradeJournalEntry = {
      tradeId: params.tradeId,
      strategyId: params.strategyId,
      regime: params.regime,
      venue: params.venue,
      symbol: params.symbol,
      side: params.side,
      entryPrice: params.entryPrice,
      exitPrice: params.exitPrice,
      filledQuantity: params.filledQuantity,
      notionalUsd,
      pnlUsd,
      feesUsd,
      netPnlUsd,
      outcome,
      enteredAtMs: params.enteredAtMs,
      exitedAtMs: params.exitedAtMs,
      durationMs,
      metadata: params.metadata,
    };

    this.record(entry);
    return entry;
  }

  // ── AC2: Performance analysis ────────────────────────────────

  /**
   * Get all entries (optionally filtered by strategy, regime, or venue).
   */
  getEntries(filters?: {
    strategyId?: string;
    regime?: string;
    venue?: string;
  }): readonly TradeJournalEntry[] {
    let result = this.entries;
    if (filters?.strategyId !== undefined) {
      result = result.filter((e) => e.strategyId === filters.strategyId);
    }
    if (filters?.regime !== undefined) {
      result = result.filter((e) => e.regime === filters.regime);
    }
    if (filters?.venue !== undefined) {
      result = result.filter((e) => e.venue === filters.venue);
    }
    return result;
  }

  /**
   * Compute performance for a strategy over a time window.
   * Returns null if insufficient data.
   */
  computePerformance(
    strategyId: string,
    windowMs: number,
    nowMs?: number,
  ): StrategyPerformance | null {
    const now = nowMs ?? this.now();
    const windowStart = now - windowMs;

    const entries = this.entries.filter(
      (e) =>
        e.strategyId === strategyId &&
        e.enteredAtMs >= windowStart &&
        e.enteredAtMs <= now &&
        (e.outcome === "WIN" || e.outcome === "LOSS" || e.outcome === "BREAKEVEN"),
    );

    return this.computePerformanceFromEntries(entries, strategyId, windowStart, now);
  }

  /**
   * Compute performance over the last N trades (count-based window).
   */
  computePerformanceByCount(
    strategyId: string,
    tradeCount: number,
  ): StrategyPerformance | null {
    const entries = this.entries
      .filter(
        (e) =>
          e.strategyId === strategyId &&
          (e.outcome === "WIN" || e.outcome === "LOSS" || e.outcome === "BREAKEVEN"),
      )
      .slice(-tradeCount);

    if (entries.length < 2) return null;
    return this.computePerformanceFromEntries(
      entries,
      strategyId,
      entries[0].enteredAtMs,
      entries[entries.length - 1].enteredAtMs,
    );
  }

  /**
   * Compute performance for a specific regime.
   */
  computeRegimePerformance(
    regime: string,
    windowMs: number,
    nowMs?: number,
  ): StrategyPerformance | null {
    const now = nowMs ?? this.now();
    const windowStart = now - windowMs;

    const entries = this.entries.filter(
      (e) =>
        e.regime === regime &&
        e.enteredAtMs >= windowStart &&
        e.enteredAtMs <= now &&
        (e.outcome === "WIN" || e.outcome === "LOSS" || e.outcome === "BREAKEVEN"),
    );

    return this.computePerformanceFromEntries(
      entries,
      `regime:${regime}`,
      windowStart,
      now,
    );
  }

  /**
   * Compute performance for a specific venue.
   */
  computeVenuePerformance(
    venue: string,
    windowMs: number,
    nowMs?: number,
  ): StrategyPerformance | null {
    const now = nowMs ?? this.now();
    const windowStart = now - windowMs;

    const entries = this.entries.filter(
      (e) =>
        e.venue === venue &&
        e.enteredAtMs >= windowStart &&
        e.enteredAtMs <= now &&
        (e.outcome === "WIN" || e.outcome === "LOSS" || e.outcome === "BREAKEVEN"),
    );

    return this.computePerformanceFromEntries(
      entries,
      `venue:${venue}`,
      windowStart,
      now,
    );
  }

  /**
   * Compute performance metrics from pre-filtered entries.
   * Public so callers (e.g. EdgeDecayDetector) can compute metrics
   * from a sliced subset without reimplementing the logic.
   */
  computePerformanceFromEntries(
    entries: readonly TradeJournalEntry[],
    strategyId: string,
    windowStartMs: number,
    windowEndMs: number,
  ): StrategyPerformance | null {
    if (entries.length < 2) return null;

    const winCount = entries.filter((e) => e.outcome === "WIN").length;
    const lossCount = entries.filter((e) => e.outcome === "LOSS").length;
    const totalPnl = entries.reduce((a, e) => a + e.netPnlUsd, 0);
    const pnlValues = entries.map((e) => e.netPnlUsd);
    const durations = entries
      .filter((e) => e.durationMs !== null)
      .map((e) => e.durationMs!);

    return {
      strategyId,
      tradeCount: entries.length,
      winCount,
      lossCount,
      winRate: entries.length > 0 ? winCount / entries.length : 0,
      totalPnlUsd: totalPnl,
      avgPnlUsd: totalPnl / entries.length,
      sharpeRatio: computeSharpe(pnlValues),
      maxDrawdownUsd: computeMaxDrawdown(pnlValues),
      profitFactor: computeProfitFactor(pnlValues),
      avgDurationMs: durations.length > 0 ? mean(durations) : 0,
      windowStartMs,
      windowEndMs,
    };
  }

  /**
   * Get all distinct strategy IDs in the journal.
   */
  distinctStrategyIds(): string[] {
    const ids = new Set<string>();
    for (const e of this.entries) ids.add(e.strategyId);
    return [...ids];
  }

  /**
   * Get all distinct regimes in the journal.
   */
  distinctRegimes(): string[] {
    const regimes = new Set<string>();
    for (const e of this.entries) regimes.add(e.regime);
    return [...regimes];
  }

  /**
   * Total number of journal entries.
   */
  get size(): number {
    return this.entries.length;
  }
}
