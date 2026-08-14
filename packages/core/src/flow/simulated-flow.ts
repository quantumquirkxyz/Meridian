import {
  type AuditEvent,
  type AuditReasonCode,
  type CostBreakdown,
  type OpportunityCandidate,
  type OrderIntent,
  type RiskDecision,
  type StateName,
  type SystemMode,
} from "@agenttrading/contracts";
import { StateGraph, type TransitionOutcome } from "../stategraph/state-graph.ts";
import { MODULE_ACTORS } from "../stategraph/topology.ts";
import { RiskGate } from "../risk/risk-gate.ts";

/**
 * Simulated opportunity flow (issue #13 AC4, the Phase Zero exit criterion):
 * walks the StateGraph deterministically from IDLE through the full cycle
 * (detect opportunity -> build intent -> agent review -> risk gate -> simulate
 * execution -> reconcile -> audit) with NO LLM anywhere, and returns the
 * verifiable audit log. The agent review is a deterministic PASS/FAIL stub and
 * execution is simulated, exactly as Alpha requires.
 */

export interface SimulatedFlowScenario {
  id: string;
  expectedNetProfitUsd: number;
  grossSpreadUsd?: number;
  route?: readonly string[];
  dataQualityScore?: number;
  venue?: string;
  symbol?: string;
  quantity?: number;
  price?: number;
}

export interface SimulatedFlowResult {
  scenarioId: string;
  /** True when the risk gate approved and the flow simulated execution. */
  approved: boolean;
  finalState: StateName;
  finalMode: SystemMode;
  path: readonly StateName[];
  transitions: readonly TransitionOutcome[];
  opportunity?: OpportunityCandidate;
  orderIntent?: OrderIntent;
  riskDecision?: RiskDecision;
  /** Full verifiable audit log lines, one per event. */
  logs: readonly string[];
}

export interface SimulatedFlowOptions {
  graph: StateGraph;
  riskGate: RiskGate;
  scenario: SimulatedFlowScenario;
  timestampMs: number;
}

const EMPTY_COSTS: CostBreakdown = {
  tradingFeesUsd: 0,
  slippageUsd: 0,
  gasUsd: 0,
  bridgeCostUsd: 0,
  fundingCostUsd: 0,
  latencyRiskUsd: 0,
  failureRiskUsd: 0,
  safetyBufferUsd: 0,
};

