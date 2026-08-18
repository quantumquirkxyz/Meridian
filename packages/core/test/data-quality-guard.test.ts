import { describe, expect, test } from "bun:test";
import { dataQualityBlocksSignal } from "../src/stategraph/guards.ts";
import {
  markEdgesByQuality,
  type DataQualityReport,
  type StateContext,
} from "@agenttrading/contracts";

function makeCtx(
  data?: Record<string, unknown>,
): StateContext {
  return {
    state: "DETECT_OPPORTUNITY",
    mode: "NORMAL",
    updatedAtMs: 1_700_000_000_000,
    data,
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

function disconnectedReport(source: string): DataQualityReport {
  return {
    source,
    state: "DISCONNECTED",
    score: 0,
    updatedAtMs: 1_700_000_000_000,
    lastSeenMs: 1_699_999_000_000,
  };
}

describe("dataQualityBlocksSignal", () => {
  test("blocks when no reports present", () => {
    const guard = dataQualityBlocksSignal("testGuard");
    const result = guard.evaluate(makeCtx());
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("no data quality reports");
  });

  test("passes when all dependent sources are HEALTHY", () => {
    const guard = dataQualityBlocksSignal("testGuard");
    const ctx = makeCtx({
      source: "bybit-ws",
      dataQualityReports: [healthyReport("bybit-ws")],
    });
    expect(guard.evaluate(ctx).ok).toBe(true);
  });

  test("blocks when source is STALE (default threshold)", () => {
    const guard = dataQualityBlocksSignal("testGuard");
    const ctx = makeCtx({
      source: "bybit-ws",
      dataQualityReports: [staleReport("bybit-ws")],
    });
    const result = guard.evaluate(ctx);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("STALE");
  });

  test("blocks when source is DISCONNECTED", () => {
    const guard = dataQualityBlocksSignal("testGuard");
    const ctx = makeCtx({
      source: "bybit-ws",
      dataQualityReports: [disconnectedReport("bybit-ws")],
    });
    const result = guard.evaluate(ctx);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("DISCONNECTED");
  });

  test("blocks when DEGRADED with default DEGRADED threshold", () => {
    const guard = dataQualityBlocksSignal("testGuard");
    const ctx = makeCtx({
      source: "bybit-ws",
      dataQualityReports: [degradedReport("bybit-ws")],
    });
    expect(guard.evaluate(ctx).ok).toBe(false);
  });

  test("blocks when DEGRADED with DEGRADED threshold", () => {
    const guard = dataQualityBlocksSignal("testGuard", {
      threshold: "DEGRADED",
    });
    const ctx = makeCtx({
      source: "bybit-ws",
      dataQualityReports: [degradedReport("bybit-ws")],
    });
    const result = guard.evaluate(ctx);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("DEGRADED");
  });

  test("does not block on an unrelated degraded source", () => {
    const guard = dataQualityBlocksSignal("testGuard");
    const ctx = makeCtx({
      source: "bybit-ws",
      dataQualityReports: [
        healthyReport("bybit-ws"),
        degradedReport("pancakeswap-rpc"),
      ],
    });
    expect(guard.evaluate(ctx).ok).toBe(true);
  });

  test("blocks when no report exists for the dependent source", () => {
    const guard = dataQualityBlocksSignal("testGuard");
    const ctx = makeCtx({
      source: "other-source",
      dataQualityReports: [staleReport("bybit-ws")],
    });
    const result = guard.evaluate(ctx);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("missing report for dependent source");
  });

  test("blocks when some but not all dependent sources have reports", () => {
    const guard = dataQualityBlocksSignal("testGuard", {
      sourceKeys: ["sources"],
    });
    const ctx = makeCtx({
      sources: ["bybit-ws", "pancakeswap-rpc"],
      dataQualityReports: [healthyReport("bybit-ws")],
    });
    const result = guard.evaluate(ctx);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("missing report for dependent source pancakeswap-rpc");
  });

  test("supports sourceKeys with an array of dependent sources", () => {
    const guard = dataQualityBlocksSignal("testGuard", {
      sourceKeys: ["sources"],
    });
    const ctx = makeCtx({
      sources: ["bybit-ws", "pancakeswap-rpc"],
      dataQualityReports: [
        degradedReport("bybit-ws"),
        healthyReport("pancakeswap-rpc"),
      ],
    });
    const result = guard.evaluate(ctx);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("bybit-ws");
  });
});

describe("markEdgesByQuality", () => {
  test("marks STALE source edge as non-tradable", () => {
    const edges = [
      { id: "e1", source: "bybit-ws", tradable: true },
      { id: "e2", source: "pancakeswap-rpc", tradable: true },
    ];
    const reports = [staleReport("bybit-ws"), healthyReport("pancakeswap-rpc")];

    const result = markEdgesByQuality(edges, reports);
    expect(result[0].tradable).toBe(false);
    expect(result[1].tradable).toBe(true);
  });

  test("marks edges with no report as non-tradable (fail closed)", () => {
    const edges = [
      { id: "e1", source: "bybit-ws", tradable: true },
      { id: "e2", source: "pancakeswap-rpc", tradable: true },
    ];
    const reports = [staleReport("bybit-ws")];

    const result = markEdgesByQuality(edges, reports);
    expect(result[0].tradable).toBe(false);
    expect(result[1].tradable).toBe(false);
  });

  test("marks DISCONNECTED source edge as non-tradable", () => {
    const edges = [{ id: "e1", source: "bybit-ws", tradable: true }];
    const reports = [disconnectedReport("bybit-ws")];

    const result = markEdgesByQuality(edges, reports);
    expect(result[0].tradable).toBe(false);
  });

  test("does not mark HEALTHY source edge", () => {
    const edges = [{ id: "e1", source: "bybit-ws", tradable: true }];
    const reports = [healthyReport("bybit-ws")];

    const result = markEdgesByQuality(edges, reports);
    expect(result[0].tradable).toBe(true);
  });

  test("with DEGRADED threshold, marks degraded edges", () => {
    const edges = [{ id: "e1", source: "bybit-ws", tradable: true }];
    const reports = [degradedReport("bybit-ws")];

    const result = markEdgesByQuality(edges, reports, "DEGRADED");
    expect(result[0].tradable).toBe(false);
  });

  test("does not mutate original edges", () => {
    const edges = [{ id: "e1", source: "bybit-ws", tradable: true }];
    const reports = [staleReport("bybit-ws")];

    markEdgesByQuality(edges, reports);
    expect(edges[0].tradable).toBe(true);
  });

  test("marks edge with no matching report as non-tradable (fail closed)", () => {
    const edges = [{ id: "e1", source: "unknown-source", tradable: true }];
    const reports = [staleReport("bybit-ws")];

    const result = markEdgesByQuality(edges, reports);
    expect(result[0].tradable).toBe(false);
  });
});
