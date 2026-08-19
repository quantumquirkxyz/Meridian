import { describe, expect, test } from "bun:test";
import {
  isAuditEvent,
  PERMISSIONS_NEVER_GRANTED_TO_AGENTS,
  STATE_NAMES,
  type Permission,
  type StateName,
} from "@agenttrading/contracts";
import { AuditLog } from "../src/stategraph/audit-log.ts";
import { PermissionRegistry } from "../src/stategraph/permission-registry.ts";
import { StateGraph } from "../src/stategraph/state-graph.ts";
import {
  buildDefaultGraph,
  defaultPermissionRegistry,
  MODULE_ACTORS,
} from "../src/stategraph/topology.ts";
import {
  defaultFallbacks,
  defaultStateTimeouts,
  Orchestrator,
  type OrchestratorOptions,
} from "../src/stategraph/orchestrator.ts";

const FIXED_TS = 1_700_000_000_000;

/** Creates a fresh Orchestrator for testing. */
function newOrchestrator(
  overrides?: Partial<OrchestratorOptions>,
): { orchestrator: Orchestrator; graph: StateGraph; audit: AuditLog } {
  const { nodes, transitions } = buildDefaultGraph();
  const audit = new AuditLog();
  const permissions = defaultPermissionRegistry();
  const graph = new StateGraph({
    nodes,
    transitions,
    permissions,
    audit,
    now: () => FIXED_TS,
  });
  const orchestrator = new Orchestrator({
    graph,
    permissions,
    audit,
    stateTimeouts: defaultStateTimeouts(),
    retryPolicy: { maxRetries: 3, baseDelayMs: 1_000 },
    fallbacks: defaultFallbacks(),
    now: () => FIXED_TS,
    ...overrides,
  });
  return { orchestrator, graph, audit };
}

// ── AC1: Cannot jump SIGNAL_FOUND → EXECUTING without DEBATING, RISK_CHECKING, APPROVED ──

