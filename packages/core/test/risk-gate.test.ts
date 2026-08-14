import { describe, expect, test } from "bun:test";
import { isRiskDecision, type OrderIntent } from "@agenttrading/contracts";
import {
  DEFAULT_RISK_POLICY,
  RiskGate,
} from "../src/risk/risk-gate.ts";

function intent(overrides: Partial<OrderIntent> = {}): OrderIntent {
  return {
    idempotencyKey: "intent-1",
    opportunityId: "opp-1",
    venue: "bybit",
    symbol: "BTC/USDT",
    side: "BUY",
    quantity: 0.01,
    price: 100,
    quoteCurrency: "USDT",
    createdAtMs: 0,
    expiresAtMs: 60_000,
    limits: { maxSlippageBps: 30 },
    ...overrides,
  };
}

describe("RiskGate (issue #13 AC4, RISK.md minimum rules)", () => {
  const gate = new RiskGate(DEFAULT_RISK_POLICY);

  test("approves a profitable, in-limits intent with approval payload", () => {
    const decision = gate.evaluate({
      orderIntent: intent(),
      expectedNetProfitUsd: 5,
      mode: "NORMAL",
      dataQualityScore: 0.95,
      evaluatedAtMs: 0,
    });
    expect(decision.decision).toBe("APPROVE");
    if (decision.decision === "APPROVE") {
      expect(decision.approvedSize).toBe(0.01);
      expect(decision.approvedLimits.maxSlippageBps).toBe(30);
      expect(decision.expiresAtMs).toBeGreaterThan(0);
    }
    expect(isRiskDecision(decision)).toBe(true);
  });

  test("rejects below the minimum edge with MIN_EDGE reason code", () => {
    const decision = gate.evaluate({
      orderIntent: intent(),
      expectedNetProfitUsd: 0.5,
      mode: "NORMAL",
      evaluatedAtMs: 0,
    });
    expect(decision.decision).toBe("REJECT");
    if (decision.decision === "REJECT") {
      expect(decision.reasonCodes).toContain("MIN_EDGE");
    }
    expect(isRiskDecision(decision)).toBe(true);
  });

  test("rejects with MIN_DATA_QUALITY when the source is degraded", () => {
    const decision = gate.evaluate({
      orderIntent: intent(),
      expectedNetProfitUsd: 5,
      mode: "NORMAL",
      dataQualityScore: 0.1,
      evaluatedAtMs: 0,
    });
    expect(decision.decision).toBe("REJECT");
    if (decision.decision === "REJECT") {
      expect(decision.reasonCodes).toContain("MIN_DATA_QUALITY");
    }
  });

  test("reduces size when notional exceeds the per-trade cap", () => {
    const decision = gate.evaluate({
      orderIntent: intent({ quantity: 20_000, price: 100 }),
      expectedNetProfitUsd: 5,
      mode: "NORMAL",
      evaluatedAtMs: 0,
    });
    expect(decision.decision).toBe("REDUCE_SIZE");
    if (decision.decision === "REDUCE_SIZE") {
      expect(decision.reasonCodes).toContain("MAX_RISK_PER_TRADE");
      expect(decision.approvedSize).toBe(
        DEFAULT_RISK_POLICY.maxRiskPerTradeUsd / 100,
      );
    }
    expect(isRiskDecision(decision)).toBe(true);
  });

  test("refuses new orders in a defensive mode", () => {
    const decision = gate.evaluate({
      orderIntent: intent(),
      expectedNetProfitUsd: 5,
      mode: "CANCEL_ONLY",
      evaluatedAtMs: 0,
    });
    expect(decision.decision).toBe("EXIT_ONLY");
    if (decision.decision === "EXIT_ONLY") {
      expect(decision.reasonCodes).toContain("DEGRADED_MODE");
    }
  });

  test("policy overrides change decisions", () => {
    const strict = new RiskGate({ ...DEFAULT_RISK_POLICY, minEdgeUsd: 10 });
    const decision = strict.evaluate({
      orderIntent: intent(),
      expectedNetProfitUsd: 5,
      mode: "NORMAL",
      evaluatedAtMs: 0,
    });
    expect(decision.decision).toBe("REJECT");
  });
});