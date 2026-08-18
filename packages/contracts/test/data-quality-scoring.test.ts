import { describe, expect, test } from "bun:test";
import {
  computeDataQualityScore,
  deriveDataQualityState,
  evaluateDataQuality,
  isDataQualityMetrics,
  isStateAtLeast,
  parseDataQualityMetrics,
  DEFAULT_SCORING_THRESHOLDS,
  type DataQualityMetrics,
} from "../src/index.ts";

function healthyMetrics(): DataQualityMetrics {
  return {
    source: "bybit-ws-linear",
    latencyMs: 10,
    stalenessMs: 100,
    gapCount: 0,
    wsRestConsistent: true,
    rpcHealthy: true,
    exchangeStatus: "online",
  };
}

describe("isDataQualityMetrics", () => {
  test("valid metrics pass", () => {
    expect(isDataQualityMetrics(healthyMetrics())).toBe(true);
  });

  test("missing fields rejected", () => {
    const m = healthyMetrics();
    expect(isDataQualityMetrics({ ...m, source: undefined })).toBe(false);
    expect(isDataQualityMetrics({ ...m, latencyMs: "fast" })).toBe(false);
    expect(isDataQualityMetrics({ ...m, wsRestConsistent: "yes" })).toBe(
      false,
    );
  });

  test("parse round-trips", () => {
    const m = healthyMetrics();
    expect(parseDataQualityMetrics(m)).toEqual(m);
  });
});

describe("isStateAtLeast", () => {
  test("HEALTHY is least restrictive", () => {
    expect(isStateAtLeast("HEALTHY", "HEALTHY")).toBe(true);
    expect(isStateAtLeast("HEALTHY", "DEGRADED")).toBe(false);
    expect(isStateAtLeast("HEALTHY", "STALE")).toBe(false);
    expect(isStateAtLeast("HEALTHY", "DISCONNECTED")).toBe(false);
  });

  test("DEGRADED is at least HEALTHY", () => {
    expect(isStateAtLeast("DEGRADED", "HEALTHY")).toBe(true);
    expect(isStateAtLeast("DEGRADED", "DEGRADED")).toBe(true);
    expect(isStateAtLeast("DEGRADED", "STALE")).toBe(false);
  });

  test("STALE is at least DEGRADED", () => {
    expect(isStateAtLeast("STALE", "HEALTHY")).toBe(true);
    expect(isStateAtLeast("STALE", "DEGRADED")).toBe(true);
    expect(isStateAtLeast("STALE", "STALE")).toBe(true);
    expect(isStateAtLeast("STALE", "DISCONNECTED")).toBe(false);
  });

  test("DISCONNECTED is most restrictive", () => {
    expect(isStateAtLeast("DISCONNECTED", "HEALTHY")).toBe(true);
    expect(isStateAtLeast("DISCONNECTED", "DEGRADED")).toBe(true);
    expect(isStateAtLeast("DISCONNECTED", "STALE")).toBe(true);
    expect(isStateAtLeast("DISCONNECTED", "DISCONNECTED")).toBe(true);
  });
});

describe("computeDataQualityScore", () => {
  test("perfect metrics score 1.0", () => {
    const score = computeDataQualityScore(healthyMetrics());
    expect(score).toBe(1);
  });

  test("high latency reduces score", () => {
    const m = { ...healthyMetrics(), latencyMs: 2_500 };
    const score = computeDataQualityScore(m);
    expect(score).toBeGreaterThan(0.5);
    expect(score).toBeLessThan(1);
  });

  test("extreme latency scores near 0 for latency component", () => {
    const m = { ...healthyMetrics(), latencyMs: 10_000 };
    const score = computeDataQualityScore(m);
    expect(score).toBeLessThan(0.8);
  });

  test("high staleness reduces score significantly", () => {
    const m = { ...healthyMetrics(), stalenessMs: 15_000 };
    const score = computeDataQualityScore(m);
    expect(score).toBeGreaterThan(0.7);
    expect(score).toBeLessThan(0.9);
  });

  test("max staleness zeros staleness component", () => {
    const m = { ...healthyMetrics(), stalenessMs: 30_000 };
    const score = computeDataQualityScore(m);
    expect(score).toBeLessThan(0.75);
  });

  test("gaps reduce score", () => {
    const m = { ...healthyMetrics(), gapCount: 5 };
    const score = computeDataQualityScore(m);
    expect(score).toBeGreaterThan(0.5);
    expect(score).toBeLessThan(1);
  });

  test("max gaps zero gap component", () => {
    const m = { ...healthyMetrics(), gapCount: 10 };
    const score = computeDataQualityScore(m);
    expect(score).toBeLessThan(0.9);
  });

  test("WS/REST inconsistency reduces score", () => {
    const m = { ...healthyMetrics(), wsRestConsistent: false };
    const score = computeDataQualityScore(m);
    expect(score).toBeLessThan(0.95);
  });

  test("RPC unhealthy reduces score", () => {
    const m = { ...healthyMetrics(), rpcHealthy: false };
    const score = computeDataQualityScore(m);
    expect(score).toBeLessThan(0.95);
  });

  test("exchange maintenance reduces score", () => {
    const m: DataQualityMetrics = { ...healthyMetrics(), exchangeStatus: "maintenance" };
    const score = computeDataQualityScore(m);
    expect(score).toBeLessThan(0.95);
  });

  test("exchange degraded reduces score less than maintenance", () => {
    const degraded = computeDataQualityScore({
      ...healthyMetrics(),
      exchangeStatus: "degraded",
    });
    const maintenance = computeDataQualityScore({
      ...healthyMetrics(),
      exchangeStatus: "maintenance",
    });
    expect(degraded).toBeGreaterThan(maintenance);
  });

  test("score is always in [0, 1]", () => {
    const worst = computeDataQualityScore({
      source: "x",
      latencyMs: 100_000,
      stalenessMs: 100_000,
      gapCount: 100,
      wsRestConsistent: false,
      rpcHealthy: false,
      exchangeStatus: "offline",
    });
    expect(worst).toBeGreaterThanOrEqual(0);
    expect(worst).toBeLessThanOrEqual(1);
  });
});

