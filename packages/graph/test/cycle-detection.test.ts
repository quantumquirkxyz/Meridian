import { describe, expect, test } from "bun:test";
import {
  computeRiskConcentration,
  detectCycleCandidates,
  findArbitrageCycles,
  scoreRoute,
  computeRouteCost,
} from "../src/pathfinding.ts";
import { isOpportunityCandidate } from "@agenttrading/contracts";
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

// ── scoreRoute: enriched fields ────────────────────────────────────

describe("scoreRoute enriched fields", () => {
  test("populates maxCapitalUsd from bottleneck liquidity", () => {
    const snap = makeSnapshot(
      [asset("A"), asset("B"), asset("C")],
      [
        swapEdge("asset:A", "asset:B", { liquidityUsd: 100_000, fee: 1 }),
        swapEdge("asset:B", "asset:C", { liquidityUsd: 50_000, fee: 1 }),
      ],
    );
    const candidate = scoreRoute(
      snap,
      ["asset:A", "asset:B", "asset:C"],
      100,
    );
    expect(candidate).toBeDefined();
    expect(candidate?.maxCapitalUsd).toBe(50_000); // bottleneck
  });

  test("populates confidence as average across edges", () => {
    const snap = makeSnapshot(
      [asset("A"), asset("B")],
      [
        swapEdge("asset:A", "asset:B", { confidence: 0.8, fee: 0 }),
      ],
    );
    const candidate = scoreRoute(snap, ["asset:A", "asset:B"], 10);
    expect(candidate).toBeDefined();
    expect(candidate?.confidence).toBeCloseTo(0.8, 2);
  });

  test("confidence averages across multiple edges", () => {
    const snap = makeSnapshot(
      [asset("A"), asset("B"), asset("C")],
      [
        swapEdge("asset:A", "asset:B", { confidence: 0.6, fee: 0 }),
        swapEdge("asset:B", "asset:C", { confidence: 0.9, fee: 0 }),
      ],
    );
    const candidate = scoreRoute(
      snap,
      ["asset:A", "asset:B", "asset:C"],
      100,
    );
    expect(candidate).toBeDefined();
    // (0.6 + 0.9) / 2 hops = 0.75
    expect(candidate?.confidence).toBeCloseTo(0.75, 2);
  });

  test("populates riskConcentration map", () => {
    const snap = makeSnapshot(
      [asset("A"), asset("B")],
      [
        swapEdge("asset:A", "asset:B", {
          riskScore: 0.5,
          failureProbability: 0.2,
          fee: 0,
        }),
      ],
    );
    const candidate = scoreRoute(snap, ["asset:A", "asset:B"], 10);
    expect(candidate).toBeDefined();
    expect(candidate?.riskConcentration).toBeDefined();
    // Edge concentration: 0.5 * 0.2 * 10 = 1.0 → clamped to 1.0
    expect(candidate?.riskConcentration?.["asset:A→asset:B"]).toBe(1.0);
    // Node concentration: max of adjacent edges
    expect(candidate?.riskConcentration?.["asset:A"]).toBe(1.0);
    expect(candidate?.riskConcentration?.["asset:B"]).toBe(1.0);
  });

  test("riskConcentration is empty for zero-risk edges", () => {
    const snap = makeSnapshot(
      [asset("A"), asset("B")],
      [
        swapEdge("asset:A", "asset:B", {
          riskScore: 0,
          failureProbability: 0,
          fee: 0,
        }),
      ],
    );
    const candidate = scoreRoute(snap, ["asset:A", "asset:B"], 10);
    expect(candidate).toBeDefined();
    expect(candidate?.riskConcentration?.["asset:A→asset:B"]).toBe(0);
  });

  test("candidate validates against isOpportunityCandidate", () => {
    const snap = makeSnapshot(
      [asset("A"), asset("B")],
      [
        swapEdge("asset:A", "asset:B", {
          liquidityUsd: 10_000,
          confidence: 0.9,
          riskScore: 0.1,
          failureProbability: 0.05,
          fee: 1,
        }),
      ],
    );
    const candidate = scoreRoute(snap, ["asset:A", "asset:B"], 100);
    expect(candidate).toBeDefined();
    expect(isOpportunityCandidate(candidate!)).toBe(true);
  });
});

// ── computeRiskConcentration ───────────────────────────────────────

