import { describe, expect, test } from "bun:test";
import {
  LOOP_NAMES,
  isAuditEvent,
  type AgentInput,
  type AgentRunResult,
  type ConsultativeAgentOutput,
} from "@agenttrading/contracts";
import {
  BetaPaperTradingSession,
  type BetaAgentRecommendationRunner,
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

function recommendationFor(input: AgentInput): ConsultativeAgentOutput {
  const base = {
    confidence: 0.91,
    summary: `runtime recommendation for ${input.agentId}`,
    assumptions: ["paper-only", "typed runtime output"],
    invalidationReasons: [],
  };
  switch (input.agentId) {
    case "agent-planner-supervisor":
      return {
        ...base,
        agentId: "agent-planner-supervisor",
        plannedSteps: ["loop", "risk", "execute", "reconcile"],
        recommendedMode: "PAPER_ONLY",
      };
    case "agent-arbitrage-alpha":
      return {
        ...base,
        agentId: "agent-arbitrage-alpha",
        candidateSignal: String(input.payload.candidateId),
        expectedNetProfitUsd: 12,
        invalidationReasons: ["MIN_EDGE"],
        costBreakdownUsd: {
          feesUsd: 0,
          slippageUsd: 0,
          gasUsd: 0,
          bridgeCostUsd: 0,
          fundingCostUsd: 0,
          latencyRiskUsd: 0,
          failureRiskUsd: 0,
          safetyBufferUsd: 0,
        },
      };
    case "agent-risk-analyst":
      return {
        ...base,
        agentId: "agent-risk-analyst",
        riskNarrative: "typed runtime risk recommendation",
        controls: ["risk gate", "inventory", "reconciliation"],
        residualRisks: ["fixture realism"],
      };
    case "agent-execution-advisor":
      return {
        ...base,
        agentId: "agent-execution-advisor",
        executionPlanCandidates: [
          {
            venue: "bybit-paper",
            orderType: "limit",
            expectedNetProfitUsd: 12,
            assumptions: ["paper venue"],
          },
        ],
        recommendedMode: "PAPER_ONLY",
      };
    default:
      throw new Error(`unexpected agent ${input.agentId}`);
  }
}

function agentRunResult(input: AgentInput): AgentRunResult {
  return {
    output: {
      kind: "structured",
      agentId: input.agentId,
      payload: recommendationFor(input) as unknown as Record<string, unknown>,
      schemaName: "ConsultativeAgentOutput",
      timestampMs: input.timestampMs,
    },
    status: "completed",
    tokensConsumed: 0,
    costUsd: 0,
    durationMs: 0,
    retriesAttempted: 0,
    fallbackUsed: false,
  };
}

describe("BetaPaperTradingSession (issue #33)", () => {
  test("runs the complete Beta paper loop and emits a reconstructable post-trade report", async () => {
    const session = new BetaPaperTradingSession({ now: () => FIXED_TS });

    session.startPaperTrading();
    const result = await session.runPaperCycle(approvedScenario());
    const report = session.reports[0];

    expect(result.approved).toBe(true);
    expect(result.finalMode).toBe("PAPER_ONLY");
    expect(result.path).toContain("REQUEST_AGENT_REVIEW");
    expect(result.path).toContain("RISK_VALIDATE");
    expect(result.path).toContain("EXECUTE_ORDER");
    expect(result.path).toContain("RECONCILE");
    expect(result.loopCycle.completed).toBe(true);
    expect(result.loopCycle.loopOutputs.map((output) => output.loopName)).toEqual(
      [...LOOP_NAMES],
    );

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
    expect(
      result.auditEvents.some((event) =>
        event.reasonCodes?.includes("ORCHESTRATED"),
      ),
    ).toBe(true);
  });

  test("routes consultative recommendations through the injected agent runner", async () => {
    const calls: AgentInput[] = [];
    const agentRunner: BetaAgentRecommendationRunner = {
      async run(input) {
        calls.push(input);
        return agentRunResult(input);
      },
    };
    const session = new BetaPaperTradingSession({
      now: () => FIXED_TS,
      agentRunner,
    });

    session.startPaperTrading();
    const result = await session.runPaperCycle(approvedScenario());

    expect(calls.map((call) => call.agentId)).toEqual([
      "agent-planner-supervisor",
      "agent-arbitrage-alpha",
      "agent-risk-analyst",
      "agent-execution-advisor",
    ]);
    expect(result.report.agentRecommendations.map((rec) => rec.summary)).toEqual(
      calls.map((call) => `runtime recommendation for ${call.agentId}`),
    );
  });

  test("fails closed when risk rejects before paper execution", async () => {
    const session = new BetaPaperTradingSession({ now: () => FIXED_TS });

    session.startPaperTrading();
    const result = await session.runPaperCycle(
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

  test("blocks execution when paper inventory cannot fund the order", async () => {
    const session = new BetaPaperTradingSession({ now: () => FIXED_TS });

    session.startPaperTrading();
    const result = await session.runPaperCycle(
      approvedScenario({
        id: "beta-insufficient-inventory",
        paperInventory: {
          balances: [
            {
              venueType: "CEX",
              venue: "bybit-paper",
              chain: "",
              asset: "USDT",
              available: 1,
              locked: 0,
              exposed: 0,
              lastSyncAtMs: FIXED_TS,
            },
          ],
          prices: { USDT: 1 },
          strategyAllocations: [
            {
              strategyId: "beta-paper",
              maxAllocationUsd: 1,
              deployedUsd: 0,
            },
          ],
        },
      }),
    );

    expect(result.approved).toBe(false);
    expect(result.path).not.toContain("EXECUTE_ORDER");
    expect(result.report.execution).toBeUndefined();
    expect(result.report.inventory?.validation.blocked).toBe(true);
    expect(result.report.inventory?.validation.reasons.length).toBeGreaterThan(0);
  });

  test("reconciliation mismatch drives the session into the defensive mode chosen by policy", async () => {
    const session = new BetaPaperTradingSession({ now: () => FIXED_TS });

    session.startPaperTrading();
    const result = await session.runPaperCycle(
      approvedScenario({
        id: "beta-reconciliation-mismatch",
        reconciliation: { omitExternalFill: true },
      }),
    );

    expect(result.approved).toBe(false);
    expect(result.finalMode).toBe("CANCEL_ONLY");
    expect(result.path).toContain("RECONCILE");
    expect(result.path).toContain("CANCEL_ONLY_MODE");
    expect(result.report.reconciliation?.unresolved).toBe(true);
    expect(session.status.running).toBe(false);
  });

  test("control commands enforce sticky defensive modes and kill switch blocks new paper cycles", async () => {
    const session = new BetaPaperTradingSession({ now: () => FIXED_TS });

    expect(session.status.running).toBe(false);
    expect(session.control("start").mode).toBe("PAPER_ONLY");
    expect(session.status.running).toBe(true);

    expect(session.control("cash-only").mode).toBe("CASH_ONLY");
    await expect(session.runPaperCycle(approvedScenario())).rejects.toThrow(
      /not in PAPER_ONLY mode/,
    );

    expect(() => session.control("start")).toThrow(/defensive mode CASH_ONLY/);

    const halted = new BetaPaperTradingSession({ now: () => FIXED_TS });
    expect(halted.control("start").mode).toBe("PAPER_ONLY");
    expect(halted.control("cancel-all").mode).toBe("CANCEL_ONLY");
    expect(halted.status.openPaperOrders).toBe(0);
    expect(() => halted.control("start")).toThrow(
      /defensive mode CANCEL_ONLY/,
    );

    const killSwitch = new BetaPaperTradingSession({ now: () => FIXED_TS });
    expect(killSwitch.control("start").mode).toBe("PAPER_ONLY");
    expect(killSwitch.control("halt").mode).toBe("HALT");
    expect(killSwitch.status.killSwitchActive).toBe(true);
    expect(() => killSwitch.control("start")).toThrow(/kill switch/i);
    expect(() => killSwitch.control("cash-only")).toThrow(
      /failed to enter CASH_ONLY_MODE/,
    );
    expect(killSwitch.status.mode).toBe("HALT");
    await expect(killSwitch.runPaperCycle(approvedScenario())).rejects.toThrow(
      /kill switch/i,
    );
  });
});
