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

// ── Severity Classification ──────────────────────────────────────────

/**
 * Severity threshold configuration for decay detection.
 */
export interface SeverityThresholds {
  low: number;
  medium: number;
  high: number;
  critical: number;
}

/**
 * Classify a metric value against severity thresholds.
 * Returns the severity level if the value crosses any threshold,
 * or null if no threshold is crossed.
 *
 * Thresholds are checked from most severe to least: if the value
 * is <= critical, it's "critical"; else if <= high, it's "high";
 * etc. This assumes lower values indicate worse performance.
 */
export function classifySeverity(
  value: number,
  thresholds: SeverityThresholds,
): "low" | "medium" | "high" | "critical" | null {
  if (value <= thresholds.critical) return "critical";
  if (value <= thresholds.high) return "high";
  if (value <= thresholds.medium) return "medium";
  if (value <= thresholds.low) return "low";
  return null;
}

/**
 * Return the worse (more severe) of two severity levels.
 * Returns null if both are null.
 */
export function worstSeverity(
  a: "low" | "medium" | "high" | "critical" | null,
  b: "low" | "medium" | "high" | "critical" | null,
): "low" | "medium" | "high" | "critical" | null {
  const rank = { low: 1, medium: 2, high: 3, critical: 4 };
  if (a === null) return b;
  if (b === null) return a;
  return rank[a] >= rank[b] ? a : b;
}
