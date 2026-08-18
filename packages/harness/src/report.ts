/**
 * Performance reporter (issue #21 AC4). Computes comprehensive performance
 * metrics from backtest results: gross/net PnL, max drawdown, win rate,
 * profit factor, expected value, fill ratio, and tail losses.
 *
 * This is the evidence layer — no hypothesis passes to Beta without
 * harness evidence produced by this reporter.
 */

import type { BacktestResult, BacktestTrade } from "./backtest.ts";

/** Comprehensive performance report. */
export interface PerformanceReport {
  /** Seed used for this backtest (reproducibility proof). */
  seed: number;
  /** Total number of trades. */
  totalTrades: number;
  /** Number of filled trades. */
  filledTrades: number;
  /** Fill ratio (filled / total). */
  fillRatio: number;

  // ── PnL ────────────────────────────────────────────────────────
  /** Total gross PnL (before costs). */
  grossPnlUsd: number;
  /** Total costs (fees + slippage + gas + funding + latency). */
  totalCostsUsd: number;
  /** Net PnL (after all costs). */
  netPnlUsd: number;
  /** Average net PnL per trade. */
  avgPnlPerTradeUsd: number;

  // ── Drawdown ───────────────────────────────────────────────────
  /** Maximum drawdown in USD. */
  maxDrawdownUsd: number;
  /** Maximum drawdown as percentage of peak equity. */
  maxDrawdownPct: number;
  /** Peak equity (highest capital point). */
  peakEquityUsd: number;

  // ── Win/Loss ───────────────────────────────────────────────────
  /** Number of profitable trades. */
  winningTrades: number;
  /** Number of losing trades. */
  losingTrades: number;
  /** Win rate (winning / filled trades). */
  winRate: number;
  /** Average winning trade PnL. */
  avgWinUsd: number;
  /** Average losing trade PnL. */
  avgLossUsd: number;
  /** Largest single winning trade. */
  maxWinUsd: number;
  /** Largest single losing trade. */
  maxLossUsd: number;

  // ── Risk Metrics ───────────────────────────────────────────────
  /** Profit factor (gross wins / gross losses). */
  profitFactor: number;
  /** Expected value per trade (avg win * win rate + avg loss * loss rate). */
  expectedValueUsd: number;
  /** Payoff ratio (avg win / abs(avg loss)). */
  payoffRatio: number;

  // ── Tail Losses ────────────────────────────────────────────────
  /** 95th percentile loss (worst 5% of trades). */
  tailLoss95Usd: number;
  /** 99th percentile loss (worst 1% of trades). */
  tailLoss99Usd: number;
  /** Value at Risk (95% confidence). */
  var95Usd: number;
  /** Conditional Value at Risk (expected loss beyond VaR). */
  cvar95Usd: number;

  // ── Cost Breakdown ─────────────────────────────────────────────
  /** Total slippage cost. */
  totalSlippageUsd: number;
  /** Total gas cost. */
  totalGasUsd: number;
  /** Total funding cost. */
  totalFundingUsd: number;
  /** Total latency cost. */
  totalLatencyCostUsd: number;

  // ── Failure ────────────────────────────────────────────────────
  /** Total failures encountered. */
  totalFailures: number;
  /** Failure rate. */
  failureRate: number;
}

/**
 * Compute a comprehensive performance report from a backtest result.
 */
