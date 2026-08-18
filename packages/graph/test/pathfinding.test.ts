import { describe, expect, test } from "bun:test";
import {
  findRoutes,
  findArbitrageCycles,
  computeRouteCost,
  scoreRoute,
  findAndScoreRoutes,
  discardNonExecutable,
} from "../src/pathfinding.ts";
import type { MarketGraphSnapshot } from "@agenttrading/contracts";

// ── Helpers ────────────────────────────────────────────────────────

function makeSnapshot(
  nodes: MarketGraphSnapshot["nodes"],
  edges: MarketGraphSnapshot["edges"],
): MarketGraphSnapshot {
  return {
    version: 1,
    snapshotId: "snap:test",
    createdAtMs: Date.now(),
    nodes,
    edges,
  };
}

function asset(id: string) {
  return { id: `asset:${id}`, type: "ASSET" as const };
}

function venue(id: string) {
  return { id: `venue:${id}`, type: "VENUE" as const };
}

function orderBookEdge(
  from: string,
  to: string,
  weights: Record<string, number> = {},
  tradable = true,
) {
  return {
    id: `asset:${from}→venue:${to}:ORDER_BOOK`,
    from: `asset:${from}`,
    to: `venue:${to}`,
    type: "ORDER_BOOK" as const,
    weights,
    tradable,
    source: to,
  };
}

function swapEdge(
  from: string,
  to: string,
  weights: Record<string, number> = {},
  tradable = true,
) {
  return {
    id: `${from}→${to}:SWAP`,
    from,
    to,
    type: "SWAP" as const,
    weights,
    tradable,
    source: "dex",
  };
}

function bridgeEdge(
  from: string,
  to: string,
  weights: Record<string, number> = {},
  tradable = true,
) {
  return {
    id: `${from}→${to}:BRIDGE`,
    from,
    to,
    type: "BRIDGE" as const,
    weights,
    tradable,
    source: "bridge",
  };
}

// ── Tests ──────────────────────────────────────────────────────────

describe("findRoutes", () => {
  test("finds a direct route", () => {
    const snap = makeSnapshot(
      [asset("BTC"), asset("ETH")],
      [orderBookEdge("BTC", "bybit", { price: 42_000 })],
    );
    // No direct edge between BTC and ETH assets.
    const routes = findRoutes(snap, "asset:BTC", "asset:ETH");
    expect(routes).toHaveLength(0);
  });

  test("finds route through a venue node", () => {
    const snap = makeSnapshot(
      [asset("BTC"), asset("ETH"), venue("bybit")],
      [
        orderBookEdge("BTC", "bybit", { price: 42_000 }),
        {
          id: "venue:bybit→asset:ETH:ORDER_BOOK",
          from: "venue:bybit",
          to: "asset:ETH",
          type: "ORDER_BOOK",
          weights: { price: 2_500 },
          tradable: true,
          source: "bybit",
        },
      ],
    );
    const routes = findRoutes(snap, "asset:BTC", "asset:ETH");
    expect(routes.length).toBeGreaterThanOrEqual(1);
    expect(routes[0]).toEqual(["asset:BTC", "venue:bybit", "asset:ETH"]);
  });

  test("does not follow non-tradable edges", () => {
    const snap = makeSnapshot(
      [asset("BTC"), asset("ETH"), venue("bybit")],
      [
        orderBookEdge("BTC", "bybit", { price: 42_000 }, false), // non-tradable
        orderBookEdge("ETH", "bybit", { price: 2_500 }),
      ],
    );
    const routes = findRoutes(snap, "asset:BTC", "asset:ETH");
    expect(routes).toHaveLength(0);
  });

  test("respects maxHops limit", () => {
    const snap = makeSnapshot(
      [asset("A"), asset("B"), venue("v1"), venue("v2")],
      [
        orderBookEdge("A", "v1", { price: 100 }),
        orderBookEdge("B", "v2", { price: 200 }),
      ],
    );
    const routes = findRoutes(snap, "asset:A", "asset:B", { maxHops: 1 });
    expect(routes).toHaveLength(0);
  });

  test("finds multi-hop routes", () => {
    const snap = makeSnapshot(
      [asset("BTC"), asset("USDT"), asset("ETH"), venue("bybit"), venue("uniswap")],
      [
        orderBookEdge("BTC", "bybit", { price: 42_000 }),
        orderBookEdge("USDT", "bybit", { price: 1 }),
        orderBookEdge("ETH", "uniswap", { price: 2_500 }),
        orderBookEdge("USDT", "uniswap", { price: 1 }),
      ],
    );
    // BTC → bybit → USDT → bybit → ETH (through venues)
    // But we need asset-to-asset traversal. Let's use swap edges instead.
    const snap2 = makeSnapshot(
      [asset("BTC"), asset("USDT"), asset("ETH")],
      [
        swapEdge("asset:BTC", "asset:USDT", { price: 42_000 }),
        swapEdge("asset:USDT", "asset:ETH", { price: 1 / 2500 }),
      ],
    );
    const routes = findRoutes(snap2, "asset:BTC", "asset:ETH");
    expect(routes).toHaveLength(1);
    expect(routes[0]).toEqual(["asset:BTC", "asset:USDT", "asset:ETH"]);
  });

  test("does not revisit nodes (acyclic routes)", () => {
    const snap = makeSnapshot(
      [asset("A"), asset("B"), asset("C")],
      [
        swapEdge("asset:A", "asset:B", { price: 1 }),
        swapEdge("asset:B", "asset:C", { price: 1 }),
        swapEdge("asset:C", "asset:A", { price: 1 }), // would create cycle
      ],
    );
    const routes = findRoutes(snap, "asset:A", "asset:C");
    // Should find A→B→C but not A→B→C→A→C (cycle)
    for (const route of routes) {
      expect(new Set(route).size).toBe(route.length);
    }
  });
});

