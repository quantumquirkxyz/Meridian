import { describe, expect, test } from "bun:test";
import { EventBus } from "@agenttrading/events";
import { EventStore } from "@agenttrading/events";
import { ObservabilityService } from "../src/observability.ts";
import type { DataQualityReport } from "@agenttrading/contracts";

function tickPayload(symbol = "BTC/USDT", venue = "bybit") {
  return {
    venue,
    symbol,
    timestampMs: 1_000,
    bid: 30_000,
    ask: 30_001,
    mid: 30_000.5,
    depth: 1_000_000,
    latencyMs: 10,
    source: `${venue}-ws`,
  };
}

function qualityReport(
  source = "bybit-ws",
  state: DataQualityReport["state"] = "HEALTHY",
): DataQualityReport {
  return {
    source,
    state,
    score: state === "HEALTHY" ? 0.95 : state === "DEGRADED" ? 0.5 : 0.1,
    updatedAtMs: 1_000,
    lastSeenMs: 900,
  };
}

function graphSnapshotPayload(version = 1) {
  return {
    version,
    snapshotId: `snap:${version}`,
    createdAtMs: 1_000,
    nodes: [{ id: "asset:BTC", type: "ASSET" }],
    edges: [],
  };
}

describe("ObservabilityService (issue #22 AC2)", () => {
  test("tracks connector events (MARKET_TICK)", () => {
    const store = new EventStore(":memory:");
    const bus = new EventBus(store);
    const obs = new ObservabilityService(bus);
    obs.activate();

    bus.publish({
      eventId: "t1",
      type: "MARKET_TICK",
      kind: "normalized",
      timestampMs: 1_000,
      source: "bybit-ws",
      payload: tickPayload(),
    });

    expect(obs.eventCount).toBe(1);

    // Connector event produces an AUDIT_EVENT.
    const auditEvents = store.queryByType("AUDIT_EVENT");
    expect(auditEvents.length).toBeGreaterThanOrEqual(1);

    const payload = auditEvents[0].payload as Record<string, unknown>;
    expect(payload.action).toBe("CONNECTOR_EVENT");
    expect(payload.actor).toBe("bybit-ws");
  });

  test("tracks ORDERBOOK_SNAPSHOT events", () => {
    const store = new EventStore(":memory:");
    const bus = new EventBus(store);
    const obs = new ObservabilityService(bus);
    obs.activate();

    bus.publish({
      eventId: "ob1",
      type: "ORDERBOOK_SNAPSHOT",
      kind: "normalized",
      timestampMs: 1_000,
      source: "bybit-ws",
      payload: {
        venue: "bybit",
        symbol: "BTC/USDT",
        timestampMs: 1_000,
        bids: [{ price: 30_000, size: 1 }],
        asks: [{ price: 30_001, size: 1 }],
      },
    });

    expect(obs.eventCount).toBe(1);
    const auditEvents = store.queryByType("AUDIT_EVENT");
    expect(auditEvents.length).toBeGreaterThanOrEqual(1);
  });

  test("tracks POOL_STATE_UPDATE events", () => {
    const store = new EventStore(":memory:");
    const bus = new EventBus(store);
    const obs = new ObservabilityService(bus);
    obs.activate();

    bus.publish({
      eventId: "pool1",
      type: "POOL_STATE_UPDATE",
      kind: "normalized",
      timestampMs: 1_000,
      source: "pancakeswap-v4-rpc",
      payload: {
        venue: "pancakeswap-v4",
        poolAddress: "0xpool",
        symbol: "BNB/USDT",
        timestampMs: 1_000,
        reserve0: 100,
        reserve1: 1_000,
      },
    });

    expect(obs.eventCount).toBe(1);
  });

  test("tracks GRAPH_UPDATED events", () => {
    const store = new EventStore(":memory:");
    const bus = new EventBus(store);
    const obs = new ObservabilityService(bus);
    obs.activate();

    bus.publish({
      eventId: "g1",
      type: "GRAPH_UPDATED",
      kind: "normalized",
      timestampMs: 1_000,
      source: "graph-engine",
      payload: graphSnapshotPayload(1),
    });

    expect(obs.graphUpdateCount).toBe(1);
    expect(obs.lastGraphVersion).toBe(1);
    expect(obs.graphSnapshots).toHaveLength(1);

    // Graph update produces an AUDIT_EVENT.
    const auditEvents = store.queryByType("AUDIT_EVENT");
    expect(auditEvents.length).toBeGreaterThanOrEqual(1);
    const payload = auditEvents[0].payload as Record<string, unknown>;
    expect(payload.action).toBe("GRAPH_UPDATE");
  });

  test("deduplicates graph version tracking", () => {
    const store = new EventStore(":memory:");
    const bus = new EventBus(store);
    const obs = new ObservabilityService(bus);
    obs.activate();

    // Same version published twice — only one audit event.
    bus.publish({
      eventId: "g1",
      type: "GRAPH_UPDATED",
      kind: "normalized",
      timestampMs: 1_000,
      source: "graph-engine",
      payload: graphSnapshotPayload(1),
    });
    bus.publish({
      eventId: "g2",
      type: "GRAPH_UPDATED",
      kind: "normalized",
      timestampMs: 1_001,
      source: "graph-engine",
      payload: graphSnapshotPayload(1),
    });

    expect(obs.lastGraphVersion).toBe(1);
    // g2 is a duplicate of g1's version, so only one graph audit event.
    const graphAudits = store.queryByType("AUDIT_EVENT").filter((e) => {
      const payload = e.payload as Record<string, unknown>;
      return payload.action === "GRAPH_UPDATE";
    });
    expect(graphAudits).toHaveLength(1);
  });

  test("tracks DATA_QUALITY_UPDATE events", () => {
    const store = new EventStore(":memory:");
    const bus = new EventBus(store);
    const obs = new ObservabilityService(bus);
    obs.activate();

    bus.publish({
      eventId: "dq1",
      type: "DATA_QUALITY_UPDATE",
      kind: "normalized",
      timestampMs: 1_000,
      source: "data-quality-monitor",
      payload: qualityReport("bybit-ws", "HEALTHY") as unknown as Record<string, unknown>,
    });

    expect(obs.eventCount).toBe(1);

    const auditEvents = store.queryByType("AUDIT_EVENT");
    expect(auditEvents.length).toBeGreaterThanOrEqual(1);
    const payload = auditEvents[0].payload as Record<string, unknown>;
    expect(payload.action).toBe("DATA_QUALITY_EVENT");

    const data = payload.data as Record<string, unknown>;
    expect(data.source).toBe("bybit-ws");
    expect(data.state).toBe("HEALTHY");
  });

  test("getConnectorEvents returns connector audit events", () => {
    const store = new EventStore(":memory:");
    const bus = new EventBus(store);
    const obs = new ObservabilityService(bus);
    obs.activate();

    bus.publish({
      eventId: "t1",
      type: "MARKET_TICK",
      kind: "normalized",
      timestampMs: 1_000,
      source: "bybit-ws",
      payload: tickPayload("BTC/USDT", "bybit"),
    });
    bus.publish({
      eventId: "t2",
      type: "MARKET_TICK",
      kind: "normalized",
      timestampMs: 1_001,
      source: "pancakeswap-v4-rpc",
      payload: tickPayload("ETH/USDT", "pancakeswap-v4"),
    });

    const all = obs.getConnectorEvents();
    expect(all.length).toBeGreaterThanOrEqual(2);
  });

  test("getDataQualityEvents returns quality audit events", () => {
    const store = new EventStore(":memory:");
    const bus = new EventBus(store);
    const obs = new ObservabilityService(bus);
    obs.activate();

    bus.publish({
      eventId: "dq1",
      type: "DATA_QUALITY_UPDATE",
      kind: "normalized",
      timestampMs: 1_000,
      source: "data-quality-monitor",
      payload: qualityReport("bybit-ws", "HEALTHY") as unknown as Record<string, unknown>,
    });

    const dqEvents = obs.getDataQualityEvents();
    expect(dqEvents.length).toBeGreaterThanOrEqual(1);
  });

  test("does not re-record audit events (no infinite loop)", () => {
    const store = new EventStore(":memory:");
    const bus = new EventBus(store);
    const obs = new ObservabilityService(bus);
    obs.activate();

    // Publish a tick event — produces one connector audit event.
    bus.publish({
      eventId: "t1",
      type: "MARKET_TICK",
      kind: "normalized",
      timestampMs: 1_000,
      source: "bybit-ws",
      payload: tickPayload(),
    });

    // The audit event itself should not trigger another audit event.
    const auditEvents = store.queryByType("AUDIT_EVENT");
    expect(auditEvents).toHaveLength(1);
  });

  test("getAuditEvents returns all observability audit events", () => {
    const store = new EventStore(":memory:");
    const bus = new EventBus(store);
    const obs = new ObservabilityService(bus);
    obs.activate();

    bus.publish({
      eventId: "t1",
      type: "MARKET_TICK",
      kind: "normalized",
      timestampMs: 1_000,
      source: "bybit-ws",
      payload: tickPayload(),
    });
    bus.publish({
      eventId: "dq1",
      type: "DATA_QUALITY_UPDATE",
      kind: "normalized",
      timestampMs: 1_001,
      source: "data-quality-monitor",
      payload: qualityReport() as unknown as Record<string, unknown>,
    });

    const all = obs.getAuditEvents();
    expect(all.length).toBeGreaterThanOrEqual(2);
    // All should be AUDIT_EVENTs.
    for (const event of all) {
      expect(event.type).toBe("AUDIT_EVENT");
    }
  });
});
