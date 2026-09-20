/**
 * AuditReconstructor: end-to-end trade timeline reconstruction (issue #39).
 *
 * Acceptance criteria:
 *   AC1: Every trade is reconstructable end to end with reason codes.
 *   AC4: Audit unavailability blocks trading (invariant).
 *
 * The reconstructor is deterministic — no LLM, no I/O. It takes
 * audit events and trade journal entries and assembles a complete
 * TradeReconstruction for each trade.
 *
 * Usage:
 * ```ts
 * const reconstructor = new AuditReconstructor();
 * reconstructor.addAuditEvents(audit.all());
 * const reconstruction = reconstructor.reconstruct("trade-1");
 * const allReconstructions = reconstructor.reconstructAll();
 * const available = reconstructor.isAvailable(nowMs);
 * ```
 */

import type {
  AuditEvent,
  AuditReasonCode,
  TradeJournalEntry,
  TradeReconstruction,
  TimelineEvent,
  TimelinePhase,
  AuditAvailability,
} from "@agenttrading/contracts";
import { DEFAULT_AUDIT_AVAILABILITY } from "@agenttrading/contracts";
import { evaluateAuditStaleness } from "@agenttrading/core-session";

// ── Timeline Mapping ────────────────────────────────────────────────

/**
 * Map audit action strings to timeline phases.
 * This mapping determines how audit events are classified in the
 * trade reconstruction timeline.
 *
 * STATE_TRANSITION is mapped dynamically based on the event's actor:
 *   - actor contains "bull" → bull_review
 *   - actor contains "bear" → bear_review
 *   - actor contains "skeptic" → skeptic_review
 *   - actor contains "risk" → risk_analyst_consulted
 *   - default → signal_generated
 */
const ACTION_TO_PHASE: Record<string, TimelinePhase> = {
  OPPORTUNITY_DETECTED: "opportunity_detected",
  DATA_QUALITY_EVENT: "data_quality_evaluated",
  GRAPH_UPDATE: "graph_snapshot",
  CONNECTOR_EVENT: "exchange_confirmation",
  RISK_DECISION: "risk_decision",
  ORDER_INTENT_CREATED: "order_intent_created",
  STATE_TRANSITION: "signal_generated",
  OPPORTUNITY_RECORDED: "position_closed",
};

/**
 * Resolve the timeline phase for a STATE_TRANSITION event based on
 * the actor. This enables SP1 (risk_analyst_consulted) and SP2
 * (bull/bear/skeptic) timeline phases.
 */
function resolveTransitionPhase(event: AuditEvent): TimelinePhase {
  // Read actor from the top-level field (AuditEvent.actor), not from data.
  const actor = event.actor.toLowerCase();
  // Also check data for secondary signals (e.g. action type).
  const dataAction = (event.data?.["action"] as string)?.toLowerCase() ?? "";

  // SP2: Map deliberative agent debate stages.
  if (actor.includes("bull") || dataAction.includes("bull")) return "bull_review";
  if (actor.includes("bear") || dataAction.includes("bear")) return "bear_review";
  if (actor.includes("skeptic") || dataAction.includes("skeptic")) return "skeptic_review";

  // SP1: Map risk analyst consultation.
  if (actor.includes("risk") || dataAction.includes("risk_analyst")) return "risk_analyst_consulted";

  return "signal_generated";
}

/**
 * Extract a trade identifier from audit event data.
 * Audit events reference trades via orderId, tradeId, or symbol fields.
 */
function extractTradeId(event: AuditEvent): string | null {
  const data = event.data;
  if (data === undefined) return null;

  // Check common trade identifier fields.
  if (typeof data["tradeId"] === "string") return data["tradeId"];
  if (typeof data["orderId"] === "string") return data["orderId"];
  if (typeof data["idempotencyKey"] === "string")
    return data["idempotencyKey"];
  if (typeof data["orderIntentIdempotencyKey"] === "string")
    return data["orderIntentIdempotencyKey"];

  return null;
}

// ── AuditReconstructor ───────────────────────────────────────────────

/**
 * AuditReconstructor: assembles end-to-end trade timelines from
 * audit events and trade journal entries.
 */
export class AuditReconstructor {
  private readonly auditEvents: AuditEvent[] = [];
  private readonly tradeEntries: TradeJournalEntry[] = [];
  private availability: AuditAvailability;
  private readonly now: () => number;

  constructor(
    availability?: AuditAvailability,
    now?: () => number,
  ) {
    this.availability = { ...(availability ?? DEFAULT_AUDIT_AVAILABILITY) };
    this.now = now ?? (() => Date.now());
  }

  // ── Data Ingestion ──────────────────────────────────────────────

  /**
   * Add audit events from the AuditLog.
   */
  addAuditEvents(events: readonly AuditEvent[]): void {
    for (const event of events) {
      this.auditEvents.push({ ...event });
    }
  }

  /**
   * Add a single audit event.
   */
  addAuditEvent(event: AuditEvent): void {
    this.auditEvents.push({ ...event });
  }

  /**
   * Add trade journal entries.
   */
  addTradeEntries(entries: readonly TradeJournalEntry[]): void {
    for (const entry of entries) {
      this.tradeEntries.push({ ...entry });
    }
  }

  /**
   * Add a single trade journal entry.
   */
  addTradeEntry(entry: TradeJournalEntry): void {
    this.tradeEntries.push({ ...entry });
  }

  // ── AC4: Audit Availability ────────────────────────────────────