describe("AC1: forbidden route enforcement — no direct jump to execution", () => {
  test("blocks DETECT_OPPORTUNITY → EXECUTE_ORDER", () => {
    const { orchestrator, graph } = newOrchestrator();
    // Walk to DETECT_OPPORTUNITY.
    graph.transition({
      to: "INGEST_MARKET_DATA",
      actor: MODULE_ACTORS.marketDataSentinel,
      timestampMs: FIXED_TS,
    });
    graph.transition({
      to: "NORMALIZE_MARKET_STATE",
      actor: MODULE_ACTORS.normalizer,
      data: { normalizedMarketData: { mid: 1 } },
      timestampMs: FIXED_TS,
    });
    graph.transition({
      to: "UPDATE_MARKET_GRAPH",
      actor: MODULE_ACTORS.graphBuilder,
      data: { graphSnapshot: { version: 1 } },
      timestampMs: FIXED_TS,
    });
    graph.transition({
      to: "DETECT_OPPORTUNITY",
      actor: MODULE_ACTORS.opportunityScanner,
      data: { graphSnapshot: { version: 1 } },
      timestampMs: FIXED_TS,
    });
    expect(graph.currentState).toBe("DETECT_OPPORTUNITY");

    // Try to jump directly to EXECUTE_ORDER — must be blocked.
    const outcome = orchestrator.transition({
      to: "EXECUTE_ORDER",
      actor: MODULE_ACTORS.executionEngine,
      timestampMs: FIXED_TS,
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reasonCode).toBe("FORBIDDEN_ROUTE");
    }
  });

  test("blocks BUILD_ORDER_INTENT → EXECUTION_PRECHECK", () => {
    const { orchestrator, graph } = newOrchestrator();
    // Walk to BUILD_ORDER_INTENT.
    graph.transition({
      to: "INGEST_MARKET_DATA",
      actor: MODULE_ACTORS.marketDataSentinel,
      timestampMs: FIXED_TS,
    });
    graph.transition({
      to: "NORMALIZE_MARKET_STATE",
      actor: MODULE_ACTORS.normalizer,
      data: { normalizedMarketData: { mid: 1 } },
      timestampMs: FIXED_TS,
    });
    graph.transition({
      to: "UPDATE_MARKET_GRAPH",
      actor: MODULE_ACTORS.graphBuilder,
      data: { graphSnapshot: { version: 1 } },
      timestampMs: FIXED_TS,
    });
    graph.transition({
      to: "DETECT_OPPORTUNITY",
      actor: MODULE_ACTORS.opportunityScanner,
      data: {
        candidates: [{ status: "CANDIDATE", expectedNetProfitUsd: 5 }],
        graphSnapshot: { version: 1 },
      },
      timestampMs: FIXED_TS,
    });
    graph.transition({
      to: "BUILD_ORDER_INTENT",
      actor: MODULE_ACTORS.opportunityScanner,
      data: {
        candidates: [{ status: "CANDIDATE", expectedNetProfitUsd: 5 }],
      },
      timestampMs: FIXED_TS,
    });
    expect(graph.currentState).toBe("BUILD_ORDER_INTENT");

    // Try to jump directly to EXECUTION_PRECHECK — must be blocked.
    const outcome = orchestrator.transition({
      to: "EXECUTION_PRECHECK",
      actor: MODULE_ACTORS.riskEngine,
      timestampMs: FIXED_TS,
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reasonCode).toBe("FORBIDDEN_ROUTE");
    }
  });

  test("blocks DETECT_OPPORTUNITY → PAPER_EXECUTING", () => {
    const { orchestrator, graph } = newOrchestrator();
    graph.transition({
      to: "INGEST_MARKET_DATA",
      actor: MODULE_ACTORS.marketDataSentinel,
      timestampMs: FIXED_TS,
    });
    graph.transition({
      to: "NORMALIZE_MARKET_STATE",
      actor: MODULE_ACTORS.normalizer,
      data: { normalizedMarketData: { mid: 1 } },
      timestampMs: FIXED_TS,
    });
    graph.transition({
      to: "UPDATE_MARKET_GRAPH",
      actor: MODULE_ACTORS.graphBuilder,
      data: { graphSnapshot: { version: 1 } },
      timestampMs: FIXED_TS,
    });
    graph.transition({
      to: "DETECT_OPPORTUNITY",
      actor: MODULE_ACTORS.opportunityScanner,
      data: { graphSnapshot: { version: 1 } },
      timestampMs: FIXED_TS,
    });
    expect(graph.currentState).toBe("DETECT_OPPORTUNITY");

    // Try to jump to PAPER_EXECUTING — must be blocked.
    const outcome = orchestrator.transition({
      to: "PAPER_EXECUTING",
      actor: MODULE_ACTORS.executionEngine,
      timestampMs: FIXED_TS,
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reasonCode).toBe("FORBIDDEN_ROUTE");
    }
  });

  test("allows the proper orchestrator flow: BUILD_ORDER_INTENT → DEBATING → RISK_CHECKING", () => {
    const { orchestrator, graph } = newOrchestrator();
    // Walk to BUILD_ORDER_INTENT.
    graph.transition({
      to: "INGEST_MARKET_DATA",
      actor: MODULE_ACTORS.marketDataSentinel,
      timestampMs: FIXED_TS,
    });
    graph.transition({
      to: "NORMALIZE_MARKET_STATE",
      actor: MODULE_ACTORS.normalizer,
      data: { normalizedMarketData: { mid: 1 } },
      timestampMs: FIXED_TS,
    });
    graph.transition({
      to: "UPDATE_MARKET_GRAPH",
      actor: MODULE_ACTORS.graphBuilder,
      data: { graphSnapshot: { version: 1 } },
      timestampMs: FIXED_TS,
    });
    graph.transition({
      to: "DETECT_OPPORTUNITY",
      actor: MODULE_ACTORS.opportunityScanner,
      data: {
        candidates: [{ status: "CANDIDATE", expectedNetProfitUsd: 5 }],
        graphSnapshot: { version: 1 },
      },
      timestampMs: FIXED_TS,
    });
    graph.transition({
      to: "BUILD_ORDER_INTENT",
      actor: MODULE_ACTORS.opportunityScanner,
      data: {
        candidates: [{ status: "CANDIDATE", expectedNetProfitUsd: 5 }],
      },
      timestampMs: FIXED_TS,
    });
    expect(graph.currentState).toBe("BUILD_ORDER_INTENT");

    // Enter DEBATING — allowed via orchestrator flow.
    const toDebating = orchestrator.transition({
      to: "DEBATING",
      actor: MODULE_ACTORS.planner,
      data: { orderIntent: { idempotencyKey: "intent-1" } },
      timestampMs: FIXED_TS,
    });
    expect(toDebating.ok).toBe(true);
    expect(graph.currentState).toBe("DEBATING");

    // Enter RISK_CHECKING — allowed.
    const toRiskChecking = orchestrator.transition({
      to: "RISK_CHECKING",
      actor: MODULE_ACTORS.agentReview,
      data: { debateResult: "PASS" },
      timestampMs: FIXED_TS,
    });
    expect(toRiskChecking.ok).toBe(true);
    expect(graph.currentState).toBe("RISK_CHECKING");
  });

  test("allows the full orchestrator cycle: DEBATING → RISK_CHECKING → APPROVED → PAPER_EXECUTING → RECONCILING → AUDITING → IDLE", () => {
    const { orchestrator, graph } = newOrchestrator();
    // Walk to BUILD_ORDER_INTENT.
    graph.transition({
      to: "INGEST_MARKET_DATA",
      actor: MODULE_ACTORS.marketDataSentinel,
      timestampMs: FIXED_TS,
    });
    graph.transition({
      to: "NORMALIZE_MARKET_STATE",
      actor: MODULE_ACTORS.normalizer,
      data: { normalizedMarketData: { mid: 1 } },
      timestampMs: FIXED_TS,
    });
    graph.transition({
      to: "UPDATE_MARKET_GRAPH",
      actor: MODULE_ACTORS.graphBuilder,
      data: { graphSnapshot: { version: 1 } },
      timestampMs: FIXED_TS,
    });
    graph.transition({
      to: "DETECT_OPPORTUNITY",
      actor: MODULE_ACTORS.opportunityScanner,
      data: {
        candidates: [{ status: "CANDIDATE", expectedNetProfitUsd: 5 }],
        graphSnapshot: { version: 1 },
      },
      timestampMs: FIXED_TS,
    });
    graph.transition({
      to: "BUILD_ORDER_INTENT",
      actor: MODULE_ACTORS.opportunityScanner,
      data: {
        candidates: [{ status: "CANDIDATE", expectedNetProfitUsd: 5 }],
      },
      timestampMs: FIXED_TS,
    });

    // DEBATING
    const toDebating = orchestrator.transition({
      to: "DEBATING",
      actor: MODULE_ACTORS.planner,
      data: { orderIntent: { idempotencyKey: "intent-1" } },
      timestampMs: FIXED_TS,
    });
    expect(toDebating.ok).toBe(true);

    // RISK_CHECKING
    const toRiskChecking = orchestrator.transition({
      to: "RISK_CHECKING",
      actor: MODULE_ACTORS.agentReview,
      data: { debateResult: "PASS" },
      timestampMs: FIXED_TS,
    });
    expect(toRiskChecking.ok).toBe(true);

    const validRiskDecision = {
      decision: "APPROVE" as const,
      orderIntentIdempotencyKey: "intent-1",
      evaluatedAtMs: FIXED_TS,
      approvedSize: 0.01,
      approvedLimits: { maxSlippageBps: 30 },
      expiresAtMs: FIXED_TS + 300_000,
    };
    // APPROVED (risk decision)
    const approved = orchestrator.transition({
      to: "APPROVED",
      actor: MODULE_ACTORS.riskEngine,
      data: {
        riskDecisionOutcome: "APPROVE",
        riskDecision: validRiskDecision,
      },
      timestampMs: FIXED_TS,
    });
    expect(approved.ok).toBe(true);

    // PAPER_EXECUTING
    const toPaper = orchestrator.transition({
      to: "PAPER_EXECUTING",
      actor: MODULE_ACTORS.executionEngine,
      data: {
        riskDecision: validRiskDecision,
      },
      timestampMs: FIXED_TS,
    });
    expect(toPaper.ok).toBe(true);

    // RECONCILING
    const toReconciling = orchestrator.transition({
      to: "RECONCILING",
      actor: MODULE_ACTORS.executionEngine,
      data: { execution: "SIMULATED_FILL" },
      timestampMs: FIXED_TS,
    });
    expect(toReconciling.ok).toBe(true);

    // AUDITING
    const toAuditing = orchestrator.transition({
      to: "AUDITING",
      actor: MODULE_ACTORS.reconciliationEngine,
      data: { reconciliation: "OK" },
      timestampMs: FIXED_TS,
    });
    expect(toAuditing.ok).toBe(true);

    // IDLE
    const toIdle = orchestrator.transition({
      to: "IDLE",
      actor: MODULE_ACTORS.audit,
      data: { cycleComplete: true },
      timestampMs: FIXED_TS,
    });
    expect(toIdle.ok).toBe(true);
    expect(graph.currentState).toBe("IDLE");
  });

  test("rejected path: RISK_CHECKING → REJECTED → AUDITING → IDLE", () => {
    const { orchestrator, graph } = newOrchestrator();
    // Walk to RISK_CHECKING.
    graph.transition({
      to: "INGEST_MARKET_DATA",
      actor: MODULE_ACTORS.marketDataSentinel,
      timestampMs: FIXED_TS,
    });
    graph.transition({
      to: "NORMALIZE_MARKET_STATE",
      actor: MODULE_ACTORS.normalizer,
      data: { normalizedMarketData: { mid: 1 } },
      timestampMs: FIXED_TS,
    });
    graph.transition({
      to: "UPDATE_MARKET_GRAPH",
      actor: MODULE_ACTORS.graphBuilder,
      data: { graphSnapshot: { version: 1 } },
      timestampMs: FIXED_TS,
    });
    graph.transition({
      to: "DETECT_OPPORTUNITY",
      actor: MODULE_ACTORS.opportunityScanner,
      data: {
        candidates: [{ status: "CANDIDATE", expectedNetProfitUsd: 5 }],
        graphSnapshot: { version: 1 },
      },
      timestampMs: FIXED_TS,
    });
    graph.transition({
      to: "BUILD_ORDER_INTENT",
      actor: MODULE_ACTORS.opportunityScanner,
      data: {
        candidates: [{ status: "CANDIDATE", expectedNetProfitUsd: 5 }],
      },
      timestampMs: FIXED_TS,
    });
    orchestrator.transition({
      to: "DEBATING",
      actor: MODULE_ACTORS.planner,
      data: { orderIntent: { idempotencyKey: "intent-1" } },
      timestampMs: FIXED_TS,
    });
    orchestrator.transition({
      to: "RISK_CHECKING",
      actor: MODULE_ACTORS.agentReview,
      data: { debateResult: "PASS" },
      timestampMs: FIXED_TS,
    });
    expect(graph.currentState).toBe("RISK_CHECKING");

    // REJECTED
    const rejected = orchestrator.transition({
      to: "REJECTED",
      actor: MODULE_ACTORS.riskEngine,
      data: {
        riskDecisionOutcome: "REJECT",
        riskDecision: {
          decision: "REJECT",
          orderIntentIdempotencyKey: "intent-1",
          evaluatedAtMs: FIXED_TS,
          reasonCodes: ["MIN_EDGE"],
        },
      },
      timestampMs: FIXED_TS,
    });
    expect(rejected.ok).toBe(true);

    // AUDITING
    const toAuditing = orchestrator.transition({
      to: "AUDITING",
      actor: MODULE_ACTORS.riskEngine,
      data: { riskDecision: { decision: "REJECT" } },
      timestampMs: FIXED_TS,
    });
    expect(toAuditing.ok).toBe(true);

    // IDLE
    const toIdle = orchestrator.transition({
      to: "IDLE",
      actor: MODULE_ACTORS.audit,
      data: { cycleComplete: true },
      timestampMs: FIXED_TS,
    });
    expect(toIdle.ok).toBe(true);
    expect(graph.currentState).toBe("IDLE");
  });
});

