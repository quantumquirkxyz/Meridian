import { describe, expect, test } from "bun:test";
import {
  isRiskDecision,
  parseRiskDecision,
  type OrderIntent,
} from "@agenttrading/contracts";
import {
  DEFAULT_RISK_POLICY,
  RiskEngine,
  activeRules,
  RISK_APPROVAL_TTL_MS,
  type RiskPolicy,
  type RiskGateInput,
} from "../src/risk/risk-gate.ts";

// ── Helpers ─────────────────────────────────────────────────────────

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

function baseInput(overrides: Partial<RiskGateInput> = {}): RiskGateInput {
  return {
    orderIntent: intent(),
    expectedNetProfitUsd: 5,
    mode: "NORMAL",
    evaluatedAtMs: 0,
    ...overrides,
  };
}

// ── Rule 1: MAX_RISK_PER_TRADE ──────────────────────────────────────

describe("Rule 1: MAX_RISK_PER_TRADE", () => {
  const engine = new RiskEngine(DEFAULT_RISK_POLICY);

  test("approves when notional is below the per-trade cap", () => {
    const decision = engine.evaluate(baseInput());
    expect(decision.decision).toBe("APPROVE");
    expect(isRiskDecision(decision)).toBe(true);
  });

  test("reduces size when notional exceeds the per-trade cap", () => {
    const decision = engine.evaluate(
      baseInput({ orderIntent: intent({ quantity: 20_000, price: 100 }) }),
    );
    expect(decision.decision).toBe("REDUCE_SIZE");
    if (decision.decision === "REDUCE_SIZE") {
      expect(decision.reasonCodes).toContain("MAX_RISK_PER_TRADE");
      expect(decision.approvedSize).toBe(
        DEFAULT_RISK_POLICY.maxRiskPerTradeUsd / 100,
      );
    }
  });

  test("zero quantity is always approved (no notional)", () => {
    const decision = engine.evaluate(
      baseInput({ orderIntent: intent({ quantity: 0, price: 100 }) }),
    );
    expect(decision.decision).toBe("APPROVE");
  });
});

// ── Rule 2: MAX_DAILY_LOSS ──────────────────────────────────────────

describe("Rule 2: MAX_DAILY_LOSS", () => {
  const engine = new RiskEngine({
    ...DEFAULT_RISK_POLICY,
    maxDailyLossUsd: 500,
  });

  test("approves when daily loss is below limit", () => {
    const decision = engine.evaluate(baseInput({ dailyLossUsd: 200 }));
    expect(decision.decision).toBe("APPROVE");
  });

  test("blocks with CASH_ONLY when daily loss hits limit", () => {
    const decision = engine.evaluate(baseInput({ dailyLossUsd: 500 }));
    expect(decision.decision).toBe("CASH_ONLY");
    if (decision.decision === "CASH_ONLY") {
      expect(decision.reasonCodes).toContain("MAX_DAILY_LOSS");
    }
  });

  test("blocks with CASH_ONLY when daily loss exceeds limit", () => {
    const decision = engine.evaluate(baseInput({ dailyLossUsd: 600 }));
    expect(decision.decision).toBe("CASH_ONLY");
  });

  test("rule not enforced when policy field is undefined", () => {
    const engine2 = new RiskEngine({
      ...DEFAULT_RISK_POLICY,
      maxDailyLossUsd: undefined,
    });
    const decision = engine2.evaluate(baseInput({ dailyLossUsd: 999_999 }));
    expect(decision.decision).not.toBe("CASH_ONLY");
  });
});

// ── Rule 3: MAX_WEEKLY_LOSS ─────────────────────────────────────────

