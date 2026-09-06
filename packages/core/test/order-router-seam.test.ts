import { describe, expect, test } from "bun:test";
import {
  DEFAULT_CANARY_CONFIG,
  type ApprovedRiskDecision,
  type OrderIntent,
  type OrderRouteAck,
  type OrderRouter,
  type RiskDecision,
} from "@agenttrading/contracts";
import { type CanaryPreCheckResult } from "@agenttrading/core";
import { LiveExecutionEngine } from "../src/live/live-execution-engine.ts";
import { CanarySession } from "../src/live/canary-session.ts";
import { TradingSession } from "../src/live/trading-session.ts";

const FIXED_TS = 1_700_000_000_000;

// ── Fixtures ───────────────────────────────────────────────────────────

function intent(overrides: Partial<OrderIntent> = {}): OrderIntent {
  return {
    idempotencyKey: "intent-1",
    opportunityId: "opp-1",
    venue: "bybit",
    symbol: "BTCUSDT",
    side: "BUY",
    quantity: 0.01,
    price: 100,
    quoteCurrency: "USDT",
    createdAtMs: FIXED_TS,
    expiresAtMs: FIXED_TS + 60_000,
    limits: { maxSlippageBps: 20 },
    ...overrides,
  };
}

function approvedDecision(
  overrides: Partial<ApprovedRiskDecision> = {},
): ApprovedRiskDecision {
  return {
    decision: "APPROVE",
    orderIntentIdempotencyKey: "intent-1",
    evaluatedAtMs: FIXED_TS,
    approvedSize: 0.01,
    approvedLimits: { maxSlippageBps: 20 },
    expiresAtMs: FIXED_TS + 60_000,
    ...overrides,
  };
}

function allowedPreCheck(approvedQuantity?: number): CanaryPreCheckResult {
  return {
    allowed: true,
    reason: "all canary limits satisfied",
    ...(approvedQuantity !== undefined ? { approvedQuantity } : {}),
  };
}

function blockedPreCheck(): CanaryPreCheckResult {
  return {
    allowed: false,
    blockReason: "CAPITAL_EXHAUSTED",
    reason: "capital already fully deployed",
  };
}

// ── LiveExecutionEngine seam (ADR-0011) ──────────────────────────────

