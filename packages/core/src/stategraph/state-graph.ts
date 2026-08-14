import {
  type AuditEvent,
  type AuditReasonCode,
  type GuardResult,
  type StateContext,
  type StateName,
  type StateNode,
  type SystemMode,
  type Transition,
} from "@agenttrading/contracts";
import { AuditLog } from "./audit-log.ts";
import { PermissionRegistry } from "./permission-registry.ts";
import {
  DEFENSIVE_STATE_MODE,
  DEFENSIVE_STATES,
  type DefensiveState,
} from "./topology.ts";

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