import {
  CANDIDATE_STATUS,
  isRiskDecision,
  type OpportunityStatus,
  type Permission,
  type StateContext,
  type StateName,
  type StateNode,
  type SystemMode,
  type Transition,
} from "@agenttrading/contracts";
import { PermissionRegistry } from "./permission-registry.ts";
import { EXECUTION_MODES, SIGNAL_MODES } from "../modes.ts";
import {
  alwaysAllow,
  allOf,
  allowWhen,
  dataEquals,
  defensiveEntry,
  modeAllows,
  notHalted,
  requiresData,
} from "./guards.ts";

/**
 * Default StateGraph topology (issue #13, ARCHITECTURE.md:37-41):
 *
 *   IDLE -> INGEST_MARKET_DATA -> NORMALIZE_MARKET_STATE -> UPDATE_MARKET_GRAPH
 *     -> DETECT_OPPORTUNITY -> BUILD_ORDER_INTENT -> REQUEST_AGENT_REVIEW
 *     -> RISK_VALIDATE -> EXECUTION_PRECHECK -> EXECUTE_ORDER -> RECONCILE
 *     -> AUDIT_DECISION -> IDLE
 *
 * plus reject/abort forks (no candidates, agent review FAIL, risk REJECT) that
 * return to AUDIT_DECISION, and the five defensive states (HALT, DEGRADED_MODE,
 * CASH_ONLY_MODE, CANCEL_ONLY_MODE, REDUCE_ONLY_MODE) reachable from every
 * state (fail closed: target mode must be at least as restrictive). Leaving a
 * defensive state requires an operator reset back to IDLE.
 */

/** Defensive states the graph can enter from anywhere (ADR-0002, RISK.md). */
export const DEFENSIVE_STATES = [
  "HALT",
  "DEGRADED_MODE",
  "CASH_ONLY_MODE",
  "CANCEL_ONLY_MODE",
  "REDUCE_ONLY_MODE",
] as const satisfies readonly StateName[];

/** Union type of every defensive state name. */
export type DefensiveState = (typeof DEFENSIVE_STATES)[number];

/** SystemMode each defensive state puts the graph into (CONTEXT.md SystemMode). */
export const DEFENSIVE_STATE_MODE: Record<DefensiveState, SystemMode> = {
  HALT: "HALT",
  DEGRADED_MODE: "OBSERVE_ONLY",
  CASH_ONLY_MODE: "CASH_ONLY",
  CANCEL_ONLY_MODE: "CANCEL_ONLY",
  REDUCE_ONLY_MODE: "REDUCE_ONLY",
};

/** Outcome of a risk decision that authorizes simulated execution. */
const EXECUTABLE_RISK_OUTCOMES: readonly string[] = ["APPROVE", "REDUCE_SIZE"];

/** True when the recorded risk decision outcome permits execution. */
function isExecutableRiskOutcome(outcome: unknown): boolean {
  return EXECUTABLE_RISK_OUTCOMES.includes(String(outcome));
}

/** CANDIDATE status from the shared OPPORTUNITY_STATUS vocabulary. */
const CANDIDATE_STATUS_VALUE: OpportunityStatus = CANDIDATE_STATUS;

/**
 * True when the transition data carries at least one candidate still in
 * CANDIDATE status. Shared by the detect forks so the predicate lives once.
 */
function hasCandidateStatus(ctx: StateContext): boolean {
  const candidates = (ctx.data?.candidates ?? []) as Array<{
    status?: string;
  }>;
  return candidates.some(
    (candidate) => candidate.status === CANDIDATE_STATUS_VALUE,
  );
}

/**
 * True when the transition context carries a complete risk decision whose
 * recorded outcome matches the decision itself. US26 / ADR-0003: no bare
 * hand-written `riskDecisionOutcome` string can authorize execution; the full
 * RiskGate-produced decision record must be present and structurally valid
 * (the contracts `isRiskDecision` guard rejects forged/malformed records).
 */
function hasRiskDecision(ctx: StateContext): boolean {
  const outcome = ctx.data?.riskDecisionOutcome;
  const decision = ctx.data?.riskDecision;
  return (
    outcome !== undefined &&
    isRiskDecision(decision) &&
    decision.decision === outcome
  );
}