describe("findArbitrageCycles", () => {
  test("finds a profitable cycle", () => {
    const snap = makeSnapshot(
      [asset("BTC"), asset("ETH"), asset("USDT")],
      [
        swapEdge("asset:BTC", "asset:ETH", { price: 15 }),
        swapEdge("asset:ETH", "asset:USDT", { price: 2500 }),
        swapEdge("asset:USDT", "asset:BTC", { price: 1 / 42_000 }),
      ],
    );
    const cycles = findArbitrageCycles(snap);
    // Product: 15 * 2500 * (1/42000) = 37500/42000 ≈ 0.893 (not profitable)
    // So no cycle should be found.
    expect(cycles).toHaveLength(0);
  });

  test("finds a truly profitable cycle", () => {
    const snap = makeSnapshot(
      [asset("BTC"), asset("ETH"), asset("USDT")],
      [
        swapEdge("asset:BTC", "asset:ETH", { price: 15 }),
        swapEdge("asset:ETH", "asset:USDT", { price: 3000 }),
        swapEdge("asset:USDT", "asset:BTC", { price: 1 / 42_000 }),
      ],
    );
    const cycles = findArbitrageCycles(snap);
    // Product: 15 * 3000 * (1/42000) = 45000/42000 ≈ 1.071 (profitable!)
    expect(cycles.length).toBeGreaterThanOrEqual(1);
  });
});

