import {
  type AuditEvent,
  type Permission,
  type StateContext,
  type StateName,
  type SystemMode,
} from "@agenttrading/contracts";
import type { AuditLog } from "./audit-log.ts";
import type { PermissionRegistry } from "./permission-registry.ts";
import { StateGraph, type TransitionInput, type TransitionOutcome } from "./state-graph.ts";

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
      reasonCodes: options.reasonCodes as any,
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

function transitionKey(from: StateName, to: StateName): string {
  return `${from}>${to}`;
}

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
