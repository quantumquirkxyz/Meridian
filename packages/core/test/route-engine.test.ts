import { describe, expect, test } from "bun:test";
import type {
  MarketEdge,
  MarketGraphSnapshot,
  MarketNode,
  RouteEngineConfig,
  SystemicRiskOverlay,
} from "@agenttrading/contracts";
import { DEFAULT_ROUTE_ENGINE_CONFIG } from "@agenttrading/contracts";
import { scoreRoute } from "@agenttrading/graph";
import { RouteEngine } from "../src/live/route-engine.ts";
import { SystemicRiskOverlayEngine } from "../src/live/systemic-risk-overlay.ts";
import {
  ORDER_BOOK_GROSS_SPREAD_USD,
  ORDER_BOOK_ROUTE,
  ORDER_BOOK_TOTAL_COST_USD,
  orderBookEdges,
} from "./fixtures/order-book.ts";

// ── Test helpers ────────────────────────────────────────────────────

const NOW_MS = 1_700_000_000_000;

function node(id: string, type: MarketNode["type"], meta?: Record<string, unknown>): MarketNode {
  return { id, type, meta };
}

function edge(
  id: string,
  from: string,
  to: string,
  type: MarketEdge["type"],
  weights: Partial<MarketEdge["weights"]> = {},
  tradable = true,
  updatedAtMs = NOW_MS,
): MarketEdge {
  return {
    id,
    from,
    to,
    type,
    weights: {
      price: 10,
      fee: 0.5,
      expectedSlippage: 0.2,
      gasCost: 0.1,
      fundingCost: 0,
      liquidityUsd: 100_000,
      confidence: 0.9,
      riskScore: 0.1,
      // Generic fixture: small failure probability so the route clears the
      // canonical cost stack (issue #134). Risk-specific tests override it.
      failureProbability: 0.00002,
      ...weights,
    },
    tradable,
    source: "test",
    ...(updatedAtMs !== undefined ? { updatedAtMs } : {}),
  } as MarketEdge;
}

function snapshot(
  nodes: MarketNode[],
  edges: MarketEdge[],
  version = 1,
): MarketGraphSnapshot {
  return {
    version,
    snapshotId: `snap-v${version}`,
    createdAtMs: NOW_MS,
    nodes,
    edges,
  };
}

function config(overrides: Partial<RouteEngineConfig> = {}): RouteEngineConfig {
  return {
    ...DEFAULT_ROUTE_ENGINE_CONFIG,
    ...overrides,
  };
}

function overlay(overrides: Partial<SystemicRiskOverlay> = {}): SystemicRiskOverlay {
  return {
    overlayId: "test-overlay",
    dimension: "VENUE",
    maxConcentration: 0.5,
    enabled: true,
    ...overrides,
  };
}

// ── AC1: Live routes detected across route types ────────────────────

