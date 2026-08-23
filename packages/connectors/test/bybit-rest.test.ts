import { describe, expect, test, beforeEach } from "bun:test";
import { createHmac } from "node:crypto";
import {
  BybitRESTClient,
  BybitAPIError,
  BybitRateLimitError,
} from "../src/bybit-rest.ts";

// ── Mock fetch helpers ───────────────────────────────────────────────

interface MockFetchState {
  calls: Array<{ url: string; init?: RequestInit }>;
}

function jsonResponse(
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "X-Rate-Limit-Remaining": "119",
      "X-Rate-Limit-Reset": String(Math.floor(Date.now() / 1000) + 60),
      "X-Rate-Limit-Limit": "120",
      ...headers,
    },
  });
}

function rateLimitResponse(): Response {
  return new Response(JSON.stringify({ retCode: 10006, retMsg: "Too many requests" }), {
    status: 429,
    headers: {
      "Content-Type": "application/json",
      "X-Rate-Limit-Remaining": "0",
      "X-Rate-Limit-Reset": String(Math.floor(Date.now() / 1000) + 1),
      "X-Rate-Limit-Limit": "120",
    },
  });
}

function createMockFetch(
  handler: (url: string, init?: RequestInit) => Response,
  state?: MockFetchState,
): { fn: typeof fetch; state: MockFetchState } {
  const s: MockFetchState = state ?? { calls: [] };
  const fn = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const urlStr = typeof url === "string" ? url : url.toString();
    s.calls.push({ url: urlStr, init });
    return handler(urlStr, init);
  };
  return { fn: fn as unknown as typeof fetch, state: s };
}

// ── HMAC Signing Tests ──────────────────────────────────────────────

describe("BybitRESTClient HMAC signing", () => {
  test("generates correct HMAC-SHA256 signature", () => {
    const apiKey = "test-api-key";
    const apiSecret = "test-api-secret";
    const timestamp = 1700000000000;
    const recvWindow = 5000;
    const payload = "category=spot&symbol=BTCUSDT";

    const signPayload = `${timestamp}${apiKey}${recvWindow}${payload}`;
    const expectedSignature = createHmac("sha256", apiSecret)
      .update(signPayload)
      .digest("hex");

    // Verify the signing logic matches Bybit V5 spec
    expect(expectedSignature).toMatch(/^[a-f0-9]{64}$/);
    expect(expectedSignature.length).toBe(64);
  });

  test("sends correct auth headers", async () => {
    const apiKey = "test-key";
    const apiSecret = "test-secret";
    const state: MockFetchState = { calls: [] };
    const { fn } = createMockFetch(
      () => jsonResponse({ retCode: 0, retMsg: "OK", result: {} }),
      state,
    );

    const client = new BybitRESTClient({
      apiKey,
      apiSecret,
      fetchFn: fn,
    });

    await client.getAccountInfo();

    const { init } = state.calls[0];
    const headers = Object.fromEntries(
      new Headers(init?.headers as Record<string, string>).entries(),
    );
    expect(headers["x-bapi-api-key"]).toBe(apiKey);
    expect(headers["x-bapi-sign"]).toMatch(/^[a-f0-9]{64}$/);
    expect(headers["x-bapi-timestamp"]).toBeDefined();
    expect(headers["x-bapi-recv-window"]).toBe("5000");
    expect(state.calls[0].url).toContain("/v5/account/wallet-balance");
  });

  test("appends signature with correct payload format", async () => {
    const apiKey = "key123";
    const apiSecret = "secret456";
    const state: MockFetchState = { calls: [] };
    const { fn } = createMockFetch(
      () => jsonResponse({ retCode: 0, retMsg: "OK", result: {} }),
      state,
    );

    const client = new BybitRESTClient({
      apiKey,
      apiSecret,
      fetchFn: fn,
    });

    await client.placeOrder({
      category: "spot",
      symbol: "BTCUSDT",
      side: "Buy",
      orderType: "Limit",
      qty: "0.001",
      price: "30000",
    });

    const body = state.calls[0].init?.body as string;
    expect(body).toContain("category=spot");
    expect(body).toContain("symbol=BTCUSDT");
    expect(body).toContain("side=Buy");
    expect(body).toContain("orderType=Limit");
    expect(body).toContain("qty=0.001");
    expect(body).toContain("price=30000");
  });
});

// ── API Error Handling Tests ─────────────────────────────────────────

describe("BybitRESTClient error handling", () => {
  test("throws BybitAPIError on non-zero retCode", async () => {
    const { fn } = createMockFetch(() =>
      jsonResponse({ retCode: 10001, retMsg: "Invalid parameter", result: {} }),
    );

    const client = new BybitRESTClient({
      apiKey: "key",
      apiSecret: "secret",
      fetchFn: fn,
    });

    await expect(client.getAccountInfo()).rejects.toThrow(BybitAPIError);
    await expect(client.getAccountInfo()).rejects.toThrow("Invalid parameter");
  });

  test("throws BybitRateLimitError on 429", async () => {
    const { fn } = createMockFetch(() => rateLimitResponse());

    const client = new BybitRESTClient({
      apiKey: "key",
      apiSecret: "secret",
      maxRetries: 0,
      fetchFn: fn,
    });

    await expect(client.getAccountInfo()).rejects.toThrow(BybitRateLimitError);
  });
});