/** Actors and the permissions they hold (ARCHITECTURE.md:55-59). */
export const MODULE_ACTORS = {
  marketDataSentinel: "market-data-sentinel",
  normalizer: "normalizer",
  graphBuilder: "graph-builder",
  opportunityScanner: "opportunity-scanner",
  planner: "planner",
  agentReview: "agent-review",
  riskEngine: "risk-engine",
  executionEngine: "execution-engine",
  reconciliationEngine: "reconciliation-engine",
  audit: "audit",
  infraGuardian: "infra-guardian",
  operator: "operator",
} as const;

/** Analytical agents registered for the permission-boundary tests (no execution perms). */
export const AGENT_IDS = [
  "agent-arbitrage-alpha",
  "agent-risk-analyst",
  "agent-planner",
  "agent-audit",
] as const;

/**
 * Permissions per analytical agent. Keyed by AGENT_IDS member so the two lists
 * cannot drift: a registered agent always appears in AGENT_IDS and vice versa
 * (enforced at compile time by the Record type).
 */
const AGENT_PERMISSIONS: Record<
  (typeof AGENT_IDS)[number],
  readonly Permission[]
> = {
  "agent-arbitrage-alpha": ["OBSERVE_MARKET_DATA", "PROPOSE_SIGNAL"],
  "agent-risk-analyst": ["OBSERVE_STATE", "PROPOSE_RISK_REVIEW"],
  "agent-planner": ["OBSERVE_STATE", "PROPOSE_SIGNAL", "PROPOSE_EXECUTION_PLAN"],
  "agent-audit": ["OBSERVE_AUDIT", "OBSERVE_STATE"],
};

const TRIGGER_BY_DEFENSIVE_STATE: Record<DefensiveState, Permission> = {
  DEGRADED_MODE: "TRIGGER_DEGRADED_MODE",
  CANCEL_ONLY_MODE: "TRIGGER_CANCEL_ONLY",
  REDUCE_ONLY_MODE: "TRIGGER_REDUCE_ONLY",
  CASH_ONLY_MODE: "TRIGGER_CASH_ONLY",
  HALT: "TRIGGER_HALT",
};

/**
 * Registry with the canonical module/agent permissions. Agents only ever hold
 * observation/proposal permissions; the execution-authority permissions live
 * on deterministic engines and the operator.
 */
export function defaultPermissionRegistry(): PermissionRegistry {
  const registry = new PermissionRegistry(AGENT_IDS);

  registry.register(MODULE_ACTORS.marketDataSentinel, [
    "OBSERVE_MARKET_DATA",
  ]);
  registry.register(MODULE_ACTORS.normalizer, ["OBSERVE_MARKET_DATA"]);
  registry.register(MODULE_ACTORS.graphBuilder, [
    "OBSERVE_MARKET_DATA",
    "OBSERVE_STATE",
  ]);
  registry.register(MODULE_ACTORS.opportunityScanner, [
    "OBSERVE_MARKET_DATA",
    "OBSERVE_STATE",
    "PROPOSE_SIGNAL",
  ]);
  registry.register(MODULE_ACTORS.planner, [
    "OBSERVE_STATE",
    "PROPOSE_SIGNAL",
    "PROPOSE_EXECUTION_PLAN",
  ]);
  registry.register(MODULE_ACTORS.agentReview, [
    "OBSERVE_STATE",
    "PROPOSE_RISK_REVIEW",
  ]);
  registry.register(MODULE_ACTORS.riskEngine, [
    "APPROVE_RISK",
    "OBSERVE_STATE",
    "OBSERVE_AUDIT",
    "TRIGGER_REDUCE_ONLY",
    "TRIGGER_CASH_ONLY",
    "TRIGGER_HALT",
  ]);
  registry.register(MODULE_ACTORS.executionEngine, [
    "SUBMIT_ORDER",
    "CANCEL_ORDER",
    "SIGN_TRANSACTION",
    "OBSERVE_STATE",
  ]);
  registry.register(MODULE_ACTORS.reconciliationEngine, [
    "OBSERVE_STATE",
    "OBSERVE_AUDIT",
    "TRIGGER_DEGRADED_MODE",
    "TRIGGER_CANCEL_ONLY",
  ]);
  registry.register(MODULE_ACTORS.audit, ["OBSERVE_AUDIT", "OBSERVE_STATE"]);
  registry.register(MODULE_ACTORS.infraGuardian, [
    "OBSERVE_STATE",
    "TRIGGER_DEGRADED_MODE",
    "TRIGGER_CANCEL_ONLY",
    "TRIGGER_REDUCE_ONLY",
    "TRIGGER_CASH_ONLY",
    "TRIGGER_HALT",
  ]);
  registry.register(MODULE_ACTORS.operator, [
    "OBSERVE_AUDIT",
    "OBSERVE_STATE",
    "MODIFY_RISK_LIMITS",
    "TRIGGER_DEGRADED_MODE",
    "TRIGGER_CANCEL_ONLY",
    "TRIGGER_REDUCE_ONLY",
    "TRIGGER_CASH_ONLY",
    "TRIGGER_HALT",
  ]);

  for (const [agentId, permissions] of Object.entries(AGENT_PERMISSIONS)) {
    registry.register(agentId, permissions);
  }

  return registry;
}

