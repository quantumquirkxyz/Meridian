/**
 * ReportGenerator: daily and weekly trade report generation (issue #39).
 *
 * Acceptance criteria:
 *   AC2: Daily and weekly reports are generated.
 *
 * The generator is deterministic — no LLM, no I/O. It takes trade
 * journal entries and audit reconstruction data and produces aggregated
 * TradeReport objects with performance breakdowns by strategy and venue.
 *
 * Usage:
 * ```ts
 * const generator = new ReportGenerator(journal, reconstructor);
 * const dailyReport = generator.generateDailyReport(nowMs);
 * const weeklyReport = generator.generateWeeklyReport(nowMs);
 * ```
 */

import type {
  AuditReasonCode,
  TradeJournalEntry,
  TradeReport,
  ReportEntry,
  ReportPeriod,
  TradeReconstruction,
} from "@agenttrading/contracts";

// ── Report Generator ─────────────────────────────────────────────────

/**
 * ReportGenerator: generates daily and weekly trade reports.
 */
export class ReportGenerator {
  private readonly journalEntries: TradeJournalEntry[];
  private readonly reconstructions: Map<string, TradeReconstruction>;
  private readonly now: () => number;

  constructor(
    journalEntries: readonly TradeJournalEntry[],
    reconstructions: Map<string, TradeReconstruction> = new Map(),
    now?: () => number,
  ) {
    this.journalEntries = [...journalEntries];
    this.reconstructions = reconstructions;
    this.now = now ?? (() => Date.now());
  }

  // ── AC2: Report Generation ─────────────────────────────────────

  /**
   * Generate a daily report for the calendar day containing `nowMs`.
   *
   * AC2: Daily reports are generated.
   */
  generateDailyReport(nowMs?: number): TradeReport {
    const now = nowMs ?? this.now();
    const dayStart = this.dayStart(now);
    const dayEnd = dayStart + 86_400_000; // 24 hours

    return this.generateReport("daily", dayStart, dayEnd);
  }

  /**
   * Generate a weekly report for the ISO week containing `nowMs`.
   *
   * AC2: Weekly reports are generated.
   */
  generateWeeklyReport(nowMs?: number): TradeReport {
    const now = nowMs ?? this.now();
    const weekStart = this.weekStart(now);
    const weekEnd = weekStart + 7 * 86_400_000; // 7 days

    return this.generateReport("weekly", weekStart, weekEnd);
  }

  /**
   * Generate a report for an arbitrary time range.
   */
  generateCustomReport(
    periodStartMs: number,
    periodEndMs: number,
  ): TradeReport {
    return this.generateReport(
      "daily" as ReportPeriod, // Use daily as base period type.
      periodStartMs,
      periodEndMs,
      `custom-${periodStartMs}-${periodEndMs}`,
    );
  }

  // ── Internal ───────────────────────────────────────────────────