  /**
   * Refresh the internal availability state from audit events.
   * Called before evaluation to sync the availability clock with
   * the latest audit events.
   */
  refreshAvailability(nowMs: number): void {
    // If we have never written, check if that's acceptable.
    if (this.availability.lastWriteAtMs === 0 && this.availability.available) {
      // First check — if we have events, we're available.
      if (this.auditEvents.length > 0) {
        this.availability.lastWriteAtMs =
          this.auditEvents[this.auditEvents.length - 1].timestampMs;
        this.availability.available = true;
        this.availability.error = undefined;
      }
    }
  }

  /**
   * Check if the audit subsystem is available (pure read, no side effects).
   *
   * AC4: Audit unavailability blocks trading. When available returns
   * false, the trading system MUST NOT submit new orders.
   *
   * Callers should invoke refreshAvailability() before isAvailable() when
   * they need the availability clock synced with the latest audit events.
   */
  isAvailable(nowMs?: number): AuditAvailability {
    const now = nowMs ?? this.now();
    const result = evaluateAuditStaleness(this.availability, now);
    return {
      available: result.available,
      lastWriteAtMs: this.availability.lastWriteAtMs,
      maxStaleMs: this.availability.maxStaleMs,
      error: result.error,
    };
  }

  /**
   * Record a successful audit write, refreshing the availability clock.
   */
  recordWrite(timestampMs: number): void {
    this.availability.lastWriteAtMs = timestampMs;
    this.availability.available = true;
    this.availability.error = undefined;
  }

  /**
   * Record an audit failure.
   */
  recordFailure(error: string, timestampMs: number): void {
    this.availability.available = false;
    this.availability.error = error;
    this.availability.lastWriteAtMs = timestampMs;
  }

  /**
   * Get the audit availability error that would block trading, or null
   * if audit is available.
   *
   * AC4: Returns the blocking reason when audit is unavailable.
   */
  getBlockingReason(nowMs?: number): string | null {
    const status = this.isAvailable(nowMs);
    if (status.available) return null;
    return status.error ?? "audit unavailable";
  }

  // ── AC1: Trade Reconstruction ──────────────────────────────────

  /**
   * Reconstruct a single trade from its tradeId.
   * Returns null if no journal entry is found for the tradeId.
   *
   * AC1: Every trade is reconstructable end to end with reason codes.
   */
  reconstruct(tradeId: string): TradeReconstruction | null {
    const entry = this.tradeEntries.find((e) => e.tradeId === tradeId);
    if (entry === undefined) return null;

    // Find all audit events that reference this trade.
    const relatedEvents = this.auditEvents.filter((event) => {
      const eventTradeId = extractTradeId(event);
      return eventTradeId === tradeId;
    });

    // Sort events by timestamp.
    const sortedEvents = [...relatedEvents].sort(
      (a, b) => a.timestampMs - b.timestampMs,
    );

    // Convert audit events to timeline events.
    const timeline: TimelineEvent[] = sortedEvents.map((event) => {
      const phase = event.action === "STATE_TRANSITION"
        ? resolveTransitionPhase(event)
        : ACTION_TO_PHASE[event.action] ?? "signal_generated";
      return {
        eventId: event.eventId,
        phase,
        timestampMs: event.timestampMs,
        data: {
          action: event.action,
          actor: event.actor,
          state: event.state,
          ...(event.data ?? {}),
        },
        reasonCodes: (event.reasonCodes ?? []) as AuditReasonCode[],
      };
    });

    // Extract incident flags from timeline data.
    const incidentFlags: string[] = [];
    const lessons: string[] = [];

    for (const te of timeline) {
      if (typeof te.data["incident"] === "string") {
        incidentFlags.push(te.data["incident"] as string);
      }
      if (typeof te.data["lesson"] === "string") {
        lessons.push(te.data["lesson"] as string);
      }
      // Check for error states that indicate incidents.
      if (
        te.data["state"] === "HALT" ||
        te.data["state"] === "CANCEL_ONLY"
      ) {
        incidentFlags.push(
          `state_${te.data["state"]}_${te.phase}`,
        );
      }
    }

    // Compute slippage from metadata if available.
    const slippageUsd = (entry.metadata?.["slippageUsd"] as number) ?? 0;

    const reconstruction: TradeReconstruction = {
      reconstructionId: `recon-${tradeId}-${this.now()}`,
      tradeId: entry.tradeId,
      strategyId: entry.strategyId,
      regime: entry.regime,
      venue: entry.venue,
      symbol: entry.symbol,
      side: entry.side,
      timeline,
      finalPnlUsd: entry.netPnlUsd,
      feesUsd: entry.feesUsd,
      slippageUsd,
      hasIncidentFlags: incidentFlags.length > 0,
      incidentFlags,
      lessons,
      reconstructedAtMs: this.now(),
    };

    return reconstruction;
  }

  /**
   * Reconstruct all trades that have journal entries.
   * Returns a map of tradeId → TradeReconstruction.
   */
  reconstructAll(): Map<string, TradeReconstruction> {
    const result = new Map<string, TradeReconstruction>();
    for (const entry of this.tradeEntries) {
      const recon = this.reconstruct(entry.tradeId);
      if (recon !== null) {
        result.set(entry.tradeId, recon);
      }
    }
    return result;
  }

  /**
   * Get the number of audit events stored.
   */
  get auditEventCount(): number {
    return this.auditEvents.length;
  }

  /**
   * Get the number of trade entries stored.
   */
  get tradeEntryCount(): number {
    return this.tradeEntries.length;
  }

  /**
   * Clear all stored data.
   */
  clear(): void {
    this.auditEvents.length = 0;
    this.tradeEntries.length = 0;
  }
}