describe("computeRiskConcentration", () => {
  test("returns empty object for route with no edges in snapshot", () => {
    const snap = makeSnapshot([], []);
    const conc = computeRiskConcentration(snap, ["asset:A", "asset:B"]);
    expect(Object.keys(conc)).toHaveLength(0);
  });

  test("computes edge concentration from riskScore * failureProbability", () => {
    const snap = makeSnapshot(
      [asset("A"), asset("B")],
      [
        swapEdge("asset:A", "asset:B", {
          riskScore: 0.3,
          failureProbability: 0.1,
        }),
      ],
    );
    const conc = computeRiskConcentration(snap, ["asset:A", "asset:B"]);
    // 0.3 * 0.1 * 10 = 0.3
    expect(conc["asset:A→asset:B"]).toBeCloseTo(0.3, 2);
  });

  test("clamps concentration to [0, 1]", () => {
    const snap = makeSnapshot(
      [asset("A"), asset("B")],
      [
        swapEdge("asset:A", "asset:B", {
          riskScore: 1.0,
          failureProbability: 1.0,
        }),
      ],
    );
    const conc = computeRiskConcentration(snap, ["asset:A", "asset:B"]);
    // 1.0 * 1.0 * 10 = 10 → clamped to 1.0
    expect(conc["asset:A→asset:B"]).toBe(1.0);
  });

  test("node concentration is max of adjacent edge concentrations", () => {
    const snap = makeSnapshot(
      [asset("A"), asset("B"), asset("C")],
      [
        swapEdge("asset:A", "asset:B", {
          riskScore: 0.1,
          failureProbability: 0.1,
        }),
        swapEdge("asset:B", "asset:C", {
          riskScore: 0.5,
          failureProbability: 0.5,
        }),
      ],
    );
    const conc = computeRiskConcentration(snap, [
      "asset:A",
      "asset:B",
      "asset:C",
    ]);
    // A→B: 0.1 * 0.1 * 10 = 0.1
    // B→C: 0.5 * 0.5 * 10 = 2.5 → clamped to 1.0
    // Node A: max(0.1) = 0.1
    // Node B: max(0.1, 1.0) = 1.0
    // Node C: max(1.0) = 1.0
    expect(conc["asset:A"]).toBeCloseTo(0.1, 2);
    expect(conc["asset:B"]).toBe(1.0);
    expect(conc["asset:C"]).toBe(1.0);
  });

  test("handles edges with no risk weights", () => {
    const snap = makeSnapshot(
      [asset("A"), asset("B")],
      [swapEdge("asset:A", "asset:B", {})],
    );
    const conc = computeRiskConcentration(snap, ["asset:A", "asset:B"]);
    // riskScore=0, failureProbability=0 → 0*0*10 = 0
    expect(conc["asset:A→asset:B"]).toBe(0);
  });
});

// ── detectCycleCandidates ──────────────────────────────────────────