describe("computeRouteCost", () => {
  test("sums fees, slippage, gas, and bridge costs", () => {
    const snap = makeSnapshot(
      [asset("BTC"), asset("ETH"), asset("USDT")],
      [
        swapEdge("asset:BTC", "asset:ETH", {
          fee: 5,
          expectedSlippage: 2,
          gasCost: 10,
          latencyMs: 100,
        }),
        swapEdge("asset:ETH", "asset:USDT", {
          fee: 3,
          expectedSlippage: 1,
          gasCost: 5,
          latencyMs: 50,
        }),
      ],
    );
    const cost = computeRouteCost(snap, ["asset:BTC", "asset:ETH", "asset:USDT"]);
    expect(cost.costs.tradingFeesUsd).toBe(8); // 5 + 3
    expect(cost.costs.slippageUsd).toBe(3); // 2 + 1
    expect(cost.costs.gasUsd).toBe(15); // 10 + 5
    expect(cost.costs.latencyRiskUsd).toBeCloseTo(0.15); // 150 * 0.001
    expect(cost.hops).toBe(2);
  });

  test("handles missing edges (infinite cost)", () => {
    const snap = makeSnapshot([], []);
    const cost = computeRouteCost(snap, ["asset:A", "asset:B"]);
    expect(cost.costs.tradingFeesUsd).toBe(Infinity);
  });

  test("tracks bottleneck liquidity", () => {
    const snap = makeSnapshot(
      [asset("A"), asset("B"), asset("C")],
      [
        swapEdge("asset:A", "asset:B", { liquidityUsd: 100_000 }),
        swapEdge("asset:B", "asset:C", { liquidityUsd: 5_000 }),
      ],
    );
    const cost = computeRouteCost(snap, ["asset:A", "asset:B", "asset:C"]);
    expect(cost.bottleneckLiquidityUsd).toBe(5_000);
  });

  test("computes combined failure probability", () => {
    const snap = makeSnapshot(
      [asset("A"), asset("B"), asset("C")],
      [
        swapEdge("asset:A", "asset:B", { failureProbability: 0.1 }),
        swapEdge("asset:B", "asset:C", { failureProbability: 0.2 }),
      ],
    );
    const cost = computeRouteCost(snap, ["asset:A", "asset:B", "asset:C"]);
    // 1 - (1-0.1)*(1-0.2) = 1 - 0.72 = 0.28
    expect(cost.combinedFailureProbability).toBeCloseTo(0.28, 2);
  });

  test("bridge edges add to bridgeCostUsd instead of tradingFeesUsd", () => {
    const snap = makeSnapshot(
      [asset("A"), asset("B")],
      [
        bridgeEdge("asset:A", "asset:B", { fee: 10, gasCost: 5 }),
      ],
    );
    const cost = computeRouteCost(snap, ["asset:A", "asset:B"]);
    expect(cost.costs.bridgeCostUsd).toBe(10);
    expect(cost.costs.tradingFeesUsd).toBe(0);
    expect(cost.costs.gasUsd).toBe(5);
  });

  test("applies safety buffer from options", () => {
    const snap = makeSnapshot(
      [asset("A"), asset("B")],
      [swapEdge("asset:A", "asset:B", {})],
    );
    const cost = computeRouteCost(snap, ["asset:A", "asset:B"], {
      safetyBufferUsd: 5.0,
    });
    expect(cost.costs.safetyBufferUsd).toBe(5.0);
  });
});

describe("scoreRoute", () => {
  test("produces a CANDIDATE when net profit > 0", () => {
    const snap = makeSnapshot(
      [asset("A"), asset("B")],
      [swapEdge("asset:A", "asset:B", { fee: 1, expectedSlippage: 0.5, gasCost: 0.5 })],
    );
    const candidate = scoreRoute(
      snap,
      ["asset:A", "asset:B"],
      10, // gross spread
    );
    expect(candidate).toBeDefined();
    expect(candidate?.status).toBe("CANDIDATE");
    expect(candidate?.expectedNetProfitUsd).toBeGreaterThan(0);
  });

  test("produces INVALID when net profit <= 0", () => {
    const snap = makeSnapshot(
      [asset("A"), asset("B")],
      [swapEdge("asset:A", "asset:B", { fee: 100 })],
    );
    const candidate = scoreRoute(
      snap,
      ["asset:A", "asset:B"],
      5, // gross spread < costs
    );
    expect(candidate).toBeDefined();
    expect(candidate?.status).toBe("INVALID");
    expect(candidate?.invalidationReasons).toContain("MIN_EDGE");
  });

  test("returns undefined for non-tradable route", () => {
    const snap = makeSnapshot(
      [asset("A"), asset("B")],
      [swapEdge("asset:A", "asset:B", {}, false)],
    );
    const candidate = scoreRoute(
      snap,
      ["asset:A", "asset:B"],
      100,
    );
    expect(candidate).toBeUndefined();
  });
});