  /**
   * Generate a report for a specific time range.
   */
  private generateReport(
    period: ReportPeriod,
    periodStartMs: number,
    periodEndMs: number,
    reportId?: string,
  ): TradeReport {
    // Filter entries to the time range.
    const entries = this.journalEntries.filter(
      (e) =>
        e.enteredAtMs >= periodStartMs &&
        e.enteredAtMs < periodEndMs,
    );

    // Build report entries.
    const reportEntries: ReportEntry[] = entries.map((entry) => {
      const recon = this.reconstructions.get(entry.tradeId);
      const reasonCodes = this.extractReasonCodes(recon);

      return {
        tradeId: entry.tradeId,
        strategyId: entry.strategyId,
        regime: entry.regime,
        venue: entry.venue,
        symbol: entry.symbol,
        side: entry.side,
        entryPrice: entry.entryPrice,
        exitPrice: entry.exitPrice,
        netPnlUsd: entry.netPnlUsd,
        feesUsd: entry.feesUsd,
        outcome: entry.outcome,
        hasIncidents: recon?.hasIncidentFlags ?? false,
        reasonCodes,
      };
    });

    // Compute summary statistics.
    const totalTrades = entries.length;
    const winCount = entries.filter((e) => e.outcome === "WIN").length;
    const lossCount = entries.filter((e) => e.outcome === "LOSS").length;
    const breakevenCount = entries.filter(
      (e) => e.outcome === "BREAKEVEN",
    ).length;
    const winRate = totalTrades > 0 ? winCount / totalTrades : 0;

    const totalNetPnlUsd = entries.reduce((a, e) => a + e.netPnlUsd, 0);
    const totalFeesUsd = entries.reduce((a, e) => a + e.feesUsd, 0);
    const avgNetPnlUsd =
      totalTrades > 0 ? totalNetPnlUsd / totalTrades : 0;

    // Compute max drawdown from cumulative PnL.
    let cumulative = 0;
    let peak = 0;
    let maxDrawdownUsd = 0;
    for (const entry of entries) {
      cumulative += entry.netPnlUsd;
      if (cumulative > peak) peak = cumulative;
      const drawdown = peak - cumulative;
      if (drawdown > maxDrawdownUsd) maxDrawdownUsd = drawdown;
    }

    // Best and worst trade.
    const pnlValues = entries.map((e) => e.netPnlUsd);
    const bestTradePnlUsd = pnlValues.length > 0 ? Math.max(...pnlValues) : 0;
    const worstTradePnlUsd =
      pnlValues.length > 0 ? Math.min(...pnlValues) : 0;

    // Incident count.
    const incidentCount = reportEntries.filter(
      (e) => e.hasIncidents,
    ).length;

    // Strategy breakdown.
    const strategyBreakdown = this.buildGroupedBreakdown(entries, (e) => e.strategyId);

    // Venue breakdown.
    const venueBreakdown = this.buildGroupedBreakdown(entries, (e) => e.venue);

    // Total slippage.
    const totalSlippageUsd = entries.reduce(
      (a, e) => a + ((e.metadata?.["slippageUsd"] as number) ?? 0),
      0,
    );

    return {
      reportId: reportId ?? `report-${period}-${periodStartMs}`,
      period,
      periodStartMs,
      periodEndMs,
      totalTrades,
      winCount,
      lossCount,
      breakevenCount,
      winRate,
      totalNetPnlUsd,
      totalFeesUsd,
      totalSlippageUsd,
      avgNetPnlUsd,
      maxDrawdownUsd,
      bestTradePnlUsd,
      worstTradePnlUsd,
      incidentCount,
      strategyBreakdown,
      venueBreakdown,
      entries: reportEntries,
      generatedAtMs: this.now(),
    };
  }

  /**
   * Build a grouped breakdown from entries using the given key extractor.
   * Single implementation for both strategy and venue breakdowns (S1 fix).
   */
  private buildGroupedBreakdown(
    entries: readonly TradeJournalEntry[],
    keyFn: (entry: TradeJournalEntry) => string,
  ): Record<string, { tradeCount: number; netPnlUsd: number; winRate: number }> {
    const breakdown: Record<
      string,
      { tradeCount: number; netPnlUsd: number; winCount: number }
    > = {};

    for (const entry of entries) {
      const key = keyFn(entry);
      if (breakdown[key] === undefined) {
        breakdown[key] = { tradeCount: 0, netPnlUsd: 0, winCount: 0 };
      }
      const bucket = breakdown[key];
      bucket.tradeCount += 1;
      bucket.netPnlUsd += entry.netPnlUsd;
      if (entry.outcome === "WIN") bucket.winCount += 1;
    }

    const result: Record<
      string,
      { tradeCount: number; netPnlUsd: number; winRate: number }
    > = {};
    for (const [id, data] of Object.entries(breakdown)) {
      result[id] = {
        tradeCount: data.tradeCount,
        netPnlUsd: data.netPnlUsd,
        winRate:
          data.tradeCount > 0 ? data.winCount / data.tradeCount : 0,
      };
    }
    return result;
  }

  /**
   * Extract reason codes from a reconstruction's timeline.
   */
  private extractReasonCodes(
    recon: TradeReconstruction | undefined,
  ): AuditReasonCode[] {
    if (recon === undefined) return [];
    const codes = new Set<AuditReasonCode>();
    for (const event of recon.timeline) {
      for (const code of event.reasonCodes) {
        codes.add(code);
      }
    }
    return [...codes];
  }

  /**
   * Compute the start of the day (00:00:00 UTC) for a timestamp.
   */
  private dayStart(timestampMs: number): number {
    const d = new Date(timestampMs);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }

  /**
   * Compute the start of the ISO week (Monday 00:00:00 UTC) for a timestamp.
   */
  private weekStart(timestampMs: number): number {
    const d = new Date(timestampMs);
    const dayOfWeek = d.getUTCDay();
    // Convert Sunday=0 to 7, then subtract to get Monday.
    const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const monday = new Date(d);
    monday.setUTCDate(d.getUTCDate() - mondayOffset);
    return Date.UTC(
      monday.getUTCFullYear(),
      monday.getUTCMonth(),
      monday.getUTCDate(),
    );
  }
}