describe("detectCycleCandidates", () => {
  test("returns empty when no profitable cycles exist", () => {
    const snap = makeSnapshot(
      [asset("BTC"), asset("ETH"), asset("USDT")],
      [
        swapEdge("asset:BTC", "asset:ETH", { price: 15, fee: 1 }),
        swapEdge("asset:ETH", "asset:USDT", { price: 2500, fee: 1 }),
        swapEdge("asset:USDT", "asset:BTC", { price: 1 / 42_000, fee: 1 }),
      ],
    );
    // Product: 15 * 2500 * (1/42000) ≈ 0.893 (not profitable)
    const candidates = detectCycleCandidates(snap);
    expect(candidates).toHaveLength(0);
  });

  test("finds profitable cycle candidates with full data", () => {
    const snap = makeSnapshot(
      [asset("BTC"), asset("ETH"), asset("USDT")],
      [
        swapEdge("asset:BTC", "asset:ETH", {
          price: 15,
          fee: 0.5,
          liquidityUsd: 50_000,
          confidence: 0.9,
          riskScore: 0.1,
          failureProbability: 0.05,
        }),
        swapEdge("asset:ETH", "asset:USDT", {
          price: 3000,
          fee: 0.5,
          liquidityUsd: 80_000,
          confidence: 0.85,
          riskScore: 0.15,
          failureProbability: 0.05,
        }),
        swapEdge("asset:USDT", "asset:BTC", {
          price: 1 / 42_000,
          fee: 0.5,
          liquidityUsd: 30_000,
          confidence: 0.95,
          riskScore: 0.05,
          failureProbability: 0.02,
        }),
      ],
    );
    // Product: 15 * 3000 * (1/42000) = 45000/42000 ≈ 1.071 (profitable)
    const candidates = detectCycleCandidates(snap, {
      grossSpreadUsd: 100,
    });
    expect(candidates.length).toBeGreaterThanOrEqual(1);

    const first = candidates[0];
    expect(first.candidate.status).toBe("CANDIDATE");
    expect(first.candidate.expectedNetProfitUsd).toBeGreaterThan(0);
    expect(first.candidate.maxCapitalUsd).toBeGreaterThan(0);
    expect(first.candidate.confidence).toBeGreaterThan(0);
    expect(first.candidate.riskConcentration).toBeDefined();
    expect(Object.keys(first.candidate.riskConcentration!).length).toBeGreaterThan(0);
  });

  test("discards cycles that fail net-cost stack", () => {
    const snap = makeSnapshot(
      [asset("A"), asset("B"), asset("C")],
      [
        swapEdge("asset:A", "asset:B", {
          price: 1.02,
          fee: 50, // very high fee
        }),
        swapEdge("asset:B", "asset:C", {
          price: 1.02,
          fee: 50,
        }),
        swapEdge("asset:C", "asset:A", {
          price: 1.02,
          fee: 50,
        }),
      ],
    );
    // Product: 1.02^3 ≈ 1.061 (profitable rate)
    // But fees of 50 * 3 = 150 will exceed any reasonable spread
    const candidates = detectCycleCandidates(snap, {
      grossSpreadUsd: 10,
    });
    expect(candidates).toHaveLength(0);
  });

  test("respects filter options", () => {
    const snap = makeSnapshot(
      [asset("A"), asset("B"), asset("C")],
      [
        swapEdge("asset:A", "asset:B", {
          price: 2,
          fee: 0,
          liquidityUsd: 100,
        }),
        swapEdge("asset:B", "asset:C", {
          price: 2,
          fee: 0,
          liquidityUsd: 100,
        }),
        swapEdge("asset:C", "asset:A", {
          price: 0.3,
          fee: 0,
          liquidityUsd: 100,
        }),
      ],
    );
    // Product: 2 * 2 * 0.3 = 1.2 (profitable)
    // But bottleneck liquidity = 100
    const candidates = detectCycleCandidates(snap, {
      grossSpreadUsd: 100,
      filter: { minLiquidityUsd: 1000 },
    });
    expect(candidates).toHaveLength(0);
  });

  test("includes riskConcentration in cycle candidates", () => {
    const snap = makeSnapshot(
      [asset("A"), asset("B"), asset("C")],
      [
        swapEdge("asset:A", "asset:B", {
          price: 2,
          fee: 0,
          riskScore: 0.3,
          failureProbability: 0.1,
        }),
        swapEdge("asset:B", "asset:C", {
          price: 2,
          fee: 0,
          riskScore: 0.2,
          failureProbability: 0.05,
        }),
        swapEdge("asset:C", "asset:A", {
          price: 0.3,
          fee: 0,
          riskScore: 0.1,
          failureProbability: 0.01,
        }),
      ],
    );
    const candidates = detectCycleCandidates(snap, {
      grossSpreadUsd: 100,
    });
    if (candidates.length > 0) {
      const conc = candidates[0].candidate.riskConcentration!;
      expect(Object.keys(conc).length).toBeGreaterThan(0);
      // All values should be in [0, 1]
      for (const val of Object.values(conc)) {
        expect(val).toBeGreaterThanOrEqual(0);
        expect(val).toBeLessThanOrEqual(1);
      }
    }
  });

  test("candidates are sorted by net profit descending", () => {
    const snap = makeSnapshot(
      [asset("A"), asset("B"), asset("C"), asset("D")],
      [
        swapEdge("asset:A", "asset:B", { price: 1.5, fee: 0 }),
        swapEdge("asset:B", "asset:C", { price: 1.5, fee: 0 }),
        swapEdge("asset:C", "asset:A", { price: 0.5, fee: 0 }),
        swapEdge("asset:A", "asset:D", { price: 1.1, fee: 0 }),
        swapEdge("asset:D", "asset:B", { price: 1.1, fee: 0 }),
        swapEdge("asset:B", "asset:A", { price: 0.9, fee: 0 }),
      ],
    );
    const candidates = detectCycleCandidates(snap, { grossSpreadUsd: 50 });
    for (let i = 1; i < candidates.length; i++) {
      expect(candidates[i - 1].candidate.expectedNetProfitUsd).toBeGreaterThanOrEqual(
        candidates[i].candidate.expectedNetProfitUsd,
      );
    }
  });
});

// ── Invalidation reasons ───────────────────────────────────────────

describe("route invalidation", () => {
  test("candidate with negative net profit is INVALID with reason code", () => {
    const snap = makeSnapshot(
      [asset("A"), asset("B")],
      [swapEdge("asset:A", "asset:B", { fee: 100 })],
    );
    const candidate = scoreRoute(snap, ["asset:A", "asset:B"], 5);
    expect(candidate).toBeDefined();
    expect(candidate?.status).toBe("INVALID");
    expect(candidate?.invalidationReasons).toContain("MIN_EDGE");
  });

  test("candidate with zero net profit is INVALID", () => {
    const snap = makeSnapshot(
      [asset("A"), asset("B")],
      [swapEdge("asset:A", "asset:B", { fee: 10 })],
    );
    const candidate = scoreRoute(snap, ["asset:A", "asset:B"], 10);
    expect(candidate).toBeDefined();
    expect(candidate?.status).toBe("INVALID");
    expect(candidate?.invalidationReasons).toBeDefined();
    expect(candidate!.invalidationReasons!.length).toBeGreaterThan(0);
  });

  test("validates INVALID candidate with reason codes", () => {
    const candidate = {
      id: "test",
      snapshotId: "snap-1",
      route: ["a", "b"],
      grossSpreadUsd: 10,
      costs: {
        tradingFeesUsd: 100,
        slippageUsd: 0,
        gasUsd: 0,
        bridgeCostUsd: 0,
        fundingCostUsd: 0,
        latencyRiskUsd: 0,
        failureRiskUsd: 0,
        safetyBufferUsd: 0,
      },
      expectedNetProfitUsd: -90,
      createdAtMs: Date.now(),
      status: "INVALID" as const,
      invalidationReasons: ["MIN_EDGE" as const],
    };
    expect(isOpportunityCandidate(candidate)).toBe(true);
  });
});
