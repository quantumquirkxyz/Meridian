import { describe, expect, test } from "bun:test";
import { CONNECTORS_VERSION } from "../src/index.ts";
import { isMarketDataSnapshot } from "@agenttrading/contracts";

describe("@agenttrading/connectors smoke", () => {
  test("package resolves", () => {
    expect(CONNECTORS_VERSION).toBe("0.1.0");
  });

  test("normalized snapshot shape comes from contracts", () => {
    const snapshot = {
      venue: "bybit",
      symbol: "BTC/USDT",
      timestampMs: 0,
      bid: 30_000,
      ask: 30_001,
      mid: 30_000.5,
      depth: 1_000_000,
      latencyMs: 12,
      source: "bybit-ws",
    };
    expect(isMarketDataSnapshot(snapshot)).toBe(true);
  });
});