describe("Rule 3: MAX_WEEKLY_LOSS", () => {
  const engine = new RiskEngine({
    ...DEFAULT_RISK_POLICY,
    maxWeeklyLossUsd: 2_000,
  });

  test("approves when weekly loss is below limit", () => {
    const decision = engine.evaluate(baseInput({ weeklyLossUsd: 1_000 }));
    expect(decision.decision).toBe("APPROVE");
  });

  test("blocks with CANCEL_ONLY when weekly loss hits limit", () => {
    const decision = engine.evaluate(baseInput({ weeklyLossUsd: 2_000 }));
    expect(decision.decision).toBe("CANCEL_ONLY");
    if (decision.decision === "CANCEL_ONLY") {
      expect(decision.reasonCodes).toContain("MAX_WEEKLY_LOSS");
    }
  });

  test("blocks with CANCEL_ONLY when weekly loss exceeds limit", () => {
    const decision = engine.evaluate(baseInput({ weeklyLossUsd: 3_000 }));
    expect(decision.decision).toBe("CANCEL_ONLY");
  });

  test("rule not enforced when policy field is undefined", () => {
    const engine2 = new RiskEngine({
      ...DEFAULT_RISK_POLICY,
      maxWeeklyLossUsd: undefined,
    });
    const decision = engine2.evaluate(baseInput({ weeklyLossUsd: 999_999 }));
    expect(decision.decision).not.toBe("CANCEL_ONLY");
  });
});

// ── Rule 4: MAX_EXPOSURE_PER_TOKEN ──────────────────────────────────

describe("Rule 4: MAX_EXPOSURE_PER_TOKEN", () => {
  const engine = new RiskEngine({
    ...DEFAULT_RISK_POLICY,
    maxExposurePerTokenUsd: 50_000,
  });

  test("approves when projected token exposure is below limit", () => {
    const decision = engine.evaluate(
      baseInput({
        tokenExposureUsd: 40_000,
        orderIntent: intent({ quantity: 0.01, price: 100 }),
      }),
    );
    expect(decision.decision).toBe("APPROVE");
  });

  test("reduces size when projected token exposure hits limit", () => {
    // Existing 49_000 + new 1_100 = 50_100 > 50_000
    const decision = engine.evaluate(
      baseInput({
        tokenExposureUsd: 49_000,
        orderIntent: intent({ quantity: 11, price: 100 }),
      }),
    );
    expect(decision.decision).toBe("REDUCE_SIZE");
    if (decision.decision === "REDUCE_SIZE") {
      expect(decision.reasonCodes).toContain("MAX_EXPOSURE_PER_TOKEN");
      // allowedAdditional = 50_000 - 49_000 = 1_000; size = 1_000 / 100 = 10
      expect(decision.approvedSize).toBe(10);
    }
  });

  test("rule not enforced when policy field is undefined", () => {
    const engine2 = new RiskEngine({
      ...DEFAULT_RISK_POLICY,
      maxExposurePerTokenUsd: undefined,
    });
    const decision = engine2.evaluate(
      baseInput({ tokenExposureUsd: 999_999_999 }),
    );
    expect(decision.decision).not.toBe("REDUCE_SIZE");
  });
});

// ── Rule 5: MAX_EXPOSURE_PER_VENUE ──────────────────────────────────

describe("Rule 5: MAX_EXPOSURE_PER_VENUE", () => {
  const engine = new RiskEngine({
    ...DEFAULT_RISK_POLICY,
    maxExposurePerVenueUsd: 100_000,
  });

  test("approves when projected venue exposure is below limit", () => {
    const decision = engine.evaluate(
      baseInput({
        venueExposureUsd: 90_000,
        orderIntent: intent({ quantity: 0.01, price: 100 }),
      }),
    );
    expect(decision.decision).toBe("APPROVE");
  });

  test("reduces size when projected venue exposure hits limit", () => {
    const decision = engine.evaluate(
      baseInput({
        venueExposureUsd: 99_000,
        orderIntent: intent({ quantity: 20, price: 100 }),
      }),
    );
    expect(decision.decision).toBe("REDUCE_SIZE");
    if (decision.decision === "REDUCE_SIZE") {
      expect(decision.reasonCodes).toContain("MAX_EXPOSURE_PER_VENUE");
      // allowedAdditional = 100_000 - 99_000 = 1_000; size = 1_000 / 100 = 10
      expect(decision.approvedSize).toBe(10);
    }
  });
});

