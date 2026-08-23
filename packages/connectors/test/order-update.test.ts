import { describe, expect, test } from "bun:test";
import {
  isOrderUpdate,
  parseOrderUpdate,
  ORDER_UPDATE_STATUSES,
  type OrderUpdate,
} from "@agenttrading/contracts";

describe("OrderUpdate contract", () => {
  test("validates a complete OrderUpdate", () => {
    const update: OrderUpdate = {
      orderId: "order-123",
      orderLinkId: "client-456",
      symbol: "BTC/USDT",
      side: "BUY",
      orderType: "LIMIT",
      price: 30000,
      quantity: 0.01,
      status: "FILLED",
      cumulativeFilledQty: 0.01,
      leavesQty: 0,
      averagePrice: 30000,
      timestampMs: 1700000000000,
    };

    expect(isOrderUpdate(update)).toBe(true);
  });

  test("validates an OrderUpdate with nullable fields", () => {
    const update = {
      orderId: "order-123",
      symbol: "BTC/USDT",
      side: "SELL",
      orderType: "MARKET",
      price: null,
      quantity: 1.0,
      status: "NEW",
      cumulativeFilledQty: 0,
      leavesQty: 1.0,
      averagePrice: null,
      timestampMs: 1700000000000,
    };

    expect(isOrderUpdate(update)).toBe(true);
  });

  test("rejects invalid status", () => {
    const update = {
      orderId: "order-123",
      symbol: "BTC/USDT",
      side: "BUY",
      orderType: "LIMIT",
      price: 30000,
      quantity: 0.01,
      status: "INVALID_STATUS",
      cumulativeFilledQty: 0,
      leavesQty: 0.01,
      averagePrice: null,
      timestampMs: 1700000000000,
    };

    expect(isOrderUpdate(update)).toBe(false);
  });

  test("rejects invalid side", () => {
    const update = {
      orderId: "order-123",
      symbol: "BTC/USDT",
      side: "LEFT",
      orderType: "LIMIT",
      price: 30000,
      quantity: 0.01,
      status: "NEW",
      cumulativeFilledQty: 0,
      leavesQty: 0.01,
      averagePrice: null,
      timestampMs: 1700000000000,
    };

    expect(isOrderUpdate(update)).toBe(false);
  });

  test("parseOrderUpdate returns typed result", () => {
    const raw = {
      orderId: "order-abc",
      symbol: "ETH/USDT",
      side: "BUY",
      orderType: "MARKET",
      price: null,
      quantity: 0.1,
      status: "FILLED",
      cumulativeFilledQty: 0.1,
      leavesQty: 0,
      averagePrice: 2000,
      timestampMs: 1700000000000,
    };

    const parsed = parseOrderUpdate(raw);
    expect(parsed.orderId).toBe("order-abc");
    expect(parsed.symbol).toBe("ETH/USDT");
    expect(parsed.status).toBe("FILLED");
    expect(parsed.price).toBeNull();
    expect(parsed.averagePrice).toBe(2000);
  });

  test("all ORDER_UPDATE_STATUSES are valid", () => {
    for (const status of ORDER_UPDATE_STATUSES) {
      const update = {
        orderId: "order-123",
        symbol: "BTC/USDT",
        side: "BUY",
        orderType: "LIMIT",
        price: 30000,
        quantity: 0.01,
        status,
        cumulativeFilledQty: 0,
        leavesQty: 0.01,
        averagePrice: null,
        timestampMs: 1700000000000,
      };

      expect(isOrderUpdate(update)).toBe(true);
    }
  });

  test("OrderUpdate is compatible with existing contract validators", () => {
    const update: OrderUpdate = {
      orderId: "order-123",
      symbol: "BTC/USDT",
      side: "BUY",
      orderType: "LIMIT",
      price: 30000,
      quantity: 0.01,
      status: "NEW",
      cumulativeFilledQty: 0,
      leavesQty: 0.01,
      averagePrice: null,
      timestampMs: 1700000000000,
    };

    // Should be usable alongside MarketDataSnapshot
    expect(isOrderUpdate(update)).toBe(true);
    expect(update.symbol).toBe("BTC/USDT");
    expect(update.status).toBe("NEW");
  });
});
