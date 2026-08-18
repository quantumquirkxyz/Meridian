import { describe, expect, test } from "bun:test";
import { harnessEvidenceApproved } from "../src/gate.ts";
import type { PerformanceReport } from "../src/report.ts";
import { createSeededRng } from "../src/seed.ts";
import { FillSimulator } from "../src/simulators/fill.ts";

// ── Helpers ────────────────────────────────────────────────────────

function makeReport(overrides: Partial<PerformanceReport> = {}): PerformanceReport {
  return {
    seed: 42,
    totalTrades: 100,
    filledTrades: 80,
    fillRatio: 0.8,
    grossPnlUsd: 5000,
    totalCostsUsd: 2000,
    netPnlUsd: 3000,
    avgPnlPerTradeUsd: 30,
    maxDrawdownUsd: 1000,
    maxDrawdownPct: 0.1,
    peakEquityUsd: 13_000,
    winningTrades: 50,
    losingTrades: 30,
    winRate: 0.625,
    avgWinUsd: 100,
    avgLossUsd: -66.67,
    maxWinUsd: 500,
    maxLossUsd: -200,
    profitFactor: 2.5,
    expectedValueUsd: 30,
    payoffRatio: 1.5,
    tailLoss95Usd: -150,
    tailLoss99Usd: -200,
    var95Usd: 150,
    cvar95Usd: 175,
    totalSlippageUsd: 500,
    totalGasUsd: 800,
    totalFundingUsd: 200,
    totalLatencyCostUsd: 100,
    totalFailures: 5,
    failureRate: 0.05,
    ...overrides,
  };
}

// ── harnessEvidenceApproved ────────────────────────────────────────

describe("harnessEvidenceApproved", () => {
  test("approves a report meeting all default criteria", () => {
    const report = makeReport();
    const result = harnessEvidenceApproved(report);
    expect(result.approved).toBe(true);
    expect(result.failures).toHaveLength(0);
  });

  test("rejects when filledTrades < minFilledTrades", () => {
    const report = makeReport({ filledTrades: 5 });
    const result = harnessEvidenceApproved(report);
    expect(result.approved).toBe(false);
    expect(result.failures.some((f) => f.includes("filledTrades"))).toBe(true);
  });

  test("rejects when winRate < minWinRate", () => {
    const report = makeReport({ winRate: 0.1 });
    const result = harnessEvidenceApproved(report);
    expect(result.approved).toBe(false);
    expect(result.failures.some((f) => f.includes("winRate"))).toBe(true);
  });

  test("rejects when profitFactor < minProfitFactor", () => {
    const report = makeReport({ profitFactor: 0.5 });
    const result = harnessEvidenceApproved(report);
    expect(result.approved).toBe(false);
    expect(result.failures.some((f) => f.includes("profitFactor"))).toBe(true);
  });

  test("rejects when maxDrawdownPct > maxDrawdownPct", () => {
    const report = makeReport({ maxDrawdownPct: 0.7 });
    const result = harnessEvidenceApproved(report);
    expect(result.approved).toBe(false);
    expect(result.failures.some((f) => f.includes("maxDrawdownPct"))).toBe(true);
  });

  test("rejects when failureRate > maxFailureRate", () => {
    const report = makeReport({ failureRate: 0.8 });
    const result = harnessEvidenceApproved(report);
    expect(result.approved).toBe(false);
    expect(result.failures.some((f) => f.includes("failureRate"))).toBe(true);
  });

  test("rejects when expectedValueUsd < minExpectedValueUsd", () => {
    const report = makeReport({ expectedValueUsd: -10 });
    const result = harnessEvidenceApproved(report);
    expect(result.approved).toBe(false);
    expect(result.failures.some((f) => f.includes("expectedValueUsd"))).toBe(true);
  });

  test("custom criteria override defaults", () => {
    // Default would reject this (filledTrades=5 < 10), but custom min=3 passes.
    const report = makeReport({ filledTrades: 5 });
    const result = harnessEvidenceApproved(report, { minFilledTrades: 3 });
    expect(result.approved).toBe(true);
  });

  test("reports multiple failures", () => {
    const report = makeReport({
      filledTrades: 2,
      winRate: 0.05,
      profitFactor: 0.1,
    });
    const result = harnessEvidenceApproved(report);
    expect(result.approved).toBe(false);
    expect(result.failures.length).toBeGreaterThanOrEqual(3);
  });
});

// ── DEX fill simulation ───────────────────────────────────────────

describe("FillSimulator DEX mode", () => {
  test("simulates constant-product AMM price impact", () => {
    const sim = new FillSimulator({
      venueModel: "dex",
      ammReserveQuote: 1_000_000,
      ammFeeBps: 30,
    });
    const rng = createSeededRng(42);
    const result = sim.simulateFill(rng, {
      side: "BUY",
      price: 2000,
      quantity: 10, // 20,000 USD order on 1M pool
      depthUsd: 1_000_000,
    });
    expect(result.filled).toBe(true);
    expect(result.fillPrice).toBeGreaterThan(2000); // price impact pushes price up
    expect(result.slippageBps).toBeGreaterThan(0);
  });

  test("larger orders cause more AMM price impact", () => {
    const rng1 = createSeededRng(42);
    const rng2 = createSeededRng(42);
    const sim = new FillSimulator({ venueModel: "dex", ammReserveQuote: 1_000_000 });

    const small = sim.simulateFill(rng1, {
      side: "BUY", price: 2000, quantity: 1, depthUsd: 1_000_000,
    });
    const large = sim.simulateFill(rng2, {
      side: "BUY", price: 2000, quantity: 100, depthUsd: 1_000_000,
    });
    expect(large.slippageBps).toBeGreaterThan(small.slippageBps);
  });

  test("DEX fills are deterministic with same seed", () => {
    const sim1 = new FillSimulator({ venueModel: "dex", ammReserveQuote: 500_000 });
    const sim2 = new FillSimulator({ venueModel: "dex", ammReserveQuote: 500_000 });
    const rng1 = createSeededRng(42);
    const rng2 = createSeededRng(42);

    for (let i = 0; i < 50; i++) {
      const r1 = sim1.simulateFill(rng1, {
        side: "BUY", price: 42_000, quantity: 0.1, depthUsd: 100_000,
      });
      const r2 = sim2.simulateFill(rng2, {
        side: "BUY", price: 42_000, quantity: 0.1, depthUsd: 100_000,
      });
      expect(r1.fillPrice).toBe(r2.fillPrice);
      expect(r1.filledQuantity).toBe(r2.filledQuantity);
    }
  });
});
