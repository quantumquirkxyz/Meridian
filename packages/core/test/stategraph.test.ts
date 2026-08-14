import { describe, expect, test } from "bun:test";
import {
  isAuditEvent,
  STATE_NAMES,
  type StateName,
  type SystemMode,
} from "@agenttrading/contracts";
import { AuditLog } from "../src/stategraph/audit-log.ts";
import { StateGraph } from "../src/stategraph/state-graph.ts";
import {
  buildDefaultGraph,
  defaultPermissionRegistry,
  DEFENSIVE_STATES,
  DEFENSIVE_STATE_MODE,
  MODULE_ACTORS,
} from "../src/stategraph/topology.ts";
import { walkToBuildIntent, walkToRiskValidate } from "./helpers.ts";

const FIXED_TS = 1_700_000_000_000;

function newGraph(options?: {
  initialState?: StateName;
  initialMode?: SystemMode;
}): { graph: StateGraph; audit: AuditLog } {
  const { nodes, transitions } = buildDefaultGraph();
  const audit = new AuditLog();
  const graph = new StateGraph({
    nodes,
    transitions,
    permissions: defaultPermissionRegistry(),
    audit,
    now: () => FIXED_TS,
    initialState: options?.initialState,
    initialMode: options?.initialMode,
  });
  return { graph, audit };
}

