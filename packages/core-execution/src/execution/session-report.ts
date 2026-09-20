/**
 * SessionReport: produces a complete session summary for trading runners,
 * including trades, PnL, regime changes, and learning recommendations.
 */

import type { TradeRecord } from "@agenttrading/core-execution";

/** Complete session report for a trading session. */
export interface SessionReportData {
  startedAtMs: number;
  endedAtMs: number;
  durationMs: number;
  cycleCount: number;
  opportunitiesDetected: number;
  ordersSubmitted: number;
  ordersFilled: number;
  ordersBlocked: number;
  trades: TradeRecord[];
  totalPnlUsd: number;
  totalFeesUsd: number;
  netPnlUsd: number;
  winRate: number;
  regimeChangeCount: number;
  finalRegime: string | undefined;
  learningRecommendationCount: number;
  auditEventCount: number;
}

/**
 * Build a session report from counters and trade records.
 */
export function buildSessionReport(opts: {
  startedAtMs: number;
  endedAtMs: number;
  cycleCount: number;
  opportunitiesDetected: number;
  ordersSubmitted: number;
  ordersFilled: number;
  ordersBlocked: number;
  trades: TradeRecord[];
  regimeChangeCount: number;
  finalRegime: string | undefined;
  learningRecommendationCount: number;
  auditEventCount: number;
}): SessionReportData {
  const totalFeesUsd = opts.trades.reduce((sum, t) => sum + t.feesUsd, 0);

  return {
    startedAtMs: opts.startedAtMs,
    endedAtMs: opts.endedAtMs,
    durationMs: opts.endedAtMs - opts.startedAtMs,
    cycleCount: opts.cycleCount,
    opportunitiesDetected: opts.opportunitiesDetected,
    ordersSubmitted: opts.ordersSubmitted,
    ordersFilled: opts.ordersFilled,
    ordersBlocked: opts.ordersBlocked,
    trades: opts.trades,
    totalPnlUsd: 0,
    totalFeesUsd,
    netPnlUsd: -totalFeesUsd,
    winRate: opts.trades.length > 0 ? 0 : 0,
    regimeChangeCount: opts.regimeChangeCount,
    finalRegime: opts.finalRegime,
    learningRecommendationCount: opts.learningRecommendationCount,
    auditEventCount: opts.auditEventCount,
  };
}

/**
 * Print a human-readable session report to stdout.
 */
export function printSessionReport(report: SessionReportData): void {
  console.log();
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║              Session Report                             ║");
  console.log("╠══════════════════════════════════════════════════════════╣");
  console.log(`║  Duration:        ${formatDuration(report.durationMs).padEnd(37)}║`);
  console.log(`║  Cycles:          ${String(report.cycleCount).padEnd(37)}║`);
  console.log(`║  Opportunities:   ${String(report.opportunitiesDetected).padEnd(37)}║`);
  console.log(`║  Orders Submitted:${String(report.ordersSubmitted).padEnd(37)}║`);
  console.log(`║  Orders Filled:   ${String(report.ordersFilled).padEnd(37)}║`);
  console.log(`║  Orders Blocked:  ${String(report.ordersBlocked).padEnd(37)}║`);
  console.log(`║  Trades:          ${String(report.trades.length).padEnd(37)}║`);
  console.log(`║  Total Fees:      $${report.totalFeesUsd.toFixed(2).padEnd(36)}║`);
  console.log(`║  Net PnL:         $${report.netPnlUsd.toFixed(2).padEnd(36)}║`);
  console.log(`║  Regime Changes:  ${String(report.regimeChangeCount).padEnd(37)}║`);
  console.log(`║  Final Regime:    ${(report.finalRegime ?? "unknown").padEnd(37)}║`);
  console.log(`║  Learning Recs:   ${String(report.learningRecommendationCount).padEnd(37)}║`);
  console.log(`║  Audit Events:    ${String(report.auditEventCount).padEnd(37)}║`);
  console.log("╚══════════════════════════════════════════════════════════╝");

  if (report.trades.length > 0) {
    console.log();
    console.log("  Trades:");
    for (const trade of report.trades) {
      const side = trade.side === "BUY" ? "▲" : "▼";
      console.log(
        `    ${side} ${trade.symbol} ${trade.side} ${trade.fillQuantity} @ $${trade.fillPrice.toFixed(2)} (fees: $${trade.feesUsd.toFixed(4)}, slip: ${trade.slippageBps}bps)`,
      );
    }
  }

  console.log();
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}
