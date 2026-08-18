import { describe, expect, test } from "bun:test";
import { EventBus } from "@agenttrading/events";
import { EventStore } from "@agenttrading/events";
import { OpportunityRecorder } from "../src/opportunity-recorder.ts";
import type { OpportunityCandidate, CostBreakdown } from "@agenttrading/contracts";

function makeCandidate(
  overrides: Partial<OpportunityCandidate> = {},
): OpportunityCandidate {
  const costs: CostBreakdown = {
    tradingFeesUsd: 1.5,
    slippageUsd: 0.8,
    gasUsd: 2.0,
    bridgeCostUsd: 0,
    fundingCostUsd: 0.3,
    latencyRiskUsd: 0.1,
    failureRiskUsd: 0.5,
    safetyBufferUsd: 1.0,
  };

  return {
    id: "opp:test:1",
    snapshotId: "snap:test:1",
    route: ["venue:bybit", "asset:BTC", "venue:pancakeswap-v4"],
    grossSpreadUsd: 100,
    costs,
    expectedNetProfitUsd: 93.8,
    createdAtMs: 1_700_000_000_000,
    status: "CANDIDATE",
    maxCapitalUsd: 50_000,
    confidence: 0.85,
    riskConcentration: { "venue:bybit": 0.1 },
    ...overrides,
  };
}

describe("OpportunityRecorder (issue #22 AC1)", () => {
  test("records a candidate as an AUDIT_EVENT in the event bus", () => {
    const store = new EventStore(":memory:");
    const bus = new EventBus(store);
    const recorder = new OpportunityRecorder(bus);

    const candidate = makeCandidate();
    const envelope = recorder.record(candidate);

    expect(envelope.type).toBe("AUDIT_EVENT");
    expect(envelope.kind).toBe("normalized");
    expect(envelope.source).toBe("opportunity-recorder");
    expect(store.count()).toBe(1);
  });

  test("audit event embeds full cost breakdown", () => {
    const store = new EventStore(":memory:");
    const bus = new EventBus(store);
    const recorder = new OpportunityRecorder(bus);

    const candidate = makeCandidate();
    recorder.record(candidate);

    const auditEvent = store.all()[0];
    const payload = auditEvent.payload as Record<string, unknown>;

    expect(payload.action).toBe("OPPORTUNITY_RECORDED");
    expect(payload.actor).toBe("opportunity-recorder");

    const data = payload.data as Record<string, unknown>;
    expect(data.candidateId).toBe(candidate.id);
    expect(data.snapshotId).toBe(candidate.snapshotId);
    expect(data.route).toEqual(candidate.route);
    expect(data.grossSpreadUsd).toBe(candidate.grossSpreadUsd);
    expect(data.expectedNetProfitUsd).toBe(candidate.expectedNetProfitUsd);
    expect(data.status).toBe("CANDIDATE");

    const costs = data.costs as CostBreakdown;
    expect(costs.tradingFeesUsd).toBe(1.5);
    expect(costs.slippageUsd).toBe(0.8);
    expect(costs.gasUsd).toBe(2.0);
    expect(costs.bridgeCostUsd).toBe(0);
    expect(costs.fundingCostUsd).toBe(0.3);
    expect(costs.latencyRiskUsd).toBe(0.1);
    expect(costs.failureRiskUsd).toBe(0.5);
    expect(costs.safetyBufferUsd).toBe(1.0);
  });

  test("audit event embeds invalidation reasons for INVALID candidates", () => {
    const store = new EventStore(":memory:");
    const bus = new EventBus(store);
    const recorder = new OpportunityRecorder(bus);

    const candidate = makeCandidate({
      status: "INVALID",
      expectedNetProfitUsd: -5,
      invalidationReasons: ["MIN_EDGE"],
    });
    recorder.record(candidate);

    const auditEvent = store.all()[0];
    const payload = auditEvent.payload as Record<string, unknown>;
    const data = payload.data as Record<string, unknown>;

    expect(data.status).toBe("INVALID");
    expect(data.invalidationReasons).toEqual(["MIN_EDGE"]);
  });

  test("audit event includes graph snapshot metadata when provided", () => {
    const store = new EventStore(":memory:");
    const bus = new EventBus(store);
    const recorder = new OpportunityRecorder(bus);

    const candidate = makeCandidate();
    const snapshot = {
      version: 42,
      snapshotId: "snap:test:1",
      createdAtMs: 1_700_000_000_000,
      nodes: [{ id: "asset:BTC", type: "ASSET" as const }],
      edges: [
        {
          id: "e1",
          from: "venue:bybit",
          to: "asset:BTC",
          type: "ORDER_BOOK" as const,
          weights: { price: 42_000 },
          tradable: true,
          source: "bybit-ws",
        },
      ],
    };
    recorder.record(candidate, snapshot);

    const auditEvent = store.all()[0];
    const payload = auditEvent.payload as Record<string, unknown>;
    const data = payload.data as Record<string, unknown>;

    expect(data.graphSnapshotVersion).toBe(42);
    expect(data.graphNodeCount).toBe(1);
    expect(data.graphEdgeCount).toBe(1);
  });

  test("multiple recorded candidates produce separate audit events", () => {
    const store = new EventStore(":memory:");
    const bus = new EventBus(store);
    const recorder = new OpportunityRecorder(bus);

    recorder.record(makeCandidate({ id: "opp:1" }));
    recorder.record(makeCandidate({ id: "opp:2" }));
    recorder.record(makeCandidate({ id: "opp:3" }));

    expect(store.count()).toBe(3);

    const all = store.all();
    const ids = all.map((e) => {
      const payload = e.payload as Record<string, unknown>;
      const data = payload.data as Record<string, unknown>;
      return data.candidateId;
    });
    expect(ids).toEqual(["opp:1", "opp:2", "opp:3"]);
  });

  test("audit events are queryable from the event store", () => {
    const store = new EventStore(":memory:");
    const bus = new EventBus(store);
    const recorder = new OpportunityRecorder(bus);

    // Publish a non-audit event first.
    bus.publish({
      eventId: "tick-1",
      type: "MARKET_TICK",
      kind: "normalized",
      timestampMs: 1_000,
      source: "bybit-ws",
      payload: {
        venue: "bybit",
        symbol: "BTC/USDT",
        timestampMs: 1_000,
        bid: 30_000,
        ask: 30_001,
        mid: 30_000.5,
        depth: 1_000_000,
        latencyMs: 10,
        source: "bybit-ws",
      },
    });

    recorder.record(makeCandidate());

    // queryAuditEvents returns only AUDIT_EVENTs.
    const auditEvents = store.queryAuditEvents();
    expect(auditEvents).toHaveLength(1);
    expect(auditEvents[0].type).toBe("AUDIT_EVENT");
  });

  test("audit event reasonCodes include OPPORTUNITY_RECORDED", () => {
    const store = new EventStore(":memory:");
    const bus = new EventBus(store);
    const recorder = new OpportunityRecorder(bus);

    recorder.record(makeCandidate());

    const auditEvent = store.all()[0];
    const payload = auditEvent.payload as Record<string, unknown>;
    expect(payload.reasonCodes).toEqual(["OPPORTUNITY_RECORDED"]);
  });
});
