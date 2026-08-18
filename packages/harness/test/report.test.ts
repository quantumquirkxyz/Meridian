import { describe, expect, test } from "bun:test";
import { computePerformanceReport } from "../src/report.ts";
import type { BacktestResult } from "../src/backtest.ts";

// ── Helpers ────────────────────────────────────────────────────────

function makeBacktestResult(
  overrides: Partial<BacktestResult> = {},
): BacktestResult {
  return {
    seed: 42,
    trades: [],
    graphSnapshot: {
      version: 1,
      snapshotId: "snap:test",
      createdAtMs: Date.now(),
      nodes: [],
      edges: [],
    },
    totalTrades: 0,
    filledTrades: 0,
    failedTrades: 0,
    grossPnlUsd: 0,
    totalCostsUsd: 0,
    netPnlUsd: 0,
    initialCapitalUsd: 10_000,
    finalCapitalUsd: 10_000,
    fillRatio: 0,
    finalRngState: 0,
    ...overrides,
  };
}

function makeTrade(overrides: Record<string, any> = {}) {
  return {
    candidate: {
      id: "opp:1",
      snapshotId: "snap:1",
      route: ["a", "b"],
      grossSpreadUsd: 100,
      costs: {
        tradingFeesUsd: 5,
        slippageUsd: 2,
        gasUsd: 1,
        bridgeCostUsd: 0,
        fundingCostUsd: 0,
        latencyRiskUsd: 0.5,
        failureRiskUsd: 1,
        safetyBufferUsd: 2,
      },
      expectedNetProfitUsd: 88.5,
      createdAtMs: Date.now(),
      status: "CANDIDATE" as const,
    },
    intent: {
      idempotencyKey: "ik:1",
      opportunityId: "opp:1",
      venue: "bybit",
      symbol: "BTC/USDT",
      side: "BUY" as const,
      quantity: 0.1,
      price: 42_000,
      quoteCurrency: "USDT",
      createdAtMs: Date.now(),
      expiresAtMs: Date.now() + 30_000,
      limits: { maxSlippageBps: 500 },
    },
    fill: {
      filled: true,
      fillRatio: 1,
      fillPrice: 42_005,
      filledQuantity: 0.1,
      slippageUsd: 0.5,
      slippageBps: 1.2,
    },
    gas: {
      gasUnits: 150_000,
      gasPriceGwei: 25,
      gasCostUsd: 9.375,
      congestionMultiplier: 1.25,
      gasSpike: false,
    },
    latency: {
      latencyMs: 100,
      latencyCostUsd: 0.1,
      spike: false,
      exceededDeadline: false,
    },
    netPnlUsd: 78.525,
    timestampMs: Date.now(),
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────

describe("PerformanceReport", () => {
  test("empty backtest produces zero metrics", () => {
    const result = makeBacktestResult();
    const report = computePerformanceReport(result);

    expect(report.totalTrades).toBe(0);
    expect(report.filledTrades).toBe(0);
    expect(report.fillRatio).toBe(0);
    expect(report.netPnlUsd).toBe(0);
    expect(report.winRate).toBe(0);
    expect(report.maxDrawdownUsd).toBe(0);
  });

  test("computes correct win rate", () => {
    const trades = [
      makeTrade({ netPnlUsd: 100 }),
      makeTrade({ netPnlUsd: 50 }),
      makeTrade({ netPnlUsd: -30 }),
    ];
    const result = makeBacktestResult({
      trades,
      totalTrades: 3,
      filledTrades: 3,
      finalCapitalUsd: 10_120,
      netPnlUsd: 120,
    });

    const report = computePerformanceReport(result);
    expect(report.winningTrades).toBe(2);
    expect(report.losingTrades).toBe(1);
    expect(report.winRate).toBeCloseTo(2 / 3, 4);
  });

  test("computes correct profit factor", () => {
    const trades = [
      makeTrade({ netPnlUsd: 200 }),
      makeTrade({ netPnlUsd: 100 }),
      makeTrade({ netPnlUsd: -50 }),
      makeTrade({ netPnlUsd: -30 }),
    ];
    const result = makeBacktestResult({
      trades,
      totalTrades: 4,
      filledTrades: 4,
      finalCapitalUsd: 10_220,
      netPnlUsd: 220,
    });

    const report = computePerformanceReport(result);
    // profitFactor = 300 / 80 = 3.75
    expect(report.profitFactor).toBeCloseTo(3.75, 2);
  });

  test("computes max drawdown", () => {
    const trades = [
      makeTrade({ netPnlUsd: 100 }),  // equity: 10100
      makeTrade({ netPnlUsd: -200 }), // equity: 9900 (drawdown: 200)
      makeTrade({ netPnlUsd: -100 }), // equity: 9800 (drawdown: 300)
      makeTrade({ netPnlUsd: 50 }),   // equity: 9850
    ];
    const result = makeBacktestResult({
      trades,
      totalTrades: 4,
      filledTrades: 4,
      finalCapitalUsd: 9_850,
      netPnlUsd: -150,
    });

    const report = computePerformanceReport(result);
    expect(report.maxDrawdownUsd).toBe(300);
    expect(report.maxDrawdownPct).toBeCloseTo(300 / 10_100, 4);
  });

  test("computes tail losses", () => {
    // Create 100 trades with known PnL distribution.
    const trades = Array.from({ length: 100 }, (_, i) =>
      makeTrade({ netPnlUsd: i - 50 }), // -50 to +49
    );
    const totalPnl = trades.reduce((sum, t) => sum + t.netPnlUsd, 0);
    const result = makeBacktestResult({
      trades,
      totalTrades: 100,
      filledTrades: 100,
      finalCapitalUsd: 10_000 + totalPnl,
      netPnlUsd: totalPnl,
    });

    const report = computePerformanceReport(result);
    // Worst 5 trades are: -50, -49, -48, -47, -46
    expect(report.tailLoss95Usd).toBeLessThanOrEqual(0);
    // VaR should be positive (it's the loss amount).
    expect(report.var95Usd).toBeGreaterThanOrEqual(0);
    // CVaR should be >= VaR.
    expect(report.cvar95Usd).toBeGreaterThanOrEqual(report.var95Usd);
  });

  test("computes cost breakdown", () => {
    const trades = [
      makeTrade({
        fill: {
          filled: true,
          fillRatio: 1,
          fillPrice: 42_005,
          filledQuantity: 0.1,
          slippageUsd: 5,
          slippageBps: 12,
        },
        gas: {
          gasUnits: 150_000,
          gasPriceGwei: 25,
          gasCostUsd: 10,
          congestionMultiplier: 1.25,
          gasSpike: false,
        },
        latency: {
          latencyMs: 100,
          latencyCostUsd: 0.1,
          spike: false,
          exceededDeadline: false,
        },
      }),
    ];
    const result = makeBacktestResult({
      trades,
      totalTrades: 1,
      filledTrades: 1,
      finalCapitalUsd: 10_000,
      netPnlUsd: 0,
    });

    const report = computePerformanceReport(result);
    expect(report.totalSlippageUsd).toBe(5);
    expect(report.totalGasUsd).toBe(10);
    expect(report.totalLatencyCostUsd).toBe(0.1);
  });

  test("fillRatio matches input", () => {
    const result = makeBacktestResult({
      fillRatio: 0.75,
    });
    const report = computePerformanceReport(result);
    expect(report.fillRatio).toBe(0.75);
  });

  test("expectedValueUsd equals avgPnlPerTradeUsd", () => {
    const trades = [
      makeTrade({ netPnlUsd: 100 }),
      makeTrade({ netPnlUsd: -50 }),
    ];
    const result = makeBacktestResult({
      trades,
      totalTrades: 2,
      filledTrades: 2,
      finalCapitalUsd: 10_050,
      netPnlUsd: 50,
    });

    const report = computePerformanceReport(result);
    expect(report.expectedValueUsd).toBe(report.avgPnlPerTradeUsd);
  });

  test("failureRate is computed correctly", () => {
    const trades = [
      makeTrade({ failure: { failed: true, failureType: "API_TIMEOUT", retryable: true, retryDelayMs: 1000, cascade: false, message: "timeout" } }),
      makeTrade({}),
      makeTrade({ failure: { failed: true, failureType: "RPC_FAILURE", retryable: false, retryDelayMs: 0, cascade: false, message: "rpc fail" } }),
    ];
    const result = makeBacktestResult({
      trades,
      totalTrades: 3,
      filledTrades: 3,
      finalCapitalUsd: 10_000,
      netPnlUsd: 0,
    });

    const report = computePerformanceReport(result);
    expect(report.totalFailures).toBe(2);
    expect(report.failureRate).toBeCloseTo(2 / 3, 4);
  });

  test("payoffRatio is avgWin / abs(avgLoss)", () => {
    const trades = [
      makeTrade({ netPnlUsd: 200 }),
      makeTrade({ netPnlUsd: -100 }),
    ];
    const result = makeBacktestResult({
      trades,
      totalTrades: 2,
      filledTrades: 2,
      finalCapitalUsd: 10_100,
      netPnlUsd: 100,
    });

    const report = computePerformanceReport(result);
    // avgWin = 200, avgLoss = -100, payoffRatio = 200/100 = 2
    expect(report.payoffRatio).toBeCloseTo(2, 4);
  });
});
