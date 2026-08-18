import type {
  AuditAction,
  AuditEvent,
  AuditReasonCode,
  DataQualityReport,
  EventEnvelope,
  MarketGraphSnapshot,
} from "@agenttrading/contracts";
import { makeEventId } from "@agenttrading/contracts";
import type { EventBus, PublishEvent } from "@agenttrading/events";

/** Source id used by ObservabilityService when publishing audit events. */
export const OBSERVABILITY_SOURCE = "observability" as const;

/** Source id used by OpportunityRecorder when publishing audit events. */
export const OPPORTUNITY_RECORDER_SOURCE = "opportunity-recorder" as const;

/**
 * ObservabilityService: base observability layer for the system (issue #22 AC2).
 *
 * Tracks and records:
 * - **Connector events**: every publish from a connector source.
 * - **Event bus activity**: publish counts.
 * - **Graph updates**: when the graph snapshot version changes.
 * - **Data quality state**: when quality reports are produced.
 *
 * Every tracked event is published as an AUDIT_EVENT on the event bus so it
 * is durably recorded and queryable alongside other audit events (AC3).
 */
export class ObservabilityService {
  private _eventCount = 0;
  private _lastGraphVersion = -1;
  private readonly snapshotEvents: EventEnvelope[] = [];

  constructor(private readonly bus: EventBus) {}

  /**
   * Hook into the event bus. Subscribes to all base event types and
   * records observability data on each publish.
   *
   * Call this once after construction to activate observability.
   */
  activate(): void {
    const types = [
      "MARKET_TICK",
      "ORDERBOOK_SNAPSHOT",
      "ORDERBOOK_DELTA",
      "POOL_STATE_UPDATE",
      "GAS_UPDATE",
      "FUNDING_UPDATE",
      "DATA_QUALITY_UPDATE",
      "GRAPH_UPDATED",
      "AUDIT_EVENT",
    ] as const;

    for (const type of types) {
      this.bus.subscribe(type, (event) => {
        this.onEvent(event);
      });
    }
  }

  private onEvent(event: EventEnvelope): void {
    // Don't count self-generated audit events.
    if (event.type === "AUDIT_EVENT" && event.source === OBSERVABILITY_SOURCE) {
      return;
    }
    this._eventCount++;

    switch (event.type) {
      case "MARKET_TICK":
      case "ORDERBOOK_SNAPSHOT":
      case "ORDERBOOK_DELTA":
      case "POOL_STATE_UPDATE":
      case "GAS_UPDATE":
      case "FUNDING_UPDATE":
        this.recordConnectorEvent(event);
        break;

      case "GRAPH_UPDATED":
        this.recordGraphUpdate(event);
        break;

      case "DATA_QUALITY_UPDATE":
        this.recordDataQualityEvent(event);
        break;

      case "AUDIT_EVENT":
        // Audit events are self-tracking; don't re-record them.
        break;
    }
  }

  /**
   * Publish an AuditEvent as an AUDIT_EVENT on the bus. Single publish
   * point — all record* methods funnel through here.
   */
  private publishAuditEvent(
    eventId: string,
    action: AuditAction,
    actor: string,
    data: Record<string, unknown>,
    reasonCodes: AuditReasonCode[],
    timestampMs: number,
  ): void {
    const auditEvent: AuditEvent = {
      eventId,
      sequence: 0,
      timestampMs,
      action,
      actor,
      data,
      reasonCodes,
    };

    const envelope: PublishEvent = {
      eventId: auditEvent.eventId,
      type: "AUDIT_EVENT",
      kind: "normalized",
      timestampMs,
      source: OBSERVABILITY_SOURCE,
      payload: auditEvent as unknown as Record<string, unknown>,
    };

    this.bus.publish(envelope);
  }

