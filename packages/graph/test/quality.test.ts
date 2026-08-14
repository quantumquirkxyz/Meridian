import { describe, expect, test } from "bun:test";
import {
  applyDataQualityToGraph,
  markEdgesFromSources,
  graphSourceIds,
  tradableEdges,
  nonTradableEdges,
} from "../src/quality.ts";
import type {
  DataQualityReport,
  MarketEdge,
  MarketGraphSnapshot,
} from "@agenttrading/contracts";

function makeSnapshot(edges: MarketEdge[]): MarketGraphSnapshot {
  return {
    version: 1,
    snapshotId: "snap-1",
    createdAtMs: 1_700_000_000_000,
    nodes: [],
    edges,
  };
}

function makeEdge(
  id: string,
  source: string,
  tradable = true,
): MarketEdge {
  return {
    id,
    from: "asset:BTC",
    to: "venue:bybit",
    type: "ORDER_BOOK",
    weights: { price: 30_000 },
    tradable,
    source,
  };
}

function healthyReport(source: string): DataQualityReport {
  return {
    source,
    state: "HEALTHY",
    score: 0.99,
    updatedAtMs: 1_700_000_000_000,
    lastSeenMs: 1_699_999_999_000,
  };
}

function degradedReport(source: string): DataQualityReport {
  return {
    source,
    state: "DEGRADED",
    score: 0.5,
    updatedAtMs: 1_700_000_000_000,
    lastSeenMs: 1_699_999_990_000,
  };
}

function staleReport(source: string): DataQualityReport {
  return {
    source,
    state: "STALE",
    score: 0.2,
    updatedAtMs: 1_700_000_000_000,
    lastSeenMs: 1_699_999_900_000,
  };
}

describe("applyDataQualityToGraph", () => {
  test("marks degraded source edges as non-tradable", () => {
    const snapshot = makeSnapshot([
      makeEdge("e1", "bybit-ws"),
      makeEdge("e2", "pancakeswap-rpc"),
    ]);
    const reports = [degradedReport("bybit-ws")];

    const result = applyDataQualityToGraph(snapshot, reports);
    expect(result.edges[0].tradable).toBe(false);
    expect(result.edges[1].tradable).toBe(true);
  });

  test("does not mutate original snapshot", () => {
    const snapshot = makeSnapshot([makeEdge("e1", "bybit-ws")]);
    const reports = [staleReport("bybit-ws")];

    applyDataQualityToGraph(snapshot, reports);
    expect(snapshot.edges[0].tradable).toBe(true);
  });

  test("preserves snapshot metadata", () => {
    const snapshot = makeSnapshot([makeEdge("e1", "bybit-ws")]);
    const reports = [staleReport("bybit-ws")];

    const result = applyDataQualityToGraph(snapshot, reports);
    expect(result.version).toBe(1);
    expect(result.snapshotId).toBe("snap-1");
    expect(result.nodes).toEqual([]);
  });

  test("with STALE threshold, only marks STALE+ edges", () => {
    const snapshot = makeSnapshot([
      makeEdge("e1", "bybit-ws"),
      makeEdge("e2", "other"),
    ]);
    const reports = [degradedReport("bybit-ws"), staleReport("other")];

    const result = applyDataQualityToGraph(snapshot, reports, "STALE");
    expect(result.edges[0].tradable).toBe(true);
    expect(result.edges[1].tradable).toBe(false);
  });
});

describe("markEdgesFromSources", () => {
  test("marks edges from degraded sources", () => {
    const edges = [makeEdge("e1", "bybit-ws"), makeEdge("e2", "other")];
    const reports = [degradedReport("bybit-ws")];

    const result = markEdgesFromSources(edges, reports);
    expect(result[0].tradable).toBe(false);
    expect(result[1].tradable).toBe(true);
  });

  test("returns new array, does not mutate", () => {
    const edges = [makeEdge("e1", "bybit-ws")];
    const reports = [staleReport("bybit-ws")];

    const result = markEdgesFromSources(edges, reports);
    expect(result).not.toBe(edges);
    expect(edges[0].tradable).toBe(true);
  });
});

describe("graphSourceIds", () => {
  test("returns unique source ids", () => {
    const snapshot = makeSnapshot([
      makeEdge("e1", "bybit-ws"),
      makeEdge("e2", "bybit-ws"),
      makeEdge("e3", "pancakeswap-rpc"),
    ]);

    expect(graphSourceIds(snapshot)).toEqual(["bybit-ws", "pancakeswap-rpc"]);
  });

  test("empty graph returns empty array", () => {
    expect(graphSourceIds(makeSnapshot([]))).toEqual([]);
  });
});

describe("tradableEdges / nonTradableEdges", () => {
  test("filters correctly", () => {
    const snapshot = makeSnapshot([
      makeEdge("e1", "bybit-ws", true),
      makeEdge("e2", "other", false),
    ]);

    expect(tradableEdges(snapshot)).toHaveLength(1);
    expect(tradableEdges(snapshot)[0].id).toBe("e1");
    expect(nonTradableEdges(snapshot)).toHaveLength(1);
    expect(nonTradableEdges(snapshot)[0].id).toBe("e2");
  });
});
