import { describe, expect, test } from "bun:test";
import {
  applyDataQualityToGraph,
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
    const reports = [degradedReport("bybit-ws"), healthyReport("pancakeswap-rpc")];

    const result = applyDataQualityToGraph(snapshot, reports);
    expect(result.edges[0].tradable).toBe(false);
    expect(result.edges[1].tradable).toBe(true);
  });

  test("marks edges with no report as non-tradable (fail closed)", () => {
    const snapshot = makeSnapshot([
      makeEdge("e1", "bybit-ws"),
      makeEdge("e2", "pancakeswap-rpc"),
    ]);
    const reports = [degradedReport("bybit-ws")];

    const result = applyDataQualityToGraph(snapshot, reports);
    expect(result.edges[0].tradable).toBe(false);
    expect(result.edges[1].tradable).toBe(false);
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

  test("edges with no matching report are non-tradable (fail closed)", () => {
    const snapshot = makeSnapshot([
      makeEdge("e1", "unknown-source"),
      makeEdge("e2", "bybit-ws"),
    ]);
    const reports = [healthyReport("bybit-ws")];

    const result = applyDataQualityToGraph(snapshot, reports);
    expect(result.edges[0].tradable).toBe(false);
    expect(result.edges[1].tradable).toBe(true);
  });
});