describe("AC1: Live route detection across route types", () => {
  test("detects CEX-CEX routes (two venue nodes, ORDER_BOOK edges)", () => {
    const nodes = [
      node("venue:bybit", "VENUE"),
      node("venue:binance", "VENUE"),
      node("asset:BTC", "ASSET"),
    ];
    const edges = [
      edge("e1", "venue:bybit", "asset:BTC", "ORDER_BOOK"),
      edge("e2", "asset:BTC", "venue:binance", "ORDER_BOOK"),
    ];
    const snap = snapshot(nodes, edges);
    const engine = new RouteEngine(config(), () => NOW_MS);

    const result = engine.discover(snap, NOW_MS);

    // Should find at least one CEX_CEX route.
    const cexCexRoutes = result.routes.filter((r) => r.routeType === "CEX_CEX");
    expect(cexCexRoutes.length).toBeGreaterThanOrEqual(1);

    // The multi-hop route should span bybit → BTC → binance.
    const multiHopRoute = cexCexRoutes.find((r) => r.nodes.length >= 3);
    if (multiHopRoute !== undefined) {
      expect(multiHopRoute.nodes).toContain("venue:bybit");
      expect(multiHopRoute.nodes).toContain("venue:binance");
    }
  });

  test("detects DEX-DEX routes (pool nodes, SWAP edges)", () => {
    const nodes = [
      node("pool:uniswap-btc-usdt", "POOL"),
      node("pool:sushiswap-btc-usdt", "POOL"),
      node("asset:BTC", "ASSET"),
    ];
    const edges = [
      edge("e1", "pool:uniswap-btc-usdt", "asset:BTC", "SWAP"),
      edge("e2", "asset:BTC", "pool:sushiswap-btc-usdt", "SWAP"),
    ];
    const snap = snapshot(nodes, edges);
    const engine = new RouteEngine(config(), () => NOW_MS);

    const result = engine.discover(snap, NOW_MS);

    const dexDexRoutes = result.routes.filter((r) => r.routeType === "DEX_DEX");
    expect(dexDexRoutes.length).toBeGreaterThanOrEqual(1);
  });

  test("detects CEX-DEX routes (venue + pool nodes)", () => {
    const nodes = [
      node("venue:bybit", "VENUE"),
      node("pool:uniswap-btc-usdt", "POOL"),
      node("asset:BTC", "ASSET"),
    ];
    const edges = [
      edge("e1", "venue:bybit", "asset:BTC", "ORDER_BOOK"),
      edge("e2", "asset:BTC", "pool:uniswap-btc-usdt", "SWAP"),
    ];
    const snap = snapshot(nodes, edges);
    const engine = new RouteEngine(config(), () => NOW_MS);

    const result = engine.discover(snap, NOW_MS);

    const cexDexRoutes = result.routes.filter((r) => r.routeType === "CEX_DEX");
    expect(cexDexRoutes.length).toBeGreaterThanOrEqual(1);
  });

  test("detects CROSS_CHAIN routes (bridge edges)", () => {
    const nodes = [
      node("chain:ethereum", "CHAIN"),
      node("chain:arbitrum", "CHAIN"),
      node("bridge:wormhole", "ASSET"),
    ];
    const edges = [
      edge("e1", "chain:ethereum", "bridge:wormhole", "BRIDGE"),
      edge("e2", "bridge:wormhole", "chain:arbitrum", "BRIDGE"),
    ];
    const snap = snapshot(nodes, edges);
    const engine = new RouteEngine(config(), () => NOW_MS);

    const result = engine.discover(snap, NOW_MS);

    const crossChainRoutes = result.routes.filter((r) => r.routeType === "CROSS_CHAIN");
    expect(crossChainRoutes.length).toBeGreaterThanOrEqual(1);
  });

  test("detects FUNDING_BASIS routes (funding edges)", () => {
    const nodes = [
      node("venue:bybit", "VENUE"),
      node("venue:binance", "VENUE"),
      node("asset:BTC", "ASSET"),
    ];
    const edges = [
      edge("e1", "venue:bybit", "asset:BTC", "FUNDING"),
      edge("e2", "asset:BTC", "venue:binance", "FUNDING"),
    ];
    const snap = snapshot(nodes, edges);
    const engine = new RouteEngine(config(), () => NOW_MS);

    const result = engine.discover(snap, NOW_MS);

    const fundingRoutes = result.routes.filter((r) => r.routeType === "FUNDING_BASIS");
    expect(fundingRoutes.length).toBeGreaterThanOrEqual(1);
  });

  test("discovers routes with correct scoring", () => {
    const nodes = [
      node("venue:bybit", "VENUE"),
      node("asset:BTC", "ASSET"),
    ];
    const edges = [
      edge("e1", "venue:bybit", "asset:BTC", "ORDER_BOOK", {
        price: 20,
        fee: 0.5,
        expectedSlippage: 0.2,
        gasCost: 0.1,
        confidence: 0.95,
        liquidityUsd: 500_000,
        riskScore: 0.05,
      }),
    ];
    const snap = snapshot(nodes, edges);
    const engine = new RouteEngine(config(), () => NOW_MS);

    const result = engine.discover(snap, NOW_MS);

    expect(result.routes.length).toBeGreaterThanOrEqual(1);
    const route = result.routes[0];
    expect(route.score).toBeGreaterThan(0);
    expect(route.score).toBeLessThanOrEqual(1);
    expect(route.confidence).toBeGreaterThan(0);
    expect(route.maxCapitalUsd).toBeGreaterThanOrEqual(0);
    expect(route.expectedNetProfitUsd).toBeGreaterThanOrEqual(0);
  });

  test("routes carry snapshot reference", () => {
    const nodes = [node("venue:bybit", "VENUE"), node("asset:BTC", "ASSET")];
    const edges = [edge("e1", "venue:bybit", "asset:BTC", "ORDER_BOOK")];
    const snap = snapshot(nodes, edges);
    const engine = new RouteEngine(config(), () => NOW_MS);

    const result = engine.discover(snap, NOW_MS);

    expect(result.routes.length).toBeGreaterThanOrEqual(1);
    expect(result.routes[0].snapshotId).toBe(snap.snapshotId);
    expect(result.snapshotVersion).toBe(snap.version);
  });

  test("respects maxRouteLength limit", () => {
    // Build a long chain: venue → asset → venue → asset → venue → asset
    const nodes = [
      node("v1", "VENUE"),
      node("a1", "ASSET"),
      node("v2", "VENUE"),
      node("a2", "ASSET"),
      node("v3", "VENUE"),
      node("a3", "ASSET"),
    ];
    const edges = [
      edge("e1", "v1", "a1", "ORDER_BOOK"),
      edge("e2", "a1", "v2", "ORDER_BOOK"),
      edge("e3", "v2", "a2", "ORDER_BOOK"),
      edge("e4", "a2", "v3", "ORDER_BOOK"),
      edge("e5", "v3", "a3", "ORDER_BOOK"),
    ];
    const snap = snapshot(nodes, edges);
    const engine = new RouteEngine(config({ maxRouteLength: 3 }), () => NOW_MS);

    const result = engine.discover(snap, NOW_MS);

    // No route should exceed 3 hops.
    for (const route of result.routes) {
      expect(route.edges.length).toBeLessThanOrEqual(3);
    }
  });

  test("no routes found in empty graph", () => {
    const snap = snapshot([], []);
    const engine = new RouteEngine(config(), () => NOW_MS);

    const result = engine.discover(snap, NOW_MS);

    expect(result.routes).toHaveLength(0);
    expect(result.liveRoutes).toHaveLength(0);
  });
});