export function runSimulatedOpportunityFlow(
  options: SimulatedFlowOptions,
): SimulatedFlowResult {
  const { graph, riskGate, scenario, timestampMs } = options;
  const audit = graph.auditLog;
  const path: StateName[] = ["IDLE"];
  const transitions: TransitionOutcome[] = [];
  let opportunity: OpportunityCandidate | undefined;
  let orderIntent: OrderIntent | undefined;
  let riskDecision: RiskDecision | undefined;
  let approved = false;

  const step = (
    to: StateName,
    actor: string,
    data?: Record<string, unknown>,
    reasonCodes?: readonly AuditReasonCode[],
  ): TransitionOutcome => {
    const outcome = graph.transition({
      to,
      actor,
      data,
      reasonCodes,
      timestampMs,
    });
    transitions.push(outcome);
    if (outcome.ok) {
      path.push(outcome.state);
    } else {
      throw new Error(
        `simulated flow blocked at ${graph.currentState} -> ${to}: ` +
          `${outcome.reasonCode} ${outcome.event.data?.guardReason ?? ""}`,
      );
    }
    return outcome;
  };

  // 1-3. Observation: ingest, normalize, graph.
  step(
    "INGEST_MARKET_DATA",
    MODULE_ACTORS.marketDataSentinel,
    { source: scenario.venue ?? "bybit" },
  );
  step("NORMALIZE_MARKET_STATE", MODULE_ACTORS.normalizer, {
    normalizedMarketData: {
      venue: scenario.venue ?? "bybit",
      symbol: scenario.symbol ?? "BTC/USDT",
      bid: scenario.price !== undefined ? scenario.price - 0.5 : 100,
      ask: scenario.price !== undefined ? scenario.price + 0.5 : 101,
      mid: scenario.price ?? 100.5,
      latencyMs: 12,
    },
  });
  const snapshotId = `snap-${scenario.id}`;
  step("UPDATE_MARKET_GRAPH", MODULE_ACTORS.graphBuilder, {
    graphSnapshot: {
      version: 1,
      snapshotId,
      createdAtMs: timestampMs,
      nodes: [],
      edges: [],
    },
  });

  // 4. Detect opportunity (no LLM; candidates computed from the scenario).
  const candidate: OpportunityCandidate = {
    id: `opp-${scenario.id}`,
    snapshotId,
    route: [...(scenario.route ?? ["venue:bybit", "asset:BTC"])],
    grossSpreadUsd: scenario.grossSpreadUsd ?? 10,
    costs: EMPTY_COSTS,
    expectedNetProfitUsd: scenario.expectedNetProfitUsd,
    createdAtMs: timestampMs,
    status: "CANDIDATE",
  };
  audit.record({
    eventId: `detected-${scenario.id}`,
    timestampMs,
    action: "OPPORTUNITY_DETECTED",
    actor: MODULE_ACTORS.opportunityScanner,
    state: "DETECT_OPPORTUNITY",
    reasonCodes: ["OPPORTUNITY_RECORDED"],
    data: {
      candidateId: candidate.id,
      snapshotId,
      expectedNetProfitUsd: candidate.expectedNetProfitUsd,
      route: candidate.route,
      status: candidate.status,
    },
  });

  step(
    "DETECT_OPPORTUNITY",
    MODULE_ACTORS.opportunityScanner,
    { candidates: [candidate] },
    ["OPPORTUNITY_RECORDED"],
  );

  // Non-profitable opportunities are discarded and audited; no intent is built.
  if (candidate.expectedNetProfitUsd <= 0) {
    candidate.status = "INVALID";
    candidate.invalidationReasons = ["MIN_EDGE"];
    step("AUDIT_DECISION", MODULE_ACTORS.audit, {
      candidates: [candidate],
      invalidationReasons: candidate.invalidationReasons,
      cycleComplete: true,
    });
    step("IDLE", MODULE_ACTORS.audit, { cycleComplete: true });
    opportunity = candidate;
    return {
      scenarioId: scenario.id,
      approved,
      finalState: graph.currentState,
      finalMode: graph.currentMode,
      path,
      transitions,
      opportunity,
      riskDecision,
      logs: audit.toLogLines(),
    };
  }

  step(
    "BUILD_ORDER_INTENT",
    MODULE_ACTORS.planner,
    { candidates: [candidate] },
  );

  // 5. Build a typed OrderIntent (never a bare order).
  orderIntent = {
    idempotencyKey: `intent-${scenario.id}`,
    opportunityId: candidate.id,
    venue: scenario.venue ?? "bybit",
    symbol: scenario.symbol ?? "BTC/USDT",
    side: "BUY",
    quantity: scenario.quantity ?? 0.01,
    price: scenario.price ?? 100,
    quoteCurrency: "USDT",
    createdAtMs: timestampMs,
    expiresAtMs: timestampMs + 60_000,
    limits: { maxSlippageBps: 30 },
  };
  audit.record({
    eventId: `intent-${scenario.id}`,
    timestampMs,
    action: "ORDER_INTENT_CREATED",
    actor: MODULE_ACTORS.planner,
    state: "BUILD_ORDER_INTENT",
    reasonCodes: ["ORDER_INTENT_CREATED"],
    data: { idempotencyKey: orderIntent.idempotencyKey, opportunityId: candidate.id },
  });

  step(
    "REQUEST_AGENT_REVIEW",
    MODULE_ACTORS.planner,
    { orderIntent },
  );

  // 6. Deterministic agent review stub (no LLM). The skeleton always passes a
  //    reviewed hypothesis on to the risk gate; the full consultative agents
  //    ship in Beta (ticket #28).
  step(
    "RISK_VALIDATE",
    MODULE_ACTORS.agentReview,
    { agentReview: "PASS" },
  );

  // 7. Risk gate: the mandatory deterministic authority (ADR-0003).
  riskDecision = riskGate.evaluate({
    orderIntent,
    expectedNetProfitUsd: candidate.expectedNetProfitUsd,
    mode: graph.currentMode,
    dataQualityScore: scenario.dataQualityScore,
    evaluatedAtMs: timestampMs,
  });
  audit.record({
    eventId: `risk-${scenario.id}`,
    timestampMs,
    action: "RISK_DECISION",
    actor: MODULE_ACTORS.riskEngine,
    state: "RISK_VALIDATE",
    reasonCodes:
      riskDecision.decision === "APPROVE" || riskDecision.decision === "REDUCE_SIZE"
        ? ["RISK_APPROVED"]
        : ["RISK_REJECTED"],
    data: {
      idempotencyKey: orderIntent.idempotencyKey,
      decision: riskDecision.decision,
      reasonCodes:
        "reasonCodes" in riskDecision ? riskDecision.reasonCodes : undefined,
    },
  });

  if (riskDecision.decision === "APPROVE" || riskDecision.decision === "REDUCE_SIZE") {
    // 8-10. Approved path: precheck, simulated execution, reconcile, audit.
    approved = true;
    step(
      "EXECUTION_PRECHECK",
      MODULE_ACTORS.riskEngine,
      {
        riskDecisionOutcome: riskDecision.decision,
        riskDecision,
        orderIntent,
      },
      ["RISK_APPROVED"],
    );
    step(
      "EXECUTE_ORDER",
      MODULE_ACTORS.executionEngine,
      { precheck: "PASS" },
    );
    step(
      "RECONCILE",
      MODULE_ACTORS.executionEngine,
      { execution: "SIMULATED_FILL", orderIntent },
      ["EXECUTION_SIMULATED"],
    );
    step(
      "AUDIT_DECISION",
      MODULE_ACTORS.reconciliationEngine,
      { reconciliation: "OK", orderIntent },
      ["RECONCILIATION_OK"],
    );
    step("IDLE", MODULE_ACTORS.audit, { cycleComplete: true }, [
      "CYCLE_COMPLETE",
    ]);
  } else {
    // Rejected path: record the rejected hypothesis and complete the cycle.
    const rejectedReasonCodes =
      "reasonCodes" in riskDecision ? riskDecision.reasonCodes : undefined;
    candidate.status = "REJECTED";
    candidate.invalidationReasons = rejectedReasonCodes ?? [];
    step(
      "AUDIT_DECISION",
      MODULE_ACTORS.riskEngine,
      {
        riskDecisionOutcome: riskDecision.decision,
        riskDecision,
        candidates: [candidate],
        cycleComplete: true,
      },
      ["RISK_REJECTED"],
    );
    step("IDLE", MODULE_ACTORS.audit, { cycleComplete: true }, [
      "CYCLE_COMPLETE",
    ]);
  }

  return {
    scenarioId: scenario.id,
    approved,
    finalState: graph.currentState,
    finalMode: graph.currentMode,
    path,
    transitions,
    opportunity: candidate,
    orderIntent,
    riskDecision,
    logs: audit.toLogLines(),
  };
}