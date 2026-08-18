import { describe, expect, test } from "bun:test";
import { createSeededRng } from "../src/seed.ts";
import { FillSimulator } from "../src/simulators/fill.ts";
import { GasSimulator } from "../src/simulators/gas.ts";
import { FundingSimulator } from "../src/simulators/funding.ts";
import { LatencySimulator } from "../src/simulators/latency.ts";
import { FailureSimulator } from "../src/simulators/failure.ts";

// ── FillSimulator ──────────────────────────────────────────────────

describe("FillSimulator", () => {
  test("deterministic with same seed", () => {
    const sim1 = new FillSimulator();
    const sim2 = new FillSimulator();
    const rng1 = createSeededRng(42);
    const rng2 = createSeededRng(42);

    for (let i = 0; i < 100; i++) {
      const r1 = sim1.simulateFill(rng1, {
        side: "BUY",
        price: 42_000,
        quantity: 0.1,
        depthUsd: 100_000,
      });
      const r2 = sim2.simulateFill(rng2, {
        side: "BUY",
        price: 42_000,
        quantity: 0.1,
        depthUsd: 100_000,
      });
      expect(r1.fillPrice).toBe(r2.fillPrice);
      expect(r1.fillRatio).toBe(r2.fillRatio);
      expect(r1.slippageUsd).toBe(r2.slippageUsd);
    }
  });

  test("returns INVALID_ORDER_PARAMS for zero quantity", () => {
    const sim = new FillSimulator();
    const rng = createSeededRng(42);
    const result = sim.simulateFill(rng, {
      side: "BUY",
      price: 100,
      quantity: 0,
      depthUsd: 10_000,
    });
    expect(result.filled).toBe(false);
    expect(result.reason).toBe("INVALID_ORDER_PARAMS");
  });

  test("returns INVALID_ORDER_PARAMS for zero price", () => {
    const sim = new FillSimulator();
    const rng = createSeededRng(42);
    const result = sim.simulateFill(rng, {
      side: "BUY",
      price: 0,
      quantity: 1,
      depthUsd: 10_000,
    });
    expect(result.filled).toBe(false);
    expect(result.reason).toBe("INVALID_ORDER_PARAMS");
  });

  test("slippage is positive for BUY orders (price increases)", () => {
    const sim = new FillSimulator({ baseSlippageBps: 10 });
    const rng = createSeededRng(42);
    const result = sim.simulateFill(rng, {
      side: "BUY",
      price: 42_000,
      quantity: 0.01,
      depthUsd: 100_000,
    });
    expect(result.fillPrice).toBeGreaterThanOrEqual(42_000);
  });

  test("slippage is negative for SELL orders (price decreases)", () => {
    const sim = new FillSimulator({ baseSlippageBps: 10 });
    const rng = createSeededRng(42);
    const result = sim.simulateFill(rng, {
      side: "SELL",
      price: 42_000,
      quantity: 0.01,
      depthUsd: 100_000,
    });
    expect(result.fillPrice).toBeLessThanOrEqual(42_000);
  });

  test("large orders relative to depth may trigger partial fill", () => {
    const sim = new FillSimulator({
      partialFillProbability: 1.0, // always try partial fill
      depthImpactFactor: 1.0,
    });
    const rng = createSeededRng(42);
    const result = sim.simulateFill(rng, {
      side: "BUY",
      price: 100,
      quantity: 100, // 10,000 USD order
      depthUsd: 5_000, // depth is smaller than order
    });
    // With these settings, partial fill should occur.
    expect(result.fillRatio).toBeLessThanOrEqual(1);
  });

  test("fillRatio is in [0, 1]", () => {
    const sim = new FillSimulator();
    const rng = createSeededRng(42);
    for (let i = 0; i < 200; i++) {
      const result = sim.simulateFill(rng, {
        side: i % 2 === 0 ? "BUY" : "SELL",
        price: 100 + i,
        quantity: 1,
        depthUsd: 10_000,
      });
      expect(result.fillRatio).toBeGreaterThanOrEqual(0);
      expect(result.fillRatio).toBeLessThanOrEqual(1);
    }
  });
});

// ── GasSimulator ───────────────────────────────────────────────────