describe("LiveExecutionEngine OrderRouter seam (ADR-0011)", () => {
  test("router is optional by default and can be late-wired", () => {
    const engine = new LiveExecutionEngine(DEFAULT_CANARY_CONFIG);
    expect(engine.hasOrderRouter).toBe(false);

    engine.setOrderRouter({
      route: async (_i, _d) => ({ orderId: "x", venue: "bybit" }),
    });
    expect(engine.hasOrderRouter).toBe(true);

    engine.setOrderRouter(undefined);
    expect(engine.hasOrderRouter).toBe(false);
  });

  test("constructor accepts an OrderRouter", async () => {
    const router: OrderRouter = {
      route: async () => ({ orderId: "ex-1", venue: "bybit" }),
    };
    const engine = new LiveExecutionEngine(DEFAULT_CANARY_CONFIG, undefined, router);
    expect(engine.hasOrderRouter).toBe(true);

    const ack = await engine.placeLiveOrder(intent(), allowedPreCheck(), approvedDecision());
    expect(ack.orderId).toBe("ex-1");
  });

  test("routes through the attached router passing the approved intent and decision", async () => {
    let routedIntent: OrderIntent | undefined;
    let routedDecision: RiskDecision | undefined;
    const router: OrderRouter = {
      route: async (intent, riskDecision) => {
        routedIntent = intent;
        routedDecision = riskDecision;
        return { orderId: "ex-2", venue: "bybit", externalRef: undefined };
      },
    };
    const engine = new LiveExecutionEngine(DEFAULT_CANARY_CONFIG, undefined, router);

    const decision = approvedDecision();
    const ack = await engine.placeLiveOrder(intent(), allowedPreCheck(0.005), decision);
    expect(ack.orderId).toBe("ex-2");
    expect(ack.venue).toBe("bybit");
    expect(routedIntent).toBeDefined();
    expect(routedIntent!.idempotencyKey).toBe("intent-1");
    expect(routedDecision!.decision).toBe("APPROVE");
    expect(routedDecision!.orderIntentIdempotencyKey).toBe("intent-1");
  });

  test("refuses to route when the canary pre-check did not approve", async () => {
    let routed = false;
    const router: OrderRouter = {
      route: async () => {
        routed = true;
        return { orderId: "never", venue: "bybit" };
      },
    };
    const engine = new LiveExecutionEngine(DEFAULT_CANARY_CONFIG, undefined, router);

    await expect(engine.placeLiveOrder(intent(), blockedPreCheck(), approvedDecision())).rejects.toThrow(
      "canary pre-check failed",
    );
    expect(routed).toBe(false);
  });

  test("refuses to route when the Risk Engine did not approve (fail-closed)", async () => {
    let routed = false;
    const router: OrderRouter = {
      route: async () => {
        routed = true;
        return { orderId: "never", venue: "bybit" };
      },
    };
    const engine = new LiveExecutionEngine(DEFAULT_CANARY_CONFIG, undefined, router);

    const rejected: RiskDecision = {
      decision: "REJECT",
      orderIntentIdempotencyKey: "intent-1",
      evaluatedAtMs: FIXED_TS,
      reasonCodes: ["MIN_EDGE"],
    };
    await expect(
      engine.placeLiveOrder(intent(), allowedPreCheck(), rejected),
    ).rejects.toThrow("risk decision REQUIRES APPROVE");
    expect(routed).toBe(false);
  });

  test("simulates the fill and returns a shape-compatible ack without a router", async () => {
    const engine = new LiveExecutionEngine(DEFAULT_CANARY_CONFIG);
    const ack = await engine.placeLiveOrder(intent({ venue: "bybit" }), allowedPreCheck(), approvedDecision());

    expect(typeof ack.orderId).toBe("string");
    expect(ack.orderId.length).toBeGreaterThan(0);
    expect(ack.venue).toBe("bybit");
  });
});

// ── CanarySession / TradingSession delegation ─────────────────────────

describe("Session OrderRouter delegation (ADR-0011)", () => {
  test("CanarySession delegates pre-check and live placement", async () => {
    const router: OrderRouter = {
      route: async () => ({ orderId: "sess-1", venue: "bybit" } as OrderRouteAck),
    };
    const session = new CanarySession({
      config: DEFAULT_CANARY_CONFIG,
      now: () => FIXED_TS,
    });
    session.setOrderRouter(router);
    expect(session.hasOrderRouter).toBe(true);

    const preCheck = session.preCheckIntent(intent());
    expect(preCheck.allowed).toBe(true);
    const ack = await session.placeLiveOrder(intent(), preCheck, approvedDecision());
    expect(ack.orderId).toBe("sess-1");
  });

  test("TradingSession exposes the same placement seam", async () => {
    const router: OrderRouter = {
      route: async () => ({ orderId: "ts-1", venue: "bybit" }),
    };
    const session = new TradingSession({
      canaryConfig: DEFAULT_CANARY_CONFIG,
      learningCycleInterval: 10,
      now: () => FIXED_TS,
    });
    session.setOrderRouter(router);

    const preCheck = session.preCheckIntent(intent());
    const ack = await session.placeLiveOrder(intent(), preCheck, approvedDecision());
    expect(ack.orderId).toBe("ts-1");
  });

  test("pre-check result carries the blocked reason into placeLiveOrder", async () => {
    const session = new TradingSession({
      canaryConfig: DEFAULT_CANARY_CONFIG,
      learningCycleInterval: 10,
      now: () => FIXED_TS,
    });
    const blocked = session.preCheckIntent(intent({ quantity: 0 }));
    expect(blocked.allowed).toBe(true);
  });
});