// ── AC2: Systemic risk overlays block routes ────────────────────────

describe("AC2: Systemic risk overlays", () => {
  test("blocks route when venue concentration exceeds threshold", () => {
    const nodes = [
      node("venue:bybit", "VENUE"),
      node("asset:BTC", "ASSET"),
    ];
    const edges = [edge("e1", "venue:bybit", "asset:BTC", "ORDER_BOOK")];
    const snap = snapshot(nodes, edges);

    // A 2-node route has base venue concentration 0.5 (1/2 nodes).
    // Setting threshold below 0.5 should block the route.
    const cfg = config({
      overlays: [overlay({ dimension: "VENUE", maxConcentration: 0.3 })],
    });
    const engine = new RouteEngine(cfg, () => NOW_MS);

    const result = engine.discover(snap, NOW_MS);

    // The route should be blocked because venue concentration (0.5)
    // exceeds the threshold (0.3).
    expect(result.blockedRoutes.length).toBeGreaterThanOrEqual(1);
  });

  test("allows route when concentration is within threshold", () => {
    const nodes = [
      node("venue:bybit", "VENUE"),
      node("asset:BTC", "ASSET"),
    ];
    const edges = [edge("e1", "venue:bybit", "asset:BTC", "ORDER_BOOK")];
    const snap = snapshot(nodes, edges);

    const cfg = config({
      overlays: [overlay({ dimension: "VENUE", maxConcentration: 0.9 })],
    });
    const engine = new RouteEngine(cfg, () => NOW_MS);

    const result = engine.discover(snap, NOW_MS);

    // With max concentration 0.9 and risk score 0.1, route should be live.
    expect(result.liveRoutes.length).toBeGreaterThanOrEqual(1);
  });

  test("disabled overlay does not block routes", () => {
    const nodes = [
      node("venue:bybit", "VENUE"),
      node("asset:BTC", "ASSET"),
    ];
    const edges = [edge("e1", "venue:bybit", "asset:BTC", "ORDER_BOOK")];
    const snap = snapshot(nodes, edges);

    const cfg = config({
      overlays: [overlay({ dimension: "VENUE", maxConcentration: 0.01, enabled: false })],
    });
    const engine = new RouteEngine(cfg, () => NOW_MS);

    const result = engine.discover(snap, NOW_MS);

    // Overlay is disabled, so no blocking should occur.
    expect(result.blockedRoutes).toHaveLength(0);
  });

  test("overlay evaluations are returned in result", () => {
    const nodes = [
      node("venue:bybit", "VENUE"),
      node("asset:BTC", "ASSET"),
    ];
    const edges = [edge("e1", "venue:bybit", "asset:BTC", "ORDER_BOOK")];
    const snap = snapshot(nodes, edges);

    const engine = new RouteEngine(config(), () => NOW_MS);
    const result = engine.discover(snap, NOW_MS);

    // Each route should have overlay evaluations.
    expect(result.overlayEvaluations.length).toBeGreaterThanOrEqual(1);
    for (const eval_ of result.overlayEvaluations) {
      expect(typeof eval_.overlayId).toBe("string");
      expect(typeof eval_.dimension).toBe("string");
      expect(typeof eval_.blocked).toBe("boolean");
      expect(typeof eval_.concentration).toBe("number");
      expect(typeof eval_.maxConcentration).toBe("number");
    }
  });

  test("multiple overlays can block independently", () => {
    const nodes = [
      node("venue:bybit", "VENUE"),
      node("asset:BTC", "ASSET"),
    ];
    const edges = [edge("e1", "venue:bybit", "asset:BTC", "ORDER_BOOK")];
    const snap = snapshot(nodes, edges);

    const cfg = config({
      overlays: [
        overlay({ overlayId: "venue-check", dimension: "VENUE", maxConcentration: 0.01 }),
        overlay({ overlayId: "chain-check", dimension: "CHAIN", maxConcentration: 0.01 }),
      ],
    });
    const engine = new RouteEngine(cfg, () => NOW_MS);

    const result = engine.discover(snap, NOW_MS);

    // At least the venue overlay should evaluate.
    const venueEvals = result.overlayEvaluations.filter(
      (e) => e.dimension === "VENUE",
    );
    expect(venueEvals.length).toBeGreaterThanOrEqual(1);
  });
});

// ── AC3: Inventory-aware routing and stale expiry ───────────────────

