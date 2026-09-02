/**
 * AuditExporter: TXT/JSON/CSV export for trade reports and
 * reconstructions (issue #39).
 *
 * Acceptance criteria:
 *   AC3: Exports work in TXT/JSON/CSV.
 *
 * The exporter is deterministic — no LLM, no I/O. It serializes
 * TradeReport and TradeReconstruction objects into the requested
 * format and returns the result as a string.
 *
 * Usage:
 * ```ts
 * const exporter = new AuditExporter();
 * const json = exporter.exportReport(report, { format: "json", ... });
 * const csv = exporter.exportReport(report, { format: "csv", ... });
 * const txt = exporter.exportReport(report, { format: "txt", ... });
 * const reconJson = exporter.exportReconstruction(recon, { format: "json", ... });
 * ```
 */

import type {
  ExportOptions,
  TradeReport,
  TradeReconstruction,
} from "@agenttrading/contracts";
import { DEFAULT_EXPORT_OPTIONS } from "@agenttrading/contracts";

// ── AuditExporter ────────────────────────────────────────────────────

/**
 * AuditExporter: serializes trade reports and reconstructions into
 * TXT, JSON, or CSV format.
 */
export class AuditExporter {
  /**
   * Export a TradeReport in the requested format.
   */
  exportReport(
    report: TradeReport,
    options: ExportOptions = DEFAULT_EXPORT_OPTIONS,
  ): string {
    switch (options.format) {
      case "json":
        return this.exportReportJson(report, options);
      case "csv":
        return this.exportReportCsv(report, options);
      case "txt":
        return this.exportReportTxt(report, options);
    }
  }

  /**
   * Export a list of TradeReconstructions in the requested format.
   */
  exportReconstructions(
    reconstructions: readonly TradeReconstruction[],
    options: ExportOptions = DEFAULT_EXPORT_OPTIONS,
  ): string {
    switch (options.format) {
      case "json":
        return this.exportReconstructionsJson(reconstructions, options);
      case "csv":
        return this.exportReconstructionsCsv(reconstructions, options);
      case "txt":
        return this.exportReconstructionsTxt(reconstructions, options);
    }
  }

  /**
   * Export a single TradeReconstruction in the requested format.
   */
  exportReconstruction(
    reconstruction: TradeReconstruction,
    options: ExportOptions = DEFAULT_EXPORT_OPTIONS,
  ): string {
    return this.exportReconstructions([reconstruction], options);
  }

  // ── Report Export: JSON ────────────────────────────────────────

  private exportReportJson(
    report: TradeReport,
    options: ExportOptions,
  ): string {
    const data = this.buildReportData(report, options);
    return JSON.stringify(data, null, 2);
  }

  // ── Report Export: CSV ─────────────────────────────────────────

  private exportReportCsv(
    report: TradeReport,
    options: ExportOptions,
  ): string {
    const lines: string[] = [];

    // Header.
    const headers = [
      "tradeId",
      "strategyId",
      "regime",
      "venue",
      "symbol",
      "side",
      "entryPrice",
      "exitPrice",
      "netPnlUsd",
      "feesUsd",
      "outcome",
      "hasIncidents",
    ];
    if (options.includeReasonCodes) {
      headers.push("reasonCodes");
    }
    lines.push(headers.join(","));

    // Data rows.
    if (options.includeEntries) {
      for (const entry of report.entries) {
        const row = [
          this.csvEscape(entry.tradeId),
          this.csvEscape(entry.strategyId),
          this.csvEscape(entry.regime),
          this.csvEscape(entry.venue),
          this.csvEscape(entry.symbol),
          entry.side,
          entry.entryPrice.toString(),
          entry.exitPrice?.toString() ?? "",
          entry.netPnlUsd.toString(),
          entry.feesUsd.toString(),
          entry.outcome,
          entry.hasIncidents.toString(),
        ];
        if (options.includeReasonCodes) {
          row.push(this.csvEscape(entry.reasonCodes.join(";")));
        }
        lines.push(row.join(","));
      }
    }

    // Summary row.
    lines.push("");
    lines.push("Summary");
    lines.push(`Total Trades,${report.totalTrades}`);
    lines.push(`Win Rate,${(report.winRate * 100).toFixed(1)}%`);
    lines.push(`Total Net PnL (USD),${report.totalNetPnlUsd.toFixed(2)}`);
    lines.push(`Total Fees (USD),${report.totalFeesUsd.toFixed(2)}`);
    lines.push(
      `Total Slippage (USD),${report.totalSlippageUsd.toFixed(2)}`,
    );
    lines.push(`Max Drawdown (USD),${report.maxDrawdownUsd.toFixed(2)}`);
    lines.push(`Incident Count,${report.incidentCount}`);

    return lines.join("\n");
  }

  // ── Report Export: TXT ─────────────────────────────────────────

