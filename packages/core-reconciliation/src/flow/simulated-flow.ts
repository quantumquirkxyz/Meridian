import {
  type ApprovedRiskDecision,
  type AuditReasonCode,
  type CostBreakdown,
  type OpportunityCandidate,
  type OrderIntent,
  type ReduceRiskDecision,
  type RiskDecision,
  type RiskReasonCode,
  type StateName,
  type SystemMode,
} from "@agenttrading/contracts";
import { StateGraph, type TransitionOutcome, isExecutableRiskOutcome, MODULE_ACTORS } from "@agenttrading/core-stategraph";
import { RiskEngine } from "@agenttrading/core-risk";
import {
  ReconciliationEngine,
  type ReconciliationSnapshot,
} from "../reconciliation/reconciliation-engine.ts";

/**
 * Simulated opportunity flow (issue #13 AC4, the baseline exit criterion):
 * walks the StateGraph deterministically from IDLE through the full cycle
 * (detect opportunity -> build intent -> agent review -> risk gate -> simulate
 * execution -> reconcile -> audit) with NO LLM anywhere, and returns the
 * verifiable audit log. The agent review is a deterministic PASS/FAIL stub and
 * execution is simulated, exactly as production requires.
 */

/** Scenario inputs for one deterministic opportunity walk. */
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
  /** Size actually executed/reconciled (approvedSize when the gate reduced it). */
  executedSize?: number;
  /** Full verifiable audit log lines, one per event. */
  logs: readonly string[];
}