describe("StateGraph guards and transitions (issue #13 AC1)", () => {
  test("walks the canonical flow from IDLE to AUDIT_DECISION", () => {
    const { graph } = newGraph();
    walkToBuildIntent(graph);
    expect(graph.currentState).toBe("BUILD_ORDER_INTENT");
  });

  test("rejects a transition with no defined edge (invalid transition)", () => {
    const { graph, audit } = newGraph();
    const outcome = graph.transition({
      to: "EXECUTE_ORDER",
      actor: MODULE_ACTORS.riskEngine,
      timestampMs: 0,
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reasonCode).toBe("INVALID_TRANSITION");
    }
    const event = audit.last();
    expect(event?.action).toBe("STATE_TRANSITION");
    expect(event?.reasonCodes).toContain("INVALID_TRANSITION");
    expect(event?.reasonCodes).toContain("TRANSITION_BLOCKED");
  });

  test("guard on normalize->update-graph requires normalized handoff data", () => {
    const { graph } = newGraph();
    graph.transition({
      to: "INGEST_MARKET_DATA",
      actor: MODULE_ACTORS.marketDataSentinel,
      timestampMs: 0,
    });
    graph.transition({
      to: "NORMALIZE_MARKET_STATE",
      actor: MODULE_ACTORS.normalizer,
      timestampMs: 0,
    });
    const outcome = graph.transition({
      to: "UPDATE_MARKET_GRAPH",
      actor: MODULE_ACTORS.graphBuilder,
      timestampMs: 0,
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reasonCode).toBe("GUARD_FAILED");
    }
  });

  test("guarded fork: only APPROVE leaves RISK_VALIDATE towards execution", () => {
    const { graph } = newGraph();
    walkToRiskValidate(graph);

    // REJECT (with a complete risk decision record) keeps the cycle away from execution.
    const rejected = graph.transition({
      to: "AUDIT_DECISION",
      actor: MODULE_ACTORS.riskEngine,
      data: {
        riskDecisionOutcome: "REJECT",
        riskDecision: {
          decision: "REJECT",
          orderIntentIdempotencyKey: "intent-1",
          evaluatedAtMs: 0,
          reasonCodes: ["MIN_EDGE"],
        },
      },
      timestampMs: 0,
    });
    expect(rejected.ok).toBe(true);

    // Reset and try APPROVE -> execution path.
    graph.reset();
    walkToRiskValidate(graph);
    const approved = graph.transition({
      to: "EXECUTION_PRECHECK",
      actor: MODULE_ACTORS.riskEngine,
      data: {
        riskDecisionOutcome: "APPROVE",
        riskDecision: {
          decision: "APPROVE",
          orderIntentIdempotencyKey: "intent-1",
          evaluatedAtMs: 0,
          approvedSize: 0.01,
          approvedLimits: { maxSlippageBps: 30 },
          expiresAtMs: 60_000,
        },
      },
      timestampMs: 0,
    });
    expect(approved.ok).toBe(true);
  });

  test("an OrderIntent cannot pass RISK_VALIDATE without a risk decision", () => {
    const { graph } = newGraph();
    walkToRiskValidate(graph);

    // No risk decision at all -> blocked before execution.
    const missing = graph.transition({
      to: "EXECUTION_PRECHECK",
      actor: MODULE_ACTORS.riskEngine,
      timestampMs: 0,
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.reasonCode).toBe("GUARD_FAILED");
    }

    // A bare hand-written outcome string without the full RiskDecision record
    // is also blocked: the gate must be enforced structurally, not by convention.
    const forged = graph.transition({
      to: "EXECUTION_PRECHECK",
      actor: MODULE_ACTORS.riskEngine,
      data: { riskDecisionOutcome: "APPROVE" },
      timestampMs: 0,
    });
    expect(forged.ok).toBe(false);
    if (!forged.ok) {
      expect(forged.reasonCode).toBe("GUARD_FAILED");
    }

    // A forged decision record that echoes the outcome but lacks the approval
    // payload (approvedSize/approvedLimits/expiresAtMs) is also rejected by
    // the contracts isRiskDecision guard.
    const forgedRecord = graph.transition({
      to: "EXECUTION_PRECHECK",
      actor: MODULE_ACTORS.riskEngine,
      data: { riskDecisionOutcome: "APPROVE", riskDecision: { decision: "APPROVE" } },
      timestampMs: 0,
    });
    expect(forgedRecord.ok).toBe(false);
    if (!forgedRecord.ok) {
      expect(forgedRecord.reasonCode).toBe("GUARD_FAILED");
    }
  });

  test("defensive risk decisions route to audit, never to execution", () => {
    const { graph } = newGraph();
    walkToRiskValidate(graph);

    // A defensive decision (CANCEL_ONLY, valid per the contract) is a rejection:
    // execution is unreachable but the decision is recorded through risk-to-audit.
    const defensive: Record<string, unknown> = {
      decision: "CANCEL_ONLY",
      orderIntentIdempotencyKey: "intent-1",
      evaluatedAtMs: 0,
      reasonCodes: ["DEGRADED_MODE"],
    };
    const toExecution = graph.transition({
      to: "EXECUTION_PRECHECK",
      actor: MODULE_ACTORS.riskEngine,
      data: { riskDecisionOutcome: "CANCEL_ONLY", riskDecision: defensive },
      timestampMs: 0,
    });
    expect(toExecution.ok).toBe(false);
    if (!toExecution.ok) {
      expect(toExecution.reasonCode).toBe("GUARD_FAILED");
    }

    graph.reset();
    walkToRiskValidate(graph);
    const toAudit = graph.transition({
      to: "AUDIT_DECISION",
      actor: MODULE_ACTORS.riskEngine,
      data: { riskDecisionOutcome: "CANCEL_ONLY", riskDecision: defensive },
      timestampMs: 0,
    });
    expect(toAudit.ok).toBe(true);
  });

  test("an expired approval is void at precheck-to-execute", () => {
    const { graph } = newGraph();
    walkToRiskValidate(graph);

    // Approve with an already-expired expiry; entering the precheck is fine,
    // but executing on it is void (RISK.md:63 "an approval past expiry is void").
    const expired = {
      decision: "APPROVE",
      orderIntentIdempotencyKey: "intent-1",
      evaluatedAtMs: 0,
      approvedSize: 0.01,
      approvedLimits: { maxSlippageBps: 30 },
      expiresAtMs: 0,
    };
    const toPrecheck = graph.transition({
      to: "EXECUTION_PRECHECK",
      actor: MODULE_ACTORS.riskEngine,
      data: { riskDecisionOutcome: "APPROVE", riskDecision: expired },
      timestampMs: 0,
    });
    expect(toPrecheck.ok).toBe(true);

    const toExecute = graph.transition({
      to: "EXECUTE_ORDER",
      actor: MODULE_ACTORS.executionEngine,
      data: { precheck: "PASS" },
      timestampMs: 1_000,
    });
    expect(toExecute.ok).toBe(false);
    if (!toExecute.ok) {
      expect(toExecute.reasonCode).toBe("GUARD_FAILED");
    }
    expect(graph.currentState).toBe("EXECUTION_PRECHECK");
  });

  test("expiry is judged by the clock, not a stale caller timestamp", () => {
    const { graph } = newGraph();
    walkToRiskValidate(graph);

    // Expired by the injectable clock (now() = FIXED_TS), but the caller
    // forwards a stale past timestamp that the old code would have trusted.
    const decision = {
      decision: "APPROVE",
      orderIntentIdempotencyKey: "intent-1",
      evaluatedAtMs: 0,
      approvedSize: 0.01,
      approvedLimits: { maxSlippageBps: 30 },
      expiresAtMs: FIXED_TS - 1,
    };
    const toPrecheck = graph.transition({
      to: "EXECUTION_PRECHECK",
      actor: MODULE_ACTORS.riskEngine,
      data: { riskDecisionOutcome: "APPROVE", riskDecision: decision },
      timestampMs: FIXED_TS - 10_000,
    });
    expect(toPrecheck.ok).toBe(true);

    const toExecute = graph.transition({
      to: "EXECUTE_ORDER",
      actor: MODULE_ACTORS.executionEngine,
      data: { precheck: "PASS" },
      timestampMs: FIXED_TS - 10_000,
    });
    expect(toExecute.ok).toBe(false);
    if (!toExecute.ok) {
      expect(toExecute.reasonCode).toBe("GUARD_FAILED");
    }
  });

  test("a failed precheck aborts to AUDIT_DECISION, never stranding", () => {
    const { graph } = newGraph();
    walkToRiskValidate(graph);

    const toPrecheck = graph.transition({
      to: "EXECUTION_PRECHECK",
      actor: MODULE_ACTORS.riskEngine,
      data: {
        riskDecisionOutcome: "APPROVE",
        riskDecision: {
          decision: "APPROVE",
          orderIntentIdempotencyKey: "intent-1",
          evaluatedAtMs: 0,
          approvedSize: 0.01,
          approvedLimits: { maxSlippageBps: 30 },
          expiresAtMs: 60_000,
        },
      },
      timestampMs: 0,
    });
    expect(toPrecheck.ok).toBe(true);

    const aborted = graph.transition({
      to: "AUDIT_DECISION",
      actor: MODULE_ACTORS.executionEngine,
      data: { precheck: "FAILED" },
      timestampMs: 0,
    });
    expect(aborted.ok).toBe(true);
    expect(graph.currentState).toBe("AUDIT_DECISION");
  });

  test("a failed reconciliation still reaches AUDIT_DECISION", () => {
    const { graph } = newGraph();
    walkToRiskValidate(graph);

    const approve = {
      decision: "APPROVE",
      orderIntentIdempotencyKey: "intent-1",
      evaluatedAtMs: 0,
      approvedSize: 0.01,
      approvedLimits: { maxSlippageBps: 30 },
      expiresAtMs: FIXED_TS + 60_000,
    };
    const toPrecheck = graph.transition({
      to: "EXECUTION_PRECHECK",
      actor: MODULE_ACTORS.riskEngine,
      data: { riskDecisionOutcome: "APPROVE", riskDecision: approve },
      timestampMs: 0,
    });
    expect(toPrecheck.ok).toBe(true);
    const toExecute = graph.transition({
      to: "EXECUTE_ORDER",
      actor: MODULE_ACTORS.executionEngine,
      data: { precheck: "PASS", executedSize: 0.01 },
      timestampMs: 0,
    });
    expect(toExecute.ok).toBe(true);
    const toReconcile = graph.transition({
      to: "RECONCILE",
      actor: MODULE_ACTORS.executionEngine,
      data: { execution: "SIMULATED_FILL" },
      timestampMs: 0,
    });
    expect(toReconcile.ok).toBe(true);

    const reconciled = graph.transition({
      to: "AUDIT_DECISION",
      actor: MODULE_ACTORS.reconciliationEngine,
      data: { reconciliation: "FAILED" },
      timestampMs: 0,
    });
    expect(reconciled.ok).toBe(true);
    expect(graph.currentState).toBe("AUDIT_DECISION");
  });
});

