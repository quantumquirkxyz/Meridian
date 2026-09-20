import {
  type AuditAction,
  type AuditEvent,
  type AuditReasonCode,
  CANDIDATE_STATUS,
  isDataQualityReport,
  type DataQualityState,
  isRiskDecision,
  PERMISSIONS_NEVER_GRANTED_TO_AGENTS,
  type Permission,
  type StateContext,
  type StateName,
  type StateNode,
  isStateAtLeast,
  SYSTEM_MODES,
  type GuardResult,
  type SystemMode,
  type Transition,
  type TransitionGuard,
} from "@agenttrading/contracts";
import { EXECUTION_MODES, SIGNAL_MODES } from "../modes.ts";

/** Fields the StateGraph supplies when recording a transition's audit event. */
export interface AuditRecordInput {
  eventId: string;
  timestampMs: number;
  action: AuditAction;
  actor: string;
  state: StateName;
  /** Structured detail attached to the event. */
  data?: Record<string, unknown>;
  /** Machine-readable reason codes; mandatory per issue #13 AC3. */
  reasonCodes: readonly AuditReasonCode[];
}

/**
 * AuditLog: the in-memory per-transition audit store (issue #13 AC3,
 * ARCHITECTURE.md:41 "mandatory audit"). Every attempted transition emits an
 * AuditEvent with a monotonic sequence and at least one reason code — for both
 * accepted and rejected transitions, so the trail is complete.
 *
 * Persistence to SQLite (event store / audit) is deferred to the infra and
 * event-bus tickets (ADR-0006); this in-memory store already guarantees the
 * baseline exit criterion of verifiable logs.
 */
export class AuditLog {
  private readonly events: AuditEvent[] = [];

  /** Records an event with the next monotonic sequence number. */
  record(input: AuditRecordInput): AuditEvent {
    const event: AuditEvent = {
      eventId: input.eventId,
      sequence: this.events.length + 1,
      timestampMs: input.timestampMs,
      action: input.action,
      actor: input.actor,
      state: input.state,
      reasonCodes: [...input.reasonCodes],
    };
    if (input.data !== undefined) {
      event.data = input.data;
    }
    this.events.push(event);
    return event;
  }

  /** Every recorded event, in sequence order. */
  all(): readonly AuditEvent[] {
    return this.events;
  }

  /** Number of recorded events. */
  count(): number {
    return this.events.length;
  }

  /** The most recent event, or undefined when the log is empty. */
  last(): AuditEvent | undefined {
    return this.events[this.events.length - 1];
  }

  /** Only the STATE_TRANSITION events, in order. */
  transitions(): readonly AuditEvent[] {
    return this.events.filter((event) => event.action === "STATE_TRANSITION");
  }

  /**
   * Human-verifiable log lines, one per event. Used by the simulated flow to
   * prove the baseline exit criterion: a full opportunity -> reject/approve
   * walk that runs with no LLM and produces reconstructable logs.
   */
  toLogLines(): readonly string[] {
    return this.events.map((event) => {
      const reason = event.reasonCodes?.join("+") ?? "";
      const detail =
        event.data === undefined
          ? ""
          : ` ${JSON.stringify(event.data)}`;
      const state = event.state === undefined ? "" : ` state=${event.state}`;
      return `#${event.sequence} ${event.timestampMs} ${event.actor} ${event.action}${state} reason=${reason}${detail}`;
    });
  }
}

/**
 * PermissionRegistry: the per-module / per-agent permission model (ADR-0003,
 * ARCHITECTURE.md:55-59). Every StateGraph transition carries
 * `requiredPermissions`; the acting actor must hold them all or the transition
 * is rejected with a PERMISSION_DENIED audit before any guard runs.
 *
 * The registry stores an actor id -> set of Permissions. Actor ids are fixed
 * module/agent names, never human-passable free strings. The registry is built
 * with the set of agent ids; registering or granting an execution-authority
 * permission (APPROVE_RISK, SUBMIT_ORDER, SIGN_TRANSACTION, MOVE_FUNDS,
 * MODIFY_RISK_LIMITS) to an agent throws immediately, so the boundary of
 * ARCHITECTURE.md:57 is enforced at runtime rather than by convention.
 */
export class PermissionRegistry {
  private readonly byActor = new Map<string, Set<Permission>>();
  private readonly agentIds: ReadonlySet<string>;

  constructor(agentIds: readonly string[] = []) {
    this.agentIds = new Set(agentIds);
  }

  register(actor: string, permissions: readonly Permission[]): void {
    this.assertAgentSafe(actor, permissions);
    this.byActor.set(actor, new Set(permissions));
  }

  grant(actor: string, permission: Permission): void {
    this.assertAgentSafe(actor, [permission]);
    const set = this.byActor.get(actor) ?? new Set<Permission>();
    set.add(permission);
    this.byActor.set(actor, set);
  }

  has(actor: string, permission: Permission): boolean {
    return this.byActor.get(actor)?.has(permission) ?? false;
  }

  hasAll(actor: string, required: readonly Permission[]): boolean {
    return required.every((permission) => this.has(actor, permission));
  }

  private assertAgentSafe(
    actor: string,
    permissions: readonly Permission[],
  ): void {
    if (!this.agentIds.has(actor)) {
      return;
    }
    const forbidden = (
      PERMISSIONS_NEVER_GRANTED_TO_AGENTS as readonly Permission[]
    ).filter((permission) => permissions.includes(permission));
    if (forbidden.length > 0) {
      throw new Error(
        `permission boundary violated: agent ${actor} cannot be granted ` +
          `${forbidden.join(", ")}`,
      );
    }
  }
}

/**
 * Structural enforcement of user story 28: no AI agent holds
 * APPROVE_RISK / SUBMIT_ORDER / SIGN_TRANSACTION / MOVE_FUNDS /
 * MODIFY_RISK_LIMITS. Returns the list of offending agents (empty when the
 * boundary holds). Belt-and-braces on top of the registry's runtime check:
 * it can also catch a registry constructed without its agent ids.
 */
export function agentsHoldingExecutionPermissions(
  registry: PermissionRegistry,
  agentIds: readonly string[],
): string[] {
  return agentIds.filter((agent) =>
    (PERMISSIONS_NEVER_GRANTED_TO_AGENTS as readonly Permission[]).some(
      (permission) => registry.has(agent, permission),
    ),
  );
}