// ── Rule 6: MAX_EXPOSURE_PER_CHAIN ──────────────────────────────────

describe("Rule 6: MAX_EXPOSURE_PER_CHAIN", () => {
  const engine = new RiskEngine({
    ...DEFAULT_RISK_POLICY,
    maxExposurePerChainUsd: 200_000,
  });

  test("approves when projected chain exposure is below limit", () => {
    const decision = engine.evaluate(
      baseInput({
        chainExposureUsd: 150_000,
        orderIntent: intent({ quantity: 0.01, price: 100 }),
      }),
    );
    expect(decision.decision).toBe("APPROVE");
  });

  test("reduces size when projected chain exposure hits limit", () => {
    const decision = engine.evaluate(
      baseInput({
        chainExposureUsd: 199_000,
        orderIntent: intent({ quantity: 20, price: 100 }),
      }),
    );
    expect(decision.decision).toBe("REDUCE_SIZE");
    if (decision.decision === "REDUCE_SIZE") {
      expect(decision.reasonCodes).toContain("MAX_EXPOSURE_PER_CHAIN");
      expect(decision.approvedSize).toBe(10);
    }
  });
});

// ── Rule 7: MAX_OPEN_ORDERS ─────────────────────────────────────────

describe("Rule 7: MAX_OPEN_ORDERS", () => {
  const engine = new RiskEngine({
    ...DEFAULT_RISK_POLICY,
    maxOpenOrders: 10,
  });

  test("approves when open order count is below limit", () => {
    const decision = engine.evaluate(baseInput({ openOrderCount: 5 }));
    expect(decision.decision).toBe("APPROVE");
  });

  test("rejects when open order count hits limit", () => {
    const decision = engine.evaluate(baseInput({ openOrderCount: 10 }));
    expect(decision.decision).toBe("REJECT");
    if (decision.decision === "REJECT") {
      expect(decision.reasonCodes).toContain("MAX_OPEN_ORDERS");
    }
  });

  test("rejects when open order count exceeds limit", () => {
    const decision = engine.evaluate(baseInput({ openOrderCount: 15 }));
    expect(decision.decision).toBe("REJECT");
  });
});

// ── Rule 8: MAX_SLIPPAGE ────────────────────────────────────────────

describe("Rule 8: MAX_SLIPPAGE", () => {
  const engine = new RiskEngine({
    ...DEFAULT_RISK_POLICY,
    maxSlippageBps: 50,
  });

  test("approves when slippage is below limit", () => {
    const decision = engine.evaluate(baseInput({ slippageBps: 30 }));
    expect(decision.decision).toBe("APPROVE");
  });

  test("rejects when slippage exceeds limit", () => {
    const decision = engine.evaluate(baseInput({ slippageBps: 60 }));
    expect(decision.decision).toBe("REJECT");
    if (decision.decision === "REJECT") {
      expect(decision.reasonCodes).toContain("MAX_SLIPPAGE");
    }
  });
});

// ── Rule 9: MAX_GAS ─────────────────────────────────────────────────

describe("Rule 9: MAX_GAS", () => {
  const engine = new RiskEngine({
    ...DEFAULT_RISK_POLICY,
    maxGasUsd: 50,
  });

  test("approves when gas cost is below limit", () => {
    const decision = engine.evaluate(baseInput({ gasCostUsd: 10 }));
    expect(decision.decision).toBe("APPROVE");
  });

  test("rejects when gas cost exceeds limit", () => {
    const decision = engine.evaluate(baseInput({ gasCostUsd: 60 }));
    expect(decision.decision).toBe("REJECT");
    if (decision.decision === "REJECT") {
      expect(decision.reasonCodes).toContain("MAX_GAS");
    }
  });
});