  private recordConnectorEvent(event: EventEnvelope): void {
    this.publishAuditEvent(
      makeEventId(["audit", "connector", event.eventId]),
      "CONNECTOR_EVENT",
      event.source,
      {
        eventType: event.type,
        originalEventId: event.eventId,
        source: event.source,
        kind: event.kind,
      },
      ["CONNECTOR_PUBLISHED"],
      event.timestampMs,
    );
  }

  private recordGraphUpdate(event: EventEnvelope): void {
    // Graph_UPDATED events carry a MarketGraphSnapshot payload.
    const payload = event.payload as Record<string, unknown>;
    const version = payload.version as number | undefined;

    if (version !== undefined && version !== this._lastGraphVersion) {
      this._lastGraphVersion = version;

      this.publishAuditEvent(
        makeEventId(["audit", "graph-update", event.eventId]),
        "GRAPH_UPDATE",
        "graph-engine",
        {
          eventType: event.type,
          originalEventId: event.eventId,
          graphVersion: version,
          snapshotId: payload.snapshotId,
          nodeCount: Array.isArray(payload.nodes)
            ? payload.nodes.length
            : undefined,
          edgeCount: Array.isArray(payload.edges)
            ? payload.edges.length
            : undefined,
        },
        ["GRAPH_NODE_UPSERTED", "GRAPH_EDGE_UPSERTED"],
        event.timestampMs,
      );
    }

    this.snapshotEvents.push(event);
  }

  private recordDataQualityEvent(event: EventEnvelope): void {
    const payload = event.payload as Record<string, unknown>;

    this.publishAuditEvent(
      makeEventId(["audit", "data-quality", event.eventId]),
      "DATA_QUALITY_EVENT",
      "data-quality-monitor",
      {
        eventType: event.type,
        originalEventId: event.eventId,
        source: payload.source,
        state: payload.state,
        score: payload.score,
        reason: payload.reason,
      },
      ["DATA_QUALITY_EVALUATED"],
      event.timestampMs,
    );
  }

  // ── Snapshot queries ──────────────────────────────────────────────

  /** Total events observed since activation. */
  get eventCount(): number {
    return this._eventCount;
  }

  /** Number of graph update events observed. */
  get graphUpdateCount(): number {
    return this.snapshotEvents.length;
  }

  /** The last observed graph version, or -1 if none. */
  get lastGraphVersion(): number {
    return this._lastGraphVersion;
  }

  /** All graph UPDATED events observed, in order. */
  get graphSnapshots(): readonly EventEnvelope[] {
    return this.snapshotEvents;
  }

  /**
   * Returns all AUDIT_EVENTs produced by the observability service
   * (connector, graph, data quality events).
   */
  getAuditEvents(): EventEnvelope[] {
    return this.bus.store.queryByType("AUDIT_EVENT").filter(
      (e) => e.source === OBSERVABILITY_SOURCE || e.source === OPPORTUNITY_RECORDER_SOURCE,
    );
  }

  /**
   * Returns connector audit events filtered by source.
   */
  getConnectorEvents(source?: string): EventEnvelope[] {
    const events = this.bus.store.queryByType("AUDIT_EVENT").filter(
      (e) => e.source === OBSERVABILITY_SOURCE,
    );
    if (source) {
      return events.filter((e) => {
        const data = e.payload as Record<string, unknown>;
        return data.actor === source;
      });
    }
    return events;
  }

  /**
   * Returns data quality audit events, optionally filtered by source.
   */
  getDataQualityEvents(source?: string): EventEnvelope[] {
    const events = this.bus.store.queryByType("AUDIT_EVENT").filter(
      (e) => {
        const payload = e.payload as Record<string, unknown>;
        return payload.action === "DATA_QUALITY_EVENT";
      },
    );
    if (source) {
      return events.filter((e) => {
        const data = e.payload as Record<string, unknown>;
        const innerData = data.data as Record<string, unknown> | undefined;
        return innerData?.source === source;
      });
    }
    return events;
  }
}
