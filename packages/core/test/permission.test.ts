import { describe, expect, test } from "bun:test";
import { PERMISSIONS_NEVER_GRANTED_TO_AGENTS } from "@agenttrading/contracts";
import { AuditLog } from "../src/stategraph/audit-log.ts";
import { StateGraph } from "../src/stategraph/state-graph.ts";
import {
  assertNoAgentHoldsExecutionPermissions,
  agentsHoldingExecutionPermissions,
  PermissionRegistry,
} from "../src/stategraph/permission-registry.ts";
import {
  AGENT_IDS,
  buildDefaultGraph,
  defaultPermissionRegistry,
  MODULE_ACTORS,
} from "../src/stategraph/topology.ts";
import { walkToRiskValidate } from "./helpers.ts";

describe("permission model (ADR-0003, user story 28)", () => {
  test("no agent holds any execution-authority permission", () => {
    const registry = defaultPermissionRegistry();
    expect(agentsHoldingExecutionPermissions(registry, AGENT_IDS)).toEqual([]);
    expect(() =>
      assertNoAgentHoldsExecutionPermissions(registry, AGENT_IDS),
    ).not.toThrow();
  });

  test("execution permissions live only on deterministic engines/operator", () => {
    const registry = defaultPermissionRegistry();
    expect(registry.has(MODULE_ACTORS.riskEngine, "APPROVE_RISK")).toBe(true);
    expect(registry.has(MODULE_ACTORS.executionEngine, "SUBMIT_ORDER")).toBe(
      true,
    );
    expect(registry.has(MODULE_ACTORS.riskEngine, "SUBMIT_ORDER")).toBe(false);
    for (const agent of AGENT_IDS) {
      for (const permission of PERMISSIONS_NEVER_GRANTED_TO_AGENTS) {
        expect(registry.has(agent, permission)).toBe(false);
      }
    }
  });

  test("the boundary is enforced at runtime: agents cannot be granted execution permissions", () => {
    const registry = defaultPermissionRegistry();
    expect(() =>
      registry.register("agent-planner", ["APPROVE_RISK"]),
    ).toThrow();
    expect(() => registry.grant("agent-planner", "SUBMIT_ORDER")).toThrow();
    // Modules/engines are unaffected.
    expect(() =>
      registry.register(MODULE_ACTORS.riskEngine, ["APPROVE_RISK"]),
    ).not.toThrow();
  });

  test("a structurally-violating registry is detected", () => {
    // A registry built without its agent ids cannot prevent the violation, so
    // the assertion helpers still catch it (belt and braces).
    const registry = new PermissionRegistry([]);
    registry.grant("agent-planner", "APPROVE_RISK");
    expect(
      agentsHoldingExecutionPermissions(registry, ["agent-planner"]),
    ).toEqual(["agent-planner"]);
    expect(() =>
      assertNoAgentHoldsExecutionPermissions(registry, AGENT_IDS),
    ).toThrow();
  });
});

describe("per-transition permission checks (issue #13)", () => {
  function newGraph(): StateGraph {
    const { nodes, transitions } = buildDefaultGraph();
    return new StateGraph({
      nodes,
      transitions,
      permissions: defaultPermissionRegistry(),
      audit: new AuditLog(),
      now: () => 0,
    });
  }

  test("a transition requires its actor to hold the edge permissions", () => {
    const graph = newGraph();
    // agent-audit observes audit only; it cannot start ingestion.
    const denied = graph.transition({
      to: "INGEST_MARKET_DATA",
      actor: "agent-audit",
      timestampMs: 0,
    });
    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(denied.reasonCode).toBe("PERMISSION_DENIED");
      expect(denied.event.reasonCodes).toContain("PERMISSION_DENIED");
    }

    const allowed = graph.transition({
      to: "INGEST_MARKET_DATA",
      actor: MODULE_ACTORS.marketDataSentinel,
      timestampMs: 0,
    });
    expect(allowed.ok).toBe(true);
  });

  test("an agent cannot drive the risk gate (no APPROVE_RISK)", () => {
    const graph = newGraph();
    walkToRiskValidate(graph);

    const denied = graph.transition({
      to: "EXECUTION_PRECHECK",
      actor: "agent-risk-analyst",
      data: { riskDecisionOutcome: "APPROVE" },
      timestampMs: 0,
    });
    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(denied.reasonCode).toBe("PERMISSION_DENIED");
    }
  });
});