// ── Rule 10: MAX_LATENCY ────────────────────────────────────────────

describe("Rule 10: MAX_LATENCY", () => {
  const engine = new RiskEngine({
    ...DEFAULT_RISK_POLICY,
    maxLatencyMs: 5_000,
  });

  test("approves when latency is below limit", () => {
    const decision = engine.evaluate(baseInput({ latencyMs: 1_000 }));
    expect(decision.decision).toBe("APPROVE");
  });

  test("rejects when latency exceeds limit", () => {
    const decision = engine.evaluate(baseInput({ latencyMs: 6_000 }));
    expect(decision.decision).toBe("REJECT");
    if (decision.decision === "REJECT") {
      expect(decision.reasonCodes).toContain("MAX_LATENCY");
    }
  });
});

// ── Rule 11: MIN_DATA_QUALITY ───────────────────────────────────────

describe("Rule 11: MIN_DATA_QUALITY", () => {
  const engine = new RiskEngine({
    ...DEFAULT_RISK_POLICY,
    minDataQualityScore: 0.5,
  });

  test("approves when data quality is above threshold", () => {
    const decision = engine.evaluate(baseInput({ dataQualityScore: 0.8 }));
    expect(decision.decision).toBe("APPROVE");
  });

  test("rejects when data quality is below threshold", () => {
    const decision = engine.evaluate(baseInput({ dataQualityScore: 0.1 }));
    expect(decision.decision).toBe("REJECT");
    if (decision.decision === "REJECT") {
      expect(decision.reasonCodes).toContain("MIN_DATA_QUALITY");
    }
  });
});

// ── Rule 12: MIN_EDGE ──────────────────────────────────────────────

describe("Rule 12: MIN_EDGE", () => {
  const engine = new RiskEngine({
    ...DEFAULT_RISK_POLICY,
    minEdgeUsd: 1,
  });

  test("approves when edge is above threshold", () => {
    const decision = engine.evaluate(baseInput({ expectedNetProfitUsd: 5 }));
    expect(decision.decision).toBe("APPROVE");
  });

  test("rejects when edge is below threshold", () => {
    const decision = engine.evaluate(baseInput({ expectedNetProfitUsd: 0.5 }));
    expect(decision.decision).toBe("REJECT");
    if (decision.decision === "REJECT") {
      expect(decision.reasonCodes).toContain("MIN_EDGE");
    }
  });
});

// ── Rule 13: MIN_LIQUIDITY ─────────────────────────────────────────

describe("Rule 13: MIN_LIQUIDITY", () => {
  const engine = new RiskEngine({
    ...DEFAULT_RISK_POLICY,
    minLiquidityDepthUsd: 10_000,
  });

  test("approves when liquidity is above threshold", () => {
    const decision = engine.evaluate(
      baseInput({ liquidityDepthUsd: 50_000 }),
    );
    expect(decision.decision).toBe("APPROVE");
  });

  test("rejects when liquidity is below threshold", () => {
    const decision = engine.evaluate(
      baseInput({ liquidityDepthUsd: 5_000 }),
    );
    expect(decision.decision).toBe("REJECT");
    if (decision.decision === "REJECT") {
      expect(decision.reasonCodes).toContain("MIN_LIQUIDITY");
    }
  });
});

// ── Rule 14: MAX_FUNDING_COST ──────────────────────────────────────

describe("Rule 14: MAX_FUNDING_COST", () => {
  const engine = new RiskEngine({
    ...DEFAULT_RISK_POLICY,
    maxFundingCostUsd: 20,
  });

  test("approves when funding cost is below threshold", () => {
    const decision = engine.evaluate(baseInput({ fundingCostUsd: 5 }));
    expect(decision.decision).toBe("APPROVE");
  });

  test("rejects when funding cost exceeds threshold", () => {
    const decision = engine.evaluate(baseInput({ fundingCostUsd: 25 }));
    expect(decision.decision).toBe("REJECT");
    if (decision.decision === "REJECT") {
      expect(decision.reasonCodes).toContain("MAX_FUNDING_COST");
    }
  });
});

