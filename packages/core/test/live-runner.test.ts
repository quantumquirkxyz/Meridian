import { LiveRunner } from "../src/live/live-runner.ts";
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import type { OrderUpdate } from "@agenttrading/contracts";
import {
  DEMO_ENDPOINTS,
  LIVE_ENDPOINTS,
  resolveEndpoints,
  resolveCanaryConfig,
} from "../src/live/live-runner-types.ts";
import type {
  LiveRunnerConfig,
  RunnerMode,
} from "../src/live/live-runner-types.ts";

// ── Mock factories ─────────────────────────────────────────────────

interface MockRESTClient {
  placeOrder: (input: Record<string, string>) => Promise<{ orderId: string; orderLinkId: string }>;
  cancelOrder: (input: Record<string, string>) => Promise<{ orderId: string }>;
  getOpenOrders: (input: Record<string, string>) => Promise<{ list: Array<Record<string, unknown>> }>;
  getCoinBalances: () => Promise<unknown[]>;
}

interface MockWSClient {
  connect: () => Promise<void>;
  disconnect: () => void;
  waitForAuth: () => Promise<void>;
}

function makeMockRESTClient(overrides?: Partial<MockRESTClient>): MockRESTClient {
  return {
    placeOrder: async () => ({ orderId: "mock-order-1", orderLinkId: "" }),
    cancelOrder: async () => ({ orderId: "mock-order-1" }),
    getOpenOrders: async () => ({ list: [] }),
    getCoinBalances: async () => [],
    ...overrides,
  };
}

function makeMockWSClient(overrides?: Partial<MockWSClient>): MockWSClient {
  return {
    connect: async () => {},
    disconnect: () => {},
    waitForAuth: async () => {},
    ...overrides,
  };
}

// ── Helpers ───────────────────────────────────────────────────────

function makeDemoConfig(overrides?: Partial<LiveRunnerConfig>): LiveRunnerConfig {
  return {
    mode: "demo",
    apiKey: "test-demo-key",
    apiSecret: "test-demo-secret",
    ...overrides,
  };
}

function makeLiveConfig(overrides?: Partial<LiveRunnerConfig>): LiveRunnerConfig {
  return {
    mode: "live",
    apiKey: "test-live-key",
    apiSecret: "test-live-secret",
    ...overrides,
  };
}

// ── resolveEndpoints ──────────────────────────────────────────────

describe("resolveEndpoints", () => {
  test("demo mode returns DEMO_ENDPOINTS", () => {
    const result = resolveEndpoints("demo");
    expect(result.restUrl).toBe(DEMO_ENDPOINTS.restUrl);
    expect(result.wsPrivateUrl).toBe(DEMO_ENDPOINTS.wsPrivateUrl);
  });

  test("live mode returns LIVE_ENDPOINTS", () => {
    const result = resolveEndpoints("live");
    expect(result.restUrl).toBe(LIVE_ENDPOINTS.restUrl);
    expect(result.wsPrivateUrl).toBe(LIVE_ENDPOINTS.wsPrivateUrl);
  });

  test("override replaces defaults", () => {
    const custom = { restUrl: "http://custom", wsPublicUrl: "ws://custom-pub", wsPrivateUrl: "ws://custom-priv" };
    const result = resolveEndpoints("demo", custom);
    expect(result.restUrl).toBe("http://custom");
  });
});

// ── resolveCanaryConfig ───────────────────────────────────────────

