import { describe, expect, test } from "bun:test";
import { isAuditEvent } from "@agenttrading/contracts";
import { AuditLog } from "../src/stategraph/audit-log.ts";
import { StateGraph } from "../src/stategraph/state-graph.ts";
import {
  buildDefaultGraph,
  defaultPermissionRegistry,
} from "../src/stategraph/topology.ts";
import { DEFAULT_RISK_POLICY, RiskEngine } from "../src/risk/risk-gate.ts";
import {
  runSimulatedOpportunityFlow,
  type SimulatedFlowResult,
} from "../src/flow/simulated-flow.ts";

const FIXED_TS = 1_700_000_000_000;

function flowHarness(): {
  graph: StateGraph;
  audit: AuditLog;
  gate: RiskEngine;
  run: (
    id: string,
    expectedNetProfitUsd: number,
    overrides?: Partial<import("../src/flow/simulated-flow.ts").SimulatedFlowScenario>,
  ) => SimulatedFlowResult;
} {
  const { nodes, transitions } = buildDefaultGraph();
  const audit = new AuditLog();
  const graph = new StateGraph({
    nodes,
    transitions,
    permissions: defaultPermissionRegistry(),
    audit,
    now: () => FIXED_TS,
  });
  const gate = new RiskEngine(DEFAULT_RISK_POLICY);
  return {
    graph,
    audit,
    gate,
    run: (id, expectedNetProfitUsd, overrides = {}) =>
      runSimulatedOpportunityFlow({
        graph,
        riskGate: gate,
        scenario: { id, expectedNetProfitUsd, ...overrides },
        timestampMs: FIXED_TS,
      }),
  };
}

