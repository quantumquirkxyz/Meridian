import { describe, expect, test } from "bun:test";
import { MarketGraph } from "../src/market-graph.ts";
import { GraphEventProcessor } from "../src/graph-event-processor.ts";
import type {
  MarketNode,
  MarketEdge,
  MarketGraphSnapshot,
  MarketDataSnapshot,
  OrderBookSnapshotPayload,
  PoolStateUpdatePayload,
  GasUpdatePayload,
  FundingUpdatePayload,
} from "@agenttrading/contracts";

// ── Helpers ────────────────────────────────────────────────────────

function makeTick(overrides: Partial<MarketDataSnapshot> = {}): MarketDataSnapshot {
  return {
    venue: "bybit",
    symbol: "BTC/USDT",
    timestampMs: 1_700_000_000_000,
    bid: 42_000,
    ask: 42_010,
    mid: 42_005,
    depth: 100_000,
    latencyMs: 50,
    source: "bybit-ws",
    ...overrides,
  };
}

function makeOrderBook(
  overrides: Partial<OrderBookSnapshotPayload> = {},
): OrderBookSnapshotPayload {
  return {
    venue: "bybit",
    symbol: "BTC/USDT",
    timestampMs: 1_700_000_000_000,
    bids: [
      { price: 42_000, size: 1.5 },
      { price: 41_990, size: 2.0 },
    ],
    asks: [
      { price: 42_010, size: 1.2 },
      { price: 42_020, size: 3.0 },
    ],
    ...overrides,
  };
}

function makePool(
  overrides: Partial<PoolStateUpdatePayload> = {},
): PoolStateUpdatePayload {
  return {
    venue: "pancakeswap-v4",
    poolAddress: "0xabc",
    symbol: "ETH/USDC",
    timestampMs: 1_700_000_000_000,
    reserve0: 1000,
    reserve1: 2_000_000,
    price: 2000,
    liquidityUsd: 4_000_000,
    ...overrides,
  };
}

function makeGasUpdate(
  overrides: Partial<GasUpdatePayload> = {},
): GasUpdatePayload {
  return {
    venue: "pancakeswap-v4",
    chain: "ethereum",
    timestampMs: 1_700_000_000_000,
    gasPriceGwei: 25,
    ...overrides,
  };
}

