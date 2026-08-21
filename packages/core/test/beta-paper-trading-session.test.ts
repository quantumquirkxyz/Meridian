import { describe, expect, test } from "bun:test";
import { isAuditEvent } from "@agenttrading/contracts";
import {
  BetaPaperTradingSession,
  type BetaPaperTradingScenario,
} from "../src/beta/paper-trading-session.ts";

const FIXED_TS = 1_700_000_000_000;

function approvedScenario(
  overrides: Partial<BetaPaperTradingScenario> = {},
): BetaPaperTradingScenario {
  return {
    id: "beta-approved-1",
    expectedNetProfitUsd: 12,
    dataQualityScore: 0.95,
    venue: "bybit-paper",
    symbol: "BTC/USDT",
    quantity: 50,
    price: 40_000,
    ...overrides,
  };
}

describe("BetaPaperTradingSession (issue #33)", () => {
  test("runs the complete Beta paper loop and emits a reconstructable post-trade report", () => {
    const session = new BetaPaperTradingSession({ now: () => FIXED_TS });

    session.startPaperTrading();
    const result = session.runPaperCycle(approvedScenario());
    const report = session.reports[0];

    expect(result.approved).toBe(true);
    expect(result.finalMode).toBe("PAPER_ONLY");
    expect(result.path).toContain("REQUEST_AGENT_REVIEW");
    expect(result.path).toContain("RISK_VALIDATE");
    expect(result.path).toContain("EXECUTE_ORDER");
    expect(result.path).toContain("RECONCILE");

    expect(report).toBeDefined();
    expect(report.paperOnly).toBe(true);
    expect(report.scenarioId).toBe("beta-approved-1");
    expect(report.orderIntent?.idempotencyKey).toBe("intent-beta-approved-1");
    expect(report.riskDecision?.decision).toBe("REDUCE_SIZE");
    expect(report.agentRecommendations.length).toBeGreaterThanOrEqual(4);
    expect(report.agentRecommendations.map((rec) => rec.agentId)).toContain(
      "agent-risk-analyst",
    );
    expect(report.execution?.state).toBe("FILLED");
    expect(report.inventory?.validation.blocked).toBe(false);
    expect(report.inventory?.snapshot.capitalStates).toContainEqual(
      expect.objectContaining({ asset: "USDT" }),
    );
    expect(report.reconstruction.auditEventIds.length).toBe(
      result.auditEvents.length,
    );
    expect(report.reconstruction.riskReasonCodes).toContain(
      "MAX_RISK_PER_TRADE",
    );
    expect(result.auditEvents.every(isAuditEvent)).toBe(true);
  });

  test("fails closed when risk rejects before paper execution", () => {
    const session = new BetaPaperTradingSession({ now: () => FIXED_TS });

    session.startPaperTrading();
    const result = session.runPaperCycle(
      approvedScenario({
        id: "beta-reject-1",
        expectedNetProfitUsd: 0.1,
      }),
    );
    const report = session.reports[0];

    expect(result.approved).toBe(false);
    expect(result.path).not.toContain("EXECUTE_ORDER");
    expect(report.execution).toBeUndefined();
    expect(report.riskDecision?.decision).toBe("REJECT");
    expect(report.reconstruction.riskReasonCodes).toContain("MIN_EDGE");
  });

  test("control commands enforce defensive modes and kill switch blocks new paper cycles", () => {
    const session = new BetaPaperTradingSession({ now: () => FIXED_TS });

    expect(session.status.running).toBe(false);
    expect(session.control("start").mode).toBe("PAPER_ONLY");
    expect(session.status.running).toBe(true);

    expect(session.control("cash-only").mode).toBe("CASH_ONLY");
    expect(() => session.runPaperCycle(approvedScenario())).toThrow(
      /not in PAPER_ONLY mode/,
    );

    expect(session.control("start").mode).toBe("PAPER_ONLY");
    expect(session.control("cancel-all").mode).toBe("CANCEL_ONLY");
    expect(session.status.openPaperOrders).toBe(0);

    expect(session.control("start").mode).toBe("PAPER_ONLY");
    expect(session.control("halt").mode).toBe("HALT");
    expect(session.status.killSwitchActive).toBe(true);
    expect(() => session.control("start")).toThrow(/kill switch/i);
    expect(() => session.runPaperCycle(approvedScenario())).toThrow(
      /kill switch/i,
    );
  });
});