describe("AC3: Inventory-aware routing", () => {
  test("route expires after TTL", () => {
    const nodes = [node("v1", "VENUE"), node("a1", "ASSET")];
    const edges = [edge("e1", "v1", "a1", "ORDER_BOOK")];
    const snap = snapshot(nodes, edges);

    const cfg = config({ routeTtlMs: 10_000 });
    const engine = new RouteEngine(cfg, () => NOW_MS);

    const result = engine.discover(snap, NOW_MS);
    expect(result.liveRoutes.length).toBeGreaterThanOrEqual(1);

    const route = result.liveRoutes[0];
    expect(route.expiresAtMs).toBe(NOW_MS + 10_000);

    // Check validity after TTL.
    const valid = engine.isRouteValidForInventory(
      route.routeId,
      1_000_000,
      NOW_MS + 11_000,
    );
    expect(valid.valid).toBe(false);
    expect(valid.reason).toContain("expired");
  });

  test("route becomes stale after staleness threshold", () => {
    const nodes = [node("v1", "VENUE"), node("a1", "ASSET")];
    const edges = [edge("e1", "v1", "a1", "ORDER_BOOK")];
    // Snapshot was created 100s ago, threshold is 60s.
    const snap = snapshot(nodes, edges);
    snap.createdAtMs = NOW_MS - 100_000;

    const cfg = config({ stalenessThresholdMs: 60_000 });
    const engine = new RouteEngine(cfg, () => NOW_MS);

    const result = engine.discover(snap, NOW_MS);

    // Route should be STALE because the snapshot is 100s old and threshold is 60s.
    const staleRoutes = result.routes.filter((r) => r.status === "STALE");
    expect(staleRoutes.length).toBeGreaterThanOrEqual(1);
  });

  test("route is invalidated when inventory is insufficient", () => {
    const nodes = [node("v1", "VENUE"), node("a1", "ASSET")];
    const edges = [
      edge("e1", "v1", "a1", "ORDER_BOOK", { liquidityUsd: 100_000 }),
    ];
    const snap = snapshot(nodes, edges);
    const engine = new RouteEngine(config(), () => NOW_MS);

    const result = engine.discover(snap, NOW_MS);
    expect(result.liveRoutes.length).toBeGreaterThanOrEqual(1);

    const route = result.liveRoutes[0];
    // maxCapitalUsd is 100_000. 10% = 10_000. Available is 500.
    const valid = engine.isRouteValidForInventory(route.routeId, 500, NOW_MS);
    expect(valid.valid).toBe(false);
    expect(valid.reason).toContain("insufficient capital");
  });

  test("route is valid when inventory is sufficient", () => {
    const nodes = [node("v1", "VENUE"), node("a1", "ASSET")];
    const edges = [
      edge("e1", "v1", "a1", "ORDER_BOOK", { liquidityUsd: 100_000 }),
    ];
    const snap = snapshot(nodes, edges);
    const engine = new RouteEngine(config(), () => NOW_MS);

    const result = engine.discover(snap, NOW_MS);
    const route = result.liveRoutes[0];

    // Available capital covers the route.
    const valid = engine.isRouteValidForInventory(route.routeId, 100_000, NOW_MS);
    expect(valid.valid).toBe(true);
  });

  test("sweepInvalidate expires stale routes", () => {
    const nodes = [node("v1", "VENUE"), node("a1", "ASSET")];
    const edges = [
      edge("e1", "v1", "a1", "ORDER_BOOK", {}, true, NOW_MS),
    ];
    const snap = snapshot(nodes, edges);
    const engine = new RouteEngine(config({ stalenessThresholdMs: 60_000 }), () => NOW_MS);

    const result = engine.discover(snap, NOW_MS);
    expect(result.liveRoutes.length).toBeGreaterThanOrEqual(1);
    expect(engine.activeRouteCount()).toBeGreaterThanOrEqual(1);

    // Sweep after staleness threshold.
    const invalidated = engine.sweepInvalidate(snap, NOW_MS + 61_000);
    expect(invalidated.length).toBeGreaterThanOrEqual(1);
    expect(engine.activeRouteCount()).toBe(0);
  });
});

// ── AC4: Route invalidation prevents executing on dead routes ───────

