import { describe, expect, test } from "bun:test";
import type { MarketEdge, MarketNode } from "@agenttrading/contracts";
import { DEFAULT_ROUTE_ENGINE_CONFIG } from "@agenttrading/contracts";
import { computeRouteCost, scoreRoute } from "@agenttrading/graph";
import { RouteEngine } from "../src/live/route-engine.ts";
import { OpportunityDetector } from "../src/live/opportunity-detector.ts";
import {
  ORDER_BOOK_GROSS_SPREAD_USD,
  ORDER_BOOK_NET_PROFIT_USD,
  ORDER_BOOK_ROUTE,
  orderBookEdges,
} from "./fixtures/order-book.ts";

const NOW_MS = 1_700_000_000_000;

// ── Test helpers ────────────────────────────────────────────────────

function node(id: string, type: MarketNode["type"]): MarketNode {
  return { id, type, meta: {} };
}

function weights(partial: Partial<MarketEdge["weights"]>): MarketEdge["weights"] {
  return {
    price: 10,
    fee: 0.5,
    expectedSlippage: 0.2,
    gasCost: 0.1,
    fundingCost: 0,
    liquidityUsd: 100_000,
    confidence: 0.9,
    riskScore: 0.1,
    failureProbability: 0.00002,
    ...partial,
  };
}

function buildOrderBookGraph(detector: OpportunityDetector): void {
  for (const id of ORDER_BOOK_ROUTE) {
    const type = id.startsWith("venue:") ? "VENUE" : "ASSET";
    detector.graphInstance.addNode(node(id, type as MarketNode["type"]));
  }
  for (const def of orderBookEdges()) {
    detector.graphInstance.upsertEdge(
      def.from,
      def.to,
      def.type,
      def.weights,
      "test",
      true,
    );
  }
}

/**
 * Two-hop BRIDGE route: asset:eth → asset:weth (BRIDGE) → venue:bybit.
 * The BRIDGE edge carries a dedicated bridgeCostUsd weight; the canonical
 * stack prices bridge and failure risk separately from any flat surcharge or
 * averaged probability.
 */
const BRIDGE_ROUTE = ["asset:eth", "asset:weth", "venue:bybit"];

function buildBridgeGraph(detector: OpportunityDetector): void {
  detector.graphInstance.addNode(node("asset:eth", "ASSET"));
  detector.graphInstance.addNode(node("asset:weth", "ASSET"));
  detector.graphInstance.addNode(node("venue:bybit", "VENUE"));
  detector.graphInstance.upsertEdge(
    "asset:eth",
    "asset:weth",
    "BRIDGE",
    weights({
      price: 560,
      bridgeCostUsd: 12.5,
      latencyMs: 600,
      liquidityUsd: 50_000,
      confidence: 0.9,
      riskScore: 0.2,
      failureProbability: 0.0001,
    }),
    "test",
    true,
  );
  detector.graphInstance.upsertEdge(
    "asset:weth",
    "venue:bybit",
    "ORDER_BOOK",
    weights({
      price: 200,
      fee: 0.5,
      expectedSlippage: 0.5,
      gasCost: 0.5,
      latencyMs: 20,
      liquidityUsd: 60_000,
      confidence: 0.9,
      riskScore: 0.1,
      failureProbability: 0.0001,
    }),
    "test",
    true,
  );
}

// ── Canonical cost breakdown (issue #135) ───────────────────────────