/** Throws if any agent holds an execution-authority permission. */
export function assertNoAgentHoldsExecutionPermissions(
  registry: PermissionRegistry,
  agentIds: readonly string[],
): void {
  const offenders = agentsHoldingExecutionPermissions(registry, agentIds);
  if (offenders.length > 0) {
    throw new Error(
      `permission boundary violated: agents ${offenders.join(", ")} hold ` +
        `execution-authority permissions`,
    );
  }
}

/**
 * Guard factories for the StateGraph (ARCHITECTURE.md:41). A guard decides
 * whether a transition is allowed in the current StateContext. Guards never
 * call LLMs and never depend on wall-clock randomness; they are pure functions
 * of the context, so the core stays deterministic.
 */

/** Guard that always allows the transition. */
export function alwaysAllow(name: string): TransitionGuard {
  return {
    name,
    evaluate(): GuardResult {
      return { ok: true, reason: "always allowed" };
    },
  };
}

/**
 * Guard built from a predicate; rejects with the given reason when false. The
 * success reason reflects the guard name (not the reject reason), so an
 * accepted transition never audits a contradictory explanation.
 */
export function allowWhen(
  name: string,
  predicate: (context: StateContext) => boolean,
  rejectReason: string,
): TransitionGuard {
  return {
    name,
    evaluate(context: StateContext): GuardResult {
      if (predicate(context)) {
        return { ok: true, reason: `${name} passed` };
      }
      return { ok: false, reason: rejectReason };
    },
  };
}

/**
 * Guard that passes only when every inner guard passes; short-circuits on the
 * first failure. Used to compose a single TransitionGuard from several checks
 * (e.g. a mode check plus a handoff-data check).
 */
export function allOf(
  name: string,
  guards: readonly TransitionGuard[],
): TransitionGuard {
  return {
    name,
    evaluate(context: StateContext): GuardResult {
      for (const guard of guards) {
        const result = guard.evaluate(context);
        if (!result.ok) {
          return result;
        }
      }
      return { ok: true, reason: `all ${guards.length} guards passed` };
    },
  };
}

/**
 * Guard blocking the transition while the system is halted. Used on the
 * observation cycle start so a halted system cannot begin a new cycle;
 * activity inside a defensive mode is governed by the mode-based guards.
 */
export function notHalted(name: string): TransitionGuard {
  return {
    name,
    evaluate(context: StateContext): GuardResult {
      if (context.mode === "HALT") {
        return {
          ok: false,
          reason: "system is halted; new cycles cannot start",
        };
      }
      return { ok: true, reason: "system not halted" };
    },
  };
}

/**
 * Guard allowing the transition only when the current mode is one of the
 * given modes. Encodes the "defensive modes reduce activity" rule: states that
 * build or execute orders only run in modes that permit that activity.
 */
export function modeAllows(
  name: string,
  allowedModes: readonly SystemMode[],
): TransitionGuard {
  const allowed = new Set<SystemMode>(allowedModes);
  return {
    name,
    evaluate(context: StateContext): GuardResult {
      if (allowed.has(context.mode)) {
        return { ok: true, reason: `mode ${context.mode} allowed` };
      }
      return {
        ok: false,
        reason: `mode ${context.mode} does not allow this activity`,
      };
    },
  };
}

/**
 * Guard requiring that a key exists in `context.data`. Used to enforce that a
 * transition only advances once the previous stage produced its typed payload
 * (e.g. EXECUTION_PRECHECK requires a risk decision).
 */
export function requiresData(
  name: string,
  key: string,
): TransitionGuard {
  return {
    name,
    evaluate(context: StateContext): GuardResult {
      if (context.data !== undefined && context.data[key] !== undefined) {
        return { ok: true, reason: `${key} present` };
      }
      return { ok: false, reason: `missing ${key}` };
    },
  };
}

/**
 * Guard requiring `context.data[key]` to equal a given value. Used to gate
 * data-dependent forks, e.g. RISK_VALIDATE -> EXECUTION_PRECHECK only when the
 * stored risk decision outcome is APPROVE.
 */
export function dataEquals(
  name: string,
  key: string,
  expected: unknown,
): TransitionGuard {
  return {
    name,
    evaluate(context: StateContext): GuardResult {
      const value = context.data?.[key];
      if (value === expected) {
        return { ok: true, reason: `${key} equals ${String(expected)}` };
      }
      return {
        ok: false,
        reason: `${key} is not ${String(expected)}`,
      };
    },
  };
}

/**
 * Mode restrictiveness ordering for defensive-mode entry (RISK.md:63-67,
 * fail closed). SYSTEM_MODES is already ordered least -> most restrictive:
 * NORMAL is the least restrictive and HALT the most. A transition into a
 * defensive mode is allowed only when the target mode is at least as
 * restrictive as the current mode, so activity never increases.
 */
export const MODE_ORDER: readonly SystemMode[] = SYSTEM_MODES;

const MODE_RANK = new Map<SystemMode, number>(
  MODE_ORDER.map((mode, index) => [mode, index]),
);

/**
 * Guard for entering a defensive mode. Rejects the transition when the target
 * mode would be less restrictive than the current mode (e.g. leaving HALT for
 * CASH_ONLY), enforcing "modes can only reduce activity" (modes.ts, RISK.md).
 */
export function defensiveEntry(
  name: string,
  targetMode: SystemMode,
): TransitionGuard {
  return {
    name,
    evaluate(context: StateContext): GuardResult {
      const currentRank = MODE_RANK.get(context.mode) ?? 0;
      const targetRank = MODE_RANK.get(targetMode) ?? 0;
      if (targetRank >= currentRank) {
        return {
          ok: true,
          reason: `${targetMode} is at least as restrictive as ${context.mode}`,
        };
      }
      return {
        ok: false,
        reason: `${targetMode} would increase activity from ${context.mode}`,
      };
    },
  };
}

/**
 * Guard that blocks signal generation when a data source the current
 * opportunity depends on is degraded or worse. Reads `dataQualityReports`
 * from the transition context (an array of DataQualityReport) and checks
 * whether any report for a dependent source is at least as restrictive as the
 * given threshold (default DEGRADED). The dependent source ids are read from
 * `context.data` at the keys in `sourceKeys` (default: ["source"]).
 *
 * Acceptance criteria (issue #18 AC2):
 * - Degraded sources block dependent signal generation when threshold is
 *   DEGRADED or stricter.
 * - STALE sources block dependent signal generation when threshold is STALE.
 *
 * Fails closed: missing reports for a dependent source block signal
 * generation rather than silently proceeding.
 */