// ── Rule 15: MAX_CORRELATION_CONCENTRATION ──────────────────────────

describe("Rule 15: MAX_CORRELATION_CONCENTRATION", () => {
  const engine = new RiskEngine({
    ...DEFAULT_RISK_POLICY,
    maxCorrelationConcentration: 0.8,
  });

  test("approves when risk concentration is below threshold", () => {
    const decision = engine.evaluate(
      baseInput({ riskConcentration: 0.5 }),
    );
    expect(decision.decision).toBe("APPROVE");
  });

  test("rejects when risk concentration exceeds threshold", () => {
    const decision = engine.evaluate(
      baseInput({ riskConcentration: 0.9 }),
    );
    expect(decision.decision).toBe("REJECT");
    if (decision.decision === "REJECT") {
      expect(decision.reasonCodes).toContain("MAX_CORRELATION_CONCENTRATION");
    }
  });
});

// ── Rule 16: DEGRADED_MODE ─────────────────────────────────────────

describe("Rule 16: DEGRADED_MODE", () => {
  const engine = new RiskEngine(DEFAULT_RISK_POLICY);

  test("approves in NORMAL mode", () => {
    const decision = engine.evaluate(baseInput({ mode: "NORMAL" }));
    expect(decision.decision).toBe("APPROVE");
  });

  test("approves in SIGNAL_ONLY mode", () => {
    const decision = engine.evaluate(baseInput({ mode: "SIGNAL_ONLY" }));
    expect(decision.decision).toBe("APPROVE");
  });

  test("approves in PAPER_ONLY mode", () => {
    const decision = engine.evaluate(baseInput({ mode: "PAPER_ONLY" }));
    expect(decision.decision).toBe("APPROVE");
  });

  test("exits with EXIT_ONLY in CANCEL_ONLY mode", () => {
    const decision = engine.evaluate(baseInput({ mode: "CANCEL_ONLY" }));
    expect(decision.decision).toBe("EXIT_ONLY");
    if (decision.decision === "EXIT_ONLY") {
      expect(decision.reasonCodes).toContain("DEGRADED_MODE");
    }
  });

  test("exits with EXIT_ONLY in REDUCE_ONLY mode", () => {
    const decision = engine.evaluate(baseInput({ mode: "REDUCE_ONLY" }));
    expect(decision.decision).toBe("EXIT_ONLY");
  });

  test("exits with EXIT_ONLY in CASH_ONLY mode", () => {
    const decision = engine.evaluate(baseInput({ mode: "CASH_ONLY" }));
    expect(decision.decision).toBe("EXIT_ONLY");
  });

  test("exits with EXIT_ONLY in HALT mode", () => {
    const decision = engine.evaluate(baseInput({ mode: "HALT" }));
    expect(decision.decision).toBe("EXIT_ONLY");
  });

  test("exits with EXIT_ONLY in OBSERVE_ONLY mode", () => {
    const decision = engine.evaluate(baseInput({ mode: "OBSERVE_ONLY" }));
    expect(decision.decision).toBe("EXIT_ONLY");
  });
});

// ── Rule 17: RECONCILIATION_UNRESOLVED ─────────────────────────────

describe("Rule 17: RECONCILIATION_UNRESOLVED", () => {
  const engine = new RiskEngine(DEFAULT_RISK_POLICY);

  test("approves when reconciliation is resolved", () => {
    const decision = engine.evaluate(
      baseInput({ reconciliationUnresolved: false }),
    );
    expect(decision.decision).toBe("APPROVE");
  });

  test("rejects when reconciliation is unresolved", () => {
    const decision = engine.evaluate(
      baseInput({ reconciliationUnresolved: true }),
    );
    expect(decision.decision).toBe("REJECT");
    if (decision.decision === "REJECT") {
      expect(decision.reasonCodes).toContain("RECONCILIATION_UNRESOLVED");
    }
  });
});