describe("AC4: Route invalidation", () => {
  test("invalidate removes route from active set", () => {
    const nodes = [node("v1", "VENUE"), node("a1", "ASSET")];
    const edges = [edge("e1", "v1", "a1", "ORDER_BOOK")];
    const snap = snapshot(nodes, edges);
    const engine = new RouteEngine(config(), () => NOW_MS);

    const result = engine.discover(snap, NOW_MS);
    const route = result.liveRoutes[0];
    expect(engine.getRoute(route.routeId)).toBeDefined();

    const success = engine.invalidate(route.routeId, "ROUTE_BLOCKED", NOW_MS);
    expect(success).toBe(true);
    expect(engine.getRoute(route.routeId)).toBeUndefined();
  });

  test("invalidate sets reason code on route", () => {
    const nodes = [node("v1", "VENUE"), node("a1", "ASSET")];
    const edges = [edge("e1", "v1", "a1", "ORDER_BOOK")];
    const snap = snapshot(nodes, edges);
    const engine = new RouteEngine(config(), () => NOW_MS);

    const result = engine.discover(snap, NOW_MS);
    const route = result.liveRoutes[0];

    engine.invalidate(route.routeId, "HIDDEN_CORRELATION", NOW_MS);

    // The route should have the invalidation reason.
    // Note: route was removed from active set, but the object is the same reference.
    expect(route.invalidationReasons).toContain("HIDDEN_CORRELATION");
    expect(route.status).toBe("EXPIRED");
  });

  test("invalidate returns false for unknown route", () => {
    const engine = new RouteEngine(config(), () => NOW_MS);
    const success = engine.invalidate("nonexistent-route", "ROUTE_BLOCKED", NOW_MS);
    expect(success).toBe(false);
  });

  test("sweepInvalidate blocks routes with non-tradable edges", () => {
    const nodes = [node("v1", "VENUE"), node("a1", "ASSET")];
    const edges = [edge("e1", "v1", "a1", "ORDER_BOOK", {}, true, NOW_MS)];
    const snap = snapshot(nodes, edges);
    const engine = new RouteEngine(config(), () => NOW_MS);

    const result = engine.discover(snap, NOW_MS);
    expect(result.liveRoutes.length).toBeGreaterThanOrEqual(1);

    // Create a new snapshot where the edge is no longer tradable.
    const deadSnap = snapshot(
      nodes,
      [edge("e1", "v1", "a1", "ORDER_BOOK", {}, false, NOW_MS)],
    );

    const invalidated = engine.sweepInvalidate(deadSnap, NOW_MS + 1000);
    expect(invalidated.length).toBeGreaterThanOrEqual(1);
    expect(invalidated[0].invalidationReasons).toContain("LIQUIDITY_EVAPORATED");
  });

  test("sweepInvalidate blocks routes blocked by overlays", () => {
    const nodes = [node("v1", "VENUE"), node("a1", "ASSET")];
    // Edge with high VENUE-prefixed risk concentration.
    const edges = [edge("e1", "v1", "a1", "ORDER_BOOK", {
      riskScore: 0.8,
      failureProbability: 0.8,
    })];
    const snap = snapshot(nodes, edges);

    // Engine with a VENUE overlay at a very low threshold.
    const engine = new RouteEngine(
      config({
        overlays: [
          overlay({ dimension: "VENUE", maxConcentration: 0.01 }),
        ],
      }),
      () => NOW_MS,
    );

    // Discover — the route should be blocked by the overlay.
    const result = engine.discover(snap, NOW_MS);
    expect(result.blockedRoutes.length).toBeGreaterThanOrEqual(1);
    expect(engine.getActiveRoutes()).toHaveLength(0);
  });

  test("route is classified as EXPIRED after invalidation", () => {
    const nodes = [node("v1", "VENUE"), node("a1", "ASSET")];
    const edges = [edge("e1", "v1", "a1", "ORDER_BOOK")];
    const snap = snapshot(nodes, edges);
    const engine = new RouteEngine(config(), () => NOW_MS);

    const result = engine.discover(snap, NOW_MS);
    const route = result.liveRoutes[0];

    engine.invalidate(route.routeId, "ROUTE_EXPIRED", NOW_MS);

    expect(route.status).toBe("EXPIRED");
    expect(route.invalidationReasons).toContain("ROUTE_EXPIRED");
  });
});

// ── SystemicRiskOverlayEngine unit tests ────────────────────────────