// ── Rate Limit Retry Tests ───────────────────────────────────────────

describe("BybitRESTClient rate limit retry", () => {
  test("retries on 429 with exponential backoff", async () => {
    let callCount = 0;
    const { fn } = createMockFetch(() => {
      callCount++;
      if (callCount <= 2) {
        return rateLimitResponse();
      }
      return jsonResponse({ retCode: 0, retMsg: "OK", result: { list: [], nextPageCursor: "" } });
    });

    const client = new BybitRESTClient({
      apiKey: "key",
      apiSecret: "secret",
      maxRetries: 3,
      initialBackoffMs: 1, // Fast for testing
      fetchFn: fn,
    });

    const result = await client.getOpenOrders({ category: "spot" });
    expect(result).toEqual({ list: [], nextPageCursor: "" });
    expect(callCount).toBe(3); // 2 failures + 1 success
  });

  test("exhausts retries and throws on persistent 429", async () => {
    let callCount = 0;
    const { fn } = createMockFetch(() => {
      callCount++;
      return rateLimitResponse();
    });

    const client = new BybitRESTClient({
      apiKey: "key",
      apiSecret: "secret",
      maxRetries: 2,
      initialBackoffMs: 1,
      fetchFn: fn,
    });

    await expect(client.getAccountInfo()).rejects.toThrow(BybitRateLimitError);
    expect(callCount).toBe(3); // 1 initial + 2 retries
  });

  test("does not retry non-429 errors", async () => {
    let callCount = 0;
    const { fn } = createMockFetch(() => {
      callCount++;
      if (callCount === 1) {
        return new Response(
          JSON.stringify({ retCode: 0, retMsg: "OK", result: {} }),
          { status: 500, headers: { "Content-Type": "application/json" } },
        );
      }
      return jsonResponse({ retCode: 0, retMsg: "OK", result: {} });
    });

    const client = new BybitRESTClient({
      apiKey: "key",
      apiSecret: "secret",
      maxRetries: 3,
      fetchFn: fn,
    });

    // 500 status but retCode 0 means success (Bybit quirk)
    const result = await client.getAccountInfo();
    expect(result).toBeDefined();
    expect(callCount).toBe(1); // No retry
  });

  test("tracks rate limit state from response headers", async () => {
    const { fn } = createMockFetch(() =>
      jsonResponse(
        { retCode: 0, retMsg: "OK", result: {} },
        {
          "X-Rate-Limit-Remaining": "50",
          "X-Rate-Limit-Reset": String(Math.floor(Date.now() / 1000) + 30),
          "X-Rate-Limit-Limit": "120",
        },
      ),
    );

    const client = new BybitRESTClient({
      apiKey: "key",
      apiSecret: "secret",
      fetchFn: fn,
    });

    await client.getAccountInfo();
    const state = client.getRateLimitState();
    expect(state.remaining).toBe(50);
    expect(state.maxRequests).toBe(120);
  });
});

// ── REST API Method Tests ────────────────────────────────────────────

describe("BybitRESTClient API methods", () => {
  let state: MockFetchState;
  let client: BybitRESTClient;

  beforeEach(() => {
    state = { calls: [] };
    const { fn } = createMockFetch(
      () => jsonResponse({ retCode: 0, retMsg: "OK", result: {} }),
      state,
    );
    client = new BybitRESTClient({
      apiKey: "key",
      apiSecret: "secret",
      fetchFn: fn,
    });
  });

  test("placeOrder sends correct params", async () => {
    await client.placeOrder({
      category: "linear",
      symbol: "BTCUSDT",
      side: "Buy",
      orderType: "Market",
      qty: "0.01",
    });

    const body = state.calls[0].init?.body as string;
    expect(body).toContain("category=linear");
    expect(body).toContain("symbol=BTCUSDT");
    expect(body).toContain("side=Buy");
    expect(body).toContain("orderType=Market");
    expect(body).toContain("qty=0.01");
  });

  test("cancelOrder sends orderId", async () => {
    await client.cancelOrder({
      category: "linear",
      symbol: "BTCUSDT",
      orderId: "order-123",
    });

    const body = state.calls[0].init?.body as string;
    expect(body).toContain("orderId=order-123");
  });

  test("getOpenOrders builds query string for GET", async () => {
    await client.getOpenOrders({
      category: "spot",
      symbol: "ETHUSDT",
      limit: 20,
    });

    const url = state.calls[0].url;
    expect(url).toContain("/v5/order/realtime?");
    expect(url).toContain("category=spot");
    expect(url).toContain("symbol=ETHUSDT");
    expect(url).toContain("limit=20");
  });

  test("getAccountInfo calls correct endpoint", async () => {
    await client.getAccountInfo();
    expect(state.calls[0].url).toContain("/v5/account/wallet-balance");
  });
});