describe("OpportunityDetector canonical cost stack (issue #135)", () => {
  test("candidate carries the canonical expectedNetProfitUsd the route engine sees", () => {
    const detector = new OpportunityDetector({}, () => NOW_MS);
    buildOrderBookGraph(detector);

    const opportunities = detector.detectOpportunities();
    const candidate = opportunities.find(
      (o) => o.candidate.route.join(">") === ORDER_BOOK_ROUTE.join(">"),
    );
    expect(candidate).toBeDefined();

    // The route engine on the same snapshot gates on this figure: gross
    // 150+120 = 270 minus the canonical cost stack 182.27 → 87.73.
    const snapshot = detector.getGraphSnapshot();
    const engine = new RouteEngine(DEFAULT_ROUTE_ENGINE_CONFIG, () => NOW_MS);
    const route = engine.discover(snapshot, NOW_MS).routes.find(
      (r) => r.nodes.join(">") === ORDER_BOOK_ROUTE.join(">"),
    );
    expect(route).toBeDefined();
    expect(route!.status).toBe("LIVE");

    // scoreRoute is the graph-package aggregator; the detector must agree.
    const graphCandidate = scoreRoute(
      snapshot,
      [...ORDER_BOOK_ROUTE],
      ORDER_BOOK_GROSS_SPREAD_USD,
    );
    expect(graphCandidate).toBeDefined();

    expect(candidate!.candidate.expectedNetProfitUsd).toBeCloseTo(
      ORDER_BOOK_NET_PROFIT_USD,
      2,
    );
    expect(candidate!.candidate.expectedNetProfitUsd).toBeCloseTo(
      route!.expectedNetProfitUsd,
      10,
    );
    expect(candidate!.candidate.expectedNetProfitUsd).toBeCloseTo(
      graphCandidate!.expectedNetProfitUsd,
      10,
    );
  });

  test("candidate reports the true gross spread and the canonical cost breakdown", () => {
    const detector = new OpportunityDetector({}, () => NOW_MS);
    buildOrderBookGraph(detector);

    const candidate = detector
      .detectOpportunities()
      .find((o) => o.candidate.route.join(">") === ORDER_BOOK_ROUTE.join(">"));
    expect(candidate).toBeDefined();

    const canonical = computeRouteCost(
      detector.getGraphSnapshot(),
      [...ORDER_BOOK_ROUTE],
    );

    // True gross spread (price1 + price2), not net + a bespoke cost stack.
    expect(candidate!.candidate.grossSpreadUsd).toBeCloseTo(
      ORDER_BOOK_GROSS_SPREAD_USD,
      2,
    );

    // The breakdown is byte-for-byte the canonical aggregator's.
    expect(candidate!.candidate.costs).toEqual(canonical.costs);

    // failureRiskUsd = maxCapitalUsd × combinedFailureProbability
    // = 60_000 × (1 − 0.999 × 0.998) = 179.88. An averaged probability would
    // have produced 60_000 × 0.0015 = 90.
    expect(candidate!.candidate.costs.failureRiskUsd).toBeCloseTo(179.88, 2);

    // The safety buffer is the canonical one, not a detector-local knob.
    expect(candidate!.candidate.costs.safetyBufferUsd).toBe(1.0);
  });

  test("bridge cost comes from the dedicated BRIDGE weight, not a flat $0.5 surcharge", () => {
    const detector = new OpportunityDetector({}, () => NOW_MS);
    buildBridgeGraph(detector);

    const candidate = detector
      .detectOpportunities()
      .find((o) => o.candidate.route.join(">") === BRIDGE_ROUTE.join(">"));
    expect(candidate).toBeDefined();

    const canonical = computeRouteCost(detector.getGraphSnapshot(), BRIDGE_ROUTE);

    // A flat $0.5-per-bridge-edge model would report 1 × 0.5 = 0.5; the point
    // is the dedicated BRIDGE weight (12.5) governs.
    expect(candidate!.candidate.costs.bridgeCostUsd).toBeCloseTo(12.5, 10);
    expect(candidate!.candidate.costs).toEqual(canonical.costs);

    // Bridge cost is a dedicated term: it is not folded into trading fees.
    expect(candidate!.candidate.costs.tradingFeesUsd).toBeCloseTo(0.5, 10);
    // And it is counted once — a flat $0.5-per-bridge-edge model reported 0.5.
    expect(candidate!.candidate.costs.bridgeCostUsd).not.toBeCloseTo(0.5, 2);
  });

  test("failureRiskUsd uses combined probability, not an averaged probability", () => {
    const detector = new OpportunityDetector({}, () => NOW_MS);
    buildBridgeGraph(detector);

    const candidate = detector
      .detectOpportunities()
      .find((o) => o.candidate.route.join(">") === BRIDGE_ROUTE.join(">"));
    expect(candidate).toBeDefined();

    // bottleneck liquidity = 50_000; combined p = 1 − 0.9999² = 0.00019999.
    // failureRisk = 50_000 × 0.00019999 = 9.9995. An averaged probability
    // would have produced 50_000 × 0.0001 = 5.
    expect(candidate!.candidate.costs.failureRiskUsd).toBeCloseTo(9.9995, 4);
    expect(candidate!.candidate.costs.failureRiskUsd).not.toBeCloseTo(5, 2);
  });

  test("MIN_EDGE gating evaluates the canonical figure", () => {
    // The canonical net profit is 87.73 (ORDER_BOOK fixture). Raising the
    // detector's viability threshold above that must exclude the opportunity —
    // using the canonical figure, not the bespoke net derived from a
    // $0.5-bridge / averaged-failure cost stack.
    const detector = new OpportunityDetector({ minNetProfitUsd: 100 }, () => NOW_MS);
    buildOrderBookGraph(detector);

    expect(detector.detectOpportunities()).toEqual([]);

    // The route engine still sees the route as LIVE on the canonical figure
    // (87.73 > 0): only the detector's MIN_EDGE-style threshold rejected it.
    const snapshot = detector.getGraphSnapshot();
    const engine = new RouteEngine(DEFAULT_ROUTE_ENGINE_CONFIG, () => NOW_MS);
    const route = engine.discover(snapshot, NOW_MS).routes.find(
      (r) => r.nodes.join(">") === ORDER_BOOK_ROUTE.join(">"),
    );
    expect(route).toBeDefined();
    expect(route!.expectedNetProfitUsd).toBeCloseTo(ORDER_BOOK_NET_PROFIT_USD, 2);
    expect(route!.status).toBe("LIVE");
  });
});