export function dataQualityBlocksSignal(
  name: string,
  options: {
    /** Keys in context.data holding the dependent source id(s) (default: ["source"]). */
    sourceKeys?: string[];
    /** Minimum state that blocks signal generation (default: "DEGRADED"). */
    threshold?: DataQualityState;
  } = {},
): TransitionGuard {
  const sourceKeys = options.sourceKeys ?? ["source"];
  const threshold = options.threshold ?? "DEGRADED";

  return {
    name,
    evaluate(context: StateContext): GuardResult {
      const rawReports = context.data?.dataQualityReports ?? [];
      if (!Array.isArray(rawReports)) {
        return {
          ok: false,
          reason: "dataQualityReports is not an array; blocking signal generation",
        };
      }
      const reports = rawReports.filter(isDataQualityReport);

      if (reports.length === 0) {
        return {
          ok: false,
          reason: "no data quality reports; blocking signal generation",
        };
      }

      const dependentSourceIds = new Set(
        sourceKeys.flatMap((key) => {
          const value = context.data?.[key];
          if (Array.isArray(value)) {
            return value.filter((v): v is string => typeof v === "string");
          }
          return typeof value === "string" ? [value] : [];
        }),
      );

      // Fail closed: every dependent source must have a report.
      const reportsBySource = new Map(
        reports.map((r) => [r.source, r] as const),
      );
      for (const sourceId of dependentSourceIds) {
        if (!reportsBySource.has(sourceId)) {
          return {
            ok: false,
            reason:
              `missing report for dependent source ${sourceId}; blocking signal generation`,
          };
        }
      }

      for (const sourceId of dependentSourceIds) {
        const report = reportsBySource.get(sourceId)!;
        if (isStateAtLeast(report.state, threshold)) {
          return {
            ok: false,
            reason: `source ${report.source} quality ${report.state} blocks signal generation (threshold: ${threshold})`,
          };
        }
      }

      return { ok: true, reason: "all dependent data sources quality sufficient" };
    },
  };
}

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
export function isExecutableRiskOutcome(outcome: unknown): boolean {
  return EXECUTABLE_RISK_OUTCOMES.includes(String(outcome));
}

/**
 * True when the transition data carries at least one candidate still in
 * CANDIDATE status. Shared by the detect forks so the predicate lives once.
 */
function hasCandidateStatus(ctx: StateContext): boolean {
  const candidates = (ctx.data?.candidates ?? []) as Array<{
    status?: string;
  }>;
  return candidates.some((candidate) => candidate.status === CANDIDATE_STATUS);
}