export function computePerformanceReport(result: BacktestResult): PerformanceReport {
  const { trades, initialCapitalUsd } = extractBacktestMetrics(result);

  const filledTrades = trades.filter((t) => t.fill.filled);
  const totalTrades = trades.length;

  // ── PnL ──────────────────────────────────────────────────────────
  const grossPnlUsd = filledTrades.reduce(
    (sum, t) => sum + t.candidate.expectedNetProfitUsd * t.fill.fillRatio,
    0,
  );
  const totalCostsUsd = trades.reduce(
    (sum, t) =>
      sum + t.fill.slippageUsd + t.gas.gasCostUsd + t.latency.latencyCostUsd,
    0,
  );
  const netPnlUsd = result.netPnlUsd;
  const avgPnlPerTradeUsd = totalTrades > 0 ? netPnlUsd / totalTrades : 0;

  // ── Drawdown ─────────────────────────────────────────────────────
  const { maxDrawdownUsd, maxDrawdownPct, peakEquityUsd } =
    computeDrawdown(trades, initialCapitalUsd);

  // ── Win/Loss ─────────────────────────────────────────────────────
  const winningTrades = filledTrades.filter((t) => t.netPnlUsd > 0);
  const losingTrades = filledTrades.filter((t) => t.netPnlUsd <= 0);
  const winRate =
    filledTrades.length > 0 ? winningTrades.length / filledTrades.length : 0;
  const avgWinUsd =
    winningTrades.length > 0
      ? winningTrades.reduce((sum, t) => sum + t.netPnlUsd, 0) /
        winningTrades.length
      : 0;
  const avgLossUsd =
    losingTrades.length > 0
      ? losingTrades.reduce((sum, t) => sum + t.netPnlUsd, 0) /
        losingTrades.length
      : 0;
  const maxWinUsd = winningTrades.length > 0
    ? Math.max(...winningTrades.map((t) => t.netPnlUsd))
    : 0;
  const maxLossUsd = losingTrades.length > 0
    ? Math.min(...losingTrades.map((t) => t.netPnlUsd))
    : 0;

  // ── Risk Metrics ─────────────────────────────────────────────────
  const grossWins = winningTrades.reduce((sum, t) => sum + t.netPnlUsd, 0);
  const grossLosses = Math.abs(
    losingTrades.reduce((sum, t) => sum + t.netPnlUsd, 0),
  );
  const profitFactor = grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Infinity : 0;
  const expectedValueUsd = avgPnlPerTradeUsd;
  const payoffRatio = avgLossUsd !== 0 ? Math.abs(avgWinUsd / avgLossUsd) : 0;

  // ── Tail Losses ──────────────────────────────────────────────────
  const sortedPnl = filledTrades
    .map((t) => t.netPnlUsd)
    .sort((a, b) => a - b);
  const { tailLoss95Usd, tailLoss99Usd, var95Usd, cvar95Usd } =
    computeTailLosses(sortedPnl);

  // ── Cost Breakdown ───────────────────────────────────────────────
  const totalSlippageUsd = trades.reduce((sum, t) => sum + t.fill.slippageUsd, 0);
  const totalGasUsd = trades.reduce((sum, t) => sum + t.gas.gasCostUsd, 0);
  const totalFundingUsd = trades.reduce(
    (sum, t) => sum + (t.funding?.fundingCostUsd ?? 0),
    0,
  );
  const totalLatencyCostUsd = trades.reduce(
    (sum, t) => sum + t.latency.latencyCostUsd,
    0,
  );

  // ── Failure ──────────────────────────────────────────────────────
  const totalFailures = trades.filter((t) => t.failure?.failed).length;
  const failureRate = totalTrades > 0 ? totalFailures / totalTrades : 0;

  return {
    seed: result.seed,
    totalTrades,
    filledTrades: filledTrades.length,
    fillRatio: result.fillRatio,
    grossPnlUsd,
    totalCostsUsd,
    netPnlUsd,
    avgPnlPerTradeUsd,
    maxDrawdownUsd,
    maxDrawdownPct,
    peakEquityUsd,
    winningTrades: winningTrades.length,
    losingTrades: losingTrades.length,
    winRate,
    avgWinUsd,
    avgLossUsd,
    maxWinUsd,
    maxLossUsd,
    profitFactor,
    expectedValueUsd,
    payoffRatio,
    tailLoss95Usd,
    tailLoss99Usd,
    var95Usd,
    cvar95Usd,
    totalSlippageUsd,
    totalGasUsd,
    totalFundingUsd,
    totalLatencyCostUsd,
    totalFailures,
    failureRate,
  };
}

// ── Helpers ────────────────────────────────────────────────────────

function extractBacktestMetrics(result: BacktestResult) {
  // Initial capital is not directly in BacktestResult; derive from finalCapitalUsd - netPnlUsd.
  const initialCapitalUsd = result.finalCapitalUsd - result.netPnlUsd;
  return { trades: result.trades, initialCapitalUsd };
}

function computeDrawdown(
  trades: BacktestTrade[],
  initialCapitalUsd: number,
): {
  maxDrawdownUsd: number;
  maxDrawdownPct: number;
  peakEquityUsd: number;
} {
  let equity = initialCapitalUsd;
  let peak = equity;
  let maxDrawdownUsd = 0;
  let maxDrawdownPct = 0;

  for (const trade of trades) {
    equity += trade.netPnlUsd;
    if (equity > peak) peak = equity;

    const drawdownUsd = peak - equity;
    const drawdownPct = peak > 0 ? drawdownUsd / peak : 0;

    if (drawdownUsd > maxDrawdownUsd) maxDrawdownUsd = drawdownUsd;
    if (drawdownPct > maxDrawdownPct) maxDrawdownPct = drawdownPct;
  }

  return {
    maxDrawdownUsd,
    maxDrawdownPct,
    peakEquityUsd: peak,
  };
}

function computeTailLosses(sortedPnl: number[]): {
  tailLoss95Usd: number;
  tailLoss99Usd: number;
  var95Usd: number;
  cvar95Usd: number;
} {
  if (sortedPnl.length === 0) {
    return { tailLoss95Usd: 0, tailLoss99Usd: 0, var95Usd: 0, cvar95Usd: 0 };
  }

  // Percentile index (from the sorted ascending list).
  const idx95 = Math.floor(sortedPnl.length * 0.05);
  const idx99 = Math.floor(sortedPnl.length * 0.01);

  const tailLoss95Usd = sortedPnl[idx95] ?? sortedPnl[0];
  const tailLoss99Usd = sortedPnl[idx99] ?? sortedPnl[0];

  // VaR95: the loss at the 5th percentile (most negative value in the worst 5%).
  const var95Usd = -tailLoss95Usd; // VaR is positive when there's a loss

  // CVaR95: average of all losses beyond VaR95.
  const tailSlice = sortedPnl.slice(0, idx95 + 1);
  const cvar95Usd =
    tailSlice.length > 0
      ? -tailSlice.reduce((sum, v) => sum + v, 0) / tailSlice.length
      : 0;

  return { tailLoss95Usd, tailLoss99Usd, var95Usd, cvar95Usd };
}