/**
 * The default graph topology: canonical flow, reject forks, defensive fan-out
 * from every state, and operator recovery edges.
 */
export interface DefaultGraph {
  nodes: readonly StateNode[];
  transitions: readonly Transition[];
}

/** The canonical flow edges (excluding the generated defensive fan-out). */
function flowTransitions(): Transition[] {
  return [
    {
      id: "idle-to-ingest",
      from: "IDLE",
      to: "INGEST_MARKET_DATA",
      guard: notHalted("idleToIngest"),
      requiredPermissions: ["OBSERVE_MARKET_DATA"],
      audit: true,
    },
    {
      id: "ingest-to-normalize",
      from: "INGEST_MARKET_DATA",
      to: "NORMALIZE_MARKET_STATE",
      guard: alwaysAllow("ingestToNormalize"),
      requiredPermissions: ["OBSERVE_MARKET_DATA"],
      audit: true,
    },
    {
      id: "normalize-to-update-graph",
      from: "NORMALIZE_MARKET_STATE",
      to: "UPDATE_MARKET_GRAPH",
      guard: requiresData("normalizeToUpdateGraph", "normalizedMarketData"),
      requiredPermissions: ["OBSERVE_MARKET_DATA"],
      audit: true,
    },
    {
      id: "update-graph-to-detect",
      from: "UPDATE_MARKET_GRAPH",
      to: "DETECT_OPPORTUNITY",
      guard: allOf("updateGraphToDetect", [
        requiresData("graphSnapshotPresent", "graphSnapshot"),
        modeAllows("detectMode", SIGNAL_MODES),
      ]),
      requiredPermissions: ["OBSERVE_MARKET_DATA"],
      audit: true,
    },
    {
      id: "detect-to-build",
      from: "DETECT_OPPORTUNITY",
      to: "BUILD_ORDER_INTENT",
      guard: allOf("detectToBuild", [
        modeAllows("buildMode", SIGNAL_MODES),
        allowWhen("candidateExists", hasCandidateStatus, "no profitable candidates"),
      ]),
      requiredPermissions: ["PROPOSE_SIGNAL"],
      audit: true,
    },
    {
      id: "detect-to-audit",
      from: "DETECT_OPPORTUNITY",
      to: "AUDIT_DECISION",
      guard: allowWhen(
        "detectToAudit",
        (ctx) => !hasCandidateStatus(ctx),
        "all candidates discarded",
      ),
      requiredPermissions: ["OBSERVE_AUDIT"],
      audit: true,
    },
    {
      id: "build-to-request-review",
      from: "BUILD_ORDER_INTENT",
      to: "REQUEST_AGENT_REVIEW",
      guard: allOf("buildToRequestReview", [
        modeAllows("reviewMode", SIGNAL_MODES),
        requiresData("orderIntentPresent", "orderIntent"),
      ]),
      requiredPermissions: ["PROPOSE_EXECUTION_PLAN"],
      audit: true,
    },
    {
      id: "request-review-to-risk",
      from: "REQUEST_AGENT_REVIEW",
      to: "RISK_VALIDATE",
      guard: allOf("requestReviewToRisk", [
        modeAllows("riskMode", SIGNAL_MODES),
        dataEquals("agentReviewPassed", "agentReview", "PASS"),
      ]),
      requiredPermissions: ["PROPOSE_RISK_REVIEW"],
      audit: true,
    },
    {
      id: "request-review-to-audit",
      from: "REQUEST_AGENT_REVIEW",
      to: "AUDIT_DECISION",
      guard: dataEquals("agentReviewFailed", "agentReview", "FAIL"),
      requiredPermissions: ["PROPOSE_RISK_REVIEW"],
      audit: true,
    },
    {
      id: "risk-to-precheck",
      from: "RISK_VALIDATE",
      to: "EXECUTION_PRECHECK",
      guard: allOf("riskApprovedAndExecutable", [
        allowWhen(
          "riskApproved",
          (ctx) =>
            hasRiskDecision(ctx) && isExecutableRiskOutcome(ctx.data?.riskDecisionOutcome),
          "no approved risk decision (APPROVE or REDUCE_SIZE)",
        ),
        modeAllows("executionMode", EXECUTION_MODES),
      ]),
      requiredPermissions: ["APPROVE_RISK"],
      audit: true,
    },
    {
      id: "risk-to-audit",
      from: "RISK_VALIDATE",
      to: "AUDIT_DECISION",
      guard: allowWhen(
        "riskRejected",
        (ctx) =>
          hasRiskDecision(ctx) &&
          !isExecutableRiskOutcome(ctx.data?.riskDecisionOutcome),
        "risk decision is not an approval",
      ),
      requiredPermissions: ["APPROVE_RISK"],
      audit: true,
    },
    {
      id: "precheck-to-execute",
      from: "EXECUTION_PRECHECK",
      to: "EXECUTE_ORDER",
      guard: allOf("precheckAndApprovalValid", [
        allowWhen(
          "precheckPassed",
          (ctx) => ctx.data?.precheck === "PASS",
          "precheck failed",
        ),
        allowWhen(
          "modeAllowsExecution",
          (ctx) => EXECUTION_MODES.includes(ctx.mode),
          "mode blocks execution",
        ),
        allowWhen(
          "approvalNotExpired",
          (ctx) => {
            const decision = ctx.data?.riskDecision;
            if (!isRiskDecision(decision) || !("expiresAtMs" in decision)) {
              return false;
            }
            return ctx.updatedAtMs < decision.expiresAtMs;
          },
          "approval expired (RISK.md)",
        ),
      ]),
      requiredPermissions: ["SUBMIT_ORDER"],
      audit: true,
    },
    {
      id: "execute-to-reconcile",
      from: "EXECUTE_ORDER",
      to: "RECONCILE",
      guard: requiresData("executeToReconcile", "execution"),
      requiredPermissions: ["SUBMIT_ORDER"],
      audit: true,
    },
    {
      id: "reconcile-to-audit",
      from: "RECONCILE",
      to: "AUDIT_DECISION",
      guard: allowWhen(
        "reconciliationResolved",
        (ctx) => ctx.data?.reconciliation === "OK",
        "reconciliation unresolved",
      ),
      requiredPermissions: ["OBSERVE_STATE"],
      audit: true,
    },
    {
      id: "audit-to-idle",
      from: "AUDIT_DECISION",
      to: "IDLE",
      guard: requiresData("auditToIdle", "cycleComplete"),
      requiredPermissions: ["OBSERVE_AUDIT"],
      audit: true,
    },
  ];
}