describe("simulated opportunity flow (issue #13 AC4, Phase Zero exit criterion)", () => {
  test("approve: the full cycle runs to IDLE with verifiable logs and no LLM", () => {
    const { audit, run } = flowHarness();
    const result = run("approve-1", 5);

    expect(result.approved).toBe(true);
    expect(result.finalState).toBe("IDLE");
    expect(result.finalMode).toBe("NORMAL");
    expect(result.riskDecision?.decision).toBe("APPROVE");
    expect(result.path).toContain("EXECUTE_ORDER");
    expect(result.path).toContain("RECONCILE");
    expect(result.path).toContain("AUDIT_DECISION");

    // Every transition emitted an audited event with reason codes.
    const transitionEvents = audit.transitions();
    expect(transitionEvents.length).toBe(result.path.length - 1);
    for (const event of transitionEvents) {
      expect(event.reasonCodes?.length ?? 0).toBeGreaterThan(0);
    }

    // Machine-readable reason codes for the whole flow are present.
    const reasons = audit.all().flatMap((event) => event.reasonCodes ?? []);
    expect(reasons).toContain("RISK_APPROVED");
    expect(reasons).toContain("EXECUTION_SIMULATED");
    expect(reasons).toContain("RECONCILIATION_OK");
    expect(reasons).toContain("CYCLE_COMPLETE");

    // Verifiable logs: one line per event, valid AuditEvents throughout.
    expect(result.logs.length).toBe(audit.count());
    expect(result.logs[0]).toContain("STATE_TRANSITION");
    expect(audit.all().every(isAuditEvent)).toBe(true);
    expect(result.logs.join("\n")).not.toMatch(/llm/i);
  });

  test("reject: an under-edge opportunity is rejected at the risk gate", () => {
    const { audit, run } = flowHarness();
    const result = run("reject-1", 0.5);

    expect(result.approved).toBe(false);
    expect(result.riskDecision?.decision).toBe("REJECT");
    expect(result.finalState).toBe("IDLE");
    expect(result.path).not.toContain("EXECUTE_ORDER");
    expect(result.opportunity?.status).toBe("REJECTED");
    expect(result.opportunity?.invalidationReasons).toContain("MIN_EDGE");

    const reasons = audit.all().flatMap((event) => event.reasonCodes ?? []);
    expect(reasons).toContain("RISK_REJECTED");
    expect(reasons).not.toContain("EXECUTION_SIMULATED");
    expect(audit.all().every(isAuditEvent)).toBe(true);

    // US29: the decision event records the reject reasons, so the trail
    // reconstructs why the opportunity was rejected.
    const decisionEvent = audit
      .all()
      .find((e) => e.action === "RISK_DECISION");
    const decisionData = decisionEvent?.data as Record<string, unknown> | undefined;
    expect(decisionData?.decision).toBe("REJECT");
    expect(decisionData?.reasonCodes).toContain("MIN_EDGE");
  });

  test("discard: a non-profitable candidate is invalidated before any intent", () => {
    const { audit, run } = flowHarness();
    const result = run("discard-1", -3);

    expect(result.approved).toBe(false);
    expect(result.opportunity?.status).toBe("INVALID");
    expect(result.opportunity?.invalidationReasons).toContain("MIN_EDGE");
    expect(result.orderIntent).toBeUndefined();
    expect(result.path).not.toContain("BUILD_ORDER_INTENT");
    expect(result.path).not.toContain("EXECUTE_ORDER");

    // US29: the candidate's own audit event reconstructs the discard.
    const detected = audit
      .all()
      .find((e) => e.action === "OPPORTUNITY_DETECTED");
    const detectedData = detected?.data as Record<string, unknown> | undefined;
    expect(detectedData?.status).toBe("INVALID");
    expect(detectedData?.invalidationReasons).toContain("MIN_EDGE");
  });

  test("deterministic: identical scenario yields identical path and logs", () => {
    const a = flowHarness().run("det-1", 5);
    const b = flowHarness().run("det-1", 5);
    expect(a.path).toEqual(b.path);
    expect(a.logs).toEqual(b.logs);
  });

  test("no LLM: the flow is a pure deterministic walk of the graph", () => {
    const { run } = flowHarness();
    const result = run("no-llm-1", 5);
    // All actors are fixed module ids from the registry; none is an LLM.
    // Log lines are `#seq ts actor action ...` so the actor is index 2.
    const actors = result.logs
      .map((line) => line.split(" ")[2])
      .filter((actor) => actor !== undefined);
    expect(actors.every((actor) => actor !== undefined && !/ai|llm/i.test(actor))).toBe(true);
  });

  test("reduce: an oversized order is reduced in size and still completes", () => {
    const { run } = flowHarness();
    const result = run("reduce-1", 5, { quantity: 20_000, price: 100 });

    expect(result.riskDecision?.decision).toBe("REDUCE_SIZE");
    expect(result.approved).toBe(true);
    expect(result.finalState).toBe("IDLE");
    expect(result.finalMode).toBe("NORMAL");
    expect(result.path).toContain("EXECUTION_PRECHECK");
    expect(result.path).toContain("EXECUTE_ORDER");
    if (result.riskDecision?.decision === "REDUCE_SIZE") {
      expect(result.riskDecision.reasonCodes).toContain("MAX_RISK_PER_TRADE");
      expect(result.riskDecision.approvedSize).toBe(
        DEFAULT_RISK_POLICY.maxRiskPerTradeUsd / 100,
      );
    }
    // The reduction actually governs the simulated execution and reconciliation.
    expect(result.executedSize).toBe(
      DEFAULT_RISK_POLICY.maxRiskPerTradeUsd / 100,
    );
    // A reduction is audited as an approval-side decision, never a rejection.
    const reasons = result.logs.join(" ");
    expect(reasons).toContain("RISK_APPROVED");
    expect(reasons).not.toContain("RISK_REJECTED");
  });

  test("OPPORTUNITY_DETECTED audit carries the full cost stack", () => {
    const { audit, run } = flowHarness();
    run("costs-1", 5);

    const event = audit.all().find((e) => e.action === "OPPORTUNITY_DETECTED");
    expect(event).toBeDefined();
    const costs = event?.data?.costs as Record<string, number> | undefined;
    expect(costs).toBeDefined();
    for (const key of [
      "tradingFeesUsd",
      "slippageUsd",
      "gasUsd",
      "bridgeCostUsd",
      "fundingCostUsd",
      "latencyRiskUsd",
      "failureRiskUsd",
      "safetyBufferUsd",
    ]) {
      expect(typeof costs?.[key]).toBe("number");
    }
  });
});