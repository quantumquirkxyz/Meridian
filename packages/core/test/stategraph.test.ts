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
    const steps: Array<[StateName, string, Record<string, unknown>]> = [
      ["INGEST_MARKET_DATA", MODULE_ACTORS.marketDataSentinel, { source: "bybit" }],
      ["NORMALIZE_MARKET_STATE", MODULE_ACTORS.normalizer, { normalizedMarketData: { mid: 1 } }],
      ["UPDATE_MARKET_GRAPH", MODULE_ACTORS.graphBuilder, { graphSnapshot: { version: 1 } }],
      ["DETECT_OPPORTUNITY", MODULE_ACTORS.opportunityScanner, { candidates: [{ status: "CANDIDATE" }] }],
      ["BUILD_ORDER_INTENT", MODULE_ACTORS.opportunityScanner, { candidates: [{ status: "CANDIDATE" }] }],
    ];
    for (const [to, actor, data] of steps) {
      const outcome = graph.transition({ to, actor, data, timestampMs: 0 });
      expect(outcome.ok, `expected ${to} to be reachable`).toBe(true);
    }
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
    const steps: Array<[StateName, string, Record<string, unknown>]> = [
      ["INGEST_MARKET_DATA", MODULE_ACTORS.marketDataSentinel, { source: "bybit" }],
      ["NORMALIZE_MARKET_STATE", MODULE_ACTORS.normalizer, { normalizedMarketData: { mid: 1 } }],
      ["UPDATE_MARKET_GRAPH", MODULE_ACTORS.graphBuilder, { graphSnapshot: { version: 1 } }],
      ["DETECT_OPPORTUNITY", MODULE_ACTORS.opportunityScanner, { candidates: [{ status: "CANDIDATE" }] }],
      ["BUILD_ORDER_INTENT", MODULE_ACTORS.opportunityScanner, { candidates: [{ status: "CANDIDATE" }] }],
      ["REQUEST_AGENT_REVIEW", MODULE_ACTORS.planner, { orderIntent: {} }],
      ["RISK_VALIDATE", MODULE_ACTORS.agentReview, { agentReview: "PASS" }],
    ];
    for (const [to, actor, data] of steps) {
      const outcome = graph.transition({ to, actor, data, timestampMs: 0 });
      expect(outcome.ok, `expected ${to} reachable`).toBe(true);
    }

    // REJECT keeps the cycle away from execution.
    const rejected = graph.transition({
      to: "AUDIT_DECISION",
      actor: MODULE_ACTORS.riskEngine,
      data: { riskDecisionOutcome: "REJECT" },
      timestampMs: 0,
    });
    expect(rejected.ok).toBe(true);

    // Reset and try APPROVE -> execution path.
    graph.reset();
    for (const [to, actor, data] of steps) {
      expect(
        graph.transition({ to, actor, data, timestampMs: 0 }).ok,
      ).toBe(true);
    }
    const approved = graph.transition({
      to: "EXECUTION_PRECHECK",
      actor: MODULE_ACTORS.riskEngine,
      data: { riskDecisionOutcome: "APPROVE" },
      timestampMs: 0,
    });
    expect(approved.ok).toBe(true);
  });
});

describe("defensive modes reachable from any state and reduce activity (issue #13 AC2)", () => {
  test("defensive edges exist from every state", () => {
    const { graph } = newGraph();
    for (const state of STATE_NAMES) {
      for (const defensive of DEFENSIVE_STATES) {
        expect(
          graph.transitionFor(state, defensive),
          `missing edge ${state} -> ${defensive}`,
        ).toBeDefined();
      }
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