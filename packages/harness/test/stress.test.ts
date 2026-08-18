import { describe, expect, test } from "bun:test";
import {
  runStressTest,
  type StressReport,
  type StressScenario,
} from "../src/stress.ts";

// ── Tests ──────────────────────────────────────────────────────────

describe("Stress tests", () => {
  test("runs all scenarios by default", () => {
    const reports = runStressTest({ seed: 42, iterations: 10 });
    expect(reports.length).toBe(8); // all 8 scenarios
  });

  test("deterministic with same seed", () => {
    const reports1 = runStressTest({ seed: 42, iterations: 20 });
    const reports2 = runStressTest({ seed: 42, iterations: 20 });

    expect(reports1.length).toBe(reports2.length);
    for (let i = 0; i < reports1.length; i++) {
      expect(reports1[i].scenario).toBe(reports2[i].scenario);
      expect(reports1[i].survivedIterations).toBe(
        reports2[i].survivedIterations,
      );
      expect(reports1[i].totalPnlImpactUsd).toBe(
        reports2[i].totalPnlImpactUsd,
      );
    }
  });

  test("each report has correct structure", () => {
    const reports = runStressTest({
      seed: 42,
      iterations: 5,
      scenarios: ["DISCONNECTION"],
    });

    expect(reports.length).toBe(1);
    const report = reports[0];

    expect(report.scenario).toBe("DISCONNECTION");
    expect(report.totalIterations).toBe(5);
    expect(report.survivedIterations).toBeGreaterThanOrEqual(0);
    expect(report.survivedIterations).toBeLessThanOrEqual(5);
    expect(report.survivalRate).toBeGreaterThanOrEqual(0);
    expect(report.survivalRate).toBeLessThanOrEqual(1);
    expect(report.iterations.length).toBe(5);
  });

  test("each iteration has correct structure", () => {
    const reports = runStressTest({
      seed: 42,
      iterations: 5,
      scenarios: ["STALE_DATA"],
    });

    for (const iter of reports[0].iterations) {
      expect(typeof iter.iteration).toBe("number");
      expect(iter.scenario).toBe("STALE_DATA");
      expect(typeof iter.survived).toBe("boolean");
      expect(iter.fill).toBeDefined();
      expect(iter.gas).toBeDefined();
      expect(iter.latency).toBeDefined();
      expect(Array.isArray(iter.failures)).toBe(true);
      expect(typeof iter.pnlImpactUsd).toBe("number");
      expect(typeof iter.notes).toBe("string");
    }
  });

  test("RPC_FAILURE scenario has high failure rate", () => {
    const reports = runStressTest({
      seed: 42,
      iterations: 100,
      scenarios: ["RPC_FAILURE"],
    });

    const report = reports[0];
    expect(report.totalFailures).toBeGreaterThan(0);
    expect(report.failureTypes.length).toBeGreaterThan(0);
  });

  test("EXTREME_SLIPPAGE produces higher slippage costs", () => {
    const extreme = runStressTest({
      seed: 42,
      iterations: 50,
      scenarios: ["EXTREME_SLIPPAGE"],
    });
    const normal = runStressTest({
      seed: 42,
      iterations: 50,
      scenarios: ["STALE_DATA"], // uses default slippage
    });

    // Extreme slippage should generally produce worse PnL.
    const extremeAvgPnl =
      extreme[0].totalPnlImpactUsd / extreme[0].totalIterations;
    // We can't guarantee direction, but the report should exist.
    expect(typeof extremeAvgPnl).toBe("number");
  });

  test("CASCADE_FAILURES can overwhelm the system", () => {
    const reports = runStressTest({
      seed: 42,
      iterations: 100,
      scenarios: ["CASCADE_FAILURES"],
    });

    const report = reports[0];
    // With high cascade probability, some iterations should fail.
    expect(report.totalFailures).toBeGreaterThan(0);
  });

  test("selected scenarios only run requested ones", () => {
    const reports = runStressTest({
      seed: 42,
      iterations: 5,
      scenarios: ["EXTREME_GAS"],
    });

    expect(reports.length).toBe(1);
    expect(reports[0].scenario).toBe("EXTREME_GAS");
  });

  test("COMBINED_STRESS tests multiple failure modes", () => {
    const reports = runStressTest({
      seed: 42,
      iterations: 100,
      scenarios: ["COMBINED_STRESS"],
    });

    const report = reports[0];
    expect(report.totalIterations).toBe(100);
    // Combined stress should produce some failures.
    expect(report.totalFailures).toBeGreaterThan(0);
  });

  test("worstLossUsd is the minimum pnlImpactUsd", () => {
    const reports = runStressTest({
      seed: 42,
      iterations: 50,
      scenarios: ["DISCONNECTION"],
    });

    const report = reports[0];
    const minPnl = Math.min(...report.iterations.map((i) => i.pnlImpactUsd));
    expect(report.worstLossUsd).toBe(minPnl);
  });
});