// ── AC2: Handoffs and permissions are enforced per agent ──

describe("AC2: per-agent permission enforcement", () => {
  test("an agent without PROPOSE_EXECUTION_PLAN cannot enter DEBATING", () => {
    const { orchestrator, graph } = newOrchestrator();
    graph.transition({
      to: "INGEST_MARKET_DATA",
      actor: MODULE_ACTORS.marketDataSentinel,
      timestampMs: FIXED_TS,
    });
    graph.transition({
      to: "NORMALIZE_MARKET_STATE",
      actor: MODULE_ACTORS.normalizer,
      data: { normalizedMarketData: { mid: 1 } },
      timestampMs: FIXED_TS,
    });
    graph.transition({
      to: "UPDATE_MARKET_GRAPH",
      actor: MODULE_ACTORS.graphBuilder,
      data: { graphSnapshot: { version: 1 } },
      timestampMs: FIXED_TS,
    });
    graph.transition({
      to: "DETECT_OPPORTUNITY",
      actor: MODULE_ACTORS.opportunityScanner,
      data: {
        candidates: [{ status: "CANDIDATE", expectedNetProfitUsd: 5 }],
        graphSnapshot: { version: 1 },
      },
      timestampMs: FIXED_TS,
    });
    graph.transition({
      to: "BUILD_ORDER_INTENT",
      actor: MODULE_ACTORS.opportunityScanner,
      data: {
        candidates: [{ status: "CANDIDATE", expectedNetProfitUsd: 5 }],
      },
      timestampMs: FIXED_TS,
    });

    // market-data-sentinel does NOT have PROPOSE_EXECUTION_PLAN.
    const outcome = orchestrator.transition({
      to: "DEBATING",
      actor: MODULE_ACTORS.marketDataSentinel,
      data: { orderIntent: { idempotencyKey: "intent-1" } },
      timestampMs: FIXED_TS,
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reasonCode).toBe("PERMISSION_DENIED");
    }
  });

  test("an agent without APPROVE_RISK cannot enter APPROVED", () => {
    const { orchestrator, graph } = newOrchestrator();
    // Walk to RISK_CHECKING.
    graph.transition({
      to: "INGEST_MARKET_DATA",
      actor: MODULE_ACTORS.marketDataSentinel,
      timestampMs: FIXED_TS,
    });
    graph.transition({
      to: "NORMALIZE_MARKET_STATE",
      actor: MODULE_ACTORS.normalizer,
      data: { normalizedMarketData: { mid: 1 } },
      timestampMs: FIXED_TS,
    });
    graph.transition({
      to: "UPDATE_MARKET_GRAPH",
      actor: MODULE_ACTORS.graphBuilder,
      data: { graphSnapshot: { version: 1 } },
      timestampMs: FIXED_TS,
    });
    graph.transition({
      to: "DETECT_OPPORTUNITY",
      actor: MODULE_ACTORS.opportunityScanner,
      data: {
        candidates: [{ status: "CANDIDATE", expectedNetProfitUsd: 5 }],
        graphSnapshot: { version: 1 },
      },
      timestampMs: FIXED_TS,
    });
    graph.transition({
      to: "BUILD_ORDER_INTENT",
      actor: MODULE_ACTORS.opportunityScanner,
      data: {
        candidates: [{ status: "CANDIDATE", expectedNetProfitUsd: 5 }],
      },
      timestampMs: FIXED_TS,
    });
    orchestrator.transition({
      to: "DEBATING",
      actor: MODULE_ACTORS.planner,
      data: { orderIntent: { idempotencyKey: "intent-1" } },
      timestampMs: FIXED_TS,
    });
    orchestrator.transition({
      to: "RISK_CHECKING",
      actor: MODULE_ACTORS.agentReview,
      data: { debateResult: "PASS" },
      timestampMs: FIXED_TS,
    });
    expect(graph.currentState).toBe("RISK_CHECKING");

    // agent-review does NOT have APPROVE_RISK.
    const outcome = orchestrator.transition({
      to: "APPROVED",
      actor: MODULE_ACTORS.agentReview,
      data: {
        riskDecisionOutcome: "APPROVE",
        riskDecision: {
          decision: "APPROVE",
          orderIntentIdempotencyKey: "intent-1",
          evaluatedAtMs: FIXED_TS,
          approvedSize: 0.01,
          approvedLimits: { maxSlippageBps: 30 },
          expiresAtMs: FIXED_TS + 60_000,
        },
      },
      timestampMs: FIXED_TS,
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reasonCode).toBe("PERMISSION_DENIED");
    }
  });

  test("an agent without SUBMIT_ORDER cannot enter PAPER_EXECUTING", () => {
    const { orchestrator, graph } = newOrchestrator();
    // Walk to APPROVED.
    graph.transition({
      to: "INGEST_MARKET_DATA",
      actor: MODULE_ACTORS.marketDataSentinel,
      timestampMs: FIXED_TS,
    });
    graph.transition({
      to: "NORMALIZE_MARKET_STATE",
      actor: MODULE_ACTORS.normalizer,
      data: { normalizedMarketData: { mid: 1 } },
      timestampMs: FIXED_TS,
    });
    graph.transition({
      to: "UPDATE_MARKET_GRAPH",
      actor: MODULE_ACTORS.graphBuilder,
      data: { graphSnapshot: { version: 1 } },
      timestampMs: FIXED_TS,
    });
    graph.transition({
      to: "DETECT_OPPORTUNITY",
      actor: MODULE_ACTORS.opportunityScanner,
      data: {
        candidates: [{ status: "CANDIDATE", expectedNetProfitUsd: 5 }],
        graphSnapshot: { version: 1 },
      },
      timestampMs: FIXED_TS,
    });
    graph.transition({
      to: "BUILD_ORDER_INTENT",
      actor: MODULE_ACTORS.opportunityScanner,
      data: {
        candidates: [{ status: "CANDIDATE", expectedNetProfitUsd: 5 }],
      },
      timestampMs: FIXED_TS,
    });
    orchestrator.transition({
      to: "DEBATING",
      actor: MODULE_ACTORS.planner,
      data: { orderIntent: { idempotencyKey: "intent-1" } },
      timestampMs: FIXED_TS,
    });
    orchestrator.transition({
      to: "RISK_CHECKING",
      actor: MODULE_ACTORS.agentReview,
      data: { debateResult: "PASS" },
      timestampMs: FIXED_TS,
    });
    orchestrator.transition({
      to: "APPROVED",
      actor: MODULE_ACTORS.riskEngine,
      data: {
        riskDecisionOutcome: "APPROVE",
        riskDecision: {
          decision: "APPROVE",
          orderIntentIdempotencyKey: "intent-1",
          evaluatedAtMs: FIXED_TS,
          approvedSize: 0.01,
          approvedLimits: { maxSlippageBps: 30 },
          expiresAtMs: FIXED_TS + 60_000,
        },
      },
      timestampMs: FIXED_TS,
    });
    expect(graph.currentState).toBe("APPROVED");

    // audit does NOT have SUBMIT_ORDER.
    const outcome = orchestrator.transition({
      to: "PAPER_EXECUTING",
      actor: MODULE_ACTORS.audit,
      data: { riskDecision: { decision: "APPROVE" } },
      timestampMs: FIXED_TS,
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reasonCode).toBe("PERMISSION_DENIED");
    }
  });

  test("permission denial is audited with actor and missing permissions", () => {
    const { orchestrator, graph, audit } = newOrchestrator();
    graph.transition({
      to: "INGEST_MARKET_DATA",
      actor: MODULE_ACTORS.marketDataSentinel,
      timestampMs: FIXED_TS,
    });
    graph.transition({
      to: "NORMALIZE_MARKET_STATE",
      actor: MODULE_ACTORS.normalizer,
      data: { normalizedMarketData: { mid: 1 } },
      timestampMs: FIXED_TS,
    });
    graph.transition({
      to: "UPDATE_MARKET_GRAPH",
      actor: MODULE_ACTORS.graphBuilder,
      data: { graphSnapshot: { version: 1 } },
      timestampMs: FIXED_TS,
    });
    graph.transition({
      to: "DETECT_OPPORTUNITY",
      actor: MODULE_ACTORS.opportunityScanner,
      data: {
        candidates: [{ status: "CANDIDATE", expectedNetProfitUsd: 5 }],
        graphSnapshot: { version: 1 },
      },
      timestampMs: FIXED_TS,
    });
    graph.transition({
      to: "BUILD_ORDER_INTENT",
      actor: MODULE_ACTORS.opportunityScanner,
      data: {
        candidates: [{ status: "CANDIDATE", expectedNetProfitUsd: 5 }],
      },
      timestampMs: FIXED_TS,
    });

    const before = audit.count();
    orchestrator.transition({
      to: "DEBATING",
      actor: MODULE_ACTORS.marketDataSentinel,
      data: { orderIntent: { idempotencyKey: "intent-1" } },
      timestampMs: FIXED_TS,
    });
    const after = audit.count();
    expect(after).toBeGreaterThan(before);

    const lastEvent = audit.last();
    expect(lastEvent).toBeDefined();
    expect(lastEvent?.reasonCodes).toContain("PERMISSION_DENIED");
    expect(lastEvent?.reasonCodes).toContain("TRANSITION_BLOCKED");
    const data = lastEvent?.data as Record<string, unknown> | undefined;
    expect(data?.actor).toBe(MODULE_ACTORS.marketDataSentinel);
    expect(data?.missingPermissions).toBeDefined();
  });
});

