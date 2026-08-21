import { describe, expect, test } from "bun:test";
import {
  type OrderIntent,
  type RiskDecision,
} from "@agenttrading/contracts";
import {
  PaperExecutionEngine,
  type PaperOrderSnapshot,
} from "../src/execution/paper-execution-engine.ts";

function intent(overrides: Partial<OrderIntent> = {}): OrderIntent {
  return {
    idempotencyKey: "intent-1",
    opportunityId: "opp-1",
    venue: "bybit",
    symbol: "BTC/USDT",
    side: "BUY",
    quantity: 2,
    price: 100,
    quoteCurrency: "USDT",
    createdAtMs: 0,
    expiresAtMs: 10_000,
    limits: { maxSlippageBps: 25 },
    ...overrides,
  };
}

function approvedDecision(overrides: Partial<RiskDecision> = {}): RiskDecision {
  return {
    decision: "APPROVE",
    orderIntentIdempotencyKey: "intent-1",
    evaluatedAtMs: 0,
    approvedSize: 2,
    approvedLimits: { maxSlippageBps: 25 },
    expiresAtMs: 10_000,
    ...overrides,
  } as RiskDecision;
}

function reducedDecision(overrides: Partial<RiskDecision> = {}): RiskDecision {
  return {
    decision: "REDUCE_SIZE",
    orderIntentIdempotencyKey: "intent-1",
    evaluatedAtMs: 0,
    approvedSize: 1,
    approvedLimits: { maxSlippageBps: 25 },
    expiresAtMs: 10_000,
    reasonCodes: ["MAX_RISK_PER_TRADE"],
    ...overrides,
  } as RiskDecision;
}

function rejectedDecision(overrides: Partial<RiskDecision> = {}): RiskDecision {
  return {
    decision: "REJECT",
    orderIntentIdempotencyKey: "intent-1",
    evaluatedAtMs: 0,
    reasonCodes: ["MIN_EDGE"],
    ...overrides,
  } as RiskDecision;
}

function getOrder(snapshot: PaperOrderSnapshot): PaperOrderSnapshot {
  return snapshot;
}