describe("defensive modes reachable from any state and reduce activity (issue #13 AC2)", () => {
  test("defensive edges exist from every state (no self-loops)", () => {
    const { graph } = newGraph();
    for (const state of STATE_NAMES) {
      for (const defensive of DEFENSIVE_STATES) {
        if (state === defensive) continue;
        expect(
          graph.transitionFor(state, defensive),
          `missing edge ${state} -> ${defensive}`,
        ).toBeDefined();
      }
    }
    // A defensive self-loop would re-emit DEFENSIVE_MODE_ENTERED / MODE_REDUCED
    // without reducing activity, so no defensive state has one.
    for (const defensive of DEFENSIVE_STATES) {
      expect(
        graph.transitionFor(defensive, defensive),
        `unexpected self-loop ${defensive} -> ${defensive}`,
      ).toBeUndefined();
    }
  });

  test("entering every defensive mode from IDLE succeeds and reduces the mode", () => {
    for (const defensive of DEFENSIVE_STATES) {
      const { graph } = newGraph();
      const outcome = graph.transition({
        to: defensive,
        actor: MODULE_ACTORS.infraGuardian,
        timestampMs: 0,
      });
      expect(outcome.ok, `expected ${defensive} reachable from IDLE`).toBe(true);
      expect(graph.currentState).toBe(defensive);
      expect(graph.currentMode).toBe(DEFENSIVE_STATE_MODE[defensive]);
    }
  });

  test("HALT is reachable from a deep state", () => {
    const { graph } = newGraph();
    graph.transition({
      to: "INGEST_MARKET_DATA",
      actor: MODULE_ACTORS.marketDataSentinel,
      timestampMs: 0,
    });
    const outcome = graph.transition({
      to: "HALT",
      actor: MODULE_ACTORS.infraGuardian,
      timestampMs: 0,
    });
    expect(outcome.ok).toBe(true);
    expect(graph.currentMode).toBe("HALT");
  });

  test("fail closed: cannot move from HALT to a less restrictive defensive state", () => {
    const { graph } = newGraph();
    graph.transition({
      to: "HALT",
      actor: MODULE_ACTORS.infraGuardian,
      timestampMs: 0,
    });
    const outcome = graph.transition({
      to: "DEGRADED_MODE",
      actor: MODULE_ACTORS.infraGuardian,
      timestampMs: 0,
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reasonCode).toBe("GUARD_FAILED");
    }
    expect(graph.currentState).toBe("HALT");
  });

  test("a defensive mode blocks signal generation (activity reduced)", () => {
    const { graph } = newGraph({ initialMode: "CANCEL_ONLY" });
    expect(
      graph.transition({
        to: "INGEST_MARKET_DATA",
        actor: MODULE_ACTORS.marketDataSentinel,
        timestampMs: 0,
      }).ok,
    ).toBe(true);
    expect(
      graph.transition({
        to: "NORMALIZE_MARKET_STATE",
        actor: MODULE_ACTORS.normalizer,
        data: { normalizedMarketData: { mid: 1 } },
        timestampMs: 0,
      }).ok,
    ).toBe(true);
    expect(
      graph.transition({
        to: "UPDATE_MARKET_GRAPH",
        actor: MODULE_ACTORS.graphBuilder,
        data: { graphSnapshot: { version: 1 } },
        timestampMs: 0,
      }).ok,
    ).toBe(true);
    const blocked = graph.transition({
      to: "DETECT_OPPORTUNITY",
      actor: MODULE_ACTORS.opportunityScanner,
      timestampMs: 0,
    });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.reasonCode).toBe("GUARD_FAILED");
    }
  });

  test("HALT blocks even the observation cycle start", () => {
    const { graph } = newGraph({ initialMode: "HALT" });
    const outcome = graph.transition({
      to: "INGEST_MARKET_DATA",
      actor: MODULE_ACTORS.marketDataSentinel,
      timestampMs: 0,
    });
    expect(outcome.ok).toBe(false);
  });

  test("leaving a defensive mode requires an operator reset", () => {
    const { graph } = newGraph();
    graph.transition({
      to: "CASH_ONLY_MODE",
      actor: MODULE_ACTORS.infraGuardian,
      timestampMs: 0,
    });
    const refused = graph.transition({
      to: "IDLE",
      actor: MODULE_ACTORS.operator,
      timestampMs: 0,
    });
    expect(refused.ok).toBe(false);

    const reset = graph.transition({
      to: "IDLE",
      actor: MODULE_ACTORS.operator,
      data: { operatorReset: true },
      timestampMs: 0,
    });
    expect(reset.ok).toBe(true);
    expect(graph.currentState).toBe("IDLE");
    expect(graph.currentMode).toBe("NORMAL");
  });

  test("a defensive mode entered mid-flow blocks subsequent execution steps", () => {
    const { graph } = newGraph();
    walkToBuildIntent(graph);
    expect(graph.currentState).toBe("BUILD_ORDER_INTENT");

    // Infra-guardian pulls the flow into a defensive mode mid-cycle.
    const entered = graph.transition({
      to: "CANCEL_ONLY_MODE",
      actor: MODULE_ACTORS.infraGuardian,
      timestampMs: 0,
    });
    expect(entered.ok).toBe(true);
    expect(graph.currentMode).toBe("CANCEL_ONLY");

    // Execution is unreachable from the defensive state, and recovery needs an
    // operator reset: activity is demonstrably reduced.
    expect(
      graph.transition({
        to: "EXECUTION_PRECHECK",
        actor: MODULE_ACTORS.riskEngine,
        timestampMs: 0,
      }).ok,
    ).toBe(false);
    expect(
      graph.transition({
        to: "EXECUTE_ORDER",
        actor: MODULE_ACTORS.executionEngine,
        timestampMs: 0,
      }).ok,
    ).toBe(false);
    expect(
      graph.transition({
        to: "IDLE",
        actor: MODULE_ACTORS.operator,
        timestampMs: 0,
      }).ok,
    ).toBe(false);
    expect(
      graph.transition({
        to: "IDLE",
        actor: MODULE_ACTORS.operator,
        data: { operatorReset: true },
        timestampMs: 0,
      }).ok,
    ).toBe(true);
  });
});

