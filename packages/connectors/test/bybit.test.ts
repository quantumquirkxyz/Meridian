import { describe, expect, test } from "bun:test";
import {
  buildBybitMarketDataSnapshot,
  measureBybitClockDriftMs,
  normalizeBybitSymbol,
} from "../src/bybit.ts";
import { isMarketDataSnapshot } from "@agenttrading/contracts";

describe("Bybit connector normalization", () => {
  test("normalizes symbol variants", () => {
    expect(normalizeBybitSymbol("BTCUSDT")).toBe("BTC/USDT");
    expect(normalizeBybitSymbol("btc_usdt")).toBe("BTC/USDT");
    expect(normalizeBybitSymbol("1000PEPEUSDT")).toBe("1000PEPE/USDT");
  });

  test("builds a normalized market snapshot with latency and mid", () => {
    const snapshot = buildBybitMarketDataSnapshot({
      symbol: "BTCUSDT",
      bid: 30_000,
      ask: 30_001,
      depth: 1_000_000,
      exchangeTimestampMs: 100,
      receiveTimestampMs: 112,
      processingTimestampMs: 115,
      source: "bybit-ws-linear",
      sequence: 42,
    });

    expect(snapshot).toEqual({
      venue: "bybit",
      symbol: "BTC/USDT",
      timestampMs: 100,
      bid: 30_000,
      ask: 30_001,
      mid: 30_000.5,
      depth: 1_000_000,
      latencyMs: 12,
      source: "bybit-ws-linear",
      sequence: 42,
    });
    expect(isMarketDataSnapshot(snapshot)).toBe(true);
    expect(
      measureBybitClockDriftMs({
        symbol: "BTCUSDT",
        exchangeTimestampMs: 100,
        receiveTimestampMs: 112,
        processingTimestampMs: 115,
      }),
    ).toBe(15);
  });
});