/** Edge guard factory for entering a defensive state. */
function defensiveGuard(to: DefensiveState): Transition {
  return {
    id: `any-to-${to}`,
    from: "" as StateName, // placeholder, replaced per source state
    to,
    guard: defensiveEntry(`enter-${to}`, DEFENSIVE_STATE_MODE[to]),
    requiredPermissions: [TRIGGER_BY_DEFENSIVE_STATE[to]],
    audit: true,
  };
}

/** Operator-gated recovery edge back to IDLE. */
function recoveryGuard(from: DefensiveState): Transition {
  return {
    id: `${from}-to-idle`,
    from,
    to: "IDLE",
    guard: allowWhen(
      "operatorReset",
      (ctx) => ctx.data?.operatorReset === true,
      "operator reset required to leave a defensive mode",
    ),
    requiredPermissions: ["MODIFY_RISK_LIMITS"],
    audit: true,
  };
}

const NORMAL_STATES: readonly StateName[] = [
  "IDLE",
  "INGEST_MARKET_DATA",
  "NORMALIZE_MARKET_STATE",
  "UPDATE_MARKET_GRAPH",
  "DETECT_OPPORTUNITY",
  "BUILD_ORDER_INTENT",
  "REQUEST_AGENT_REVIEW",
  "RISK_VALIDATE",
  "EXECUTION_PRECHECK",
  "EXECUTE_ORDER",
  "RECONCILE",
  "AUDIT_DECISION",
];