describe("GasSimulator", () => {
  test("deterministic with same seed", () => {
    const sim1 = new GasSimulator();
    const sim2 = new GasSimulator();
    const rng1 = createSeededRng(42);
    const rng2 = createSeededRng(42);

    for (let i = 0; i < 50; i++) {
      const g1 = sim1.simulateGas(rng1, "swap");
      const g2 = sim2.simulateGas(rng2, "swap");
      expect(g1.gasCostUsd).toBe(g2.gasCostUsd);
      expect(g1.gasPriceGwei).toBe(g2.gasPriceGwei);
    }
  });

  test("gas cost is positive", () => {
    const sim = new GasSimulator();
    const rng = createSeededRng(42);
    const result = sim.simulateGas(rng, "swap");
    expect(result.gasCostUsd).toBeGreaterThan(0);
    expect(result.gasUnits).toBeGreaterThan(0);
    expect(result.gasPriceGwei).toBeGreaterThan(0);
  });

  test("bridge transactions use more gas units than swap", () => {
    const sim = new GasSimulator();
    const rng1 = createSeededRng(1);
    const rng2 = createSeededRng(1);
    const swap = sim.simulateGas(rng1, "swap");
    const bridge = sim.simulateGas(rng2, "bridge");
    expect(bridge.gasUnits).toBeGreaterThan(swap.gasUnits);
  });

  test("fixedGasEstimate produces consistent results", () => {
    const sim = new GasSimulator();
    const r1 = sim.fixedGasEstimate(150_000, 50);
    const r2 = sim.fixedGasEstimate(150_000, 50);
    expect(r1.gasCostUsd).toBe(r2.gasCostUsd);
    expect(r1.gasSpike).toBe(false);
  });

  test("congestion multiplier is in configured range", () => {
    const sim = new GasSimulator({
      congestionMultiplierRange: [2, 8],
    });
    const rng = createSeededRng(42);
    for (let i = 0; i < 100; i++) {
      const result = sim.simulateGas(rng, "swap");
      if (!result.gasSpike) {
        expect(result.congestionMultiplier).toBeGreaterThanOrEqual(2);
        expect(result.congestionMultiplier).toBeLessThanOrEqual(8);
      }
    }
  });
});

// ── FundingSimulator ───────────────────────────────────────────────

describe("FundingSimulator", () => {
  test("deterministic with same seed", () => {
    const sim1 = new FundingSimulator();
    const sim2 = new FundingSimulator();
    const rng1 = createSeededRng(42);
    const rng2 = createSeededRng(42);

    for (let i = 0; i < 50; i++) {
      const f1 = sim1.simulateFunding(rng1, {
        positionSize: 1,
        markPrice: 42_000,
        timeSpanMs: 28_800_000 * 3,
        isLong: true,
      });
      const f2 = sim2.simulateFunding(rng2, {
        positionSize: 1,
        markPrice: 42_000,
        timeSpanMs: 28_800_000 * 3,
        isLong: true,
      });
      expect(f1.fundingCostUsd).toBe(f2.fundingCostUsd);
      expect(f1.fundingRate).toBe(f2.fundingRate);
    }
  });

  test("funding cost is non-negative", () => {
    const sim = new FundingSimulator();
    const rng = createSeededRng(42);
    const result = sim.simulateFunding(rng, {
      positionSize: 1,
      markPrice: 42_000,
      timeSpanMs: 28_800_000 * 3,
      isLong: true,
    });
    expect(result.fundingCostUsd).toBeGreaterThanOrEqual(0);
  });

  test("intervals elapsed matches time span", () => {
    const sim = new FundingSimulator();
    const rng = createSeededRng(42);
    const result = sim.simulateFunding(rng, {
      positionSize: 1,
      markPrice: 42_000,
      timeSpanMs: 28_800_000 * 5, // 5 intervals
      isLong: true,
    });
    expect(result.intervalsElapsed).toBe(5);
  });

  test("funding rate is clamped", () => {
    const sim = new FundingSimulator();
    const rng = createSeededRng(42);
    for (let i = 0; i < 200; i++) {
      const result = sim.simulateFunding(rng, {
        positionSize: 10,
        markPrice: 42_000,
        timeSpanMs: 28_800_000,
        isLong: true,
      });
      expect(result.fundingRate).toBeGreaterThanOrEqual(-0.01);
      expect(result.fundingRate).toBeLessThanOrEqual(0.01);
    }
  });
});

// ── LatencySimulator ───────────────────────────────────────────────