/** Inputs that drive one deterministic simulated opportunity walk. */
export interface SimulatedFlowOptions {
  graph: StateGraph;
  riskGate: RiskEngine;
  reconciliationEngine?: ReconciliationEngine;
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

/** The decision's own reason codes, when the variant carries them. */
function decisionReasonCodes(
  decision: RiskDecision,
): RiskReasonCode[] | undefined {
  const codes = "reasonCodes" in decision ? decision.reasonCodes : undefined;
  return codes === undefined ? undefined : [...codes];
}

/** Narrowing wrapper: an executable decision carries the approval payload. */
function isExecutableRiskDecision(
  decision: RiskDecision,
): decision is ApprovedRiskDecision | ReduceRiskDecision {
  return isExecutableRiskOutcome(decision.decision);
}

/** Runs the simulated opportunity flow and returns the deterministic result. */
export function runSimulatedOpportunityFlow(
  options: SimulatedFlowOptions,
): SimulatedFlowResult {
  const {
    graph,
    riskGate,
    reconciliationEngine,
    scenario,
    timestampMs,
  } = options;
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

  // 4. Detect opportunity (no LLM; candidates computed from the scenario). A
  //    non-profitable candidate is immediately invalidated so the detected
  //    audit event records the discard reason (US29: candidate opportunities
  //    audited with graph snapshot id, costs, and invalidation reasons).
  const candidate: OpportunityCandidate = {
    id: `opp-${scenario.id}`,
    snapshotId,
    route: [...(scenario.route ?? ["venue:bybit", "asset:BTC"])],
    grossSpreadUsd: scenario.grossSpreadUsd ?? 10,
    costs: { ...EMPTY_COSTS },
    expectedNetProfitUsd: scenario.expectedNetProfitUsd,
    createdAtMs: timestampMs,
    status: "CANDIDATE",
  };
  if (candidate.expectedNetProfitUsd <= 0) {
    candidate.status = "INVALID";
    candidate.invalidationReasons = ["MIN_EDGE"];
  }
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
      costs: candidate.costs,
      route: candidate.route,
      status: candidate.status,
      invalidationReasons: candidate.invalidationReasons,
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
  //    ship in production (ticket #28).
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
    // Simulated flow starts on a clean slate: no losses inside the rolling
    // 24h/7d windows (rules 2-3 fail closed when this state is missing).
    dailyLossUsd: 0,
    weeklyLossUsd: 0,
    evaluatedAtMs: timestampMs,
  });
  audit.record({
    eventId: `risk-${scenario.id}`,
    timestampMs,
    action: "RISK_DECISION",
    actor: MODULE_ACTORS.riskEngine,
    state: "RISK_VALIDATE",
    reasonCodes: isExecutableRiskOutcome(riskDecision.decision)
      ? ["RISK_APPROVED"]
      : ["RISK_REJECTED"],
    data: {
      idempotencyKey: orderIntent.idempotencyKey,
      decision: riskDecision.decision,
      reasonCodes: decisionReasonCodes(riskDecision),
    },
  });

  if (isExecutableRiskDecision(riskDecision)) {
    // 8-10. Approved path: precheck, simulated execution, reconcile, audit.
    approved = true;
    step(
      "EXECUTION_PRECHECK",
      MODULE_ACTORS.riskEngine,
      {
        riskDecisionOutcome: riskDecision.decision,
        riskDecision,
        orderIntent,
        expectedNetProfitUsd: candidate.expectedNetProfitUsd,
      },
      ["RISK_APPROVED"],
    );
    // The gate's approvedSize/approvedLimits govern the simulated fill, so a
    // REDUCE_SIZE decision actually reduces execution (ADR-0003, RISK.md:45).
    step(
      "EXECUTE_ORDER",
      MODULE_ACTORS.executionEngine,
      {
        precheck: "PASS",
        executedSize: riskDecision.approvedSize,
        approvedLimits: riskDecision.approvedLimits,
      },
    );
    const asset = orderIntent.symbol.split("/")[1] ?? "USDT";
    const quantity = riskDecision.approvedSize ?? orderIntent.quantity;
    const reconciliationInput = {
      internal: {
        orders: [
          {
            orderId: orderIntent.idempotencyKey,
            status: "CLOSED",
            quantity,
            filledQuantity: quantity,
          },
        ],
        fills: [
          {
            fillId: `fill-${scenario.id}`,
            orderId: orderIntent.idempotencyKey,
            quantity,
            price: orderIntent.price,
          },
        ],
        positions: [
          {
            symbol: orderIntent.symbol,
            quantity,
            averagePrice: orderIntent.price,
          },
        ],
        balances: [{ asset, available: 1_000, locked: 0 }],
      },
      external: {
        orders: [
          {
            orderId: orderIntent.idempotencyKey,
            status: "CLOSED",
            quantity,
            filledQuantity: quantity,
          },
        ],
        fills: [
          {
            fillId: `fill-${scenario.id}`,
            orderId: orderIntent.idempotencyKey,
            quantity,
            price: orderIntent.price,
          },
        ],
        positions: [
          {
            symbol: orderIntent.symbol,
            quantity,
            averagePrice: orderIntent.price,
          },
        ],
        balances: [{ asset, available: 1_000, locked: 0 }],
      },
      reconciledAtMs: timestampMs,
    } satisfies {
      internal: ReconciliationSnapshot;
      external: ReconciliationSnapshot;
      reconciledAtMs: number;
    };
    const reconciliationReport =
      reconciliationEngine?.reconcile(reconciliationInput) ?? {
        reconciledAtMs: timestampMs,
        unresolved: false,
        severity: "NONE" as const,
        defensiveMode: "NORMAL" as const,
        reasonCodes: ["RECONCILIATION_OK"] as const,
        orphanOrders: [],
        missingFills: [],
        balanceMismatches: [],
        positionMismatches: [],
        blocksNewPositions: false,
      };
    const reconciliationReasonCodes: AuditReasonCode[] =
      reconciliationReport.unresolved
        ? ["RECONCILIATION_MISMATCH"]
        : ["RECONCILIATION_OK"];
    step(
      "RECONCILE",
      MODULE_ACTORS.executionEngine,
      {
        execution: "SIMULATED_FILL",
        orderIntent,
        executedSize: riskDecision.approvedSize,
        reconciliationStatus: reconciliationReport,
      },
      ["EXECUTION_SIMULATED", ...reconciliationReasonCodes],
    );
    step(
      "AUDIT_DECISION",
      MODULE_ACTORS.reconciliationEngine,
      {
        reconciliation: reconciliationReport.unresolved ? "FAILED" : "OK",
        reconciliationStatus: reconciliationReport,
        orderIntent,
      },
      reconciliationReport.reasonCodes,
    );
    step("IDLE", MODULE_ACTORS.audit, { cycleComplete: true }, [
      "CYCLE_COMPLETE",
    ]);
  } else {
    // Rejected path: record the rejected hypothesis and complete the cycle.
    // REJECT and defensive outcomes always carry non-empty reason codes, so
    // the candidate is invalidated with the decision's own codes (RISK.md:45).
    candidate.status = "REJECTED";
    candidate.invalidationReasons = decisionReasonCodes(riskDecision);
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
    executedSize: isExecutableRiskDecision(riskDecision)
      ? riskDecision.approvedSize
      : undefined,
    logs: audit.toLogLines(),
  };
}
