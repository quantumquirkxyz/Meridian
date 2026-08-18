import { describe, expect, test } from "bun:test";
import {
  HARNESS_VERSION,
  createSeededRng,
  FillSimulator,
  GasSimulator,
  FundingSimulator,
  LatencySimulator,
  FailureSimulator,
  BacktestRunner,
  runStressTest,
  computePerformanceReport,
} from "../src/index.ts";
import { isOpportunityCandidate } from "@agenttrading/contracts";
import { expectPackageSmoke } from "../../../test/smoke-helper.ts";

describe("@agenttrading/harness smoke", () => {
  test("package resolves", () => {
    expectPackageSmoke(HARNESS_VERSION, () => {
      const candidate = {
        id: "c1",
        snapshotId: "snap-1",
        route: ["a", "b"],
        grossSpreadUsd: 100,
        costs: {
          tradingFeesUsd: 10,
          slippageUsd: 5,
          gasUsd: 2,
          bridgeCostUsd: 0,
          fundingCostUsd: 0,
          latencyRiskUsd: 1,
          failureRiskUsd: 2,
          safetyBufferUsd: 10,
        },
        expectedNetProfitUsd: 70,
        createdAtMs: 0,
        status: "CANDIDATE",
        invalidationReasons: [],
      };
      expect(isOpportunityCandidate(candidate)).toBe(true);
    });
  });

  test("all exports are defined", () => {
    expect(createSeededRng).toBeDefined();
    expect(FillSimulator).toBeDefined();
    expect(GasSimulator).toBeDefined();
    expect(FundingSimulator).toBeDefined();
    expect(LatencySimulator).toBeDefined();
    expect(FailureSimulator).toBeDefined();
    expect(BacktestRunner).toBeDefined();
    expect(runStressTest).toBeDefined();
    expect(computePerformanceReport).toBeDefined();
  });

  test("seeded PRNG produces deterministic output", () => {
    const rng1 = createSeededRng(42);
    const rng2 = createSeededRng(42);
    for (let i = 0; i < 100; i++) {
      expect(rng1.next()).toBe(rng2.next());
    }
  });

  test("FillSimulator produces a fill result", () => {
    const sim = new FillSimulator();
    const rng = createSeededRng(42);
    const result = sim.simulateFill(rng, {
      side: "BUY",
      price: 42_000,
      quantity: 0.1,
      depthUsd: 100_000,
    });
    expect(result).toBeDefined();
    expect(typeof result.filled).toBe("boolean");
    expect(typeof result.fillPrice).toBe("number");
  });

  test("GasSimulator produces a gas estimate", () => {
    const sim = new GasSimulator();
    const rng = createSeededRng(42);
    const result = sim.simulateGas(rng, "swap");
    expect(result.gasCostUsd).toBeGreaterThan(0);
  });

  test("BacktestRunner can run with empty events", () => {
    const runner = new BacktestRunner();
    const result = runner.run({ seed: 42, events: [], strategy: "cycle" });
    expect(result.totalTrades).toBe(0);
    expect(result.finalCapitalUsd).toBe(10_000);
  });

  test("runStressTest returns reports", () => {
    const reports = runStressTest({ seed: 42, iterations: 5 });
    expect(reports.length).toBe(8);
  });

  test("computePerformanceReport handles empty result", () => {
    const result = {
      seed: 42,
      trades: [],
      graphSnapshot: {
        version: 1,
        snapshotId: "snap:test",
        createdAtMs: 0,
        nodes: [],
        edges: [],
      },
      totalTrades: 0,
      filledTrades: 0,
      failedTrades: 0,
      grossPnlUsd: 0,
      totalCostsUsd: 0,
      netPnlUsd: 0,
      finalCapitalUsd: 10_000,
      fillRatio: 0,
      finalRngState: 0,
    };
    const report = computePerformanceReport(result);
    expect(report.totalTrades).toBe(0);
  });
});
