import { describe, expect, test } from "bun:test";
import {
  BASE_EVENT_TYPES,
  EVENT_KINDS,
  isBaseEventType,
  isEventEnvelope,
  isEventKind,
  isGasUpdatePayload,
  isNormalizedEventPayload,
  isOrderBookLevel,
  isOrderBookSnapshotPayload,
  isPoolStateUpdatePayload,
  makeEventId,
  parseEventEnvelope,
} from "../src/index.ts";

describe("base event contracts", () => {
  test("exposes the documented base event types", () => {
    expect(BASE_EVENT_TYPES).toEqual([
      "MARKET_TICK",
      "ORDERBOOK_SNAPSHOT",
      "ORDERBOOK_DELTA",
      "POOL_STATE_UPDATE",
      "GAS_UPDATE",
      "FUNDING_UPDATE",
      "DATA_QUALITY_UPDATE",
      "GRAPH_UPDATED",
      "AUDIT_EVENT",
    ]);
    expect(isBaseEventType("MARKET_TICK")).toBe(true);
    expect(isBaseEventType("NOT_AN_EVENT")).toBe(false);
    expect(EVENT_KINDS).toEqual(["raw", "normalized"]);
    expect(isEventKind("raw")).toBe(true);
    expect(isEventKind("bogus")).toBe(false);
  });

  test("raw envelope accepts any JSON payload", () => {
    const envelope = {
      eventId: "raw-1",
      sequence: 1,
      type: "MARKET_TICK",
      kind: "raw",
      timestampMs: 1_700_000_000_000,
      source: "bybit-ws",
      payload: { symbol: "BTCUSDT", rawFields: { ask: "30001" } },
    } as const;
    expect(isEventEnvelope(envelope)).toBe(true);
    expect(parseEventEnvelope(envelope)).toEqual(envelope);
  });

  test("normalized MARKET_TICK validates against MarketDataSnapshot", () => {
    const envelope = {
      eventId: "tick-1",
      sequence: 1,
      type: "MARKET_TICK",
      kind: "normalized",
      timestampMs: 1_700_000_000_000,
      source: "bybit-ws-linear",
      payload: {
        venue: "bybit",
        symbol: "BTC/USDT",
        timestampMs: 1_700_000_000_000,
        bid: 30_000,
        ask: 30_001,
        mid: 30_000.5,
        depth: 1_000_000,
        latencyMs: 12,
        source: "bybit-ws-linear",
      },
    };
    expect(isEventEnvelope(envelope)).toBe(true);
    expect(
      isNormalizedEventPayload("MARKET_TICK", envelope.payload),
    ).toBe(true);
  });

  test("normalized event with a mismatched payload is rejected", () => {
    expect(
      isEventEnvelope({
        eventId: "tick-2",
        sequence: 2,
        type: "MARKET_TICK",
        kind: "normalized",
        timestampMs: 0,
        source: "bybit-ws",
        payload: { not: "a snapshot" },
      }),
    ).toBe(false);
  });

  test("normalized payload validators accept their shapes", () => {
    expect(
      isOrderBookLevel({ price: 30_000, size: 0.5 }),
    ).toBe(true);
    expect(
      isOrderBookSnapshotPayload({
        venue: "bybit",
        symbol: "BTC/USDT",
        timestampMs: 0,
        bids: [{ price: 30_000, size: 1 }],
        asks: [{ price: 30_001, size: 1 }],
      }),
    ).toBe(true);
    expect(
      isPoolStateUpdatePayload({
        venue: "pancakeswap-v4",
        poolAddress: "0xpool",
        symbol: "BNB/USDT",
        timestampMs: 0,
        reserve0: 100,
        reserve1: 1_000,
        price: 10,
        liquidityUsd: 50_000,
      }),
    ).toBe(true);
    expect(
      isGasUpdatePayload({
        venue: "bsc",
        chain: "bsc",
        timestampMs: 0,
        gasPriceGwei: 3,
      }),
    ).toBe(true);
  });

  test("makeEventId builds deterministic idempotency keys", () => {
    expect(makeEventId(["bybit", "BTCUSDT", 42])).toBe("bybit:BTCUSDT:42");
    expect(makeEventId(["bybit", "BTCUSDT", 42])).toBe(
      makeEventId(["bybit", "BTCUSDT", 42]),
    );
  });
});
