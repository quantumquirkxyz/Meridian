/**
 * Harness evidence gate (issue #21 AC4). No hypothesis passes to Beta
 * without harness evidence that meets minimum performance criteria.
 *
 * This is the active enforcement layer on top of PerformanceReport:
 * downstream consumers call `harnessEvidenceApproved` to determine
 * whether a backtest result qualifies for promotion.
 */

import type { PerformanceReport } from "./report.ts";

/** Minimum criteria a PerformanceReport must meet to pass the gate. */
export interface HarnessGateCriteria {
  /** Minimum number of filled trades. Default: 10. */
  minFilledTrades?: number;
  /** Minimum win rate. Default: 0.3. */
  minWinRate?: number;
  /** Minimum profit factor. Default: 1.0. */
  minProfitFactor?: number;
  /** Maximum allowed max drawdown as fraction of initial capital. Default: 0.5. */
  maxDrawdownPct?: number;
  /** Minimum expected value per trade (USD). Default: 0. */
  minExpectedValueUsd?: number;
  /** Maximum allowed failure rate. Default: 0.5. */
  maxFailureRate?: number;
}

export interface HarnessGateResult {
  /** Whether the report passes all criteria. */
  approved: boolean;
  /** List of criteria that failed (empty when approved). */
  failures: string[];
}

const DEFAULT_CRITERIA: Required<HarnessGateCriteria> = {
  minFilledTrades: 10,
  minWinRate: 0.3,
  minProfitFactor: 1.0,
  maxDrawdownPct: 0.5,
  minExpectedValueUsd: 0,
  maxFailureRate: 0.5,
};

/**
 * Evaluate whether a PerformanceReport meets minimum harness evidence
 * criteria for promotion to Beta.
 *
 * Returns a HarnessGateResult with `approved: true` when all criteria
 * pass, or `approved: false` with a list of specific failures.
 */
export function harnessEvidenceApproved(
  report: PerformanceReport,
  criteria: HarnessGateCriteria = {},
): HarnessGateResult {
  const c = { ...DEFAULT_CRITERIA, ...criteria };
  const failures: string[] = [];

  if (report.filledTrades < c.minFilledTrades) {
    failures.push(
      `filledTrades ${report.filledTrades} < min ${c.minFilledTrades}`,
    );
  }

  if (report.winRate < c.minWinRate) {
    failures.push(
      `winRate ${report.winRate.toFixed(3)} < min ${c.minWinRate}`,
    );
  }

  if (report.profitFactor < c.minProfitFactor) {
    failures.push(
      `profitFactor ${report.profitFactor.toFixed(3)} < min ${c.minProfitFactor}`,
    );
  }

  if (report.maxDrawdownPct > c.maxDrawdownPct) {
    failures.push(
      `maxDrawdownPct ${report.maxDrawdownPct.toFixed(3)} > max ${c.maxDrawdownPct}`,
    );
  }

  if (report.expectedValueUsd < c.minExpectedValueUsd) {
    failures.push(
      `expectedValueUsd ${report.expectedValueUsd.toFixed(2)} < min ${c.minExpectedValueUsd}`,
    );
  }

  if (report.failureRate > c.maxFailureRate) {
    failures.push(
      `failureRate ${report.failureRate.toFixed(3)} > max ${c.maxFailureRate}`,
    );
  }

  return {
    approved: failures.length === 0,
    failures,
  };
}
