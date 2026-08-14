import {
  type AuditAction,
  type AuditEvent,
  type AuditReasonCode,
  type StateName,
} from "@agenttrading/contracts";

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
 * Phase Zero exit criterion of verifiable logs.
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
   * prove the Phase Zero exit criterion: a full opportunity -> reject/approve
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