describe("PaperExecutionEngine", () => {
  test("keeps submit, accept, and fill as distinct async confirmations", () => {
    const engine = new PaperExecutionEngine();
    const submitted = engine.submit({
      intent: intent(),
      riskDecision: approvedDecision(),
      orderType: "MARKET",
      market: { bid: 99, ask: 101, mid: 100, liquidityUsd: 500 },
      submittedAtMs: 1_000,
      acceptAfterMs: 1_050,
      fillAfterMs: 1_200,
      slippageBps: 10,
      feeBps: 5,
    });

    expect(submitted.state).toBe("SUBMITTED");
    expect(submitted.events.map((event) => event.state)).toEqual(["SUBMITTED"]);

    expect(engine.poll(1_025)).toEqual([]);
    expect(getOrder(engine.snapshot("intent-1")!)).toBeDefined();

    const accept = engine.poll(1_050);
    expect(accept.map((event) => event.state)).toEqual(["ACCEPTED"]);
    expect(engine.snapshot("intent-1")?.state).toBe("ACCEPTED");

    const fill = engine.poll(1_200);
    expect(fill.map((event) => event.state)).toEqual(["FILLED"]);
    expect(engine.snapshot("intent-1")).toBeUndefined();
  });

  test("supports partial fills and later completion", () => {
    const engine = new PaperExecutionEngine();
    engine.submit({
      intent: intent({ quantity: 5 }),
      riskDecision: approvedDecision({ approvedSize: 5 }),
      orderType: "MARKET",
      market: { bid: 99, ask: 101, mid: 100, liquidityUsd: 200 },
      submittedAtMs: 1_000,
      acceptAfterMs: 1_010,
      fillAfterMs: 1_020,
      fillDelayMs: 50,
    });

    expect(engine.poll(1_010).map((event) => event.state)).toEqual(["ACCEPTED"]);
    const partial = engine.poll(1_020);
    expect(partial.map((event) => event.state)).toEqual(["PARTIALLY_FILLED"]);
    expect(engine.snapshot("intent-1")?.state).toBe("PARTIALLY_FILLED");
    expect(engine.snapshot("intent-1")?.remainingQuantity).toBeGreaterThan(0);

    const secondPartial = engine.poll(1_070);
    expect(secondPartial.map((event) => event.state)).toEqual(["PARTIALLY_FILLED"]);

    const finalFill = engine.poll(1_120);
    expect(finalFill.map((event) => event.state)).toEqual(["FILLED"]);
    expect(engine.snapshot("intent-1")).toBeUndefined();
  });

  test("cancels pending orders before final fill", () => {
    const engine = new PaperExecutionEngine();
    engine.submit({
      intent: intent(),
      riskDecision: approvedDecision(),
      market: { bid: 99, ask: 101, mid: 100, liquidityUsd: 500 },
      submittedAtMs: 1_000,
      acceptAfterMs: 1_010,
      fillAfterMs: 1_100,
    });

    expect(engine.poll(1_010).map((event) => event.state)).toEqual(["ACCEPTED"]);
    const cancelled = engine.cancel("intent-1", 1_020);
    expect(cancelled?.state).toBe("CANCELLED");
    expect(engine.snapshot("intent-1")).toBeUndefined();
  });

  test("exposes and cancels all pending paper orders", () => {
    const engine = new PaperExecutionEngine();
    engine.submit({
      intent: intent({ idempotencyKey: "intent-1" }),
      riskDecision: approvedDecision({ orderIntentIdempotencyKey: "intent-1" }),
      market: { bid: 99, ask: 101, mid: 100, liquidityUsd: 500 },
      submittedAtMs: 1_000,
      acceptAfterMs: 1_010,
      fillAfterMs: 2_000,
    });
    engine.submit({
      intent: intent({ idempotencyKey: "intent-2" }),
      riskDecision: approvedDecision({ orderIntentIdempotencyKey: "intent-2" }),
      market: { bid: 99, ask: 101, mid: 100, liquidityUsd: 500 },
      submittedAtMs: 1_000,
      acceptAfterMs: 1_010,
      fillAfterMs: 2_000,
    });

    expect(engine.pendingSnapshots().map((order) => order.orderId)).toEqual([
      "intent-1",
      "intent-2",
    ]);
    expect(engine.openOrderCount()).toBe(2);

    const cancelled = engine.cancelAll(1_020);
    expect(cancelled.map((order) => order.state)).toEqual([
      "CANCELLED",
      "CANCELLED",
    ]);
    expect(engine.openOrderCount()).toBe(0);
    expect(engine.pendingSnapshots()).toEqual([]);
  });

  test("rejects expired intents and rejected risk decisions", () => {
    const engine = new PaperExecutionEngine();

    const expired = engine.submit({
      intent: intent({ expiresAtMs: 999 }),
      riskDecision: approvedDecision(),
      market: { bid: 99, ask: 101, mid: 100, liquidityUsd: 500 },
      submittedAtMs: 1_000,
    });
    expect(expired.state).toBe("EXPIRED");

    const rejectedByRisk = engine.submit({
      intent: intent(),
      riskDecision: rejectedDecision(),
      market: { bid: 99, ask: 101, mid: 100, liquidityUsd: 500 },
      submittedAtMs: 1_000,
    });
    expect(rejectedByRisk.state).toBe("REJECTED");
  });

  test("accepts reduced approvals as executable intents", () => {
    const engine = new PaperExecutionEngine();
    const submitted = engine.submit({
      intent: intent(),
      riskDecision: reducedDecision(),
      market: { bid: 99, ask: 101, mid: 100, liquidityUsd: 500 },
      submittedAtMs: 1_000,
      acceptAfterMs: 1_010,
      fillAfterMs: 1_020,
    });

    expect(submitted.state).toBe("SUBMITTED");
    expect(engine.poll(1_010).map((event) => event.state)).toEqual(["ACCEPTED"]);
    expect(engine.poll(1_020).map((event) => event.state)).toEqual(["FILLED"]);
  });
});