  private exportReportTxt(
    report: TradeReport,
    options: ExportOptions,
  ): string {
    const lines: string[] = [];
    const separator = "=".repeat(72);
    const thinSep = "-".repeat(72);

    lines.push(separator);
    lines.push(
      `  ${report.period.toUpperCase()} TRADE REPORT`,
    );
    lines.push(separator);
    lines.push(
      `  Report ID:     ${report.reportId}`,
    );
    lines.push(
      `  Period:        ${this.formatTimestamp(report.periodStartMs)} — ${this.formatTimestamp(report.periodEndMs)}`,
    );
    lines.push(
      `  Generated:     ${this.formatTimestamp(report.generatedAtMs)}`,
    );
    lines.push(separator);
    lines.push("");

    // Summary.
    lines.push("  SUMMARY");
    lines.push(thinSep);
    lines.push(`  Total Trades:      ${report.totalTrades}`);
    lines.push(
      `  Win/Loss/BE:       ${report.winCount}/${report.lossCount}/${report.breakevenCount}`,
    );
    lines.push(
      `  Win Rate:          ${(report.winRate * 100).toFixed(1)}%`,
    );
    lines.push(
      `  Total Net PnL:     $${report.totalNetPnlUsd.toFixed(2)}`,
    );
    lines.push(
      `  Total Fees:        $${report.totalFeesUsd.toFixed(2)}`,
    );
    lines.push(
      `  Total Slippage:    $${report.totalSlippageUsd.toFixed(2)}`,
    );
    lines.push(
      `  Avg Net PnL:       $${report.avgNetPnlUsd.toFixed(2)}`,
    );
    lines.push(
      `  Max Drawdown:      $${report.maxDrawdownUsd.toFixed(2)}`,
    );
    lines.push(
      `  Best Trade:        $${report.bestTradePnlUsd.toFixed(2)}`,
    );
    lines.push(
      `  Worst Trade:       $${report.worstTradePnlUsd.toFixed(2)}`,
    );
    lines.push(`  Incidents:         ${report.incidentCount}`);
    lines.push("");

    // Strategy breakdown.
    lines.push("  STRATEGY BREAKDOWN");
    lines.push(thinSep);
    for (const [id, data] of Object.entries(report.strategyBreakdown)) {
      lines.push(
        `  ${id.padEnd(20)} trades=${data.tradeCount} pnl=$${data.netPnlUsd.toFixed(2)} winRate=${(data.winRate * 100).toFixed(1)}%`,
      );
    }
    lines.push("");

    // Venue breakdown.
    lines.push("  VENUE BREAKDOWN");
    lines.push(thinSep);
    for (const [venue, data] of Object.entries(report.venueBreakdown)) {
      lines.push(
        `  ${venue.padEnd(20)} trades=${data.tradeCount} pnl=$${data.netPnlUsd.toFixed(2)} winRate=${(data.winRate * 100).toFixed(1)}%`,
      );
    }
    lines.push("");

    // Trade entries.
    if (options.includeEntries && report.entries.length > 0) {
      lines.push("  TRADES");
      lines.push(thinSep);
      for (const entry of report.entries) {
        const pnlSign = entry.netPnlUsd >= 0 ? "+" : "";
        lines.push(
          `  ${entry.tradeId} | ${entry.symbol} ${entry.side} | ${entry.outcome} | pnl=${pnlSign}$${entry.netPnlUsd.toFixed(2)} | fees=$${entry.feesUsd.toFixed(2)}`,
        );
        if (options.includeReasonCodes && entry.reasonCodes.length > 0) {
          lines.push(`    reasonCodes: ${entry.reasonCodes.join(", ")}`);
        }
      }
    }

    lines.push("");
    lines.push(separator);
    return lines.join("\n");
  }

  // ── Reconstruction Export: JSON ────────────────────────────────

  private exportReconstructionsJson(
    reconstructions: readonly TradeReconstruction[],
    options: ExportOptions,
  ): string {
    const data = reconstructions.map((r) =>
      this.buildReconstructionData(r, options),
    );
    return JSON.stringify(data, null, 2);
  }

  // ── Reconstruction Export: CSV ─────────────────────────────────

  private exportReconstructionsCsv(
    reconstructions: readonly TradeReconstruction[],
    options: ExportOptions,
  ): string {
    const lines: string[] = [];

    // Header.
    const headers = [
      "reconstructionId",
      "tradeId",
      "strategyId",
      "regime",
      "venue",
      "symbol",
      "side",
      "finalPnlUsd",
      "feesUsd",
      "slippageUsd",
      "hasIncidentFlags",
      "incidentFlags",
      "lessons",
    ];
    lines.push(headers.join(","));

    for (const recon of reconstructions) {
      const row = [
        this.csvEscape(recon.reconstructionId),
        this.csvEscape(recon.tradeId),
        this.csvEscape(recon.strategyId),
        this.csvEscape(recon.regime),
        this.csvEscape(recon.venue),
        this.csvEscape(recon.symbol),
        recon.side,
        recon.finalPnlUsd.toString(),
        recon.feesUsd.toString(),
        recon.slippageUsd.toString(),
        recon.hasIncidentFlags.toString(),
        this.csvEscape(recon.incidentFlags.join(";")),
        this.csvEscape(recon.lessons.join(";")),
      ];
      lines.push(row.join(","));
    }

    return lines.join("\n");
  }

  // ── Reconstruction Export: TXT ─────────────────────────────────