describe("audit per transition (issue #13 AC3)", () => {
  test("every accepted transition emits an AuditEvent with reason codes", () => {
    const { graph, audit } = newGraph();
    graph.transition({
      to: "INGEST_MARKET_DATA",
      actor: MODULE_ACTORS.marketDataSentinel,
      timestampMs: 0,
    });
    graph.transition({
      to: "NORMALIZE_MARKET_STATE",
      actor: MODULE_ACTORS.normalizer,
      timestampMs: 0,
    });
    const events = audit.transitions();
    expect(events.length).toBe(2);
    for (const event of events) {
      expect(event.action).toBe("STATE_TRANSITION");
      expect(event.reasonCodes?.length ?? 0).toBeGreaterThan(0);
      expect(event.reasonCodes).toContain("TRANSITION_ALLOWED");
    }
  });

  test("blocked attempts are audited too, with their reason codes", () => {
    const { graph, audit } = newGraph();
    graph.transition({
      to: "HALT",
      actor: MODULE_ACTORS.infraGuardian,
      timestampMs: 0,
    });
    const blocked = graph.transition({
      to: "DEGRADED_MODE",
      actor: MODULE_ACTORS.infraGuardian,
      timestampMs: 0,
    });
    expect(blocked.ok).toBe(false);
    const event = audit.last();
    expect(event?.reasonCodes).toContain("TRANSITION_BLOCKED");
    expect(event?.reasonCodes).toContain("GUARD_FAILED");
  });

  test("entering a defensive mode is audited with defensive reason codes", () => {
    const { graph, audit } = newGraph();
    graph.transition({
      to: "DEGRADED_MODE",
      actor: MODULE_ACTORS.infraGuardian,
      timestampMs: 0,
    });
    const event = audit.last();
    expect(event?.reasonCodes).toContain("DEFENSIVE_MODE_ENTERED");
    expect(event?.reasonCodes).toContain("MODE_REDUCED");
  });

  test("transition events expose the resulting SystemMode (US27)", () => {
    const { graph, audit } = newGraph();
    graph.transition({
      to: "DEGRADED_MODE",
      actor: MODULE_ACTORS.infraGuardian,
      timestampMs: 0,
    });
    const event = audit.last();
    expect(event?.action).toBe("STATE_TRANSITION");
    expect((event?.data as { mode?: string } | undefined)?.mode).toBe(
      "OBSERVE_ONLY",
    );

    // A blocked attempt records the current (unchanged) mode too.
    graph.transition({
      to: "EXECUTE_ORDER",
      actor: MODULE_ACTORS.executionEngine,
      timestampMs: 0,
    });
    const blocked = audit.last();
    expect((blocked?.data as { mode?: string } | undefined)?.mode).toBe(
      "OBSERVE_ONLY",
    );
  });

  test("sequence numbers are monotonic and events are valid AuditEvents", () => {
    const { graph, audit } = newGraph();
    for (const to of [
      "INGEST_MARKET_DATA",
      "NORMALIZE_MARKET_STATE",
      "HALT",
    ] as StateName[]) {
      graph.transition({
        to,
        actor: MODULE_ACTORS.marketDataSentinel,
        timestampMs: 0,
      });
    }
    const events = audit.all();
    const sequences = events.map((event) => event.sequence);
    expect([...sequences].sort((a, b) => a - b)).toEqual(sequences);
    expect(events.every(isAuditEvent)).toBe(true);
  });
});