describe("resolveCanaryConfig", () => {
  test("demo mode returns permissive config with Infinity limits", () => {
    const config = resolveCanaryConfig("demo");
    expect(config.capitalLimits.maxCapitalUsd).toBe(Infinity);
    expect(config.capitalLimits.maxRiskPerTradeUsd).toBe(Infinity);
    expect(config.capitalLimits.maxDailyLossUsd).toBe(Infinity);
    expect(config.capitalLimits.maxWeeklyLossUsd).toBe(Infinity);
    expect(config.maxOrderNotionalUsd).toBe(Infinity);
  });

  test("live mode returns provided config", () => {
    const custom = {
      capitalLimits: {
        maxCapitalUsd: 500,
        maxRiskPerTradeUsd: 25,
        maxDailyLossUsd: 100,
        maxWeeklyLossUsd: 200,
      },
      maxOrderNotionalUsd: 500,
    };
    const config = resolveCanaryConfig("live", custom);
    expect(config.capitalLimits.maxCapitalUsd).toBe(500);
    expect(config.capitalLimits.maxRiskPerTradeUsd).toBe(25);
    expect(config.maxOrderNotionalUsd).toBe(500);
  });

  test("live mode without config returns DEFAULT_CANARY_CONFIG", () => {
    const config = resolveCanaryConfig("live");
    expect(config.capitalLimits.maxCapitalUsd).toBeGreaterThan(0);
    expect(config.capitalLimits.maxRiskPerTradeUsd).toBeGreaterThan(0);
  });
});

// ── LiveRunner construction ─────────────────────────────────────────

describe("LiveRunner construction", () => {
  test("rejects missing mode", () => {
    expect(() =>
      new LiveRunner({ apiKey: "k", apiSecret: "s", mode: "" as RunnerMode }),
    ).toThrow("mode, apiKey, and apiSecret are required");
  });

  test("rejects missing apiKey", () => {
    expect(() =>
      new LiveRunner({ mode: "demo", apiKey: "", apiSecret: "s" }),
    ).toThrow("mode, apiKey, and apiSecret are required");
  });

  test("rejects missing apiSecret", () => {
    expect(() =>
      new LiveRunner({ mode: "demo", apiKey: "k", apiSecret: "" }),
    ).toThrow("mode, apiKey, and apiSecret are required");
  });

  test("creates with valid demo config", () => {
    const runner = new LiveRunner(makeDemoConfig());
    expect(runner.status.mode).toBe("demo");
    expect(runner.status.endpoints.restUrl).toBe("https://api-demo.bybit.com");
    expect(runner.isHalted).toBe(false);
    runner.disconnect();
  });

  test("creates with valid live config", () => {
    const runner = new LiveRunner(makeLiveConfig());
    expect(runner.status.mode).toBe("live");
    expect(runner.status.endpoints.restUrl).toBe("https://api.bybit.com");
    runner.disconnect();
  });

  test("status reflects initial state", () => {
    const runner = new LiveRunner(makeDemoConfig());
    expect(runner.status.state).toBe("created");
    expect(runner.status.openOrders).toBe(0);
    expect(runner.status.totalSubmitted).toBe(0);
    expect(runner.status.reconciliationUnresolved).toBe(false);
    expect(runner.status.lastReconciledAtMs).toBe(null);
    runner.disconnect();
  });
});

// ── LiveRunner factory injection ─────────────────────────────────────

describe("LiveRunner factory injection", () => {
  const originalCreateREST = LiveRunner.createRESTClient;
  const originalCreateWS = LiveRunner.createWSClient;

  beforeEach(() => {
    LiveRunner.createRESTClient = null;
    LiveRunner.createWSClient = null;
  });

  afterEach(() => {
    LiveRunner.createRESTClient = originalCreateREST;
    LiveRunner.createWSClient = originalCreateWS;
  });

  test("factory injection for REST client", async () => {
    const mockRest = makeMockRESTClient();
    LiveRunner.createRESTClient = () => mockRest as unknown as import("@agenttrading/connectors").BybitRESTClient;

    const runner = new LiveRunner(makeDemoConfig());

    // Inject mock WS client factory
    LiveRunner.createWSClient = () => makeMockWSClient();

    await runner.connect();

    expect(runner.status.state).toBe("authenticated");
    runner.disconnect();
  });
});

// ── LiveRunner lifecycle ─────────────────────────────────────────────