  private exportReconstructionsTxt(
    reconstructions: readonly TradeReconstruction[],
    options: ExportOptions,
  ): string {
    const lines: string[] = [];
    const separator = "=".repeat(72);
    const thinSep = "-".repeat(72);

    lines.push(separator);
    lines.push("  TRADE RECONSTRUCTION REPORT");
    lines.push(separator);
    lines.push(
      `  Total Reconstructions: ${reconstructions.length}`,
    );
    lines.push(separator);
    lines.push("");

    for (const recon of reconstructions) {
      lines.push(thinSep);
      lines.push(`  Trade: ${recon.tradeId}`);
      lines.push(thinSep);
      lines.push(`  Strategy:    ${recon.strategyId}`);
      lines.push(`  Regime:      ${recon.regime}`);
      lines.push(`  Venue:       ${recon.venue}`);
      lines.push(`  Symbol:      ${recon.symbol}`);
      lines.push(`  Side:        ${recon.side}`);
      lines.push(`  Final PnL:   $${recon.finalPnlUsd.toFixed(2)}`);
      lines.push(`  Fees:        $${recon.feesUsd.toFixed(2)}`);
      lines.push(`  Slippage:    $${recon.slippageUsd.toFixed(2)}`);
      lines.push(
        `  Incidents:   ${recon.hasIncidentFlags ? recon.incidentFlags.join(", ") : "none"}`,
      );
      lines.push(
        `  Lessons:     ${recon.lessons.length > 0 ? recon.lessons.join("; ") : "none"}`,
      );
      lines.push("");

      // Timeline.
      if (options.includeTimeline && recon.timeline.length > 0) {
        lines.push("  TIMELINE");
        for (const event of recon.timeline) {
          const codes =
            event.reasonCodes.length > 0
              ? ` [${event.reasonCodes.join(", ")}]`
              : "";
          const actor = (event.data["actor"] as string) ?? "unknown";
          lines.push(
            `    ${this.formatTimestamp(event.timestampMs)} | ${event.phase.padEnd(25)} | ${actor}${codes}`,
          );
        }
      }

      lines.push("");
    }

    lines.push(separator);
    return lines.join("\n");
  }

  // ── Helpers ────────────────────────────────────────────────────

  /**
   * Build a clean data object for JSON export.
   */
  private buildReportData(
    report: TradeReport,
    options: ExportOptions,
  ): Record<string, unknown> {
    const data: Record<string, unknown> = {
      reportId: report.reportId,
      period: report.period,
      periodStartMs: report.periodStartMs,
      periodEndMs: report.periodEndMs,
      generatedAtMs: report.generatedAtMs,
      summary: {
        totalTrades: report.totalTrades,
        winCount: report.winCount,
        lossCount: report.lossCount,
        breakevenCount: report.breakevenCount,
        winRate: report.winRate,
        totalNetPnlUsd: report.totalNetPnlUsd,
        totalFeesUsd: report.totalFeesUsd,
        totalSlippageUsd: report.totalSlippageUsd,
        avgNetPnlUsd: report.avgNetPnlUsd,
        maxDrawdownUsd: report.maxDrawdownUsd,
        bestTradePnlUsd: report.bestTradePnlUsd,
        worstTradePnlUsd: report.worstTradePnlUsd,
        incidentCount: report.incidentCount,
      },
      strategyBreakdown: report.strategyBreakdown,
      venueBreakdown: report.venueBreakdown,
    };

    if (options.includeEntries) {
      data.entries = options.includeReasonCodes
        ? report.entries
        : report.entries.map(({ reasonCodes: _, ...rest }) => rest);
    }

    return data;
  }

  /**
   * Build a clean data object for JSON export of a reconstruction.
   */
  private buildReconstructionData(
    recon: TradeReconstruction,
    options: ExportOptions,
  ): Record<string, unknown> {
    const data: Record<string, unknown> = {
      reconstructionId: recon.reconstructionId,
      tradeId: recon.tradeId,
      strategyId: recon.strategyId,
      regime: recon.regime,
      venue: recon.venue,
      symbol: recon.symbol,
      side: recon.side,
      finalPnlUsd: recon.finalPnlUsd,
      feesUsd: recon.feesUsd,
      slippageUsd: recon.slippageUsd,
      hasIncidentFlags: recon.hasIncidentFlags,
      incidentFlags: recon.incidentFlags,
      lessons: recon.lessons,
      reconstructedAtMs: recon.reconstructedAtMs,
    };

    if (options.includeTimeline) {
      data.timeline = options.includeReasonCodes
        ? recon.timeline
        : recon.timeline.map(({ reasonCodes: _, ...rest }) => rest);
    }

    return data;
  }

  /**
   * Escape a value for CSV (wrap in quotes if it contains commas or quotes).
   */
  private csvEscape(value: string): string {
    if (value.includes(",") || value.includes('"') || value.includes("\n")) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }

  /**
   * Format a Unix ms timestamp to a human-readable string.
   */
  private formatTimestamp(ms: number): string {
    return new Date(ms).toISOString().replace("T", " ").replace("Z", "");
  }
}