const NODE_PERMISSIONS: Record<StateName, readonly Permission[]> = {
  IDLE: ["OBSERVE_STATE"],
  INGEST_MARKET_DATA: ["OBSERVE_MARKET_DATA"],
  NORMALIZE_MARKET_STATE: ["OBSERVE_MARKET_DATA"],
  UPDATE_MARKET_GRAPH: ["OBSERVE_MARKET_DATA", "OBSERVE_STATE"],
  DETECT_OPPORTUNITY: ["OBSERVE_MARKET_DATA", "OBSERVE_STATE", "PROPOSE_SIGNAL"],
  BUILD_ORDER_INTENT: ["OBSERVE_STATE", "PROPOSE_SIGNAL", "PROPOSE_EXECUTION_PLAN"],
  REQUEST_AGENT_REVIEW: ["OBSERVE_STATE", "PROPOSE_RISK_REVIEW"],
  RISK_VALIDATE: ["APPROVE_RISK", "OBSERVE_STATE"],
  EXECUTION_PRECHECK: ["SUBMIT_ORDER", "OBSERVE_STATE"],
  EXECUTE_ORDER: ["SUBMIT_ORDER", "SIGN_TRANSACTION", "OBSERVE_STATE"],
  RECONCILE: ["OBSERVE_STATE"],
  AUDIT_DECISION: ["OBSERVE_AUDIT", "OBSERVE_STATE"],
  HALT: ["TRIGGER_HALT"],
  DEGRADED_MODE: ["TRIGGER_DEGRADED_MODE"],
  CASH_ONLY_MODE: ["TRIGGER_CASH_ONLY"],
  CANCEL_ONLY_MODE: ["TRIGGER_CANCEL_ONLY"],
  REDUCE_ONLY_MODE: ["TRIGGER_REDUCE_ONLY"],
};

/**
 * Builds the default graph: canonical flow, reject forks, defensive fan-out
 * from every state, and operator recovery edges. Defensive fan-out keeps
 * `from` as the concrete source so the graph is fully introspectable.
 */
export function buildDefaultGraph(): DefaultGraph {
  const nodes: StateNode[] = [...NORMAL_STATES, ...DEFENSIVE_STATES].map(
    (name) => ({
      name,
      description: undefined,
      canEnter: true,
      permissions: [...NODE_PERMISSIONS[name]],
    }),
  );

  const transitions: Transition[] = [
    ...flowTransitions(),
    ...NORMAL_STATES.flatMap((source) =>
      DEFENSIVE_STATES.map((defensive) => ({
        ...defensiveGuard(defensive),
        from: source,
      })),
    ),
    ...DEFENSIVE_STATES.flatMap((defensive) =>
      DEFENSIVE_STATES.filter((target) => target !== defensive).map((target) => ({
        ...defensiveGuard(target),
        from: defensive,
      })),
    ),
    ...DEFENSIVE_STATES.map((defensive) => recoveryGuard(defensive)),
  ];

  return { nodes, transitions };
}