describe("deriveDataQualityState", () => {
  test("perfect metrics -> HEALTHY", () => {
    const m = healthyMetrics();
    const score = computeDataQualityScore(m);
    expect(deriveDataQualityState(score, m)).toBe("HEALTHY");
  });

  test("offline exchange -> DISCONNECTED", () => {
    const m: DataQualityMetrics = { ...healthyMetrics(), exchangeStatus: "offline" };
    const score = computeDataQualityScore(m);
    expect(deriveDataQualityState(score, m)).toBe("DISCONNECTED");
  });

  test("maintenance exchange -> DISCONNECTED", () => {
    const m: DataQualityMetrics = { ...healthyMetrics(), exchangeStatus: "maintenance" };
    const score = computeDataQualityScore(m);
    expect(deriveDataQualityState(score, m)).toBe("DISCONNECTED");
  });

  test("RPC unhealthy + max staleness -> DISCONNECTED", () => {
    const m = {
      ...healthyMetrics(),
      rpcHealthy: false,
      stalenessMs: 30_000,
    };
    const score = computeDataQualityScore(m);
    expect(deriveDataQualityState(score, m)).toBe("DISCONNECTED");
  });

  test("max staleness -> STALE", () => {
    const m = { ...healthyMetrics(), stalenessMs: 30_000 };
    const score = computeDataQualityScore(m);
    expect(deriveDataQualityState(score, m)).toBe("STALE");
  });

  test("low score -> STALE", () => {
    const m: DataQualityMetrics = {
      source: "x",
      latencyMs: 100_000,
      stalenessMs: 100_000,
      gapCount: 100,
      wsRestConsistent: false,
      rpcHealthy: true,
      exchangeStatus: "online",
    };
    const score = computeDataQualityScore(m);
    expect(score).toBeLessThan(0.3);
    expect(deriveDataQualityState(score, m)).toBe("STALE");
  });

  test("WS/REST inconsistent -> DEGRADED", () => {
    const m = { ...healthyMetrics(), wsRestConsistent: false };
    const score = computeDataQualityScore(m);
    expect(deriveDataQualityState(score, m)).toBe("DEGRADED");
  });

  test("degraded exchange status -> DEGRADED (not disconnected)", () => {
    const m: DataQualityMetrics = {
      ...healthyMetrics(),
      exchangeStatus: "degraded",
      latencyMs: 2_500,
      stalenessMs: 5_000,
      gapCount: 5,
      wsRestConsistent: false,
    };
    const score = computeDataQualityScore(m);
    expect(deriveDataQualityState(score, m)).toBe("DEGRADED");
  });

  test("degraded exchange status alone -> DEGRADED", () => {
    const m: DataQualityMetrics = {
      ...healthyMetrics(),
      exchangeStatus: "degraded",
    };
    const score = computeDataQualityScore(m);
    expect(score).toBeGreaterThan(0.9);
    expect(deriveDataQualityState(score, m)).toBe("DEGRADED");
  });

  test("RPC unhealthy alone -> DEGRADED (not HEALTHY)", () => {
    const m: DataQualityMetrics = {
      ...healthyMetrics(),
      rpcHealthy: false,
    };
    const score = computeDataQualityScore(m);
    expect(score).toBeGreaterThan(0.85);
    expect(deriveDataQualityState(score, m)).toBe("DEGRADED");
  });
});

describe("evaluateDataQuality", () => {
  test("produces a valid DataQualityReport", () => {
    const report = evaluateDataQuality(healthyMetrics(), 1_700_000_000_000);
    expect(report.source).toBe("bybit-ws-linear");
    expect(report.state).toBe("HEALTHY");
    expect(report.score).toBe(1);
    expect(report.updatedAtMs).toBe(1_700_000_000_000);
    expect(report.lastSeenMs).toBe(1_700_000_000_000 - 100);
    expect(report.reason).toBeUndefined();
  });

  test("DISCONNECTED report includes reason", () => {
    const m: DataQualityMetrics = { ...healthyMetrics(), exchangeStatus: "offline" };
    const report = evaluateDataQuality(m, 1_700_000_000_000);
    expect(report.state).toBe("DISCONNECTED");
    expect(report.reason).toContain("exchange status");
  });

  test("STALE report includes reason", () => {
    const m = { ...healthyMetrics(), stalenessMs: 30_000 };
    const report = evaluateDataQuality(m, 1_700_000_000_000);
    expect(report.state).toBe("STALE");
    expect(report.reason).toContain("staleness");
  });

  test("DEGRADED report reason names the failing component", () => {
    const m = { ...healthyMetrics(), latencyMs: 4_000 };
    const report = evaluateDataQuality(m, 1_700_000_000_000);
    expect(report.state).toBe("DEGRADED");
    expect(report.reason).toContain("latency");
  });

  test("DEGRADED report reason names exchange status", () => {
    const m: DataQualityMetrics = {
      ...healthyMetrics(),
      exchangeStatus: "degraded",
    };
    const report = evaluateDataQuality(m, 1_700_000_000_000);
    expect(report.state).toBe("DEGRADED");
    expect(report.reason).toContain("exchange status");
  });
});