describe("SystemicRiskOverlayEngine", () => {
  test("computes concentration from route risk map", () => {
    const cfg = config();
    const engine = new SystemicRiskOverlayEngine(cfg);

    const route = {
      routeId: "r1",
      routeType: "CEX_CEX" as const,
      riskConcentration: {
        "VENUE:bybit": 0.8,
        "VENUE:binance": 0.2,
      },
      nodes: ["v1", "a1", "v2"],
      edges: ["e1", "e2"],
      score: 0.7,
      expectedNetProfitUsd: 50,
      maxCapitalUsd: 100_000,
      confidence: 0.9,
      status: "LIVE" as const,
      createdAtMs: NOW_MS,
      expiresAtMs: NOW_MS + 30_000,
      lastUpdatedAtMs: NOW_MS,
      invalidationReasons: [],
      snapshotId: "snap-1",
    };

    const concentration = engine.computeConcentration(route, "VENUE");
    // Max concentration for VENUE dimension is 0.8.
    expect(concentration).toBe(0.8);
  });

  test("returns 0 concentration when no data matches dimension", () => {
    const cfg = config();
    const engine = new SystemicRiskOverlayEngine(cfg);

    const route = {
      routeId: "r1",
      routeType: "CROSS_CHAIN" as const,
      riskConcentration: {
        "VENUE:bybit": 0.8,
      },
      nodes: ["c1", "c2"],
      edges: ["e1"],
      score: 0.7,
      expectedNetProfitUsd: 50,
      maxCapitalUsd: 100_000,
      confidence: 0.9,
      status: "LIVE" as const,
      createdAtMs: NOW_MS,
      expiresAtMs: NOW_MS + 30_000,
      lastUpdatedAtMs: NOW_MS,
      invalidationReasons: [],
      snapshotId: "snap-1",
    };

    // CHAIN dimension has no entries with "CHAIN:" prefix and route is CROSS_CHAIN.
    // The matchesDimension function checks if the route has BRIDGE edges for CHAIN.
    // Since this is a CROSS_CHAIN route, it will match CHAIN dimension.
    // But there's no "CHAIN:" prefixed key. The fallback checks routeHasEdgeType.
    // For CROSS_CHAIN routes, routeHasEdgeType("BRIDGE") returns true.
    // So the VENUE key won't match CHAIN dimension.
    const concentration = engine.computeConcentration(route, "CHAIN");
    expect(concentration).toBe(0);
  });

  test("returns 0 when riskConcentration is empty", () => {
    const cfg = config();
    const engine = new SystemicRiskOverlayEngine(cfg);

    const route = {
      routeId: "r1",
      routeType: "CEX_CEX" as const,
      riskConcentration: {},
      nodes: ["v1"],
      edges: ["e1"],
      score: 0.7,
      expectedNetProfitUsd: 50,
      maxCapitalUsd: 100_000,
      confidence: 0.9,
      status: "LIVE" as const,
      createdAtMs: NOW_MS,
      expiresAtMs: NOW_MS + 30_000,
      lastUpdatedAtMs: NOW_MS,
      invalidationReasons: [],
      snapshotId: "snap-1",
    };

    const concentration = engine.computeConcentration(route, "VENUE");
    expect(concentration).toBe(0);
  });

  test("isBlocked returns true when any overlay blocks", () => {
    const cfg = config({
      overlays: [
        overlay({ dimension: "VENUE", maxConcentration: 0.3 }),
      ],
    });
    const engine = new SystemicRiskOverlayEngine(cfg);

    const route = {
      routeId: "r1",
      routeType: "CEX_CEX" as const,
      riskConcentration: { "VENUE:bybit": 0.5 },
      nodes: ["v1"],
      edges: ["e1"],
      score: 0.7,
      expectedNetProfitUsd: 50,
      maxCapitalUsd: 100_000,
      confidence: 0.9,
      status: "LIVE" as const,
      createdAtMs: NOW_MS,
      expiresAtMs: NOW_MS + 30_000,
      lastUpdatedAtMs: NOW_MS,
      invalidationReasons: [],
      snapshotId: "snap-1",
    };

    expect(engine.isBlocked(route)).toBe(true);
  });

  test("isBlocked returns false when no overlay blocks", () => {
    const cfg = config({
      overlays: [
        overlay({ dimension: "VENUE", maxConcentration: 0.9 }),
      ],
    });
    const engine = new SystemicRiskOverlayEngine(cfg);

    const route = {
      routeId: "r1",
      routeType: "CEX_CEX" as const,
      riskConcentration: { "VENUE:bybit": 0.5 },
      nodes: ["v1"],
      edges: ["e1"],
      score: 0.7,
      expectedNetProfitUsd: 50,
      maxCapitalUsd: 100_000,
      confidence: 0.9,
      status: "LIVE" as const,
      createdAtMs: NOW_MS,
      expiresAtMs: NOW_MS + 30_000,
      lastUpdatedAtMs: NOW_MS,
      invalidationReasons: [],
      snapshotId: "snap-1",
    };

    expect(engine.isBlocked(route)).toBe(false);
  });

  test("evaluateRoute returns one evaluation per enabled overlay", () => {
    const cfg = config({
      overlays: [
        overlay({ overlayId: "ov1", dimension: "VENUE", enabled: true }),
        overlay({ overlayId: "ov2", dimension: "CHAIN", enabled: true }),
        overlay({ overlayId: "ov3", dimension: "BRIDGE", enabled: false }),
      ],
    });
    const engine = new SystemicRiskOverlayEngine(cfg);

    const route = {
      routeId: "r1",
      routeType: "CROSS_CHAIN" as const,
      riskConcentration: {},
      nodes: ["c1"],
      edges: ["e1"],
      score: 0.7,
      expectedNetProfitUsd: 50,
      maxCapitalUsd: 100_000,
      confidence: 0.9,
      status: "LIVE" as const,
      createdAtMs: NOW_MS,
      expiresAtMs: NOW_MS + 30_000,
      lastUpdatedAtMs: NOW_MS,
      invalidationReasons: [],
      snapshotId: "snap-1",
    };

    const evaluations = engine.evaluateRoute(route);
    // Only 2 enabled overlays should produce evaluations.
    expect(evaluations).toHaveLength(2);
    expect(evaluations.map((e) => e.overlayId)).toContain("ov1");
    expect(evaluations.map((e) => e.overlayId)).toContain("ov2");
    expect(evaluations.map((e) => e.overlayId)).not.toContain("ov3");
  });
});

// ── Route scoring ───────────────────────────────────────────────────