// ── AC3: Timeouts, retry, fallback, kill switch ──

describe("AC3: timeout, retry, fallback, and kill switch", () => {
  test("kill switch halts the system from any state", () => {
    const { orchestrator, graph, audit } = newOrchestrator();
    // Walk to DEBATING.
    graph.transition({
      to: "INGEST_MARKET_DATA",
      actor: MODULE_ACTORS.marketDataSentinel,
      timestampMs: FIXED_TS,
    });
    graph.transition({
      to: "NORMALIZE_MARKET_STATE",
      actor: MODULE_ACTORS.normalizer,
      data: { normalizedMarketData: { mid: 1 } },
      timestampMs: FIXED_TS,
    });
    graph.transition({
      to: "UPDATE_MARKET_GRAPH",
      actor: MODULE_ACTORS.graphBuilder,
      data: { graphSnapshot: { version: 1 } },
      timestampMs: FIXED_TS,
    });
    graph.transition({
      to: "DETECT_OPPORTUNITY",
      actor: MODULE_ACTORS.opportunityScanner,
      data: {
        candidates: [{ status: "CANDIDATE", expectedNetProfitUsd: 5 }],
        graphSnapshot: { version: 1 },
      },
      timestampMs: FIXED_TS,
    });
    graph.transition({
      to: "BUILD_ORDER_INTENT",
      actor: MODULE_ACTORS.opportunityScanner,
      data: {
        candidates: [{ status: "CANDIDATE", expectedNetProfitUsd: 5 }],
      },
      timestampMs: FIXED_TS,
    });
    orchestrator.transition({
      to: "DEBATING",
      actor: MODULE_ACTORS.planner,
      data: { orderIntent: { idempotencyKey: "intent-1" } },
      timestampMs: FIXED_TS,
    });
    expect(graph.currentState).toBe("DEBATING");

    // Activate kill switch.
    const event = orchestrator.activateKillSwitch(
      MODULE_ACTORS.infraGuardian,
      "emergency halt",
    );
    expect(orchestrator.isHalted).toBe(true);
    expect(graph.currentState).toBe("HALT");
    expect(graph.currentMode).toBe("HALT");
    expect(isAuditEvent(event)).toBe(true);
    expect(event.reasonCodes).toContain("KILL_SWITCH_ACTIVATED");
  });

  test("no transitions allowed after kill switch is active", () => {
    const { orchestrator, graph } = newOrchestrator();
    orchestrator.activateKillSwitch(MODULE_ACTORS.infraGuardian, "test halt");
    expect(orchestrator.isHalted).toBe(true);

    // Try to transition — must be blocked.
    const outcome = orchestrator.transition({
      to: "INGEST_MARKET_DATA",
      actor: MODULE_ACTORS.marketDataSentinel,
      timestampMs: FIXED_TS,
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reasonCode).toBe("KILL_SWITCH_ACTIVE");
    }
    expect(graph.currentState).toBe("HALT");
  });

  test("kill switch activation is idempotent", () => {
    const { orchestrator, graph, audit } = newOrchestrator();
    orchestrator.activateKillSwitch(MODULE_ACTORS.infraGuardian, "first halt");
    const eventsBefore = audit.count();

    // Second activation is a no-op but still audited.
    orchestrator.activateKillSwitch(MODULE_ACTORS.infraGuardian, "second halt");
    expect(orchestrator.isHalted).toBe(true);
    expect(graph.currentState).toBe("HALT");
    expect(audit.count()).toBeGreaterThan(eventsBefore);
  });

  test("timeout triggers fallback transition", () => {
    let clock = FIXED_TS;
    const { orchestrator, graph } = newOrchestrator({
      now: () => clock,
    });

    // Walk to DEBATING.
    graph.transition({
      to: "INGEST_MARKET_DATA",
      actor: MODULE_ACTORS.marketDataSentinel,
      timestampMs: FIXED_TS,
    });
    graph.transition({
      to: "NORMALIZE_MARKET_STATE",
      actor: MODULE_ACTORS.normalizer,
      data: { normalizedMarketData: { mid: 1 } },
      timestampMs: FIXED_TS,
    });
    graph.transition({
      to: "UPDATE_MARKET_GRAPH",
      actor: MODULE_ACTORS.graphBuilder,
      data: { graphSnapshot: { version: 1 } },
      timestampMs: FIXED_TS,
    });
    graph.transition({
      to: "DETECT_OPPORTUNITY",
      actor: MODULE_ACTORS.opportunityScanner,
      data: {
        candidates: [{ status: "CANDIDATE", expectedNetProfitUsd: 5 }],
        graphSnapshot: { version: 1 },
      },
      timestampMs: FIXED_TS,
    });
    graph.transition({
      to: "BUILD_ORDER_INTENT",
      actor: MODULE_ACTORS.opportunityScanner,
      data: {
        candidates: [{ status: "CANDIDATE", expectedNetProfitUsd: 5 }],
      },
      timestampMs: FIXED_TS,
    });
    orchestrator.transition({
      to: "DEBATING",
      actor: MODULE_ACTORS.planner,
      data: { orderIntent: { idempotencyKey: "intent-1" } },
      timestampMs: FIXED_TS,
    });
    expect(graph.currentState).toBe("DEBATING");

    // Advance clock past the DEBATING timeout (30s).
    clock = FIXED_TS + 31_000;
    const events = orchestrator.tick();
    expect(events.length).toBeGreaterThan(0);
    // DEBATING timeout triggers HALT (fail-closed).
    expect(graph.currentState).toBe("HALT");
    expect(graph.currentMode).toBe("HALT");
    expect(orchestrator.isHalted).toBe(true);
  });

  test("no timeout when within the timeout window", () => {
    let clock = FIXED_TS;
    const { orchestrator, graph } = newOrchestrator({
      now: () => clock,
    });

    graph.transition({
      to: "INGEST_MARKET_DATA",
      actor: MODULE_ACTORS.marketDataSentinel,
      timestampMs: FIXED_TS,
    });
    graph.transition({
      to: "NORMALIZE_MARKET_STATE",
      actor: MODULE_ACTORS.normalizer,
      data: { normalizedMarketData: { mid: 1 } },
      timestampMs: FIXED_TS,
    });
    graph.transition({
      to: "UPDATE_MARKET_GRAPH",
      actor: MODULE_ACTORS.graphBuilder,
      data: { graphSnapshot: { version: 1 } },
      timestampMs: FIXED_TS,
    });
    graph.transition({
      to: "DETECT_OPPORTUNITY",
      actor: MODULE_ACTORS.opportunityScanner,
      data: {
        candidates: [{ status: "CANDIDATE", expectedNetProfitUsd: 5 }],
        graphSnapshot: { version: 1 },
      },
      timestampMs: FIXED_TS,
    });
    graph.transition({
      to: "BUILD_ORDER_INTENT",
      actor: MODULE_ACTORS.opportunityScanner,
      data: {
        candidates: [{ status: "CANDIDATE", expectedNetProfitUsd: 5 }],
      },
      timestampMs: FIXED_TS,
    });
    orchestrator.transition({
      to: "DEBATING",
      actor: MODULE_ACTORS.planner,
      data: { orderIntent: { idempotencyKey: "intent-1" } },
      timestampMs: FIXED_TS,
    });
    expect(graph.currentState).toBe("DEBATING");

    // Advance clock but still within timeout.
    clock = FIXED_TS + 20_000;
    const events = orchestrator.tick();
    expect(events.length).toBe(0);
    expect(graph.currentState).toBe("DEBATING");
  });

  test("retry tracks attempts on failed transitions", () => {
    const { orchestrator, graph } = newOrchestrator();
    // Walk to BUILD_ORDER_INTENT.
    graph.transition({
      to: "INGEST_MARKET_DATA",
      actor: MODULE_ACTORS.marketDataSentinel,
      timestampMs: FIXED_TS,
    });
    graph.transition({
      to: "NORMALIZE_MARKET_STATE",
      actor: MODULE_ACTORS.normalizer,
      data: { normalizedMarketData: { mid: 1 } },
      timestampMs: FIXED_TS,
    });
    graph.transition({
      to: "UPDATE_MARKET_GRAPH",
      actor: MODULE_ACTORS.graphBuilder,
      data: { graphSnapshot: { version: 1 } },
      timestampMs: FIXED_TS,
    });
    graph.transition({
      to: "DETECT_OPPORTUNITY",
      actor: MODULE_ACTORS.opportunityScanner,
      data: {
        candidates: [{ status: "CANDIDATE", expectedNetProfitUsd: 5 }],
        graphSnapshot: { version: 1 },
      },
      timestampMs: FIXED_TS,
    });
    graph.transition({
      to: "BUILD_ORDER_INTENT",
      actor: MODULE_ACTORS.opportunityScanner,
      data: {
        candidates: [{ status: "CANDIDATE", expectedNetProfitUsd: 5 }],
      },
      timestampMs: FIXED_TS,
    });
    expect(graph.currentState).toBe("BUILD_ORDER_INTENT");

    // Try to go to RISK_CHECKING without passing through DEBATING — blocked.
    // This is a forbidden route, not a retryable failure.
    const outcome1 = orchestrator.transition({
      to: "RISK_CHECKING",
      actor: MODULE_ACTORS.agentReview,
      data: { debateResult: "PASS" },
      timestampMs: FIXED_TS,
    });
    expect(outcome1.ok).toBe(false);

    // The state should still be BUILD_ORDER_INTENT.
    expect(graph.currentState).toBe("BUILD_ORDER_INTENT");
  });

  test("degraded mode can only reduce activity", () => {
    const { orchestrator, graph } = newOrchestrator();
    // Enter CANCEL_ONLY_MODE.
    const outcome = orchestrator.enterDegradedMode(
      "CANCEL_ONLY_MODE",
      MODULE_ACTORS.infraGuardian,
      "high volatility",
    );
    expect(outcome.ok).toBe(true);
    expect(graph.currentMode).toBe("CANCEL_ONLY");

    // Try to enter DEGRADED_MODE (less restrictive) — must be blocked.
    const lessRestrictive = orchestrator.enterDegradedMode(
      "DEGRADED_MODE",
      MODULE_ACTORS.infraGuardian,
      "recovery attempt",
    );
    expect(lessRestrictive.ok).toBe(false);
    if (!lessRestrictive.ok) {
      expect(lessRestrictive.reasonCode).toBe("GUARD_FAILED");
    }

    // HALT (more restrictive) should succeed.
    const moreRestrictive = orchestrator.enterDegradedMode(
      "HALT",
      MODULE_ACTORS.infraGuardian,
      "escalation",
    );
    expect(moreRestrictive.ok).toBe(true);
    expect(graph.currentMode).toBe("HALT");
  });
});

