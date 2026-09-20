/**
 * Issue #23 — Permission boundary tests (agents never execute)
 *
 * Explicit structural tests that no AI agent holds APPROVE_RISK,
 * SUBMIT_ORDER, SIGN_TRANSACTION, MOVE_FUNDS, or MODIFY_RISK_LIMITS, and
 * that the StateGraph enforces fail-closed transitions (risk gate, fallbacks).
 *
 * Acceptance criteria:
 * - AC1: A test asserts no agent module holds execution/risk-approval permissions
 * - AC2: Fail-closed behavior is tested for risk-engine, execution, reconciliation,
 *         and audit failures
 * - AC3: Tests run in CI via bun test
 */
import { describe, expect, test } from "bun:test";
import {
  PERMISSIONS_NEVER_GRANTED_TO_AGENTS,
  PERMISSIONS,
  type Permission,
  type StateName,
} from "@agenttrading/contracts";
import {
  assertNoAgentHoldsExecutionPermissions,
  agentsHoldingExecutionPermissions,
  PermissionRegistry,
} from "../src/stategraph/state-graph.ts";
import {
  AGENT_IDS,
  buildDefaultGraph,
  defaultPermissionRegistry,
  DEFENSIVE_STATES,
  MODULE_ACTORS,
} from "../src/stategraph/state-graph.ts";
import {
  CANDIDATE_CYCLE,
  FIXED_TS,
  newGraph,
  RISK_CYCLE,
  walkSteps,
  walkToRiskValidate,
} from "./helpers.ts";

// ---------------------------------------------------------------------------
// AC1: Permission boundary — no agent holds execution/risk-approval perms
// ---------------------------------------------------------------------------