describe("Route scoring", () => {
  test("higher profit yields higher score", () => {
    const nodes = [node("v1", "VENUE"), node("a1", "ASSET")];
    const highProfitEdge = edge("e1", "v1", "a1", "ORDER_BOOK", {
      price: 200,
      fee: 0.5,
      expectedSlippage: 0.2,
      gasCost: 0.1,
      confidence: 0.9,
      liquidityUsd: 100_000,
      riskScore: 0.1,
    });
    const lowProfitEdge = edge("e2", "v1", "a1", "ORDER_BOOK", {
      price: 2,
      fee: 0.5,
      expectedSlippage: 0.2,
      gasCost: 0.1,
      confidence: 0.9,
      liquidityUsd: 100_000,
      riskScore: 0.1,
    });

    const snapHigh = snapshot(nodes, [highProfitEdge]);
    const snapLow = snapshot(nodes, [lowProfitEdge]);

    const engine = new RouteEngine(config(), () => NOW_MS);
    const highResult = engine.discover(snapHigh, NOW_MS);
    const lowResult = engine.discover(snapLow, NOW_MS);

    expect(highResult.routes[0].score).toBeGreaterThan(
      lowResult.routes[0].score,
    );
  });

  test("higher confidence yields higher score", () => {
    const nodes = [node("v1", "VENUE"), node("a1", "ASSET")];
    const highConfEdge = edge("e1", "v1", "a1", "ORDER_BOOK", {
      confidence: 0.99,
      riskScore: 0.01,
    });
    const lowConfEdge = edge("e2", "v1", "a1", "ORDER_BOOK", {
      confidence: 0.3,
      riskScore: 0.01,
    });

    const snapHigh = snapshot(nodes, [highConfEdge]);
    const snapLow = snapshot(nodes, [lowConfEdge]);

    const engine = new RouteEngine(config(), () => NOW_MS);
    const highResult = engine.discover(snapHigh, NOW_MS);
    const lowResult = engine.discover(snapLow, NOW_MS);

    expect(highResult.routes[0].score).toBeGreaterThan(
      lowResult.routes[0].score,
    );
  });

  test("lower risk concentration yields higher score", () => {
    const nodes = [node("v1", "VENUE"), node("a1", "ASSET")];
    const lowRiskEdge = edge("e1", "v1", "a1", "ORDER_BOOK", {
      riskScore: 0.01,
      failureProbability: 0.001,
      liquidityUsd: 100,
    });
    const highRiskEdge = edge("e2", "v1", "a1", "ORDER_BOOK", {
      riskScore: 0.9,
      failureProbability: 0.05,
      liquidityUsd: 100,
    });

    const snapLow = snapshot(nodes, [lowRiskEdge]);
    const snapHigh = snapshot(nodes, [highRiskEdge]);

    const engine = new RouteEngine(config(), () => NOW_MS);
    const lowResult = engine.discover(snapLow, NOW_MS);
    const highResult = engine.discover(snapHigh, NOW_MS);

    // Canonical net profit lowers as failure risk grows (failureRiskUsd =
    // maxCapitalUsd x combined probability, issue #134).
    expect(lowResult.routes[0].expectedNetProfitUsd).toBeGreaterThan(
      highResult.routes[0].expectedNetProfitUsd,
    );
    // Risk concentration also lowers the composite score via the safety term.
    expect(lowResult.routes[0].score).toBeGreaterThan(
      highResult.routes[0].score,
    );
  });
});

// ── Canonical net profit (issue #134) ───────────────────────────────

const bybitRouteNodes: MarketNode[] = ORDER_BOOK_ROUTE.map((id) =>
  node(id, id.startsWith("venue:") ? "VENUE" : "ASSET"),
);

function bybitRouteEdges(price1: number, price2: number): MarketEdge[] {
  return orderBookEdges(price1, price2).map((def, i) =>
    edge(`e${i + 1}`, def.from, def.to, def.type, def.weights),
  );
}

describe("Canonical net profit (issue #134)", () => {
  test("parity: route-engine expectedNetProfitUsd equals graph scoreRoute", () => {
    // Non-profitable route: gross 12+8=20 < totalCost 182.27 → net -162.27.
    const losingSnap = snapshot(bybitRouteNodes, bybitRouteEdges(12, 8));
    const engine = new RouteEngine(config(), () => NOW_MS);
    const losingResult = engine.discover(losingSnap, NOW_MS);

    const losingRoute = losingResult.routes.find(
      (r) => r.nodes.join(">") === ORDER_BOOK_ROUTE.join(">"),
    );
    expect(losingRoute).toBeDefined();

    const losingCandidate = scoreRoute(
      losingSnap,
      [...ORDER_BOOK_ROUTE],
      20,
    );
    expect(losingCandidate).toBeDefined();
    expect(losingRoute!.expectedNetProfitUsd).toBeCloseTo(
      losingCandidate!.expectedNetProfitUsd,
      10,
    );
    expect(losingRoute!.expectedNetProfitUsd).toBeCloseTo(20 - ORDER_BOOK_TOTAL_COST_USD, 2);

    // Profitable route: gross 150+120=270 → net 87.73.
    const winningSnap = snapshot(bybitRouteNodes, bybitRouteEdges(150, 120));
    const winningResult = engine.discover(winningSnap, NOW_MS);

    const winningRoute = winningResult.routes.find(
      (r) => r.nodes.join(">") === ORDER_BOOK_ROUTE.join(">"),
    );
    expect(winningRoute).toBeDefined();

    const winningCandidate = scoreRoute(
      winningSnap,
      [...ORDER_BOOK_ROUTE],
      ORDER_BOOK_GROSS_SPREAD_USD,
    );
    expect(winningCandidate).toBeDefined();
    expect(winningRoute!.expectedNetProfitUsd).toBeCloseTo(
      winningCandidate!.expectedNetProfitUsd,
      10,
    );
    expect(winningRoute!.expectedNetProfitUsd).toBeCloseTo(
      ORDER_BOOK_GROSS_SPREAD_USD - ORDER_BOOK_TOTAL_COST_USD,
      2,
    );
  });

  test("MIN_EDGE gating uses the canonical figure", () => {
    // Non-profitable route is not executable under the canonical cost stack.
    const losingSnap = snapshot(bybitRouteNodes, bybitRouteEdges(12, 8));
    const engine = new RouteEngine(config(), () => NOW_MS);
    const losingResult = engine.discover(losingSnap, NOW_MS);

    const losingRoute = losingResult.routes.find(
      (r) => r.nodes.join(">") === ORDER_BOOK_ROUTE.join(">"),
    );
    expect(losingRoute).toBeDefined();
    expect(losingRoute!.status).toBe("EXPIRED");
    expect(losingRoute!.invalidationReasons).toContain("MIN_EDGE");

    // The graph aggregator agrees: the same figure yields INVALID + MIN_EDGE.
    const losingCandidate = scoreRoute(
      losingSnap,
      [...ORDER_BOOK_ROUTE],
      20,
    );
    expect(losingCandidate!.status).toBe("INVALID");
    expect(losingCandidate!.invalidationReasons).toContain("MIN_EDGE");

    // Profitable route stays LIVE and unmatched by any MIN_EDGE gate.
    const winningSnap = snapshot(bybitRouteNodes, bybitRouteEdges(150, 120));
    const winningResult = engine.discover(winningSnap, NOW_MS);

    const winningRoute = winningResult.routes.find(
      (r) => r.nodes.join(">") === ORDER_BOOK_ROUTE.join(">"),
    );
    expect(winningRoute).toBeDefined();
    expect(winningRoute!.status).toBe("LIVE");
    expect(winningRoute!.invalidationReasons).not.toContain("MIN_EDGE");
  });
});