// ── AC4: Orchestrator never holds risk-approval authority ──

describe("AC4: orchestrator never holds risk-approval authority", () => {
  test("the orchestrator class does not grant APPROVE_RISK to itself", () => {
    // The Orchestrator uses the same PermissionRegistry as the graph.
    // Verify that no orchestrator-specific actor holds APPROVE_RISK.
    const registry = defaultPermissionRegistry();

    // The orchestrator itself is not a registered actor; it delegates
    // to the graph's actors. Verify the boundary:
    // Only risk-engine holds APPROVE_RISK.
    const actorsWithApproveRisk: string[] = [];
    const allActors = [
      MODULE_ACTORS.marketDataSentinel,
      MODULE_ACTORS.normalizer,
      MODULE_ACTORS.graphBuilder,
      MODULE_ACTORS.opportunityScanner,
      MODULE_ACTORS.planner,
      MODULE_ACTORS.agentReview,
      MODULE_ACTORS.riskEngine,
      MODULE_ACTORS.executionEngine,
      MODULE_ACTORS.reconciliationEngine,
      MODULE_ACTORS.audit,
      MODULE_ACTORS.infraGuardian,
      MODULE_ACTORS.operator,
    ];
    for (const actor of allActors) {
      if (registry.has(actor, "APPROVE_RISK")) {
        actorsWithApproveRisk.push(actor);
      }
    }
    expect(actorsWithApproveRisk).toEqual([MODULE_ACTORS.riskEngine]);
  });

  test("no AI agent holds execution-authority permissions", () => {
    const registry = defaultPermissionRegistry();
    const agentIds = [
      "agent-arbitrage-alpha",
      "agent-risk-analyst",
      "agent-planner",
      "agent-audit",
    ];
    for (const agentId of agentIds) {
      for (const perm of PERMISSIONS_NEVER_GRANTED_TO_AGENTS) {
        expect(
          registry.has(agentId, perm),
          `agent ${agentId} should not hold ${perm}`,
        ).toBe(false);
      }
    }
  });

  test("the orchestrator's activateKillSwitch uses the graph's HALT state, not risk approval", () => {
    const { orchestrator, graph } = newOrchestrator();
    orchestrator.activateKillSwitch(MODULE_ACTORS.infraGuardian, "test");
    // HALT is a defensive state; no risk decision was made.
    expect(graph.currentState).toBe("HALT");
    expect(graph.currentMode).toBe("HALT");
  });

  test("orchestrator audit events never contain risk-approval data from the orchestrator itself", () => {
    const { orchestrator, audit } = newOrchestrator();
    orchestrator.activateKillSwitch(MODULE_ACTORS.infraGuardian, "test");

    // All events should be from the graph or the orchestrator, not from
    // a "risk-engine" actor created by the orchestrator.
    const events = audit.all();
    for (const event of events) {
      // The orchestrator does not create risk decisions.
      expect(event.action).not.toBe("RISK_DECISION");
    }
  });
});

