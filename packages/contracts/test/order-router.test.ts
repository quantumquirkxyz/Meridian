import { describe, expect, test } from "bun:test";
import {
  DEX_VENUES,
  isDexIntent,
  isDexVenue,
  isOrderRouteAck,
  parseOrderRouteAck,
  type OrderIntent,
  type OrderRouter,
} from "../src/index.ts";

const builtIntent = (venue: string): OrderIntent =>
  ({
    idempotencyKey: "intent-1",
    opportunityId: "opp-1",
    symbol: "BNBUSDT",
    side: "BUY",
    quantity: 0.1,
    price: 600,
    venue,
    quoteCurrency: "USDT",
    createdAtMs: 1_700_000_000_000,
    expiresAtMs: 1_700_000_030_000,
    limits: {
      maxSlippageBps: 50,
      maxGasUsd: 5,
      maxNotionalUsd: 1_000,
      maxSizingExposureBps: 1_000,
    },
  }) as OrderIntent;

describe("OrderRouter (ADR-0011)", () => {
  test("interface exposes a single async route() seam", () => {
    const router: OrderRouter = {
      route: async () => ({ orderId: "abc", venue: "bybit" }),
    };
    expect(typeof router.route).toBe("function");
  });

  test("isOrderRouteAck validates ack shape", () => {
    expect(isOrderRouteAck({ orderId: "abc", venue: "bybit" })).toBe(true);
    expect(isOrderRouteAck({ orderId: "abc", venue: "bybit", externalRef: "0xtxhash" })).toBe(true);
    expect(isOrderRouteAck({ venue: "bybit" })).toBe(false);
    expect(isOrderRouteAck({ orderId: "abc" })).toBe(false);
  });

  test("parseOrderRouteAck round-trips and throws on invalid ack", () => {
    expect(parseOrderRouteAck({ orderId: "abc", venue: "bybit" }).orderId).toBe("abc");
    expect(() => parseOrderRouteAck({ orderId: 42, venue: "bybit" })).toThrow("OrderRouteAck");
  });
});

describe("Venue routing helpers", () => {
  test("DEX_VENUES covers the PancakeSwap venue only", () => {
    expect(DEX_VENUES).toEqual(["pancakeswap-v4"]);
  });

  test("isDexVenue validates against the canonical list", () => {
    expect(isDexVenue("pancakeswap-v4")).toBe(true);
    expect(isDexVenue("bybit")).toBe(false);
  });

  test("isDexIntent routes by venue on the intent", () => {
    expect(isDexIntent(builtIntent("pancakeswap-v4"))).toBe(true);
    expect(isDexIntent(builtIntent("bybit"))).toBe(false);
    expect(isDexIntent(builtIntent("binance"))).toBe(false);
  });
});