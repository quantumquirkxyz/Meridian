import type {
  AuditEvent,
  DataQualityReport,
  EventEnvelope,
  MarketGraphSnapshot,
} from "@agenttrading/contracts";
import { makeEventId } from "@agenttrading/contracts";
import type { EventBus, PublishEvent } from "@agenttrading/events";

/**
 * ObservabilityService: base observability layer for the system (issue #22 AC2).
 *
 * Tracks and records:
 * - **Connector events**: every publish from a connector source.
 * - **Event bus activity**: publish counts, deduplication counts.
 * - **Graph updates**: when the graph snapshot version changes.
 * - **Data quality state**: when quality reports are produced.
 *
 * Every tracked event is published as an AUDIT_EVENT on the event bus so it
 * is durably recorded and queryable alongside other audit events (AC3).
 */
export class ObservabilityService {
  private _eventCount = 0;
  private deduplicatedCount = 0;
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
    if (event.type === "AUDIT_EVENT" && event.source === "observability") {
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

  private recordConnectorEvent(event: EventEnvelope): void {
    const auditEvent: AuditEvent = {
      eventId: makeEventId(["audit", "connector", event.eventId]),
      sequence: 0,
      timestampMs: event.timestampMs,
      action: "CONNECTOR_EVENT",
      actor: event.source,
      data: {
        eventType: event.type,
        originalEventId: event.eventId,
        source: event.source,
        kind: event.kind,
      },
      reasonCodes: ["CONNECTOR_PUBLISHED"],
    };

    const envelope: PublishEvent = {
      eventId: auditEvent.eventId,
      type: "AUDIT_EVENT",
      kind: "normalized",
      timestampMs: event.timestampMs,
      source: "observability",
      payload: auditEvent as unknown as Record<string, unknown>,
    };

    this.bus.publish(envelope);
  }

  private recordGraphUpdate(event: EventEnvelope): void {
    // Graph_UPDATED events carry a MarketGraphSnapshot payload.
    const payload = event.payload as Record<string, unknown>;
    const version = payload.version as number | undefined;

    if (version !== undefined && version !== this._lastGraphVersion) {
      this._lastGraphVersion = version;

      const auditEvent: AuditEvent = {
        eventId: makeEventId(["audit", "graph-update", event.eventId]),
        sequence: 0,
        timestampMs: event.timestampMs,
        action: "GRAPH_UPDATE",
        actor: "graph-engine",
        data: {
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
        reasonCodes: ["GRAPH_NODE_UPSERTED", "GRAPH_EDGE_UPSERTED"],
      };

      const envelope: PublishEvent = {
        eventId: auditEvent.eventId,
        type: "AUDIT_EVENT",
        kind: "normalized",
        timestampMs: event.timestampMs,
        source: "observability",
        payload: auditEvent as unknown as Record<string, unknown>,
      };

      this.bus.publish(envelope);
    }

    this.snapshotEvents.push(event);
  }

  private recordDataQualityEvent(event: EventEnvelope): void {
    const payload = event.payload as Record<string, unknown>;

    const auditEvent: AuditEvent = {
      eventId: makeEventId(["audit", "data-quality", event.eventId]),
      sequence: 0,
      timestampMs: event.timestampMs,
      action: "DATA_QUALITY_EVENT",
      actor: "data-quality-monitor",
      data: {
        eventType: event.type,
        originalEventId: event.eventId,
        source: payload.source,
        state: payload.state,
        score: payload.score,
        reason: payload.reason,
      },
      reasonCodes: ["DATA_QUALITY_EVALUATED"],
    };

    const envelope: PublishEvent = {
      eventId: auditEvent.eventId,
      type: "AUDIT_EVENT",
      kind: "normalized",
      timestampMs: event.timestampMs,
      source: "observability",
      payload: auditEvent as unknown as Record<string, unknown>,
    };

    this.bus.publish(envelope);
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
      (e) => e.source === "observability" || e.source === "opportunity-recorder",
    );
  }

  /**
   * Returns connector audit events filtered by source.
   */
  getConnectorEvents(source?: string): EventEnvelope[] {
    const events = this.bus.store.queryByType("AUDIT_EVENT").filter(
      (e) => e.source === "observability",
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