describe("permission boundary (issue #23 AC1 — agents never execute)", () => {
  const FORBIDDEN: readonly Permission[] = PERMISSIONS_NEVER_GRANTED_TO_AGENTS;

  test("PERMISSIONS_NEVER_GRANTED_TO_AGENTS contains exactly the five execution-authority permissions", () => {
    expect(FORBIDDEN).toEqual([
      "APPROVE_RISK",
      "SUBMIT_ORDER",
      "SIGN_TRANSACTION",
      "MOVE_FUNDS",
      "MODIFY_RISK_LIMITS",
    ]);
  });

  test("no agent in AGENT_IDS holds any execution/risk-approval permission", () => {
    const registry = defaultPermissionRegistry();
    const offenders = agentsHoldingExecutionPermissions(registry, AGENT_IDS);
    expect(offenders).toEqual([]);
  });

  test("assertNoAgentHoldsExecutionPermissions passes for the default registry", () => {
    const registry = defaultPermissionRegistry();
    expect(() =>
      assertNoAgentHoldsExecutionPermissions(registry, AGENT_IDS),
    ).not.toThrow();
  });

  test("every agent's permissions are a subset of OBSERVE_* or PROPOSE_* (no execute/triggers)", () => {
    const registry = defaultPermissionRegistry();
    const FORBIDDEN_SET = new Set<string>(FORBIDDEN);

    for (const agentId of AGENT_IDS) {
      for (const perm of PERMISSIONS) {
        if (registry.has(agentId, perm)) {
          expect(
            FORBIDDEN_SET.has(perm),
            `agent ${agentId} holds forbidden permission ${perm}`,
          ).toBe(false);
        }
      }
    }
  });

  test("the runtime boundary prevents granting execution permissions to agents", () => {
    const registry = defaultPermissionRegistry();
    for (const perm of FORBIDDEN) {
      // Existing agent IDs are enforced at runtime: grant() throws.
      expect(() => registry.grant("agent-planner-supervisor", perm)).toThrow();
      expect(() => registry.grant("agent-execution-advisor", perm)).toThrow();
      expect(() => registry.grant("agent-arbitrage-alpha", perm)).toThrow();
    }
    // Modules/engines are unaffected — they are not in the agent set.
    expect(() =>
      registry.register(MODULE_ACTORS.riskEngine, ["APPROVE_RISK"]),
    ).not.toThrow();
  });

  test("a registry constructed without agent ids still detects violations", () => {
    const rogue = new PermissionRegistry([]);
    rogue.grant("rogue-agent", "APPROVE_RISK");
    rogue.grant("rogue-agent", "SUBMIT_ORDER");
    expect(
      agentsHoldingExecutionPermissions(rogue, ["rogue-agent"]),
    ).toEqual(["rogue-agent"]);
    expect(() =>
      assertNoAgentHoldsExecutionPermissions(rogue, ["rogue-agent"]),
    ).toThrow();
  });

  test("deterministic engines hold the permissions agents must never have", () => {
    const registry = defaultPermissionRegistry();
    expect(registry.has(MODULE_ACTORS.riskEngine, "APPROVE_RISK")).toBe(true);
    expect(registry.has(MODULE_ACTORS.executionEngine, "SUBMIT_ORDER")).toBe(true);
    expect(registry.has(MODULE_ACTORS.executionEngine, "SIGN_TRANSACTION")).toBe(true);
  });

  test("issue #28 consultative agents are all present in the permission boundary", () => {
    expect(AGENT_IDS).toEqual([
      "agent-planner-supervisor",
      "agent-arbitrage-alpha",
      "agent-market-regime",
      "agent-bull",
      "agent-bear",
      "agent-skeptic",
      "agent-risk-analyst",
      "agent-execution-advisor",
    ]);
  });

  test("agent-audit is a pure observer: no proposal or execution permissions", () => {
    const registry = defaultPermissionRegistry();
    expect(registry.has("agent-audit", "OBSERVE_AUDIT")).toBe(false);
    expect(registry.has("agent-audit", "OBSERVE_STATE")).toBe(false);
    // Cannot propose or execute
    expect(registry.has("agent-audit", "PROPOSE_SIGNAL")).toBe(false);
    expect(registry.has("agent-audit", "APPROVE_RISK")).toBe(false);
    expect(registry.has("agent-audit", "SUBMIT_ORDER")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC2: Fail-closed behavior tests
// ---------------------------------------------------------------------------

describe("fail-closed: risk-engine failure (issue #23 AC2)", () => {
  test("risk rejection blocks execution: the risk-to-precheck guard rejects non-approval decisions", () => {
    const { graph } = newGraph();
    walkToRiskValidate(graph);

    // Risk engine rejects the opportunity — route to audit, not execution.
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

    // The risk-to-precheck guard requires an approved risk decision;
    // a REJECT decision cannot proceed to execution.
    graph.reset();
    walkToRiskValidate(graph);
    const blocked = graph.transition({
      to: "EXECUTION_PRECHECK",
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
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.reasonCode).toBe("GUARD_FAILED");
    }
    expect(graph.currentState).toBe("RISK_VALIDATE");
  });

  test("HALT mode entered from risk-engine failure blocks execution via the graph", () => {
    // Scenario: risk engine identifies a critical failure and triggers HALT.
    const { graph } = newGraph();
    walkToRiskValidate(graph);

    // Risk engine triggers HALT before any execution can occur.
    const halted = graph.transition({
      to: "HALT",
      actor: MODULE_ACTORS.riskEngine,
      timestampMs: 0,
    });
    expect(halted.ok).toBe(true);
    expect(graph.currentMode).toBe("HALT");
    expect(graph.currentState).toBe("HALT");

    // Execution is unreachable from HALT (mode is HALT, not in EXECUTION_MODES).
    const toPrecheck = graph.transition({
      to: "EXECUTION_PRECHECK",
      actor: MODULE_ACTORS.riskEngine,
      timestampMs: 0,
    });
    expect(toPrecheck.ok).toBe(false);
  });
});

describe("fail-closed: execution failure (issue #23 AC2)", () => {
  /** Walks to EXECUTION_PRECHECK with a valid approval. */
  function walkToPrecheck(graph: import("../src/stategraph/state-graph.ts").StateGraph): void {
    walkToRiskValidate(graph);
    walkSteps(graph, [
      [
        "EXECUTION_PRECHECK",
        MODULE_ACTORS.riskEngine,
        {
          riskDecisionOutcome: "APPROVE",
          riskDecision: {
            decision: "APPROVE",
            orderIntentIdempotencyKey: "intent-1",
            evaluatedAtMs: 0,
            approvedSize: 0.01,
            approvedLimits: { maxSlippageBps: 30 },
            expiresAtMs: FIXED_TS + 60_000,
          },
          expectedNetProfitUsd: 5,
        },
      ],
    ]);
  }

  test("execution failure triggers HALT: infra-guardian enters HALT from EXECUTE_ORDER", () => {
    const { graph } = newGraph();
    walkToPrecheck(graph);

    // Simulate execution (e.g. order was sent but the fill failed).
    const executed = graph.transition({
      to: "EXECUTE_ORDER",
      actor: MODULE_ACTORS.executionEngine,
      data: { precheck: "PASS", execution: "FAILED" },
      timestampMs: 0,
    });
    expect(executed.ok).toBe(true);

    // Infra-guardian detects the execution failure and enters HALT.
    const halted = graph.transition({
      to: "HALT",
      actor: MODULE_ACTORS.infraGuardian,
      timestampMs: 0,
    });
    expect(halted.ok).toBe(true);
    expect(graph.currentMode).toBe("HALT");
    expect(graph.currentState).toBe("HALT");
  });

  test("HALT blocks all subsequent execution and signal generation", () => {
    const { graph } = newGraph();
    // Enter HALT from IDLE.
    graph.transition({
      to: "HALT",
      actor: MODULE_ACTORS.infraGuardian,
      timestampMs: 0,
    });

    // Cannot start a new cycle.
    expect(
      graph.transition({
        to: "INGEST_MARKET_DATA",
        actor: MODULE_ACTORS.marketDataSentinel,
        timestampMs: 0,
      }).ok,
    ).toBe(false);

    // Cannot execute.
    expect(
      graph.transition({
        to: "EXECUTE_ORDER",
        actor: MODULE_ACTORS.executionEngine,
        timestampMs: 0,
      }).ok,
    ).toBe(false);

    // Cannot detect opportunities.
    expect(
      graph.transition({
        to: "DETECT_OPPORTUNITY",
        actor: MODULE_ACTORS.opportunityScanner,
        timestampMs: 0,
      }).ok,
    ).toBe(false);

    // Cannot recover without operator reset.
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
    expect(graph.currentMode).toBe("NORMAL");
  });

  test("HALT entered from execution-reduce-only blocks new order starts", () => {
    const { graph } = newGraph();
    walkToPrecheck(graph);

    // Execution proceeds.
    graph.transition({
      to: "EXECUTE_ORDER",
      actor: MODULE_ACTORS.executionEngine,
      data: { precheck: "PASS" },
      timestampMs: 0,
    });

    // Infra-guardian detects the execution failure and enters REDUCE_ONLY.
    const reduced = graph.transition({
      to: "REDUCE_ONLY_MODE",
      actor: MODULE_ACTORS.infraGuardian,
      timestampMs: 0,
    });
    expect(reduced.ok).toBe(true);
    expect(graph.currentMode).toBe("REDUCE_ONLY");

    // Signal generation is blocked in REDUCE_ONLY mode.
    expect(
      graph.transition({
        to: "DETECT_OPPORTUNITY",
        actor: MODULE_ACTORS.opportunityScanner,
        timestampMs: 0,
      }).ok,
    ).toBe(false);

    // No new order starts are possible.
    expect(
      graph.transition({
        to: "BUILD_ORDER_INTENT",
        actor: MODULE_ACTORS.planner,
        timestampMs: 0,
      }).ok,
    ).toBe(false);

    // Recovery requires operator reset.
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
    expect(graph.currentMode).toBe("NORMAL");
  });
});

describe("fail-closed: reconciliation failure (issue #23 AC2)", () => {
  test("reconciliation failure triggers HALT: no new positions possible", () => {
    const { graph } = newGraph();
    walkToRiskValidate(graph);

    // Walk through execution to RECONCILE.
    walkSteps(graph, [
      [
        "EXECUTION_PRECHECK",
        MODULE_ACTORS.riskEngine,
        {
          riskDecisionOutcome: "APPROVE",
          riskDecision: {
            decision: "APPROVE",
            orderIntentIdempotencyKey: "intent-1",
            evaluatedAtMs: 0,
            approvedSize: 0.01,
            approvedLimits: { maxSlippageBps: 30 },
            expiresAtMs: FIXED_TS + 60_000,
          },
          expectedNetProfitUsd: 5,
        },
      ],
      ["EXECUTE_ORDER", MODULE_ACTORS.executionEngine, { precheck: "PASS" }],
      ["RECONCILE", MODULE_ACTORS.executionEngine, { execution: "SIMULATED_FILL" }],
    ]);

    // Reconciliation detects a balance mismatch — infra-guardian triggers HALT.
    const halted = graph.transition({
      to: "HALT",
      actor: MODULE_ACTORS.infraGuardian,
      timestampMs: 0,
    });
    expect(halted.ok).toBe(true);
    expect(graph.currentMode).toBe("HALT");

    // HALT blocks any new opportunity cycle.
    expect(
      graph.transition({
        to: "INGEST_MARKET_DATA",
        actor: MODULE_ACTORS.marketDataSentinel,
        timestampMs: 0,
      }).ok,
    ).toBe(false);
    expect(
      graph.transition({
        to: "DETECT_OPPORTUNITY",
        actor: MODULE_ACTORS.opportunityScanner,
        timestampMs: 0,
      }).ok,
    ).toBe(false);

    // HALT blocks new order starts.
    expect(
      graph.transition({
        to: "BUILD_ORDER_INTENT",
        actor: MODULE_ACTORS.planner,
        timestampMs: 0,
      }).ok,
    ).toBe(false);
  });

  test("reconciliation failure can enter REDUCE_ONLY to preserve partial flow", () => {
    const { graph } = newGraph();
    walkToRiskValidate(graph);

    walkSteps(graph, [
      [
        "EXECUTION_PRECHECK",
        MODULE_ACTORS.riskEngine,
        {
          riskDecisionOutcome: "APPROVE",
          riskDecision: {
            decision: "APPROVE",
            orderIntentIdempotencyKey: "intent-1",
            evaluatedAtMs: 0,
            approvedSize: 0.01,
            approvedLimits: { maxSlippageBps: 30 },
            expiresAtMs: FIXED_TS + 60_000,
          },
          expectedNetProfitUsd: 5,
        },
      ],
      ["EXECUTE_ORDER", MODULE_ACTORS.executionEngine, { precheck: "PASS" }],
      ["RECONCILE", MODULE_ACTORS.executionEngine, { execution: "SIMULATED_FILL" }],
    ]);

    // Infra-guardian enters REDUCE_ONLY (less severe than HALT).
    const reduced = graph.transition({
      to: "REDUCE_ONLY_MODE",
      actor: MODULE_ACTORS.infraGuardian,
      timestampMs: 0,
    });
    expect(reduced.ok).toBe(true);
    expect(graph.currentMode).toBe("REDUCE_ONLY");

    // Signal generation is blocked.
    expect(
      graph.transition({
        to: "DETECT_OPPORTUNITY",
        actor: MODULE_ACTORS.opportunityScanner,
        timestampMs: 0,
      }).ok,
    ).toBe(false);
  });
});

describe("fail-closed: audit failure (issue #23 AC2)", () => {
  test("audit failure blocks AUDIT_DECISION → IDLE: system stranded in AUDIT_DECISION", () => {
    const { graph } = newGraph();
    walkToRiskValidate(graph);

    // Risk rejects and routes to AUDIT_DECISION.
    graph.transition({
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

    // Audit fails: the mandatory cycleComplete data is missing.
    const toIdle = graph.transition({
      to: "IDLE",
      actor: MODULE_ACTORS.audit,
      timestampMs: 0,
    });
    expect(toIdle.ok).toBe(false);
    if (!toIdle.ok) {
      expect(toIdle.reasonCode).toBe("GUARD_FAILED");
    }

    // System is stranded: cannot start a new cycle.
    expect(graph.currentState).toBe("AUDIT_DECISION");
    expect(
      graph.transition({
        to: "INGEST_MARKET_DATA",
        actor: MODULE_ACTORS.marketDataSentinel,
        timestampMs: 0,
      }).ok,
    ).toBe(false);
  });

  test("audit unavailable triggers HALT: system does not trade (ARCHITECTURE.md fallback)", () => {
    const { graph } = newGraph();
    walkToRiskValidate(graph);

    // Risk rejects and routes to AUDIT_DECISION.
    graph.transition({
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

    // Audit subsystem is unavailable — infra-guardian triggers HALT
    // per ARCHITECTURE.md: "Audit unavailable → Do not trade."
    const halted = graph.transition({
      to: "HALT",
      actor: MODULE_ACTORS.infraGuardian,
      timestampMs: 0,
    });
    expect(halted.ok).toBe(true);
    expect(graph.currentMode).toBe("HALT");

    // System cannot start new cycles.
    expect(
      graph.transition({
        to: "INGEST_MARKET_DATA",
        actor: MODULE_ACTORS.marketDataSentinel,
        timestampMs: 0,
      }).ok,
    ).toBe(false);
  });
});

describe("fail-closed: defensive mode fan-out from any state (issue #23 AC2)", () => {
  test("HALT is reachable from every normal state via the infra-guardian", () => {
    const WALK_STEPS: ReadonlyArray<{
      state: StateName;
      steps: ReadonlyArray<[StateName, string, Record<string, unknown>]>;
    }> = [
      { state: "IDLE", steps: [] },
      { state: "INGEST_MARKET_DATA", steps: CANDIDATE_CYCLE.slice(0, 1) },
      { state: "NORMALIZE_MARKET_STATE", steps: CANDIDATE_CYCLE.slice(0, 2) },
      { state: "UPDATE_MARKET_GRAPH", steps: CANDIDATE_CYCLE.slice(0, 3) },
      { state: "DETECT_OPPORTUNITY", steps: CANDIDATE_CYCLE.slice(0, 4) },
      { state: "BUILD_ORDER_INTENT", steps: CANDIDATE_CYCLE },
      {
        state: "REQUEST_AGENT_REVIEW",
        steps: [
          ...CANDIDATE_CYCLE,
          ["REQUEST_AGENT_REVIEW", MODULE_ACTORS.planner, { orderIntent: {} }],
        ],
      },
      { state: "RISK_VALIDATE", steps: RISK_CYCLE },
      {
        state: "EXECUTION_PRECHECK",
        steps: [
          ...RISK_CYCLE,
          [
            "EXECUTION_PRECHECK",
            MODULE_ACTORS.riskEngine,
            {
              riskDecisionOutcome: "APPROVE",
              riskDecision: {
                decision: "APPROVE",
                orderIntentIdempotencyKey: "intent-1",
                evaluatedAtMs: 0,
                approvedSize: 0.01,
                approvedLimits: { maxSlippageBps: 30 },
                expiresAtMs: FIXED_TS + 60_000,
              },
              expectedNetProfitUsd: 5,
            },
          ],
        ],
      },
      {
        state: "EXECUTE_ORDER",
        steps: [
          ...RISK_CYCLE,
          [
            "EXECUTION_PRECHECK",
            MODULE_ACTORS.riskEngine,
            {
              riskDecisionOutcome: "APPROVE",
              riskDecision: {
                decision: "APPROVE",
                orderIntentIdempotencyKey: "intent-1",
                evaluatedAtMs: 0,
                approvedSize: 0.01,
                approvedLimits: { maxSlippageBps: 30 },
                expiresAtMs: FIXED_TS + 60_000,
              },
              expectedNetProfitUsd: 5,
            },
          ],
          ["EXECUTE_ORDER", MODULE_ACTORS.executionEngine, { precheck: "PASS" }],
        ],
      },
      {
        state: "RECONCILE",
        steps: [
          ...RISK_CYCLE,
          [
            "EXECUTION_PRECHECK",
            MODULE_ACTORS.riskEngine,
            {
              riskDecisionOutcome: "APPROVE",
              riskDecision: {
                decision: "APPROVE",
                orderIntentIdempotencyKey: "intent-1",
                evaluatedAtMs: 0,
                approvedSize: 0.01,
                approvedLimits: { maxSlippageBps: 30 },
                expiresAtMs: FIXED_TS + 60_000,
              },
              expectedNetProfitUsd: 5,
            },
          ],
          ["EXECUTE_ORDER", MODULE_ACTORS.executionEngine, { precheck: "PASS" }],
          ["RECONCILE", MODULE_ACTORS.executionEngine, { execution: "SIMULATED_FILL" }],
        ],
      },
      {
        state: "AUDIT_DECISION",
        steps: [
          ...RISK_CYCLE,
          [
            "EXECUTION_PRECHECK",
            MODULE_ACTORS.riskEngine,
            {
              riskDecisionOutcome: "APPROVE",
              riskDecision: {
                decision: "APPROVE",
                orderIntentIdempotencyKey: "intent-1",
                evaluatedAtMs: 0,
                approvedSize: 0.01,
                approvedLimits: { maxSlippageBps: 30 },
                expiresAtMs: FIXED_TS + 60_000,
              },
              expectedNetProfitUsd: 5,
            },
          ],
          ["EXECUTE_ORDER", MODULE_ACTORS.executionEngine, { precheck: "PASS" }],
          ["RECONCILE", MODULE_ACTORS.executionEngine, { execution: "SIMULATED_FILL" }],
          ["AUDIT_DECISION", MODULE_ACTORS.reconciliationEngine, { reconciliation: "OK" }],
        ],
      },
    ];

    for (const { state, steps } of WALK_STEPS) {
      const { graph } = newGraph();
      walkSteps(graph, steps);

      // HALT should be reachable from the current state.
      const halted = graph.transition({
        to: "HALT",
        actor: MODULE_ACTORS.infraGuardian,
        timestampMs: 0,
      });
      expect(
        halted.ok,
        `HALT should be reachable from ${state}, got: ${halted.ok === false ? halted.reasonCode : "ok"}`,
      ).toBe(true);
      expect(graph.currentMode).toBe("HALT");
    }
  });
});