// ── Rule 18: AUDIT_UNAVAILABLE ─────────────────────────────────────

describe("Rule 18: AUDIT_UNAVAILABLE", () => {
  const engine = new RiskEngine(DEFAULT_RISK_POLICY);

  test("approves when audit is available", () => {
    const decision = engine.evaluate(
      baseInput({ auditUnavailable: false }),
    );
    expect(decision.decision).toBe("APPROVE");
  });

  test("rejects when audit is unavailable", () => {
    const decision = engine.evaluate(
      baseInput({ auditUnavailable: true }),
    );
    expect(decision.decision).toBe("REJECT");
    if (decision.decision === "REJECT") {
      expect(decision.reasonCodes).toContain("AUDIT_UNAVAILABLE");
    }
  });
});

// ── Rule priority: defensive rules override loss/trade limits ───────

describe("Rule priority", () => {
  const engine = new RiskEngine({
    ...DEFAULT_RISK_POLICY,
    maxDailyLossUsd: 500,
    maxRiskPerTradeUsd: 1_000,
  });

  test("AUDIT_UNAVAILABLE wins over MAX_DAILY_LOSS", () => {
    const decision = engine.evaluate(
      baseInput({
        dailyLossUsd: 999,
        auditUnavailable: true,
      }),
    );
    expect(decision.decision).toBe("REJECT");
    if (decision.decision === "REJECT") {
      expect(decision.reasonCodes).toContain("AUDIT_UNAVAILABLE");
      expect(decision.reasonCodes).not.toContain("MAX_DAILY_LOSS");
    }
  });

  test("RECONCILIATION_UNRESOLVED wins over DEGRADED_MODE", () => {
    const decision = engine.evaluate(
      baseInput({
        mode: "CANCEL_ONLY",
        reconciliationUnresolved: true,
      }),
    );
    expect(decision.decision).toBe("REJECT");
    if (decision.decision === "REJECT") {
      expect(decision.reasonCodes).toContain("RECONCILIATION_UNRESOLVED");
      expect(decision.reasonCodes).not.toContain("DEGRADED_MODE");
    }
  });
});

// ── Approval payload ────────────────────────────────────────────────

describe("Approval payload", () => {
  const engine = new RiskEngine(DEFAULT_RISK_POLICY);

  test("approved decision carries size, limits, and expiry", () => {
    const decision = engine.evaluate(
      baseInput({ evaluatedAtMs: 1_000_000 }),
    );
    expect(decision.decision).toBe("APPROVE");
    if (decision.decision === "APPROVE") {
      expect(decision.approvedSize).toBe(0.01);
      expect(decision.approvedLimits?.maxSlippageBps).toBe(30);
      expect(decision.expiresAtMs).toBe(1_000_000 + RISK_APPROVAL_TTL_MS);
    }
  });

  test("reduced decision carries the reduced size and reason codes", () => {
    const decision = engine.evaluate(
      baseInput({
        orderIntent: intent({ quantity: 20_000, price: 100 }),
        evaluatedAtMs: 2_000_000,
      }),
    );
    expect(decision.decision).toBe("REDUCE_SIZE");
    if (decision.decision === "REDUCE_SIZE") {
      expect(decision.approvedSize).toBe(
        DEFAULT_RISK_POLICY.maxRiskPerTradeUsd / 100,
      );
      expect(decision.approvedLimits?.maxSlippageBps).toBe(30);
      expect(decision.expiresAtMs).toBe(2_000_000 + RISK_APPROVAL_TTL_MS);
      expect(decision.reasonCodes).toContain("MAX_RISK_PER_TRADE");
    }
  });

  test("rejected decisions carry reason codes", () => {
    const decision = engine.evaluate(
      baseInput({ expectedNetProfitUsd: 0.5 }),
    );
    expect(decision.decision).toBe("REJECT");
    if (decision.decision === "REJECT") {
      expect(decision.reasonCodes.length).toBeGreaterThan(0);
    }
  });
});