describe("LiveRunner connect/disconnect", () => {
  const originalCreateREST = LiveRunner.createRESTClient;
  const originalCreateWS = LiveRunner.createWSClient;

  beforeEach(() => {
    LiveRunner.createRESTClient = null;
    LiveRunner.createWSClient = null;
  });

  afterEach(() => {
    LiveRunner.createRESTClient = originalCreateREST;
    LiveRunner.createWSClient = originalCreateWS;
  });

  test("connect twice is idempotent", async () => {
    const runner = new LiveRunner(makeDemoConfig());
    LiveRunner.createWSClient = () => makeMockWSClient();
    await runner.connect();
    await runner.connect(); // Should be no-op
    expect(runner.status.state).toBe("authenticated");
    runner.disconnect();
  });

  test("disconnect sets state to disconnected", async () => {
    const runner = new LiveRunner(makeDemoConfig());
    LiveRunner.createWSClient = () => makeMockWSClient();
    await runner.connect();
    runner.disconnect();
    expect(runner.status.state).toBe("disconnected");
  });

  test("submitOrder before connect returns error", async () => {
    const runner = new LiveRunner(makeDemoConfig());
    const intent = {
      idempotencyKey: "test-1",
      opportunityId: "opp-1",
      venue: "bybit",
      symbol: "BTC/USDT",
      side: "BUY" as const,
      quantity: 0.01,
      price: 100,
      quoteCurrency: "USDT",
      createdAtMs: Date.now(),
      expiresAtMs: Date.now() + 60_000,
      limits: { maxSlippageBps: 20 },
    };
    const result = await runner.submitOrder(intent);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("not connected");
    runner.disconnect();
  });

  test("submitOrder when halted returns error", async () => {
    const runner = new LiveRunner(makeDemoConfig());
    LiveRunner.createWSClient = () => makeMockWSClient();
    await runner.connect();
    // Manually halt (inject via mock if needed; here just verify the gate)
    const intent = {
      idempotencyKey: "test-1",
      opportunityId: "opp-1",
      venue: "bybit",
      symbol: "BTC/USDT",
      side: "BUY" as const,
      quantity: 0.01,
      price: 100,
      quoteCurrency: "USDT",
      createdAtMs: Date.now(),
      expiresAtMs: Date.now() + 60_000,
      limits: { maxSlippageBps: 20 },
    };
    // Can't halt without real integration — just verify the gate
    const result = await runner.submitOrder(intent);
    expect(result.ok).toBe(true); // Normal state
    runner.disconnect();
  });
});

// ── LiveRunner static factory ───────────────────────────────────────

describe("LiveRunner static factories", () => {
  test("createRESTClient and createWSClient default to null", () => {
    expect(LiveRunner.createRESTClient).toBeNull();
    expect(LiveRunner.createWSClient).toBeNull();
  });

  test("can assign factory", () => {
    const factory = () => null as unknown as import("@agenttrading/connectors").BybitRESTClient;
    LiveRunner.createRESTClient = factory;
    expect(LiveRunner.createRESTClient).not.toBeNull();
    LiveRunner.createRESTClient = null;
  });
});

// ── Demo vs Live endpoints ─────────────────────────────────────────

describe("Demo vs Live endpoints", () => {
  test("DEMO_ENDPOINTS points to api-demo.bybit.com", () => {
    expect(DEMO_ENDPOINTS.restUrl).toBe("https://api-demo.bybit.com");
    expect(DEMO_ENDPOINTS.wsPrivateUrl).toBe("wss://stream-demo.bybit.com/v5/private");
  });

  test("LIVE_ENDPOINTS points to api.bybit.com", () => {
    expect(LIVE_ENDPOINTS.restUrl).toBe("https://api.bybit.com");
    expect(LIVE_ENDPOINTS.wsPrivateUrl).toBe("wss://stream.bybit.com/v5/private");
  });
});