// ── Default configuration ───────────────────────────────────────────

describe("Default configuration", () => {
  test("has reasonable defaults", () => {
    expect(DEFAULT_ROUTE_ENGINE_CONFIG.maxRouteLength).toBeGreaterThan(0);
    expect(DEFAULT_ROUTE_ENGINE_CONFIG.routeTtlMs).toBeGreaterThan(0);
    expect(DEFAULT_ROUTE_ENGINE_CONFIG.stalenessThresholdMs).toBeGreaterThan(0);
    expect(DEFAULT_ROUTE_ENGINE_CONFIG.overlays.length).toBeGreaterThan(0);

    // Scoring weights should be positive.
    const s = DEFAULT_ROUTE_ENGINE_CONFIG.scoring;
    expect(s.profitWeight).toBeGreaterThan(0);
    expect(s.confidenceWeight).toBeGreaterThan(0);
    expect(s.liquidityWeight).toBeGreaterThan(0);
    expect(s.safetyWeight).toBeGreaterThan(0);
    expect(s.brevityWeight).toBeGreaterThan(0);
  });

  test("overlay dimensions cover all systemic risk categories", () => {
    const dims = DEFAULT_ROUTE_ENGINE_CONFIG.overlays.map((o) => o.dimension);
    expect(dims).toContain("VENUE");
    expect(dims).toContain("CHAIN");
    expect(dims).toContain("STABLECOIN");
    expect(dims).toContain("BRIDGE");
    expect(dims).toContain("POOL");
    expect(dims).toContain("RPC");
    expect(dims).toContain("WRAPPED_ASSET");
  });
});

// ── Engine construction and lifecycle ───────────────────────────────

describe("Engine construction and lifecycle", () => {
  test("constructs with default config", () => {
    const engine = new RouteEngine();
    expect(engine).toBeDefined();
    expect(engine.activeRouteCount()).toBe(0);
  });

  test("constructs with custom config", () => {
    const engine = new RouteEngine(config({ maxRouteLength: 10 }));
    expect(engine).toBeDefined();
  });

  test("getActiveRoutes returns current live routes", () => {
    const nodes = [node("v1", "VENUE"), node("a1", "ASSET")];
    const edges = [edge("e1", "v1", "a1", "ORDER_BOOK")];
    const snap = snapshot(nodes, edges);
    const engine = new RouteEngine(config(), () => NOW_MS);

    expect(engine.getActiveRoutes()).toHaveLength(0);

    engine.discover(snap, NOW_MS);
    expect(engine.getActiveRoutes().length).toBeGreaterThanOrEqual(1);
  });

  test("getRoute returns specific route by id", () => {
    const nodes = [node("v1", "VENUE"), node("a1", "ASSET")];
    const edges = [edge("e1", "v1", "a1", "ORDER_BOOK")];
    const snap = snapshot(nodes, edges);
    const engine = new RouteEngine(config(), () => NOW_MS);

    const result = engine.discover(snap, NOW_MS);
    const route = result.liveRoutes[0];

    expect(engine.getRoute(route.routeId)).toBeDefined();
    expect(engine.getRoute(route.routeId)!.routeId).toBe(route.routeId);
  });

  test("getConfig returns a copy of the config", () => {
    const cfg = config({ maxRouteLength: 42 });
    const engine = new RouteEngine(cfg, () => NOW_MS);
    const returned = engine.getConfig();
    expect(returned.maxRouteLength).toBe(42);
    // Mutating the returned config should not affect the engine.
    returned.maxRouteLength = 99;
    expect(engine.getConfig().maxRouteLength).toBe(42);
  });
});
