import type {
  AuditEvent,
  EventEnvelope,
  MarketGraphSnapshot,
  OpportunityCandidate,
} from "@agenttrading/contracts";
import { makeEventId } from "@agenttrading/contracts";
import type { EventBus, PublishEvent } from "@agenttrading/events";

/**
 * OpportunityRecorder: records every OpportunityCandidate as an AUDIT_EVENT
 * in the event bus (issue #22 AC1). The audit event embeds:
 * - The full cost breakdown from the candidate.
 * - The graph snapshot id that produced the candidate.
 * - The route and invalidation reasons.
 *
 * This makes every opportunity auditable: which graph state produced it, what
 * costs were considered, and why it was accepted or rejected.
 */
export class OpportunityRecorder {
  private sequence = 0;

  constructor(private readonly bus: EventBus) {}

  /**
   * Record an OpportunityCandidate as an AUDIT_EVENT. The candidate's
   * snapshotId, costs, route, status, and invalidationReasons are embedded
   * in the audit event's `data` field.
   *
   * Returns the published EventEnvelope wrapping the audit event.
   */
  record(
    candidate: OpportunityCandidate,
    snapshot?: MarketGraphSnapshot,
  ): EventEnvelope {
    const data: Record<string, unknown> = {
      candidateId: candidate.id,
      snapshotId: candidate.snapshotId,
      route: candidate.route,
      grossSpreadUsd: candidate.grossSpreadUsd,
      costs: candidate.costs,
      expectedNetProfitUsd: candidate.expectedNetProfitUsd,
      status: candidate.status,
      invalidationReasons: candidate.invalidationReasons,
      maxCapitalUsd: candidate.maxCapitalUsd,
      confidence: candidate.confidence,
      riskConcentration: candidate.riskConcentration,
    };

    if (snapshot) {
      data.graphSnapshotVersion = snapshot.version;
      data.graphNodeCount = snapshot.nodes.length;
      data.graphEdgeCount = snapshot.edges.length;
    }

    const auditEvent: AuditEvent = {
      eventId: makeEventId([
        "audit",
        "opportunity-recorded",
        candidate.id,
      ]),
      sequence: 0, // assigned by store
      timestampMs: candidate.createdAtMs,
      action: "OPPORTUNITY_RECORDED",
      actor: "opportunity-recorder",
      data,
      reasonCodes: ["OPPORTUNITY_RECORDED"],
    };

    // Wrap the AuditEvent in an EventEnvelope and publish via the bus.
    const envelope: PublishEvent = {
      eventId: auditEvent.eventId,
      type: "AUDIT_EVENT",
      kind: "normalized",
      timestampMs: candidate.createdAtMs,
      source: "opportunity-recorder",
      payload: auditEvent as unknown as Record<string, unknown>,
    };

    return this.bus.publish(envelope).event;
  }
}