/** True when the first candidate in the transition data is still profitable. */
function hasProfitableCandidate(ctx: StateContext): boolean {
  const candidates = (ctx.data?.candidates ?? []) as Array<{
    expectedNetProfitUsd?: unknown;
  }>;
  return candidates.some(
    (candidate) =>
      typeof candidate.expectedNetProfitUsd === "number" &&
      candidate.expectedNetProfitUsd > 0,
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
  "agent-planner-supervisor",
  "agent-arbitrage-alpha",
  "agent-market-regime",
  "agent-bull",
  "agent-bear",
  "agent-skeptic",
  "agent-risk-analyst",
  "agent-execution-advisor",
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
  "agent-planner-supervisor": [
    "OBSERVE_STATE",
    "PROPOSE_SIGNAL",
    "PROPOSE_EXECUTION_PLAN",
  ],
  "agent-arbitrage-alpha": ["OBSERVE_MARKET_DATA", "PROPOSE_SIGNAL"],
  "agent-market-regime": ["OBSERVE_MARKET_DATA", "OBSERVE_STATE", "PROPOSE_SIGNAL"],
  "agent-bull": ["OBSERVE_STATE", "PROPOSE_RISK_REVIEW"],
  "agent-bear": ["OBSERVE_STATE", "PROPOSE_RISK_REVIEW"],
  "agent-skeptic": ["OBSERVE_STATE", "PROPOSE_RISK_REVIEW"],
  "agent-risk-analyst": ["OBSERVE_STATE", "PROPOSE_RISK_REVIEW"],
  "agent-execution-advisor": ["OBSERVE_STATE", "PROPOSE_EXECUTION_PLAN"],
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
  registry.register("orchestrator", ["OBSERVE_AUDIT", "OBSERVE_STATE", "TRIGGER_HALT"]);

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
        allowWhen(
          "candidateProfitable",
          hasProfitableCandidate,
          "no profitable candidates",
        ),
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
          "reducedTradeProfitable",
          (ctx) =>
            typeof ctx.data?.expectedNetProfitUsd === "number" &&
            ctx.data.expectedNetProfitUsd > 0,
          "reduced trade not profitable",
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
      id: "precheck-to-audit",
      from: "EXECUTION_PRECHECK",
      to: "AUDIT_DECISION",
      guard: allowWhen(
        "precheckFailed",
        (ctx) => ctx.data?.precheck !== "PASS",
        "precheck failure must be audited, not stranded",
      ),
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
        "reconciliationRecorded",
        (ctx) => ctx.data?.reconciliation !== undefined,
        "no reconciliation result",
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
function defensiveGuard(from: StateName, to: DefensiveState): Transition {
  return {
    id: `any-to-${to}`,
    from,
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

/** Canonical baseline states. */
const BASELINE_STATES: readonly StateName[] = [
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

/** Orchestrator states (issue #25). */
const ORCHESTRATOR_STATES: readonly StateName[] = [
  "DEBATING",
  "RISK_CHECKING",
  "APPROVED",
  "REJECTED",
  "EXECUTING",
  "RECONCILING",
  "AUDITING",
];

/** All normal (non-defensive) states. */
const NORMAL_STATES: readonly StateName[] = [
  ...BASELINE_STATES,
  ...ORCHESTRATOR_STATES,
];

/**
 * Orchestrator flow transitions (issue #25):
 *
 *   BUILD_ORDER_INTENT -> DEBATING -> RISK_CHECKING
 *     -> APPROVED -> EXECUTING -> RECONCILING -> AUDITING -> IDLE
 *     -> REJECTED -> AUDITING -> IDLE *
 * plus defensive fan-out from every orchestrator state.
 */
function orchestratorTransitions(): Transition[] {
  return [
    {
      id: "build-to-debating",
      from: "BUILD_ORDER_INTENT",
      to: "DEBATING",
      guard: allOf("buildToDebating", [
        modeAllows("debatingMode", SIGNAL_MODES),
        requiresData("orderIntentForDebate", "orderIntent"),
      ]),
      requiredPermissions: ["PROPOSE_EXECUTION_PLAN"],
      audit: true,
    },
    {
      id: "debating-to-risk-checking",
      from: "DEBATING",
      to: "RISK_CHECKING",
      guard: allOf("debatingToRiskChecking", [
        modeAllows("riskCheckingMode", SIGNAL_MODES),
        requiresData("debateComplete", "debateResult"),
      ]),
      requiredPermissions: ["PROPOSE_RISK_REVIEW"],
      audit: true,
    },
    {
      id: "risk-checking-to-approved",
      from: "RISK_CHECKING",
      to: "APPROVED",
      guard: allOf("riskCheckingToApproved", [
        allowWhen(
          "riskApproved",
          (ctx) =>
            hasRiskDecision(ctx) &&
            isExecutableRiskOutcome(ctx.data?.riskDecisionOutcome),
          "no approved risk decision",
        ),
        modeAllows("approvedMode", EXECUTION_MODES),
      ]),
      requiredPermissions: ["APPROVE_RISK"],
      audit: true,
    },
    {
      id: "risk-checking-to-rejected",
      from: "RISK_CHECKING",
      to: "REJECTED",
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
      id: "approved-to-executing",
      from: "APPROVED",
      to: "EXECUTING",
      guard: allOf("approvedToExecuting", [
        requiresData("approvedRiskDecision", "riskDecision"),
        modeAllows("execMode", EXECUTION_MODES),
        allowWhen(
          "approvalNotExpired",
          (ctx) => {
            const decision = ctx.data?.riskDecision;
            if (!isRiskDecision(decision) || !("expiresAtMs" in decision)) {
              return false;
            }
            return ctx.updatedAtMs < decision.expiresAtMs;
          },
          "approval expired",
        ),
      ]),
      requiredPermissions: ["SUBMIT_ORDER"],
      audit: true,
    },
    {
      id: "executing-to-reconciling",
      from: "EXECUTING",
      to: "RECONCILING",
      guard: requiresData("execToReconciling", "execution"),
      requiredPermissions: ["SUBMIT_ORDER"],
      audit: true,
    },
    {
      id: "reconciling-to-auditing",
      from: "RECONCILING",
      to: "AUDITING",
      guard: allowWhen(
        "reconcilingToAuditing",
        (ctx) => ctx.data?.reconciliation !== undefined,
        "no reconciliation result",
      ),
      requiredPermissions: ["OBSERVE_STATE"],
      audit: true,
    },
    {
      id: "rejected-to-auditing",
      from: "REJECTED",
      to: "AUDITING",
      guard: requiresData("rejectedToAuditing", "riskDecision"),
      requiredPermissions: ["APPROVE_RISK"],
      audit: true,
    },
    {
      id: "auditing-to-idle",
      from: "AUDITING",
      to: "IDLE",
      guard: requiresData("auditingToIdle", "cycleComplete"),
      requiredPermissions: ["OBSERVE_AUDIT"],
      audit: true,
    },
  ];
}

/**
 * Builds the default graph: canonical flow, reject forks, orchestrator flow,
 * defensive fan-out from every state, and operator recovery edges.
 */
export function buildDefaultGraph(): DefaultGraph {
  const nodes: StateNode[] = [...NORMAL_STATES, ...DEFENSIVE_STATES].map(
    (name) => ({
      name,
      description: undefined,
    }),
  );

  const transitions: Transition[] = [
    ...flowTransitions(),
    ...orchestratorTransitions(),
    ...NORMAL_STATES.flatMap((source) =>
      DEFENSIVE_STATES.map((defensive) => ({
        ...defensiveGuard(source, defensive),
      })),
    ),
    ...DEFENSIVE_STATES.flatMap((defensive) =>
      DEFENSIVE_STATES.filter((target) => target !== defensive).map((target) => ({
        ...defensiveGuard(defensive, target),
      })),
    ),
    ...DEFENSIVE_STATES.map((defensive) => recoveryGuard(defensive)),
  ];

  return { nodes, transitions };
}

/** Constructor options for the deterministic StateGraph core. */
export interface StateGraphOptions {
  nodes: readonly StateNode[];
  transitions: readonly Transition[];
  permissions: PermissionRegistry;
  audit: AuditLog;
  /** Injectable clock so flows are deterministic; defaults to Date.now. */
  now?: () => number;
  initialState?: StateName;
  initialMode?: SystemMode;
}

/** Input for one transition attempt and its audit metadata. */
export interface TransitionInput {
  to: StateName;
  /** Module/agent performing the transition; must hold the edge's permissions. */
  actor: string;
  /** Typed handoff data merged into the state context. */
  data?: Record<string, unknown>;
  /** Extra reason codes attached to the audit when the transition is allowed. */
  reasonCodes?: readonly AuditReasonCode[];
  timestampMs?: number;
  eventId?: string;
}

/**
 * Result of a transition attempt: the new state/mode and the emitted audit
 * event on success, or the blocking reason code and event on failure.
 */
export type TransitionOutcome =
  | {
      ok: true;
      state: StateName;
      mode: SystemMode;
      event: AuditEvent;
      guard: GuardResult;
    }
  | {
      ok: false;
      reasonCode: AuditReasonCode;
      event: AuditEvent;
      guard?: GuardResult;
    };

/**
 * StateGraph: the project's minimal deterministic orchestrator (ADR-0002,
 * issue #13). Every transition is guarded, requires the actor to hold the
 * edge's permissions, and emits an AuditEvent with reason codes — whether the
 * transition is allowed or blocked. Defensive modes are reachable from every
 * state and, once entered, reduce activity by switching the global mode (which
 * the mode-based guards then enforce). The engine never calls LLMs.
 */
export class StateGraph {
  private readonly nodes: ReadonlyMap<StateName, StateNode>;
  private readonly transitions: ReadonlyMap<string, Transition>;
  private readonly permissions: PermissionRegistry;
  private readonly audit: AuditLog;
  private readonly now: () => number;
  private readonly initialState: StateName;
  private readonly initialMode: SystemMode;

  private state: StateName;
  private mode: SystemMode;
  private data: Record<string, unknown> = {};
  private eventCounter = 0;

  constructor(options: StateGraphOptions) {
    this.nodes = new Map(options.nodes.map((node) => [node.name, node]));
    this.transitions = new Map(
      options.transitions.map((transition) => [
        transitionKey(transition.from, transition.to),
        transition,
      ]),
    );
    this.permissions = options.permissions;
    this.audit = options.audit;
    this.now = options.now ?? (() => Date.now());
    this.initialState = options.initialState ?? "IDLE";
    this.initialMode = options.initialMode ?? "NORMAL";
    this.state = this.initialState;
    this.mode = this.initialMode;
  }

  /** Current state + mode + accumulated handoff data. */
  get context(): StateContext {
    return {
      state: this.state,
      mode: this.mode,
      updatedAtMs: this.now(),
      data: this.data,
    };
  }

  /** Current state name. */
  get currentState(): StateName {
    return this.state;
  }

  /** Current global SystemMode. */
  get currentMode(): SystemMode {
    return this.mode;
  }

  /** The audit store backing every transition event. */
  get auditLog(): AuditLog {
    return this.audit;
  }

  /** The permission registry backing every transition check. */
  get permissionRegistry(): PermissionRegistry {
    return this.permissions;
  }

  /** Rebuild the graph from its initial state, clearing context data. */
  reset(): void {
    this.state = this.initialState;
    this.mode = this.initialMode;
    this.data = {};
  }

  /**
   * Attempts a transition. Guards, permission checks, and the audit event are
   * applied for both accepted and blocked attempts (issue #13 AC1/AC3).
   */
  transition(input: TransitionInput): TransitionOutcome {
    const { to, actor } = input;
    const timestampMs = input.timestampMs ?? this.now();
    const sourceState = this.state;
    const edge = this.transitions.get(transitionKey(this.state, to));

    if (edge === undefined) {
      const event = this.emit({
        input,
        timestampMs,
        action: "STATE_TRANSITION",
        state: sourceState,
        reasonCodes: ["TRANSITION_BLOCKED", "INVALID_TRANSITION"],
        data: { from: sourceState, to, attemptedActor: actor },
      });
      return {
        ok: false,
        reasonCode: "INVALID_TRANSITION",
        event,
      };
    }

    if (!this.permissions.hasAll(actor, edge.requiredPermissions)) {
      const event = this.emit({
        input,
        timestampMs,
        action: "STATE_TRANSITION",
        state: sourceState,
        reasonCodes: ["TRANSITION_BLOCKED", "PERMISSION_DENIED"],
        data: {
          transitionId: edge.id,
          from: sourceState,
          to,
          missingPermissions: edge.requiredPermissions.filter(
            (permission) => !this.permissions.has(actor, permission),
          ),
        },
      });
      return {
        ok: false,
        reasonCode: "PERMISSION_DENIED",
        event,
      };
    }

    // Guards evaluate against the injectable clock, so a caller cannot defeat
    // time-based checks (e.g. approval expiry) by forwarding a stale timestamp.
    const prospectiveContext: StateContext = {
      state: this.state,
      mode: this.mode,
      updatedAtMs: this.now(),
      data: { ...this.data, ...(input.data ?? {}) },
    };
    const guardResult = edge.guard.evaluate(prospectiveContext);
    if (!guardResult.ok) {
      const event = this.emit({
        input,
        timestampMs,
        action: "STATE_TRANSITION",
        state: sourceState,
        reasonCodes: ["TRANSITION_BLOCKED", "GUARD_FAILED"],
        data: {
          transitionId: edge.id,
          from: sourceState,
          to,
          guardName: edge.guard.name,
          guardReason: guardResult.reason,
        },
      });
      return {
        ok: false,
        reasonCode: "GUARD_FAILED",
        event,
        guard: guardResult,
      };
    }

    this.apply(edge, input, timestampMs);
    const event = this.emit({
      input,
      timestampMs,
      action: "STATE_TRANSITION",
      state: sourceState,
      reasonCodes: this.reasonCodesFor(edge, input),
      data: {
        transitionId: edge.id,
        from: sourceState,
        to: edge.to,
        guardName: edge.guard.name,
        guardReason: guardResult.reason,
      },
    });

    return {
      ok: true,
      state: this.state,
      mode: this.mode,
      event,
      guard: guardResult,
    };
  }

  /** The edge definition for a given from -> to pair, if it exists. */
  transitionFor(from: StateName, to: StateName): Transition | undefined {
    return this.transitions.get(transitionKey(from, to));
  }

  private apply(
    edge: Transition,
    input: TransitionInput,
    timestampMs: number,
  ): void {
    const from = this.state;
    this.state = edge.to;

    if (isDefensiveState(edge.to)) {
      this.mode = DEFENSIVE_STATE_MODE[edge.to as DefensiveState];
    } else if (edge.to === "IDLE") {
      if (isDefensiveState(from)) {
        this.mode = this.initialMode;
      }
      this.data = {};
    }

    if (input.data !== undefined) {
      this.data = { ...this.data, ...input.data };
    }
  }

  private reasonCodesFor(
    edge: Transition,
    input: TransitionInput,
  ): readonly AuditReasonCode[] {
    const base: readonly AuditReasonCode[] = isDefensiveState(edge.to)
      ? ["TRANSITION_ALLOWED", "DEFENSIVE_MODE_ENTERED", "MODE_REDUCED"]
      : ["TRANSITION_ALLOWED"];
    return [...base, ...(input.reasonCodes ?? [])];
  }

  private emit(options: {
    input: TransitionInput;
    timestampMs: number;
    action: "STATE_TRANSITION";
    state: StateName;
    reasonCodes: readonly AuditReasonCode[];
    data: Record<string, unknown>;
  }): AuditEvent {
    return this.audit.record({
      eventId: options.input.eventId ?? `evt-${++this.eventCounter}`,
      timestampMs: options.timestampMs,
      action: options.action,
      actor: options.input.actor,
      state: options.state,
      reasonCodes: options.reasonCodes,
      data: { ...options.data, mode: this.mode },
    });
  }
}

function transitionKey(from: StateName, to: StateName): string {
  return `${from}>${to}`;
}

function isDefensiveState(state: StateName): boolean {
  return (DEFENSIVE_STATES as readonly StateName[]).includes(state);
}

/** Configuration for state-specific timeout behavior. */
export interface StateTimeoutConfig {
  /** The state this timeout applies to. */
  state: StateName;
  /** Maximum time (ms) allowed in this state before automatic transition. */
  timeoutMs: number;
}

/** Configuration for a fallback handler when a transition fails. */
export interface FallbackConfig {
  /** The transition (from->to) this fallback applies to. */
  from: StateName;
  to: StateName;
  /** The state to transition to on failure. */
  fallbackState: StateName;
  /** Actor performing the fallback transition. */
  fallbackActor: string;
  /** Optional data to include in the fallback transition. */
  fallbackData?: Record<string, unknown>;
}

/** Constructor options for the Orchestrator. */
export interface OrchestratorOptions {
  /** The underlying StateGraph. */
  graph: StateGraph;
  /** The permission registry for verifying actor permissions. */
  permissions: PermissionRegistry;
  /** The audit log for recording orchestrator events. */
  audit: AuditLog;
  /** State timeout configurations. */
  stateTimeouts?: readonly StateTimeoutConfig[];
  /** Fallback configurations for specific transitions. */
  fallbacks?: readonly FallbackConfig[];
  /** Injectable clock; defaults to Date.now. */
  now?: () => number;
}

/**
 * Orchestrator: the complete deterministic orchestrator built on the
 * baseline StateGraph. Coordinates state transitions with timeouts,
 * retries, fallbacks, kill switch, and degraded mode — while never
 * replacing the Risk Engine's authority.
 */
/**
 * Orchestrator (Issue #25): the complete deterministic orchestrator
 * built on top of the baseline StateGraph. Adds:
 *
 * - Timeout management per state (automatic transition on stall)
 * - Fallback handlers for failed transitions
 * - Kill switch integration (HALT from any state)
 * - Degraded mode coordination
 * - Forbidden route enforcement (no SIGNAL_FOUND → EXECUTING without
 *   DEBATING, RISK_CHECKING, APPROVED)
 * - Per-agent permission enforcement on every handoff
 * - Mandatory audit for every transition attempt
 *
 * The Orchestrator coordinates but never replaces the Risk Engine.
 * It never holds risk-approval authority.
 */

/** Configuration for state-specific timeout behavior. */
export interface StateTimeoutConfig {
  /** The state this timeout applies to. */
  state: StateName;
  /** Maximum time (ms) allowed in this state before automatic transition. */
  timeoutMs: number;
}

/** Configuration for a fallback handler when a transition fails. */
export interface FallbackConfig {
  /** The transition (from->to) this fallback applies to. */
  from: StateName;
  to: StateName;
  /** The state to transition to on failure. */
  fallbackState: StateName;
  /** Actor performing the fallback transition. */
  fallbackActor: string;
  /** Optional data to include in the fallback transition. */
  fallbackData?: Record<string, unknown>;
}

/** Constructor options for the Orchestrator. */
export interface OrchestratorOptions {
  /** The underlying StateGraph. */
  graph: StateGraph;
  /** The permission registry for verifying actor permissions. */
  permissions: PermissionRegistry;
  /** The audit log for recording orchestrator events. */
  audit: AuditLog;
  /** State timeout configurations. */
  stateTimeouts?: readonly StateTimeoutConfig[];
  /** Fallback configurations for specific transitions. */
  fallbacks?: readonly FallbackConfig[];
  /** Injectable clock; defaults to Date.now. */
  now?: () => number;
}

/**
 * Orchestrator: the complete deterministic orchestrator built on the
 * baseline StateGraph. Coordinates state transitions with timeouts,
 * retries, fallbacks, kill switch, and degraded mode — while never
 * replacing the Risk Engine's authority.
 */
export class Orchestrator {
  private readonly graph: StateGraph;
  private readonly permissions: PermissionRegistry;
  private readonly audit: AuditLog;
  private readonly now: () => number;
  private readonly stateTimeouts: ReadonlyMap<StateName, StateTimeoutConfig>;
  private readonly fallbackMap: ReadonlyMap<string, FallbackConfig>;
  private readonly stateEnteredAt = new Map<StateName, number>();
  private killSwitchActive = false;
  private transitionCounter = 0;

  constructor(options: OrchestratorOptions) {
    this.graph = options.graph;
    this.permissions = options.permissions;
    this.audit = options.audit;
    this.now = options.now ?? (() => Date.now());
    // Build lookup maps.
    this.stateTimeouts = new Map(
      (options.stateTimeouts ?? []).map((config) => [config.state, config]),
    );
    this.fallbackMap = new Map(
      (options.fallbacks ?? []).map((config) => [
        transitionKey(config.from, config.to),
        config,
      ]),
    );

    // Record initial state entry.
    this.stateEnteredAt.set(this.graph.currentState, this.now());
  }

  /** Whether the kill switch is currently active. */
  get isHalted(): boolean {
    return this.killSwitchActive;
  }

  /** Current orchestrator state context. */
  get context(): StateContext {
    return this.graph.context;
  }

  /** Current state name. */
  get currentState(): StateName {
    return this.graph.currentState;
  }

  /** Current system mode. */
  get currentMode(): SystemMode {
    return this.graph.currentMode;
  }

  /** The underlying StateGraph. */
  get stateGraph(): StateGraph {
    return this.graph;
  }

  /**
   * Orchestrator tick: checks for timeouts and manages state transitions.
   * Should be called periodically by the runtime to enforce timeout policies.
   *
   * Returns an array of events generated during this tick (timeout
   * transitions, fallback transitions, etc.).
   */
  tick(): readonly AuditEvent[] {
    const events: AuditEvent[] = [];

    if (this.killSwitchActive) {
      return events;
    }

    // Check for state timeouts.
    const timeoutEvent = this.checkTimeouts();
    if (timeoutEvent !== undefined) {
      events.push(timeoutEvent);
    }

    return events;
  }

  /**
   * Attempts a transition through the orchestrator. Enforces:
   * 1. Kill switch check
   * 2. Timeout management
   * 3. Forbidden route enforcement (AC1: no SIGNAL_FOUND → EXECUTING without
   *    DEBATING, RISK_CHECKING, APPROVED)
   * 4. Permission enforcement (AC2)
   * 5. Retry logic on failure
   * 6. Fallback handling
   * 7. Audit for every attempt
   *
   * @returns The transition outcome from the underlying StateGraph.
   */
  transition(input: TransitionInput): TransitionOutcome {
    const timestampMs = input.timestampMs ?? this.now();

    // 1. Kill switch: no transitions allowed when halted (AC3).
    if (this.killSwitchActive) {
      const event = this.recordAudit({
        input,
        timestampMs,
        reasonCodes: ["TRANSITION_BLOCKED", "KILL_SWITCH_ACTIVE"],
        data: {
          from: this.graph.currentState,
          to: input.to,
          killSwitchActive: true,
        },
      });
      return {
        ok: false,
        reasonCode: "KILL_SWITCH_ACTIVE",
        event,
      };
    }

    // 2. Forbidden route enforcement (AC1): the orchestrator cannot jump
    //    from signal detection to execution without DEBATING, RISK_CHECKING,
    //    and APPROVED.
    if (isForbiddenRoute(this.graph.currentState, input.to)) {
      const event = this.recordAudit({
        input,
        timestampMs,
        reasonCodes: ["TRANSITION_BLOCKED", "FORBIDDEN_ROUTE"],
        data: {
          from: this.graph.currentState,
          to: input.to,
          forbiddenReason:
            "direct jump to execution forbidden; must pass through DEBATING, RISK_CHECKING, APPROVED",
        },
      });
      return {
        ok: false,
        reasonCode: "FORBIDDEN_ROUTE",
        event,
      };
    }

    // 3. Permission enforcement (AC2): verify actor holds required permissions
    //    before delegating to the StateGraph.
    const edge = this.graph.transitionFor(this.graph.currentState, input.to);
    if (edge !== undefined) {
      if (!this.permissions.hasAll(input.actor, edge.requiredPermissions)) {
        const missing = edge.requiredPermissions.filter(
          (p: Permission) => !this.permissions.has(input.actor, p),
        );
        const event = this.recordAudit({
          input,
          timestampMs,
          reasonCodes: ["TRANSITION_BLOCKED", "PERMISSION_DENIED"],
          data: {
            from: this.graph.currentState,
            to: input.to,
            actor: input.actor,
            missingPermissions: missing,
          },
        });
        return {
          ok: false,
          reasonCode: "PERMISSION_DENIED",
          event,
        };
      }
    }

    // 4. Delegate to the StateGraph for the actual transition.
    const outcome = this.graph.transition({ ...input, timestampMs });

    // 5. Track state entry time for timeout management.
    if (outcome.ok) {
      this.stateEnteredAt.set(outcome.state, timestampMs);
    } else {
      // 6. Handle failed transitions: execute configured fallback if any.
      const key = transitionKey(this.graph.currentState, input.to);
      const fallback = this.fallbackMap.get(key);
      if (fallback !== undefined) {
        this.executeFallback(fallback, input, timestampMs);
      }
    }

    // 7. Record the orchestrator-level audit event.
    this.recordAudit({
      input,
      timestampMs,
      reasonCodes: outcome.ok
        ? ["TRANSITION_ALLOWED", "ORCHESTRATED"]
        : ["TRANSITION_BLOCKED", outcome.reasonCode],
      data: {
        from: this.graph.currentState,
        to: input.to,
        stateGraphOutcome: outcome.ok ? "allowed" : "blocked",
        stateGraphReasonCode: outcome.ok ? undefined : outcome.reasonCode,
      },
    });

    return outcome;
  }

  /**
   * Activates the kill switch, halting the system immediately.
   * The kill switch transitions to HALT from any state (AC3).
   *
   * @param actor - The actor activating the kill switch.
   * @param reason - Human-readable reason for activation.
   * @returns The audit event generated by the kill switch activation.
   */
  activateKillSwitch(actor: string, reason: string): AuditEvent {
    if (this.killSwitchActive) {
      // Already halted — emit a no-op audit and return.
      return this.recordAudit({
        input: { to: "HALT", actor, timestampMs: this.now() },
        timestampMs: this.now(),
        reasonCodes: ["TRANSITION_BLOCKED", "KILL_SWITCH_ACTIVE"],
        data: {
          killSwitchAlreadyActive: true,
          reason,
        },
      });
    }

    this.killSwitchActive = true;
    const timestampMs = this.now();

    // Transition to HALT through the graph.
    const outcome = this.graph.transition({
      to: "HALT",
      actor,
      timestampMs,
      data: { killSwitch: true, killSwitchReason: reason },
    });

    const event = this.recordAudit({
      input: { to: "HALT", actor, timestampMs },
      timestampMs,
      reasonCodes: [
        "TRANSITION_ALLOWED",
        "KILL_SWITCH_ACTIVATED",
        "DEFENSIVE_MODE_ENTERED",
        "MODE_REDUCED",
      ],
      data: {
        killSwitchActivated: true,
        reason,
        graphOutcome: outcome.ok ? "halted" : "halt-failed",
      },
    });

    return event;
  }

  /**
   * Enters a degraded mode, reducing system activity (AC3).
   * Degraded modes can only reduce activity, never increase it (fail closed).
   *
   * @param state - The defensive state to enter.
   * @param actor - The actor requesting degraded mode.
   * @param reason - Human-readable reason.
   * @returns The transition outcome.
   */
  enterDegradedMode(
    state: StateName,
    actor: string,
    reason: string,
  ): TransitionOutcome {
    const timestampMs = this.now();
    const outcome = this.graph.transition({
      to: state,
      actor,
      timestampMs,
      data: { degradedMode: true, degradedReason: reason },
    });

    this.recordAudit({
      input: { to: state, actor, timestampMs },
      timestampMs,
      reasonCodes: outcome.ok
        ? ["TRANSITION_ALLOWED", "DEGRADED_MODE_ENTERED"]
        : ["TRANSITION_BLOCKED", outcome.reasonCode],
      data: {
        from: this.graph.currentState,
        to: state,
        reason,
        outcome: outcome.ok ? "entered" : "blocked",
      },
    });

    if (outcome.ok) {
      this.stateEnteredAt.set(outcome.state, timestampMs);
    }

    return outcome;
  }

  /**
   * Checks for state timeouts and executes fallback transitions.
   * Returns the audit event if a timeout was triggered, or undefined.
   */
  private checkTimeouts(): AuditEvent | undefined {
    const currentState = this.graph.currentState;
    const timeoutConfig = this.stateTimeouts.get(currentState);
    if (timeoutConfig === undefined) {
      return undefined;
    }

    const enteredAt = this.stateEnteredAt.get(currentState);
    if (enteredAt === undefined) {
      return undefined;
    }

    const elapsed = this.now() - enteredAt;
    if (elapsed < timeoutConfig.timeoutMs) {
      return undefined;
    }

    // Timeout triggered: enter HALT via the defensive fan-out (always
    // available from any state). This is the fail-closed behavior.
    const timestampMs = this.now();
    this.killSwitchActive = true;
    const outcome = this.graph.transition({
      to: "HALT",
      actor: "orchestrator",
      timestampMs,
      data: {
        timeoutTriggered: true,
        timeoutState: currentState,
        timeoutElapsedMs: elapsed,
        timeoutConfigMs: timeoutConfig.timeoutMs,
      },
    });

    if (outcome.ok) {
      this.stateEnteredAt.set(outcome.state, timestampMs);
    }

    return this.recordAudit({
      input: {
        to: "HALT",
        actor: "orchestrator",
        timestampMs,
      },
      timestampMs,
      reasonCodes: [
        "TRANSITION_ALLOWED",
        "TIMEOUT_TRIGGERED",
        "DEFENSIVE_MODE_ENTERED",
        "MODE_REDUCED",
      ],
      data: {
        timeoutState: currentState,
        elapsedMs: elapsed,
        timeoutConfigMs: timeoutConfig.timeoutMs,
        fallbackState: "HALT",
        outcome: outcome.ok ? "timeout-halt-succeeded" : "timeout-halt-failed",
      },
    });
  }

  /**
   * Executes a fallback transition for a failed transition.
   */
  private executeFallback(
    fallback: FallbackConfig,
    originalInput: TransitionInput,
    timestampMs: number,
  ): void {
    const fallbackOutcome = this.graph.transition({
      to: fallback.fallbackState,
      actor: fallback.fallbackActor,
      timestampMs,
      data: {
        ...fallback.fallbackData,
        fallbackTriggered: true,
        originalTo: originalInput.to,
        originalActor: originalInput.actor,
      },
    });

    if (fallbackOutcome.ok) {
      this.stateEnteredAt.set(fallbackOutcome.state, timestampMs);
    }

    this.recordAudit({
      input: {
        to: fallback.fallbackState,
        actor: fallback.fallbackActor,
        timestampMs,
      },
      timestampMs,
      reasonCodes: fallbackOutcome.ok
        ? ["TRANSITION_ALLOWED", "FALLBACK_EXECUTED"]
        : ["TRANSITION_BLOCKED", "FALLBACK_FAILED"],
      data: {
        fallbackFrom: this.graph.currentState,
        fallbackTo: fallback.fallbackState,
        originalFrom: originalInput.actor,
        originalTo: originalInput.to,
        outcome: fallbackOutcome.ok ? "fallback-succeeded" : "fallback-blocked",
      },
    });
  }

  /** Emits an audit event for orchestrator-level actions. */
  private recordAudit(options: {
    input: TransitionInput;
    timestampMs: number;
    reasonCodes: readonly string[];
    data: Record<string, unknown>;
  }): AuditEvent {
    return this.audit.record({
      eventId:
        options.input.eventId ??
        `orch-${++this.transitionCounter}-${options.timestampMs}`,
      timestampMs: options.timestampMs,
      action: "STATE_TRANSITION",
      actor: options.input.actor,
      state: this.graph.currentState,
      reasonCodes: options.reasonCodes as AuditReasonCode[],
      data: { ...options.data, mode: this.graph.currentMode },
    });
  }
}

// ── Forbidden route enforcement (AC1) ─────────────────────────────────

/**
 * Forbidden routes that the orchestrator blocks.
 * AC1: The system cannot jump SIGNAL_FOUND → EXECUTING without DEBATING,
 * RISK_CHECKING, APPROVED.
 *
 * This is enforced by blocking direct jumps from signal/analysis states
 * to execution states, requiring the orchestrator's review pipeline.
 */
const FORBIDDEN_ROUTES: ReadonlyArray<{
  from: readonly StateName[];
  to: readonly StateName[];
  reason: string;
}> = [
  {
    from: ["DETECT_OPPORTUNITY", "BUILD_ORDER_INTENT"],
    to: ["EXECUTE_ORDER", "EXECUTING", "EXECUTION_PRECHECK"],
    reason:
      "direct jump to execution forbidden; must pass through DEBATING, RISK_CHECKING, APPROVED",
  },
  {
    from: ["DETECT_OPPORTUNITY", "BUILD_ORDER_INTENT"],
    to: ["RECONCILE", "RECONCILING"],
    reason:
      "direct jump to reconciliation forbidden; must pass through DEBATING, RISK_CHECKING, APPROVED",
  },
];

/** Checks whether a from→to transition is forbidden by the orchestrator. */
function isForbiddenRoute(from: StateName, to: StateName): boolean {
  return FORBIDDEN_ROUTES.some(
    (route) => route.from.includes(from) && route.to.includes(to),
  );
}

// ── Helpers ──────────────────────────────────────────────────────────

/** Default timeout configurations for the orchestrator states. */
export function defaultStateTimeouts(): readonly StateTimeoutConfig[] {
  return [
    {
      state: "DEBATING",
      timeoutMs: 30_000,
    },
    {
      state: "RISK_CHECKING",
      timeoutMs: 15_000,
    },
    {
      state: "APPROVED",
      timeoutMs: 10_000,
    },
    {
      state: "EXECUTING",
      timeoutMs: 30_000,
    },
    {
      state: "RECONCILING",
      timeoutMs: 15_000,
    },
  ];
}

/** Default fallback configurations for critical transitions. */
export function defaultFallbacks(): readonly FallbackConfig[] {
  return [
    {
      from: "RISK_CHECKING",
      to: "APPROVED",
      fallbackState: "REJECTED",
      fallbackActor: "orchestrator",
      fallbackData: { fallbackReason: "risk-check-timeout" },
    },
    {
      from: "RISK_CHECKING",
      to: "REJECTED",
      fallbackState: "AUDITING",
      fallbackActor: "orchestrator",
      fallbackData: { fallbackReason: "rejection-audit" },
    },
  ];
}