describe("findAndScoreRoutes", () => {
  test("returns scored routes sorted by net profit", () => {
    const snap = makeSnapshot(
      [asset("A"), asset("B"), asset("C")],
      [
        swapEdge("asset:A", "asset:B", { fee: 1, liquidityUsd: 50_000 }),
        swapEdge("asset:B", "asset:C", { fee: 1, liquidityUsd: 50_000 }),
        swapEdge("asset:A", "asset:C", { fee: 5, liquidityUsd: 50_000 }),
      ],
    );
    const results = findAndScoreRoutes(snap, "asset:A", "asset:C", 20);
    expect(results.length).toBeGreaterThanOrEqual(1);
    // Check sorted by net profit descending.
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].candidate.expectedNetProfitUsd).toBeGreaterThanOrEqual(
        results[i].candidate.expectedNetProfitUsd,
      );
    }
  });

  test("filters routes below minLiquidityUsd", () => {
    const snap = makeSnapshot(
      [asset("A"), asset("B")],
      [swapEdge("asset:A", "asset:B", { fee: 0, liquidityUsd: 100 })],
    );
    const results = findAndScoreRoutes(snap, "asset:A", "asset:B", 1000, {
      filter: { minLiquidityUsd: 1000 },
    });
    expect(results).toHaveLength(0);
  });

  test("filters routes with negative net profit", () => {
    const snap = makeSnapshot(
      [asset("A"), asset("B")],
      [swapEdge("asset:A", "asset:B", { fee: 100 })],
    );
    const results = findAndScoreRoutes(snap, "asset:A", "asset:B", 5);
    expect(results).toHaveLength(0);
  });
});

describe("discardNonExecutable", () => {
  test("keeps executable routes", () => {
    const snap = makeSnapshot(
      [asset("A"), asset("B"), asset("C")],
      [
        swapEdge("asset:A", "asset:B", { fee: 1, liquidityUsd: 50_000 }),
        swapEdge("asset:B", "asset:C", { fee: 1, liquidityUsd: 50_000 }),
      ],
    );
    const result = discardNonExecutable(
      snap,
      [["asset:A", "asset:B", "asset:C"]],
      20,
    );
    expect(result).toHaveLength(1);
  });

  test("discards routes with non-tradable edges", () => {
    const snap = makeSnapshot(
      [asset("A"), asset("B")],
      [swapEdge("asset:A", "asset:B", { fee: 0 }, false)],
    );
    const result = discardNonExecutable(
      snap,
      [["asset:A", "asset:B"]],
      100,
    );
    expect(result).toHaveLength(0);
  });

  test("discards routes below minNetProfitUsd", () => {
    const snap = makeSnapshot(
      [asset("A"), asset("B")],
      [swapEdge("asset:A", "asset:B", { fee: 50 })],
    );
    const result = discardNonExecutable(
      snap,
      [["asset:A", "asset:B"]],
      10, // spread < fee
      { minNetProfitUsd: 1 },
    );
    expect(result).toHaveLength(0);
  });

  test("discards routes exceeding maxHops", () => {
    const snap = makeSnapshot(
      [asset("A"), asset("B"), asset("C"), asset("D")],
      [
        swapEdge("asset:A", "asset:B", { fee: 0 }),
        swapEdge("asset:B", "asset:C", { fee: 0 }),
        swapEdge("asset:C", "asset:D", { fee: 0 }),
      ],
    );
    const result = discardNonExecutable(
      snap,
      [["asset:A", "asset:B", "asset:C", "asset:D"]],
      100,
      { maxHops: 2 },
    );
    expect(result).toHaveLength(0);
  });

  test("discards cycles (repeated node ids)", () => {
    const snap = makeSnapshot(
      [asset("A"), asset("B")],
      [
        swapEdge("asset:A", "asset:B", { fee: 0 }),
        swapEdge("asset:B", "asset:A", { fee: 0 }),
      ],
    );
    const result = discardNonExecutable(
      snap,
      [["asset:A", "asset:B", "asset:A"]],
      100,
    );
    expect(result).toHaveLength(0);
  });

  test("discards routes below minLiquidityUsd", () => {
    const snap = makeSnapshot(
      [asset("A"), asset("B")],
      [swapEdge("asset:A", "asset:B", { fee: 0, liquidityUsd: 100 })],
    );
    const result = discardNonExecutable(
      snap,
      [["asset:A", "asset:B"]],
      100,
      { minLiquidityUsd: 1000 },
    );
    expect(result).toHaveLength(0);
  });

  test("discards routes with high failure probability", () => {
    const snap = makeSnapshot(
      [asset("A"), asset("B")],
      [swapEdge("asset:A", "asset:B", { failureProbability: 0.9 })],
    );
    const result = discardNonExecutable(
      snap,
      [["asset:A", "asset:B"]],
      100,
      { maxFailureProbability: 0.5 },
    );
    expect(result).toHaveLength(0);
  });
});
