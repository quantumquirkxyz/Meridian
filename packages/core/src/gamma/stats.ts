/**
 * Shared statistical helpers for the governed learning loop.
 *
 * Pure functions used by TradeJournal and EdgeDecayDetector to compute
 * performance metrics without duplication.
 */

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const avg = mean(values);
  const squaredDiffs = values.map((v) => (v - avg) ** 2);
  return Math.sqrt(mean(squaredDiffs));
}

export function computeSharpe(pnlValues: number[]): number {
  if (pnlValues.length < 2) return 0;
  const avg = mean(pnlValues);
  const sd = stddev(pnlValues);
  if (sd === 0) return avg > 0 ? 1.0 : avg < 0 ? -1.0 : 0;
  return avg / sd;
}

export function computeProfitFactor(pnlValues: number[]): number {
  const grossProfit = pnlValues
    .filter((p) => p > 0)
    .reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(
    pnlValues.filter((p) => p < 0).reduce((a, b) => a + b, 0),
  );
  if (grossLoss === 0) return grossProfit > 0 ? Infinity : 0;
  return grossProfit / grossLoss;
}

export function computeMaxDrawdown(pnlValues: number[]): number {
  let peak = 0;
  let maxDd = 0;
  let cumulative = 0;
  for (const pnl of pnlValues) {
    cumulative += pnl;
    if (cumulative > peak) peak = cumulative;
    const dd = peak - cumulative;
    if (dd > maxDd) maxDd = dd;
  }
  return maxDd;
}