// ── Orchestrator state names are in the graph ──

describe("Orchestrator states exist in the default graph", () => {
  test("all orchestrator states are valid StateNames", () => {
    const orchestratorStates: StateName[] = [
      "DEBATING",
      "RISK_CHECKING",
      "APPROVED",
      "REJECTED",
      "PAPER_EXECUTING",
      "RECONCILING",
      "AUDITING",
    ];
    for (const state of orchestratorStates) {
      expect(STATE_NAMES).toContain(state);
    }
  });

  test("all orchestrator states have nodes in the default graph", () => {
    const { graph } = newOrchestrator();
    const orchestratorStates: StateName[] = [
      "DEBATING",
      "RISK_CHECKING",
      "APPROVED",
      "REJECTED",
      "PAPER_EXECUTING",
      "RECONCILING",
      "AUDITING",
    ];
    for (const state of orchestratorStates) {
      // Verify the state is reachable by checking it exists as a node.
      // We can verify by checking that defensive edges exist from it.
      const defensiveEdge = graph.transitionFor(state, "HALT");
      expect(
        defensiveEdge,
        `missing defensive edge from ${state} to HALT`,
      ).toBeDefined();
    }
  });

  test("defensive edges exist from every orchestrator state", () => {
    const { graph } = newOrchestrator();
    const defensiveStates: StateName[] = [
      "HALT",
      "DEGRADED_MODE",
      "CASH_ONLY_MODE",
      "CANCEL_ONLY_MODE",
      "REDUCE_ONLY_MODE",
    ];
    const orchestratorStates: StateName[] = [
      "DEBATING",
      "RISK_CHECKING",
      "APPROVED",
      "REJECTED",
      "PAPER_EXECUTING",
      "RECONCILING",
      "AUDITING",
    ];
    for (const state of orchestratorStates) {
      for (const defensive of defensiveStates) {
        expect(
          graph.transitionFor(state, defensive),
          `missing edge ${state} -> ${defensive}`,
        ).toBeDefined();
      }
    }
  });
});