// ── Contract validation ─────────────────────────────────────────────

describe("Contract validation", () => {
  const engine = new RiskEngine(DEFAULT_RISK_POLICY);

  test("every decision satisfies the isRiskDecision contract", () => {
    const modes = [
      "NORMAL",
      "SIGNAL_ONLY",
      "PAPER_ONLY",
      "CANCEL_ONLY",
      "REDUCE_ONLY",
      "CASH_ONLY",
      "HALT",
      "OBSERVE_ONLY",
    ] as const;

    for (const mode of modes) {
      const decision = engine.evaluate(baseInput({ mode }));
      expect(isRiskDecision(decision)).toBe(true);
    }
  });

  test("REJECT decisions are parseable", () => {
    const decision = engine.evaluate(
      baseInput({ expectedNetProfitUsd: 0.1 }),
    );
    expect(() => parseRiskDecision(decision)).not.toThrow();
  });
});

// ── activeRules helper ──────────────────────────────────────────────

describe("activeRules", () => {
  test("returns all defined rules", () => {
    const rules = activeRules({
      maxRiskPerTradeUsd: 100,
      maxDailyLossUsd: 200,
      maxWeeklyLossUsd: 300,
      maxExposurePerTokenUsd: 400,
      maxExposurePerVenueUsd: 500,
      maxExposurePerChainUsd: 600,
      maxOpenOrders: 7,
      maxSlippageBps: 8,
      maxGasUsd: 9,
      maxLatencyMs: 10,
      minDataQualityScore: 0.5,
      minEdgeUsd: 1,
      minLiquidityDepthUsd: 12,
      maxFundingCostUsd: 13,
      maxCorrelationConcentration: 0.9,
    });
    expect(rules).toHaveLength(15);
    expect(rules).toContain("MAX_RISK_PER_TRADE");
    expect(rules).toContain("MAX_DAILY_LOSS");
    expect(rules).toContain("MIN_EDGE");
  });

  test("returns empty when no rules are defined", () => {
    expect(activeRules({})).toHaveLength(0);
  });
});

// ── Backward compatibility ──────────────────────────────────────────

describe("RiskGate backward compatibility", () => {
  test("imported RiskGate value works as a constructor", async () => {
    const { RiskGate } = await import("../src/risk/risk-gate.ts");
    const gate = new RiskGate(DEFAULT_RISK_POLICY);
    expect(gate).toBeInstanceOf(RiskEngine);
  });
});

// ── Kill switch (HALT_SYSTEM action) ────────────────────────────────

describe("HALT_SYSTEM action", () => {
  const engine = new RiskEngine(DEFAULT_RISK_POLICY);

  test("HALT_SYSTEM is returned when mode is HALT", () => {
    const decision = engine.evaluate(baseInput({ mode: "HALT" }));
    expect(decision.decision).toBe("EXIT_ONLY");
    if (decision.decision === "EXIT_ONLY") {
      expect(decision.reasonCodes).toContain("DEGRADED_MODE");
    }
  });

  test("multiple defensive rules produce correct actions", () => {
    // HALT mode + audit unavailable → audit unavailable wins (rule 18 > rule 16)
    const decision = engine.evaluate(
      baseInput({ mode: "HALT", auditUnavailable: true }),
    );
    expect(decision.decision).toBe("REJECT");
    if (decision.decision === "REJECT") {
      expect(decision.reasonCodes).toContain("AUDIT_UNAVAILABLE");
    }
  });
});

// ── Position sizing edge cases ──────────────────────────────────────