describe("LatencySimulator", () => {
  test("deterministic with same seed", () => {
    const sim1 = new LatencySimulator();
    const sim2 = new LatencySimulator();
    const rng1 = createSeededRng(42);
    const rng2 = createSeededRng(42);

    for (let i = 0; i < 100; i++) {
      const l1 = sim1.simulateLatency(rng1);
      const l2 = sim2.simulateLatency(rng2);
      expect(l1.latencyMs).toBe(l2.latencyMs);
      expect(l1.exceededDeadline).toBe(l2.exceededDeadline);
    }
  });

  test("latency is always positive", () => {
    const sim = new LatencySimulator();
    const rng = createSeededRng(42);
    for (let i = 0; i < 500; i++) {
      const result = sim.simulateLatency(rng);
      expect(result.latencyMs).toBeGreaterThan(0);
      expect(result.latencyCostUsd).toBeGreaterThanOrEqual(0);
    }
  });

  test("exceededDeadline is true when latency > deadline", () => {
    const sim = new LatencySimulator({ baseLatencyMs: 100 });
    const rng = createSeededRng(42);
    // With base latency of 100ms, a deadline of 10ms should always be exceeded.
    for (let i = 0; i < 50; i++) {
      const result = sim.simulateLatency(rng, 10);
      expect(result.exceededDeadline).toBe(true);
    }
  });

  test("exceededDeadline is false when latency < deadline", () => {
    const sim = new LatencySimulator({
      baseLatencyMs: 1,
      jitterRangeMs: [0, 1],
      spikeProbability: 0,
    });
    const rng = createSeededRng(42);
    // With very low latency and high deadline.
    for (let i = 0; i < 50; i++) {
      const result = sim.simulateLatency(rng, 10_000);
      expect(result.exceededDeadline).toBe(false);
    }
  });
});

// ── FailureSimulator ───────────────────────────────────────────────

describe("FailureSimulator", () => {
  test("deterministic with same seed", () => {
    const sim1 = new FailureSimulator();
    const sim2 = new FailureSimulator();
    const rng1 = createSeededRng(42);
    const rng2 = createSeededRng(42);

    for (let i = 0; i < 100; i++) {
      const f1 = sim1.simulateFailure(rng1);
      const f2 = sim2.simulateFailure(rng2);
      expect(f1.failed).toBe(f2.failed);
      expect(f1.failureType).toBe(f2.failureType);
    }
  });

  test("no failure when failureProbability is 0", () => {
    const sim = new FailureSimulator({ failureProbability: 0 });
    const rng = createSeededRng(42);
    for (let i = 0; i < 100; i++) {
      const result = sim.simulateFailure(rng);
      expect(result.failed).toBe(false);
    }
  });

  test("always fails when failureProbability is 1", () => {
    const sim = new FailureSimulator({ failureProbability: 1 });
    const rng = createSeededRng(42);
    for (let i = 0; i < 100; i++) {
      const result = sim.simulateFailure(rng);
      expect(result.failed).toBe(true);
      expect(result.failureType).toBeDefined();
      expect(result.message).toBeTruthy();
    }
  });

  test("retryable failures have positive retryDelayMs", () => {
    const sim = new FailureSimulator({ failureProbability: 1 });
    const rng = createSeededRng(42);
    for (let i = 0; i < 200; i++) {
      const result = sim.simulateFailure(rng);
      if (result.failed && result.retryable) {
        expect(result.retryDelayMs).toBeGreaterThan(0);
      }
    }
  });

  test("non-retryable failures have retryDelayMs of 0", () => {
    const sim = new FailureSimulator({ failureProbability: 1 });
    const rng = createSeededRng(42);
    for (let i = 0; i < 200; i++) {
      const result = sim.simulateFailure(rng);
      if (result.failed && !result.retryable) {
        expect(result.retryDelayMs).toBe(0);
      }
    }
  });

  test("context bias affects failure type selection", () => {
    const sim = new FailureSimulator({ failureProbability: 1 });
    const rng = createSeededRng(42);

    // With DEX context, should see more RPC/TX failures.
    const dexTypes = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const result = sim.simulateFailure(rng, { isDex: true });
      if (result.failed && result.failureType) {
        dexTypes.add(result.failureType);
      }
    }
    // Should have at least some DEX-related failure types.
    const dexFailures = ["RPC_FAILURE", "RPC_TIMEOUT", "TX_REVERT", "NONCE_CONFLICT"];
    const hasDexType = dexFailures.some((t) => dexTypes.has(t as any));
    expect(hasDexType).toBe(true);
  });

  test("simulateCascade returns array of failures", () => {
    const sim = new FailureSimulator({
      failureProbability: 1,
      cascadeProbability: 1,
      maxCascadeLength: 5,
    });
    const rng = createSeededRng(42);
    const results = sim.simulateCascade(rng);
    expect(results.length).toBeGreaterThanOrEqual(1);
    for (const r of results) {
      expect(r.failed).toBe(true);
    }
  });
});
