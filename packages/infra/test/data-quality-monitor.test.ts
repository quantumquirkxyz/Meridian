import { describe, expect, test } from "bun:test";
import { DataQualityMonitor } from "../src/data-quality-monitor.ts";
import type { DataQualityMetrics } from "@agenttrading/contracts";

function healthyMetrics(source = "bybit-ws-linear"): DataQualityMetrics {
  return {
    source,
    latencyMs: 10,
    stalenessMs: 100,
    gapCount: 0,
    wsRestConsistent: true,
    rpcHealthy: true,
    exchangeStatus: "online",
  };
}

function degradedMetrics(
  source = "bybit-ws-linear",
): DataQualityMetrics {
  return {
    source,
    latencyMs: 2_500,
    stalenessMs: 5_000,
    gapCount: 3,
    wsRestConsistent: false,
    rpcHealthy: true,
    exchangeStatus: "online",
  };
}

function staleMetrics(source = "bybit-ws-linear"): DataQualityMetrics {
  return {
    source,
    latencyMs: 100,
    stalenessMs: 35_000,
    gapCount: 0,
    wsRestConsistent: true,
    rpcHealthy: true,
    exchangeStatus: "online",
  };
}

function disconnectedMetrics(
  source = "bybit-ws-linear",
): DataQualityMetrics {
  return {
    source,
    latencyMs: 100,
    stalenessMs: 100,
    gapCount: 0,
    wsRestConsistent: true,
    rpcHealthy: false,
    exchangeStatus: "offline",
  };
}

describe("DataQualityMonitor", () => {
  test("evaluates a healthy source", () => {
    const monitor = new DataQualityMonitor();
    const report = monitor.evaluate(healthyMetrics(), 1_700_000_000_000);
    expect(report.state).toBe("HEALTHY");
    expect(report.score).toBe(1);
    expect(monitor.size).toBe(1);
  });

  test("tracks multiple sources independently", () => {
    const monitor = new DataQualityMonitor();
    monitor.evaluate(healthyMetrics("source-a"), 1_000);
    monitor.evaluate(degradedMetrics("source-b"), 2_000);

    expect(monitor.size).toBe(2);
    expect(monitor.getReport("source-a")?.state).toBe("HEALTHY");
    expect(monitor.getReport("source-b")?.state).toBe("DEGRADED");
  });

  test("getReport returns undefined for unknown source", () => {
    const monitor = new DataQualityMonitor();
    expect(monitor.getReport("nonexistent")).toBeUndefined();
  });

  test("getAllReports returns all tracked reports", () => {
    const monitor = new DataQualityMonitor();
    monitor.evaluate(healthyMetrics("a"), 1_000);
    monitor.evaluate(healthyMetrics("b"), 2_000);
    expect(monitor.getAllReports()).toHaveLength(2);
  });

  test("score history is maintained", () => {
    const monitor = new DataQualityMonitor();
    monitor.evaluate(healthyMetrics(), 1_000);
    monitor.evaluate(degradedMetrics(), 2_000);
    monitor.evaluate(healthyMetrics(), 3_000);

    const history = monitor.getScoreHistory("bybit-ws-linear");
    expect(history).toHaveLength(3);
    expect(history[0]).toBe(1);
    expect(history[2]).toBe(1);
  });

  test("stateChange callback fires on transition", () => {
    const monitor = new DataQualityMonitor();
    const transitions: Array<{
      source: string;
      prev: string | null;
      state: string;
    }> = [];

    monitor.onStateChange((source, prev, report) => {
      transitions.push({ source, prev, state: report.state });
    });

    monitor.evaluate(healthyMetrics(), 1_000);
    monitor.evaluate(degradedMetrics(), 2_000);
    monitor.evaluate(healthyMetrics(), 3_000);

    expect(transitions).toHaveLength(3);
    expect(transitions[0]).toEqual({
      source: "bybit-ws-linear",
      prev: null,
      state: "HEALTHY",
    });
    expect(transitions[1]).toEqual({
      source: "bybit-ws-linear",
      prev: "HEALTHY",
      state: "DEGRADED",
    });
    expect(transitions[2]).toEqual({
      source: "bybit-ws-linear",
      prev: "DEGRADED",
      state: "HEALTHY",
    });
  });

  test("reconnect callback fires on DISCONNECTED", () => {
    const monitor = new DataQualityMonitor();
    const reconnected: string[] = [];

    monitor.onReconnect((source) => {
      reconnected.push(source);
    });

    monitor.evaluate(healthyMetrics(), 1_000);
    monitor.evaluate(disconnectedMetrics(), 2_000);

    expect(reconnected).toEqual(["bybit-ws-linear"]);
  });

  test("reconnect callback does not fire if already DISCONNECTED", () => {
    const monitor = new DataQualityMonitor();
    const reconnected: string[] = [];

    monitor.onReconnect((source) => {
      reconnected.push(source);
    });

    monitor.evaluate(disconnectedMetrics(), 1_000);
    monitor.evaluate(disconnectedMetrics(), 2_000);

    expect(reconnected).toHaveLength(1);
  });

  test("isSourceTradable returns true for HEALTHY and DEGRADED", () => {
    const monitor = new DataQualityMonitor();
    monitor.evaluate(healthyMetrics(), 1_000);
    expect(monitor.isSourceTradable("bybit-ws-linear")).toBe(true);

    monitor.evaluate(degradedMetrics(), 2_000);
    expect(monitor.isSourceTradable("bybit-ws-linear")).toBe(true);
  });

  test("isSourceTradable returns false for STALE and DISCONNECTED", () => {
    const monitor = new DataQualityMonitor();
    monitor.evaluate(staleMetrics(), 1_000);
    expect(monitor.isSourceTradable("bybit-ws-linear")).toBe(false);

    monitor.evaluate(disconnectedMetrics(), 2_000);
    expect(monitor.isSourceTradable("bybit-ws-linear")).toBe(false);
  });

  test("isSourceTradable returns false for unknown source", () => {
    const monitor = new DataQualityMonitor();
    expect(monitor.isSourceTradable("unknown")).toBe(false);
  });

  test("canSourceGenerateSignals only for HEALTHY", () => {
    const monitor = new DataQualityMonitor();
    monitor.evaluate(healthyMetrics(), 1_000);
    expect(monitor.canSourceGenerateSignals("bybit-ws-linear")).toBe(true);

    monitor.evaluate(degradedMetrics(), 2_000);
    expect(monitor.canSourceGenerateSignals("bybit-ws-linear")).toBe(false);
  });

  test("sourcesAtLeast returns sources at or above threshold", () => {
    const monitor = new DataQualityMonitor();
    monitor.evaluate(healthyMetrics("a"), 1_000);
    monitor.evaluate(degradedMetrics("b"), 2_000);
    monitor.evaluate(staleMetrics("c"), 3_000);

    expect(monitor.sourcesAtLeast("STALE")).toEqual(["c"]);
    expect(monitor.sourcesAtLeast("DEGRADED")).toEqual(["b", "c"]);
    expect(monitor.sourcesAtLeast("HEALTHY")).toEqual(["a", "b", "c"]);
  });

  test("removeSource clears tracking", () => {
    const monitor = new DataQualityMonitor();
    monitor.evaluate(healthyMetrics(), 1_000);
    expect(monitor.size).toBe(1);

    monitor.removeSource("bybit-ws-linear");
    expect(monitor.size).toBe(0);
    expect(monitor.getReport("bybit-ws-linear")).toBeUndefined();
  });
});
