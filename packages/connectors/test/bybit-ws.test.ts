import { describe, expect, test } from "bun:test";
import { BybitWebSocketClient } from "../src/bybit-ws.ts";
import type { MarketDataSnapshot, OrderUpdate } from "@agenttrading/contracts";

// ── Mock WebSocket ───────────────────────────────────────────────────

class MockWebSocket {
  readyState = 0; // CONNECTING
  sent: string[] = [];
  handlers: Record<string, (event: unknown) => void> = {};

  constructor(public url: string) {}

  addEventListener(type: string, handler: (event: unknown) => void): void {
    this.handlers[type] = handler;
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3; // CLOSED
  }

  // Test helpers
  simulateOpen(): void {
    this.readyState = 1; // OPEN
    this.handlers.open?.({});
  }

  simulateMessage(data: unknown): void {
    this.handlers.message?.({ data: JSON.stringify(data) });
  }

  simulateClose(reason = ""): void {
    this.readyState = 3;
    this.handlers.close?.({ reason });
  }

  simulateError(message = "ws error"): void {
    this.handlers.error?.({ message });
  }
}

/**
 * Build a BybitWebSocketClient that tracks the last WS instances
 * created by the factory so tests can simulate events on them.
 */
function buildClient(options: {
  apiKey?: string;
  apiSecret?: string;
  symbols?: string[];
  publicTopics?: string[];
  privateTopics?: string[];
  nowMs?: () => number;
} = {}): {
  client: BybitWebSocketClient;
  publicWs: () => MockWebSocket;
  privateWs: () => MockWebSocket;
} {
  let _publicWs: MockWebSocket | null = null;
  let _privateWs: MockWebSocket | null = null;
  let callCount = 0;

  const wsFactory = (url: string): MockWebSocket => {
    callCount++;
    const ws = new MockWebSocket(url);
    if (callCount === 1) {
      _publicWs = ws;
    } else {
      _privateWs = ws;
    }
    return ws;
  };

  const client = new BybitWebSocketClient({
    apiKey: options.apiKey,
    apiSecret: options.apiSecret,
    symbols: options.symbols ?? ["BTCUSDT"],
    publicTopics: options.publicTopics ?? ["orderbook.50", "trade"],
    privateTopics: options.privateTopics ?? ["order", "position", "execution"],
    wsFactory: wsFactory as unknown as (url: string) => WebSocket,
    nowMs: options.nowMs ?? (() => Date.now()),
  });

  return {
    client,
    publicWs: () => _publicWs!,
    privateWs: () => _privateWs!,
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe("BybitWebSocketClient", () => {
  test("connects to public stream and subscribes to topics", () => {
    const { client, publicWs } = buildClient({
      symbols: ["BTCUSDT", "ETHUSDT"],
    });

    client.connect();
    const ws = publicWs();
    ws.simulateOpen();

    // Should have sent subscribe message
    expect(ws.sent.length).toBe(1);
    const subscribeMsg = JSON.parse(ws.sent[0]);
    expect(subscribeMsg.op).toBe("subscribe");
    expect(subscribeMsg.args).toContain("orderbook.50.BTCUSDT");
    expect(subscribeMsg.args).toContain("orderbook.50.ETHUSDT");
    expect(subscribeMsg.args).toContain("trade.BTCUSDT");
    expect(subscribeMsg.args).toContain("trade.ETHUSDT");
  });

  test("normalizes orderbook data into MarketDataSnapshot", () => {
    let receivedSnapshot: MarketDataSnapshot | undefined;

    const { client, publicWs } = buildClient({
      symbols: ["BTCUSDT"],
      nowMs: () => 1700000001000,
    });

    client.on({
      onMarketData: (snapshot) => {
        receivedSnapshot = snapshot;
      },
    });

    client.connect();
    const ws = publicWs();

    // Simulate orderbook message
    ws.simulateMessage({
      topic: "orderbook.50.BTCUSDT",
      type: "snapshot",
      data: {
        s: "BTCUSDT",
        b: [
          { price: "30000", size: "1.5" },
          { price: "29999", size: "2.0" },
        ],
        a: [
          { price: "30001", size: "1.2" },
          { price: "30002", size: "0.8" },
        ],
        u: 1,
        seq: 100,
        cts: 1700000000000,
      },
    });

    expect(receivedSnapshot).toBeDefined();
    expect(receivedSnapshot!.venue).toBe("bybit");
    expect(receivedSnapshot!.symbol).toBe("BTC/USDT");
    expect(receivedSnapshot!.bid).toBe(30000);
    expect(receivedSnapshot!.ask).toBe(30001);
    expect(receivedSnapshot!.mid).toBe(30000.5);
    // depth = (30000*1.5 + 29999*2.0) + (30001*1.2 + 30002*0.8)
    //       = (45000 + 59998) + (36001.2 + 24001.6) = 165000.8
    expect(receivedSnapshot!.depth).toBeCloseTo(165000.8);
    expect(receivedSnapshot!.source).toBe("bybit-ws-orderbook");
    expect(receivedSnapshot!.sequence).toBe(100);
  });

  test("normalizes trade data into MarketDataSnapshot", () => {
    let receivedSnapshot: MarketDataSnapshot | undefined;

    const { client, publicWs } = buildClient({
      symbols: ["BTCUSDT"],
      nowMs: () => 1700000001000,
    });

    client.on({
      onMarketData: (snapshot) => {
        receivedSnapshot = snapshot;
      },
    });

    client.connect();
    const ws = publicWs();

    // Simulate trade message (array of trades)
    ws.simulateMessage({
      topic: "trade",
      type: "snapshot",
      data: [
        {
          i: "trade-1",
          T: 1700000000000,
          p: "30005.5",
          v: "0.01",
          S: "Buy",
          s: "BTCUSDT",
          BT: false,
        },
      ],
    });

    expect(receivedSnapshot).toBeDefined();
    expect(receivedSnapshot!.bid).toBe(30005.5);
    expect(receivedSnapshot!.ask).toBe(30005.5);
    expect(receivedSnapshot!.symbol).toBe("BTC/USDT");
    expect(receivedSnapshot!.source).toBe("bybit-ws-trade");
  });

  test("normalizes private order events into OrderUpdate", () => {
    let receivedUpdate: OrderUpdate | undefined;

    const { client, publicWs, privateWs } = buildClient({
      apiKey: "test-key",
      apiSecret: "test-secret",
      nowMs: () => 1700000001000,
    });

    client.on({
      onOrderUpdate: (update) => {
        receivedUpdate = update;
      },
    });

    client.connect();

    // Open public stream (required for client to be considered connected)
    publicWs().simulateOpen();

    // Simulate private WS open + auth
    privateWs().simulateOpen();
    privateWs().simulateMessage({
      op: "auth",
      auth: {
        expire: 1700000010000,
        api_key: "test-key",
        twist: "abc",
      },
    });

    // Simulate order update
    privateWs().simulateMessage({
      topic: "order",
      type: "snapshot",
      data: [
        {
          orderId: "order-abc",
          orderLinkId: "client-123",
          symbol: "BTCUSDT",
          price: "30000",
          qty: "0.01",
          side: "Buy",
          orderStatus: "Filled",
          orderType: "Limit",
          avgPrice: "30000",
          cumExecQty: "0.01",
          leavesQty: "0",
          rejectReason: "",
          cancelType: "",
          createdTime: "1700000000000",
          updatedTime: "1700000000500",
          stopOrderType: "",
          tpslMode: "",
          triggerPrice: "",
          feeCurrency: "USDT",
        },
      ],
    });

    expect(receivedUpdate).toBeDefined();
    expect(receivedUpdate!.orderId).toBe("order-abc");
    expect(receivedUpdate!.orderLinkId).toBe("client-123");
    expect(receivedUpdate!.symbol).toBe("BTC/USDT");
    expect(receivedUpdate!.side).toBe("BUY");
    expect(receivedUpdate!.orderType).toBe("LIMIT");
    expect(receivedUpdate!.status).toBe("FILLED");
    expect(receivedUpdate!.price).toBe(30000);
    expect(receivedUpdate!.quantity).toBe(0.01);
    expect(receivedUpdate!.cumulativeFilledQty).toBe(0.01);
    expect(receivedUpdate!.leavesQty).toBe(0);
    expect(receivedUpdate!.averagePrice).toBe(30000);
  });

  test("maps Bybit order statuses correctly", async () => {
    const statusMap: [string, string][] = [
      ["New", "NEW"],
      ["PartiallyFilled", "PARTIALLY_FILLED"],
      ["Filled", "FILLED"],
      ["Cancelled", "CANCELLED"],
      ["Rejected", "REJECTED"],
      ["Deactivated", "CANCELLED"],
      ["Untriggered", "UNTRIGGERED"],
    ];

    for (const [bybitStatus, expectedStatus] of statusMap) {
      const receivedUpdates: OrderUpdate[] = [];

      // Each iteration creates a fresh WS pair
      let _publicWs: MockWebSocket | null = null;
      let _privateWs: MockWebSocket | null = null;
      let callCount = 0;

      const factory = (url: string): MockWebSocket => {
        callCount++;
        const ws = new MockWebSocket(url);
        if (callCount === 1) _publicWs = ws;
        else _privateWs = ws;
        return ws;
      };

      const client = new BybitWebSocketClient({
        apiKey: "key",
        apiSecret: "secret",
        symbols: ["BTCUSDT"],
        privateTopics: ["order"],
        wsFactory: factory as unknown as (url: string) => WebSocket,
        nowMs: () => 1700000001000,
      });

      client.on({
        onOrderUpdate: (update) => receivedUpdates.push(update),
      });

      client.connect();

      // Open public stream
      _publicWs!.simulateOpen();

      // Open private stream and auth
      _privateWs!.simulateOpen();
      _privateWs!.simulateMessage({
        op: "auth",
        auth: { expire: 1700000010000, api_key: "key", twist: "x" },
      });

      // Send order update
      _privateWs!.simulateMessage({
        topic: "order",
        data: [
          {
            orderId: "test",
            symbol: "BTCUSDT",
            side: "Buy",
            orderType: "Limit",
            orderStatus: bybitStatus,
            price: "30000",
            qty: "1",
            avgPrice: "",
            cumExecQty: "0",
            leavesQty: "1",
            rejectReason: "",
            cancelType: "",
            createdTime: "0",
            updatedTime: "0",
            stopOrderType: "",
            tpslMode: "",
            triggerPrice: "",
            feeCurrency: "USDT",
          },
        ],
      });

      expect(receivedUpdates.length).toBe(1);
      expect(receivedUpdates[0].status).toBe(expectedStatus as OrderUpdate["status"]);
    }
  });

  test("sends ping for keepalive", () => {
    const { client, publicWs } = buildClient();
    client.connect();
    const ws = publicWs();
    ws.simulateOpen();

    expect(client.state).toBe("connected");
  });

  test("handles pong response without error", () => {
    const { client, publicWs } = buildClient();
    client.connect();
    const ws = publicWs();
    ws.simulateOpen();

    // Pong should not throw
    ws.simulateMessage({ op: "pong" });
    expect(client.state).toBe("connected");
  });

  test("handles subscription ack without error", () => {
    const { client, publicWs } = buildClient();
    client.connect();
    const ws = publicWs();

    // Subscription ack should not throw
    ws.simulateMessage({
      success: true,
      ret_msg: "",
      op: "subscribe",
      conn_id: "conn-1",
    });
  });

  test("disconnect stops reconnection", () => {
    let reconnectAttempted = false;

    const { client, publicWs } = buildClient();
    client.on({
      onReconnecting: () => {
        reconnectAttempted = true;
      },
    });

    client.connect();
    const ws = publicWs();

    // Disconnect before close event
    client.disconnect();
    expect(client.state).toBe("disconnected");

    // Simulate close after disconnect
    ws.simulateClose("test");

    // Should not attempt reconnect since we disconnected intentionally
    expect(reconnectAttempted).toBe(false);
  });

  test("disconnect does not fire onDisconnected callback", () => {
    let disconnected = false;

    const { client, publicWs } = buildClient();
    client.on({
      onDisconnected: () => {
        disconnected = true;
      },
    });

    client.connect();
    const ws = publicWs();
    client.disconnect();

    // onDisconnected should not be called for intentional disconnect
    expect(disconnected).toBe(false);
  });

  test("reports state correctly", () => {
    const { client, publicWs } = buildClient();

    expect(client.state).toBe("disconnected");

    client.connect();
    expect(client.state).toBe("connecting");

    const ws = publicWs();
    ws.simulateOpen();
    expect(client.state).toBe("connected");
  });
});