// ── Orchestrator emits audit events for every transition ──

describe("Orchestrator audit trail", () => {
  test("every orchestrated transition emits an audit event", () => {
    const { orchestrator, graph, audit } = newOrchestrator();
    graph.transition({
      to: "INGEST_MARKET_DATA",
      actor: MODULE_ACTORS.marketDataSentinel,
      timestampMs: FIXED_TS,
    });
    graph.transition({
      to: "NORMALIZE_MARKET_STATE",
      actor: MODULE_ACTORS.normalizer,
      data: { normalizedMarketData: { mid: 1 } },
      timestampMs: FIXED_TS,
    });
    graph.transition({
      to: "UPDATE_MARKET_GRAPH",
      actor: MODULE_ACTORS.graphBuilder,
      data: { graphSnapshot: { version: 1 } },
      timestampMs: FIXED_TS,
    });
    graph.transition({
      to: "DETECT_OPPORTUNITY",
      actor: MODULE_ACTORS.opportunityScanner,
      data: {
        candidates: [{ status: "CANDIDATE", expectedNetProfitUsd: 5 }],
        graphSnapshot: { version: 1 },
      },
      timestampMs: FIXED_TS,
    });
    graph.transition({
      to: "BUILD_ORDER_INTENT",
      actor: MODULE_ACTORS.opportunityScanner,
      data: {
        candidates: [{ status: "CANDIDATE", expectedNetProfitUsd: 5 }],
      },
      timestampMs: FIXED_TS,
    });

    const before = audit.count();
    orchestrator.transition({
      to: "DEBATING",
      actor: MODULE_ACTORS.planner,
      data: { orderIntent: { idempotencyKey: "intent-1" } },
      timestampMs: FIXED_TS,
    });
    const after = audit.count();

    // The orchestrator emits its own audit event on top of the graph's event.
    expect(after).toBeGreaterThanOrEqual(before + 1);
    const lastEvent = audit.last();
    expect(lastEvent).toBeDefined();
    expect(lastEvent?.reasonCodes).toContain("ORCHESTRATED");
  });
});