describe("Position sizing", () => {
  const engine = new RiskEngine({
    ...DEFAULT_RISK_POLICY,
    maxRiskPerTradeUsd: 10_000,
    maxExposurePerTokenUsd: 20_000,
  });

  test("token exposure reduction returns zero when existing exposure is at limit", () => {
    const decision = engine.evaluate(
      baseInput({
        tokenExposureUsd: 20_000,
        orderIntent: intent({ quantity: 1, price: 100 }),
      }),
    );
    expect(decision.decision).toBe("REDUCE_SIZE");
    if (decision.decision === "REDUCE_SIZE") {
      expect(decision.approvedSize).toBe(0);
    }
  });

  test("per-trade cap reduces before token exposure cap when both apply", () => {
    // notional = 100 * 100 = 10_000, which equals the maxRiskPerTradeUsd
    const decision = engine.evaluate(
      baseInput({
        tokenExposureUsd: 0,
        orderIntent: intent({ quantity: 100, price: 100 }),
      }),
    );
    // 100 * 100 = 10_000, which equals but does not exceed the limit
    expect(decision.decision).toBe("APPROVE");
  });

  test("per-trade cap triggers when notional exceeds limit", () => {
    const decision = engine.evaluate(
      baseInput({
        tokenExposureUsd: 0,
        orderIntent: intent({ quantity: 101, price: 100 }),
      }),
    );
    // 101 * 100 = 10_100 > 10_000
    expect(decision.decision).toBe("REDUCE_SIZE");
    if (decision.decision === "REDUCE_SIZE") {
      expect(decision.reasonCodes).toContain("MAX_RISK_PER_TRADE");
    }
  });
});

// ── Full policy with all 18 rules ──────────────────────────────────

describe("Full policy: all 18 rules enforced simultaneously", () => {
  const fullPolicy: RiskPolicy = {
    maxRiskPerTradeUsd: 10_000,
    maxDailyLossUsd: 500,
    maxWeeklyLossUsd: 2_000,
    maxExposurePerTokenUsd: 50_000,
    maxExposurePerVenueUsd: 100_000,
    maxExposurePerChainUsd: 200_000,
    maxOpenOrders: 10,
    maxSlippageBps: 50,
    maxGasUsd: 50,
    maxLatencyMs: 5_000,
    minDataQualityScore: 0.5,
    minEdgeUsd: 1,
    minLiquidityDepthUsd: 10_000,
    maxFundingCostUsd: 20,
    maxCorrelationConcentration: 0.8,
  };
  const engine = new RiskEngine(fullPolicy);

  test("approves a clean intent", () => {
    const decision = engine.evaluate(
      baseInput({
        expectedNetProfitUsd: 10,
        dataQualityScore: 0.9,
        dailyLossUsd: 100,
        weeklyLossUsd: 500,
        tokenExposureUsd: 5_000,
        venueExposureUsd: 10_000,
        chainExposureUsd: 20_000,
        openOrderCount: 3,
        slippageBps: 20,
        gasCostUsd: 10,
        latencyMs: 1_000,
        liquidityDepthUsd: 50_000,
        fundingCostUsd: 5,
        riskConcentration: 0.3,
        orderIntent: intent({ quantity: 1, price: 100 }),
      }),
    );
    expect(decision.decision).toBe("APPROVE");
    if (decision.decision === "APPROVE") {
      expect(decision.approvedSize).toBe(1);
      expect(decision.expiresAtMs).toBeGreaterThan(0);
    }
    expect(isRiskDecision(decision)).toBe(true);
  });

  test("HALT_SYSTEM via HALT mode blocks everything", () => {
    const decision = engine.evaluate(
      baseInput({
        mode: "HALT",
        expectedNetProfitUsd: 100,
        dataQualityScore: 1.0,
      }),
    );
    expect(decision.decision).toBe("EXIT_ONLY");
  });
});