function makeFundingUpdate(
  overrides: Partial<FundingUpdatePayload> = {},
): FundingUpdatePayload {
  return {
    venue: "bybit",
    symbol: "BTC/USDT",
    timestampMs: 1_700_000_000_000,
    fundingRate: 0.0001,
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────

describe("MarketGraph", () => {
  describe("node operations", () => {
    test("addNode inserts a new node", () => {
      const graph = new MarketGraph();
      graph.addNode({ id: "asset:BTC", type: "ASSET" });
      expect(graph.getNode("asset:BTC")).toEqual({
        id: "asset:BTC",
        type: "ASSET",
      });
    });

    test("addNode is idempotent", () => {
      const graph = new MarketGraph();
      graph.addNode({ id: "asset:BTC", type: "ASSET" });
      graph.addNode({ id: "asset:BTC", type: "ASSET" });
      expect(graph.getNodes()).toHaveLength(1);
    });

    test("upsertNode merges meta on existing node", () => {
      const graph = new MarketGraph();
      graph.upsertNode({ id: "pool:uni:0x1", type: "POOL", meta: { fee: 3000 } });
      graph.upsertNode({ id: "pool:uni:0x1", type: "POOL", meta: { tvl: 500 } });
      const node = graph.getNode("pool:uni:0x1");
      expect(node?.meta).toEqual({ fee: 3000, tvl: 500 });
    });

    test("removeNode removes node and connected edges", () => {
      const graph = new MarketGraph();
      graph.addNode({ id: "asset:BTC", type: "ASSET" });
      graph.addNode({ id: "venue:bybit", type: "VENUE" });
      graph.upsertEdge("asset:BTC", "venue:bybit", "ORDER_BOOK", { price: 42_000 }, "bybit-ws");
      expect(graph.removeNode("asset:BTC")).toBe(true);
      expect(graph.getNode("asset:BTC")).toBeUndefined();
      expect(graph.getEdges()).toHaveLength(0);
    });

    test("getNodesByType filters correctly", () => {
      const graph = new MarketGraph();
      graph.addNode({ id: "asset:BTC", type: "ASSET" });
      graph.addNode({ id: "venue:bybit", type: "VENUE" });
      graph.addNode({ id: "chain:ethereum", type: "CHAIN" });
      expect(graph.getNodesByType("ASSET")).toHaveLength(1);
      expect(graph.getNodesByType("VENUE")).toHaveLength(1);
      expect(graph.getNodesByType("CHAIN")).toHaveLength(1);
    });

    test("version bumps on structural change", () => {
      const graph = new MarketGraph();
      expect(graph.version).toBe(0);
      graph.addNode({ id: "asset:BTC", type: "ASSET" });
      expect(graph.version).toBe(1);
      graph.addNode({ id: "asset:BTC", type: "ASSET" }); // idempotent
      expect(graph.version).toBe(1);
    });
  });

  describe("edge operations", () => {
    test("upsertEdge creates a new edge", () => {
      const graph = new MarketGraph();
      const edgeId = graph.upsertEdge(
        "asset:BTC",
        "venue:bybit",
        "ORDER_BOOK",
        { price: 42_000, liquidityUsd: 100_000 },
        "bybit-ws",
      );
      expect(edgeId).toBe("asset:BTC→venue:bybit:ORDER_BOOK");
      const edge = graph.getEdge(edgeId);
      expect(edge).toBeDefined();
      expect(edge?.weights.price).toBe(42_000);
      expect(edge?.tradable).toBe(true);
    });

    test("upsertEdge updates weights on existing edge", () => {
      const graph = new MarketGraph();
      graph.upsertEdge(
        "asset:BTC",
        "venue:bybit",
        "ORDER_BOOK",
        { price: 42_000 },
        "bybit-ws",
      );
      graph.upsertEdge(
        "asset:BTC",
        "venue:bybit",
        "ORDER_BOOK",
        { price: 42_100, liquidityUsd: 200_000 },
        "bybit-ws",
      );
      const edge = graph.getEdge("asset:BTC→venue:bybit:ORDER_BOOK");
      expect(edge?.weights.price).toBe(42_100);
      expect(edge?.weights.liquidityUsd).toBe(200_000);
    });

    test("getEdgesFrom and getEdgesTo filter correctly", () => {
      const graph = new MarketGraph();
      graph.upsertEdge("asset:BTC", "venue:bybit", "ORDER_BOOK", {}, "bybit-ws");
      graph.upsertEdge("asset:ETH", "venue:bybit", "ORDER_BOOK", {}, "bybit-ws");
      expect(graph.getEdgesFrom("asset:BTC")).toHaveLength(1);
      expect(graph.getEdgesTo("venue:bybit")).toHaveLength(2);
    });

    test("removeEdge removes an edge", () => {
      const graph = new MarketGraph();
      const id = graph.upsertEdge("asset:BTC", "venue:bybit", "ORDER_BOOK", {}, "bybit-ws");
      expect(graph.removeEdge(id)).toBe(true);
      expect(graph.getEdge(id)).toBeUndefined();
    });
  });

  describe("versioned snapshots", () => {
    test("snapshot captures current state", () => {
      const graph = new MarketGraph();
      graph.addNode({ id: "asset:BTC", type: "ASSET" });
      graph.upsertEdge("asset:BTC", "venue:bybit", "ORDER_BOOK", { price: 42_000 }, "bybit-ws");

      const snap = graph.snapshot();
      expect(snap.version).toBe(2);
      expect(snap.nodes).toHaveLength(1);
      expect(snap.edges).toHaveLength(1);
      expect(snap.snapshotId).toContain("snap:1:");
      expect(snap.createdAtMs).toBeGreaterThan(0);
    });

    test("snapshots are versioned and monotonically increasing", () => {
      const graph = new MarketGraph();
      graph.addNode({ id: "asset:BTC", type: "ASSET" });
      const snap1 = graph.snapshot();
      graph.addNode({ id: "asset:ETH", type: "ASSET" });
      const snap2 = graph.snapshot();
      expect(snap2.version).toBeGreaterThan(snap1.version);
      expect(graph.snapshotCount).toBe(2);
    });

    test("restoreFromSnapshot replaces graph state", () => {
      const graph = new MarketGraph();
      graph.addNode({ id: "asset:BTC", type: "ASSET" });
      const snap = graph.snapshot();

      const graph2 = new MarketGraph();
      graph2.addNode({ id: "asset:DOGE", type: "ASSET" });
      expect(graph2.getNodes()).toHaveLength(1);

      graph2.restoreFromSnapshot(snap);
      expect(graph2.getNodes()).toHaveLength(1);
      expect(graph2.getNode("asset:BTC")).toBeDefined();
      expect(graph2.getNode("asset:DOGE")).toBeUndefined();
    });
  });

  describe("incremental updates from normalized events", () => {
    test("applyTick creates asset, venue, and ORDER_BOOK edge", () => {
      const graph = new MarketGraph();
      const processor = new GraphEventProcessor(graph);
      const touched = processor.applyTick(makeTick());
      expect(touched).toContain("asset:BTC/USDT");
      expect(touched).toContain("venue:bybit");
      expect(graph.getNode("asset:BTC/USDT")?.type).toBe("ASSET");
      expect(graph.getNode("venue:bybit")?.type).toBe("VENUE");
      const edge = graph.getEdge("asset:BTC/USDT→venue:bybit:ORDER_BOOK");
      expect(edge).toBeDefined();
      expect(edge?.weights.price).toBe(42_005);
      expect(edge?.weights.liquidityUsd).toBe(100_000);
    });

    test("applyTick updates existing edge on second tick", () => {
      const graph = new MarketGraph();
      const processor = new GraphEventProcessor(graph);
      processor.applyTick(makeTick({ mid: 42_000 }));
      processor.applyTick(makeTick({ mid: 42_500 }));
      const edge = graph.getEdge("asset:BTC/USDT→venue:bybit:ORDER_BOOK");
      expect(edge?.weights.price).toBe(42_500);
    });

    test("applyTick with chain creates CHAIN node", () => {
      const graph = new MarketGraph();
      const processor = new GraphEventProcessor(graph);
      processor.applyTick(makeTick({ chain: "ethereum" }));
      expect(graph.getNode("chain:ethereum")?.type).toBe("CHAIN");
    });

    test("applyOrderBook computes depth from bids and asks", () => {
      const graph = new MarketGraph();
      const processor = new GraphEventProcessor(graph);
      const touched = processor.applyOrderBook(makeOrderBook());
      expect(touched).toContain("asset:BTC/USDT");
      expect(touched).toContain("venue:bybit");
      const edge = graph.getEdge("asset:BTC/USDT→venue:bybit:ORDER_BOOK");
      expect(edge).toBeDefined();
      // bidDepth = 1.5*42000 + 2.0*41990 = 63000 + 83980 = 146980
      // askDepth = 1.2*42010 + 3.0*42020 = 50412 + 126060 = 176472
      expect(edge?.weights.liquidityUsd).toBeCloseTo(323_452, 0);
    });

    test("applyPoolState creates POOL node and SWAP edge", () => {
      const graph = new MarketGraph();
      const processor = new GraphEventProcessor(graph);
      const touched = processor.applyPoolState(makePool());
      expect(touched).toContain("pool:pancakeswap-v4:0xabc");
      expect(touched).toContain("asset:ETH/USDC");
      const poolNode = graph.getNode("pool:pancakeswap-v4:0xabc");
      expect(poolNode?.type).toBe("POOL");
      const edge = graph.getEdge("pool:pancakeswap-v4:0xabc→asset:ETH/USDC:SWAP");
      expect(edge).toBeDefined();
      expect(edge?.weights.price).toBe(2000);
      expect(edge?.weights.liquidityUsd).toBe(4_000_000);
    });

    test("applyGasUpdate updates gas cost on matching edges", () => {
      const graph = new MarketGraph();
      const processor = new GraphEventProcessor(graph);
      processor.applyTick(makeTick({ venue: "pancakeswap-v4", source: "pancakeswap-v4" }));
      processor.applyGasUpdate(makeGasUpdate());
      const edge = graph.getEdge("asset:BTC/USDT→venue:pancakeswap-v4:ORDER_BOOK");
      expect(edge?.weights.gasCost).toBe(25);
    });

    test("applyFundingUpdate updates funding rate on matching edges", () => {
      const graph = new MarketGraph();
      const processor = new GraphEventProcessor(graph);
      processor.applyTick(makeTick({ source: "bybit" }));
      processor.applyFundingUpdate(makeFundingUpdate());
      const edge = graph.getEdge("asset:BTC/USDT→venue:bybit:ORDER_BOOK");
      expect(edge?.weights.fundingCost).toBe(0.0001);
    });

    test("applyEvents processes multiple events in sequence", () => {
      const graph = new MarketGraph();
      const processor = new GraphEventProcessor(graph);
      const total = processor.applyEvents([
        { type: "MARKET_TICK", payload: makeTick() },
        { type: "ORDERBOOK_SNAPSHOT", payload: makeOrderBook({ symbol: "ETH/USDT" }) },
        { type: "POOL_STATE_UPDATE", payload: makePool() },
      ]);
      expect(total).toBeGreaterThan(0);
      expect(graph.getNodes().length).toBeGreaterThanOrEqual(3);
      expect(graph.getEdges().length).toBeGreaterThanOrEqual(3);
    });
  });

  describe("route filtering", () => {
    function makeFilterGraph(): MarketGraph {
      const graph = new MarketGraph();
      graph.addNode({ id: "asset:A", type: "ASSET" });
      graph.addNode({ id: "asset:B", type: "ASSET" });
      graph.addNode({ id: "asset:C", type: "ASSET" });
      graph.upsertEdge("asset:A", "asset:B", "ORDER_BOOK", { liquidityUsd: 50_000 }, "src1");
      graph.upsertEdge("asset:B", "asset:C", "ORDER_BOOK", { liquidityUsd: 10_000 }, "src2");
      return graph;
    }

    test("keeps executable routes", () => {
      const graph = makeFilterGraph();
      const routes = graph.filterExecutableRoutes([
        ["asset:A", "asset:B", "asset:C"],
      ]);
      expect(routes).toHaveLength(1);
    });

    test("discards routes with non-tradable edges", () => {
      const graph = makeFilterGraph();
      // Mark edge as non-tradable.
      graph.upsertEdge("asset:A", "asset:B", "ORDER_BOOK", {}, "src1", false);
      const routes = graph.filterExecutableRoutes([
        ["asset:A", "asset:B", "asset:C"],
      ]);
      expect(routes).toHaveLength(0);
    });

    test("discards routes exceeding maxHops", () => {
      const graph = makeFilterGraph();
      const longRoute = ["asset:A", "asset:B", "asset:C", "asset:A", "asset:B"];
      const routes = graph.filterExecutableRoutes([longRoute], { maxHops: 2 });
      expect(routes).toHaveLength(0);
    });

    test("discards routes below minLiquidityUsd", () => {
      const graph = makeFilterGraph();
      const routes = graph.filterExecutableRoutes(
        [["asset:A", "asset:B", "asset:C"]],
        { minLiquidityUsd: 20_000 },
      );
      expect(routes).toHaveLength(0); // bottleneck is 10_000
    });

    test("discards routes with cycles", () => {
      const graph = makeFilterGraph();
      const routes = graph.filterExecutableRoutes([
        ["asset:A", "asset:B", "asset:A"],
      ]);
      expect(routes).toHaveLength(0);
    });

    test("discards routes with high failure probability", () => {
      const graph = new MarketGraph();
      graph.addNode({ id: "asset:A", type: "ASSET" });
      graph.addNode({ id: "asset:B", type: "ASSET" });
      graph.upsertEdge(
        "asset:A",
        "asset:B",
        "ORDER_BOOK",
        { failureProbability: 0.9 },
        "src1",
      );
      const routes = graph.filterExecutableRoutes(
        [["asset:A", "asset:B"]],
        { maxFailureProbability: 0.5 },
      );
      expect(routes).toHaveLength(0);
    });
  });
});
