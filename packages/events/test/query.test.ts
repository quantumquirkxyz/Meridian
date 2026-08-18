import { describe, expect, test } from "bun:test";
import { EventStore, type PublishEvent } from "../src/store.ts";

function tickEvent(
  eventId: string,
  source: string,
  timestampMs: number,
): PublishEvent {
  return {
    eventId,
    type: "MARKET_TICK",
    kind: "normalized",
    timestampMs,
    source,
    payload: {
      venue: "bybit",
      symbol: "BTC/USDT",
      timestampMs,
      bid: 30_000,
      ask: 30_001,
      mid: 30_000.5,
      depth: 1_000_000,
      latencyMs: 10,
      source,
    },
  };
}

function auditEvent(
  eventId: string,
  source: string,
  timestampMs: number,
): PublishEvent {
  return {
    eventId,
    type: "AUDIT_EVENT",
    kind: "normalized",
    timestampMs,
    source,
    payload: {
      eventId: `ae:${eventId}`,
      sequence: 0,
      timestampMs,
      action: "OPPORTUNITY_DETECTED",
      actor: source,
    },
  };
}

function poolEvent(
  eventId: string,
  source: string,
  timestampMs: number,
): PublishEvent {
  return {
    eventId,
    type: "POOL_STATE_UPDATE",
    kind: "normalized",
    timestampMs,
    source,
    payload: {
      venue: "pancakeswap-v4",
      poolAddress: "0xpool",
      symbol: "BNB/USDT",
      timestampMs,
      reserve0: 100,
      reserve1: 1_000,
    },
  };
}

describe("EventStore query methods (issue #22 AC3)", () => {
  test("queryByType returns only events of the given type", () => {
    const store = new EventStore(":memory:");
    store.append(tickEvent("t1", "bybit-ws", 1_000));
    store.append(tickEvent("t2", "bybit-ws", 1_001));
    store.append(poolEvent("p1", "pancakeswap-v4-rpc", 1_002));
    store.append(auditEvent("a1", "audit", 1_003));

    const ticks = store.queryByType("MARKET_TICK");
    expect(ticks).toHaveLength(2);
    expect(ticks.every((e) => e.type === "MARKET_TICK")).toBe(true);

    const pools = store.queryByType("POOL_STATE_UPDATE");
    expect(pools).toHaveLength(1);

    const audits = store.queryByType("AUDIT_EVENT");
    expect(audits).toHaveLength(1);
  });

  test("queryByType returns empty array when no matching events", () => {
    const store = new EventStore(":memory:");
    store.append(tickEvent("t1", "bybit-ws", 1_000));

    const result = store.queryByType("GAS_UPDATE");
    expect(result).toHaveLength(0);
  });

  test("queryBySource returns only events from the given source", () => {
    const store = new EventStore(":memory:");
    store.append(tickEvent("t1", "bybit-ws", 1_000));
    store.append(tickEvent("t2", "pancakeswap-v4-rpc", 1_001));
    store.append(tickEvent("t3", "bybit-ws", 1_002));

    const bybitEvents = store.queryBySource("bybit-ws");
    expect(bybitEvents).toHaveLength(2);
    expect(
      bybitEvents.every((e) => e.source === "bybit-ws"),
    ).toBe(true);

    const dexEvents = store.queryBySource("pancakeswap-v4-rpc");
    expect(dexEvents).toHaveLength(1);
  });

  test("queryBySource returns empty array for unknown source", () => {
    const store = new EventStore(":memory:");
    store.append(tickEvent("t1", "bybit-ws", 1_000));

    const result = store.queryBySource("unknown-source");
    expect(result).toHaveLength(0);
  });

  test("queryByTimeRange returns events within [fromMs, toMs)", () => {
    const store = new EventStore(":memory:");
    store.append(tickEvent("t1", "bybit-ws", 1_000));
    store.append(tickEvent("t2", "bybit-ws", 2_000));
    store.append(tickEvent("t3", "bybit-ws", 3_000));
    store.append(tickEvent("t4", "bybit-ws", 4_000));

    const range = store.queryByTimeRange(1_500, 3_500);
    expect(range).toHaveLength(2);
    expect(range.map((e) => e.eventId)).toEqual(["t2", "t3"]);
  });

  test("queryByTimeRange is inclusive of fromMs, exclusive of toMs", () => {
    const store = new EventStore(":memory:");
    store.append(tickEvent("t1", "bybit-ws", 1_000));
    store.append(tickEvent("t2", "bybit-ws", 2_000));
    store.append(tickEvent("t3", "bybit-ws", 3_000));

    // Exactly at boundary.
    const range = store.queryByTimeRange(1_000, 2_000);
    expect(range).toHaveLength(1);
    expect(range[0].eventId).toBe("t1");
  });

  test("queryByTimeRange returns empty array when no events in range", () => {
    const store = new EventStore(":memory:");
    store.append(tickEvent("t1", "bybit-ws", 1_000));

    const result = store.queryByTimeRange(5_000, 10_000);
    expect(result).toHaveLength(0);
  });

  test("queryAuditEvents returns only AUDIT_EVENTs", () => {
    const store = new EventStore(":memory:");
    store.append(tickEvent("t1", "bybit-ws", 1_000));
    store.append(auditEvent("a1", "audit", 1_001));
    store.append(poolEvent("p1", "pancakeswap-v4-rpc", 1_002));
    store.append(auditEvent("a2", "audit", 1_003));

    const audits = store.queryAuditEvents();
    expect(audits).toHaveLength(2);
    expect(audits.every((e) => e.type === "AUDIT_EVENT")).toBe(true);
    expect(audits.map((e) => e.eventId)).toEqual(["a1", "a2"]);
  });

  test("queryAuditEvents returns empty array when no audit events", () => {
    const store = new EventStore(":memory:");
    store.append(tickEvent("t1", "bybit-ws", 1_000));

    const result = store.queryAuditEvents();
    expect(result).toHaveLength(0);
  });

  test("query methods return events in sequence order", () => {
    const store = new EventStore(":memory:");
    store.append(tickEvent("t3", "bybit-ws", 3_000));
    store.append(tickEvent("t1", "bybit-ws", 1_000));
    store.append(tickEvent("t2", "bybit-ws", 2_000));

    const byType = store.queryByType("MARKET_TICK");
    expect(byType.map((e) => e.eventId)).toEqual(["t3", "t1", "t2"]);
    // Sequence order, not timestamp order.
    expect(byType.map((e) => e.sequence)).toEqual([1, 2, 3]);
  });

  test("query methods work after reopen from disk", () => {
    const { mkdtempSync, rmSync } = require("node:fs");
    const { join } = require("node:path");
    const { tmpdir } = require("node:os");

    const dir = mkdtempSync(join(tmpdir(), "agenttrading-query-"));
    const path = join(dir, "events.db");

    const store1 = new EventStore(path);
    store1.append(tickEvent("t1", "bybit-ws", 1_000));
    store1.append(auditEvent("a1", "audit", 1_001));
    store1.close();

    const store2 = new EventStore(path);
    expect(store2.queryByType("AUDIT_EVENT")).toHaveLength(1);
    expect(store2.queryBySource("bybit-ws")).toHaveLength(1);
    expect(store2.queryByTimeRange(0, 2_000)).toHaveLength(2);
    store2.close();

    rmSync(dir, { recursive: true, force: true });
  });
});
