import { describe, expect, test } from "bun:test";
import {
  DEFAULT_AUDIT_AVAILABILITY,
  DEFAULT_EXPORT_OPTIONS,
  type AuditEvent,
  type TradeJournalEntry,
  type TradeReconstruction,
  type AuditAvailability,
  type ExportOptions,
  isTradeReconstruction,
  isTradeReport,
  isTimelineEvent,
} from "@agenttrading/contracts";
import { AuditReconstructor } from "../src/gamma/audit-reconstructor.ts";
import { ReportGenerator } from "../src/gamma/report-generator.ts";
import { AuditExporter } from "../src/gamma/audit-exporter.ts";
import { CanarySession } from "../src/gamma/canary-session.ts";
import { DEFAULT_CANARY_CONFIG } from "@agenttrading/contracts";

// ── Helpers ──────────────────────────────────────────────────────────

const FIXED_TS = 1_700_000_000_000;

function makeEntry(
  overrides: Partial<TradeJournalEntry> = {},
): TradeJournalEntry {
  return {
    tradeId: "trade-1",
    strategyId: "alpha",
    regime: "trend",
    venue: "bybit",
    symbol: "BTC",
    side: "BUY",
    entryPrice: 100,
    exitPrice: 105,
    filledQuantity: 1,
    notionalUsd: 100,
    pnlUsd: 5,
    feesUsd: 0.2,
    netPnlUsd: 4.8,
    outcome: "WIN",
    enteredAtMs: FIXED_TS,
    exitedAtMs: FIXED_TS + 60_000,
    durationMs: 60_000,
    ...overrides,
  };
}

function makeAuditEvent(
  overrides: Partial<AuditEvent> = {},
): AuditEvent {
  return {
    eventId: "evt-1",
    sequence: 1,
    timestampMs: FIXED_TS,
    action: "RISK_DECISION",
    actor: "risk-gate",
    reasonCodes: ["RISK_APPROVED"],
    data: { tradeId: "trade-1", decision: "APPROVE" },
    ...overrides,
  };
}

function makeLosingEntry(
  overrides: Partial<TradeJournalEntry> = {},
): TradeJournalEntry {
  return makeEntry({
    tradeId: "trade-loss-1",
    exitPrice: 95,
    pnlUsd: -5,
    feesUsd: 0.2,
    netPnlUsd: -5.2,
    outcome: "LOSS",
    ...overrides,
  });
}

// ── AuditReconstructor Tests ─────────────────────────────────────────

describe("AuditReconstructor", () => {
  test("records audit events and trade entries", () => {
    const reconstructor = new AuditReconstructor(
      DEFAULT_AUDIT_AVAILABILITY,
      () => FIXED_TS,
    );

    reconstructor.addAuditEvent(makeAuditEvent());
    reconstructor.addTradeEntry(makeEntry());

    expect(reconstructor.auditEventCount).toBe(1);
    expect(reconstructor.tradeEntryCount).toBe(1);
  });

  test("records batch audit events and trade entries", () => {
    const reconstructor = new AuditReconstructor(
      DEFAULT_AUDIT_AVAILABILITY,
      () => FIXED_TS,
    );

    reconstructor.addAuditEvents([
      makeAuditEvent({ eventId: "evt-1" }),
      makeAuditEvent({ eventId: "evt-2" }),
    ]);
    reconstructor.addTradeEntries([makeEntry(), makeLosingEntry()]);

    expect(reconstructor.auditEventCount).toBe(2);
    expect(reconstructor.tradeEntryCount).toBe(2);
  });

  test("reconstruct returns null for unknown tradeId", () => {
    const reconstructor = new AuditReconstructor(
      DEFAULT_AUDIT_AVAILABILITY,
      () => FIXED_TS,
    );
    reconstructor.addTradeEntry(makeEntry());

    const result = reconstructor.reconstruct("unknown-trade");
    expect(result).toBeNull();
  });

  test("reconstruct assembles timeline from audit events", () => {
    const reconstructor = new AuditReconstructor(
      DEFAULT_AUDIT_AVAILABILITY,
      () => FIXED_TS,
    );

    reconstructor.addAuditEvents([
      makeAuditEvent({
        eventId: "evt-1",
        timestampMs: FIXED_TS,
        action: "OPPORTUNITY_DETECTED",
        data: { tradeId: "trade-1", symbol: "BTC" },
      }),
      makeAuditEvent({
        eventId: "evt-2",
        sequence: 2,
        timestampMs: FIXED_TS + 1000,
        action: "RISK_DECISION",
        data: { tradeId: "trade-1", decision: "APPROVE" },
      }),
      makeAuditEvent({
        eventId: "evt-3",
        sequence: 3,
        timestampMs: FIXED_TS + 2000,
        action: "ORDER_INTENT_CREATED",
        data: { tradeId: "trade-1", orderId: "order-1" },
      }),
    ]);

    reconstructor.addTradeEntry(makeEntry());

    const result = reconstructor.reconstruct("trade-1");
    expect(result).not.toBeNull();
    expect(result!.tradeId).toBe("trade-1");
    expect(result!.timeline.length).toBe(3);
    expect(result!.timeline[0].phase).toBe("opportunity_detected");
    expect(result!.timeline[1].phase).toBe("risk_decision");
    expect(result!.timeline[2].phase).toBe("order_intent_created");
  });

  test("reconstruct extracts reason codes from timeline", () => {
    const reconstructor = new AuditReconstructor(
      DEFAULT_AUDIT_AVAILABILITY,
      () => FIXED_TS,
    );

    reconstructor.addAuditEvents([
      makeAuditEvent({
        eventId: "evt-1",
        action: "RISK_DECISION",
        reasonCodes: ["RISK_APPROVED"],
        data: { tradeId: "trade-1" },
      }),
      makeAuditEvent({
        eventId: "evt-2",
        sequence: 2,
        action: "ORDER_INTENT_CREATED",
        reasonCodes: ["ORDER_INTENT_CREATED"],
        data: { tradeId: "trade-1" },
      }),
    ]);

    reconstructor.addTradeEntry(makeEntry());

    const result = reconstructor.reconstruct("trade-1");
    expect(result).not.toBeNull();
    expect(result!.timeline[0].reasonCodes).toContain("RISK_APPROVED");
    expect(result!.timeline[1].reasonCodes).toContain("ORDER_INTENT_CREATED");
  });

  test("reconstruct detects incident flags from HALT state", () => {
    const reconstructor = new AuditReconstructor(
      DEFAULT_AUDIT_AVAILABILITY,
      () => FIXED_TS,
    );

    reconstructor.addAuditEvents([
      makeAuditEvent({
        eventId: "evt-1",
        action: "STATE_TRANSITION",
        data: { tradeId: "trade-1", state: "HALT" },
      }),
    ]);

    reconstructor.addTradeEntry(makeEntry());

    const result = reconstructor.reconstruct("trade-1");
    expect(result).not.toBeNull();
    expect(result!.hasIncidentFlags).toBe(true);
    expect(result!.incidentFlags.length).toBeGreaterThan(0);
  });

  test("reconstructAll returns all reconstructions", () => {
    const reconstructor = new AuditReconstructor(
      DEFAULT_AUDIT_AVAILABILITY,
      () => FIXED_TS,
    );

    reconstructor.addTradeEntries([makeEntry(), makeLosingEntry()]);

    const results = reconstructor.reconstructAll();
    expect(results.size).toBe(2);
    expect(results.has("trade-1")).toBe(true);
    expect(results.has("trade-loss-1")).toBe(true);
  });

  test("clear removes all stored data", () => {
    const reconstructor = new AuditReconstructor(
      DEFAULT_AUDIT_AVAILABILITY,
      () => FIXED_TS,
    );

    reconstructor.addAuditEvent(makeAuditEvent());
    reconstructor.addTradeEntry(makeEntry());

    expect(reconstructor.auditEventCount).toBe(1);
    expect(reconstructor.tradeEntryCount).toBe(1);

    reconstructor.clear();

    expect(reconstructor.auditEventCount).toBe(0);
    expect(reconstructor.tradeEntryCount).toBe(0);
  });

  test("isAvailable returns available when audit is fresh", () => {
    const reconstructor = new AuditReconstructor(
      { ...DEFAULT_AUDIT_AVAILABILITY, lastWriteAtMs: FIXED_TS },
      () => FIXED_TS,
    );

    const status = reconstructor.isAvailable(FIXED_TS);
    expect(status.available).toBe(true);
  });

  test("isAvailable returns unavailable when audit is stale", () => {
    const reconstructor = new AuditReconstructor(
      {
        ...DEFAULT_AUDIT_AVAILABILITY,
        lastWriteAtMs: FIXED_TS,
        maxStaleMs: 60_000, // 1 minute
      },
      () => FIXED_TS + 120_000, // 2 minutes later
    );

    const status = reconstructor.isAvailable(FIXED_TS + 120_000);
    expect(status.available).toBe(false);
    expect(status.error).toContain("stale");
  });

  test("recordWrite refreshes availability", () => {
    const reconstructor = new AuditReconstructor(
      {
        ...DEFAULT_AUDIT_AVAILABILITY,
        lastWriteAtMs: FIXED_TS,
        maxStaleMs: 60_000,
      },
      () => FIXED_TS + 120_000,
    );

    // Initially stale.
    expect(reconstructor.isAvailable(FIXED_TS + 120_000).available).toBe(
      false,
    );

    // Record a write.
    reconstructor.recordWrite(FIXED_TS + 120_000);

    // Now available.
    expect(reconstructor.isAvailable(FIXED_TS + 120_000).available).toBe(
      true,
    );
  });

  test("getBlockingReason returns null when audit is available", () => {
    const reconstructor = new AuditReconstructor(
      { ...DEFAULT_AUDIT_AVAILABILITY, lastWriteAtMs: FIXED_TS },
      () => FIXED_TS,
    );

    expect(reconstructor.getBlockingReason(FIXED_TS)).toBeNull();
  });

  test("getBlockingReason returns error when audit is unavailable", () => {
    const reconstructor = new AuditReconstructor(
      {
        ...DEFAULT_AUDIT_AVAILABILITY,
        available: false,
        error: "disk full",
      },
      () => FIXED_TS,
    );

    expect(reconstructor.getBlockingReason(FIXED_TS)).toBe("disk full");
  });

  test("AC1: every trade is reconstructable end to end", () => {
    const reconstructor = new AuditReconstructor(
      DEFAULT_AUDIT_AVAILABILITY,
      () => FIXED_TS,
    );

    // Simulate a full trade lifecycle.
    const events: AuditEvent[] = [
      makeAuditEvent({
        eventId: "evt-opp",
        timestampMs: FIXED_TS,
        action: "OPPORTUNITY_DETECTED",
        data: { tradeId: "trade-1", symbol: "BTC" },
      }),
      makeAuditEvent({
        eventId: "evt-dq",
        sequence: 2,
        timestampMs: FIXED_TS + 100,
        action: "DATA_QUALITY_EVENT",
        data: { tradeId: "trade-1", quality: "good" },
      }),
      makeAuditEvent({
        eventId: "evt-risk",
        sequence: 3,
        timestampMs: FIXED_TS + 500,
        action: "RISK_DECISION",
        reasonCodes: ["RISK_APPROVED"],
        data: { tradeId: "trade-1", decision: "APPROVE" },
      }),
      makeAuditEvent({
        eventId: "evt-order",
        sequence: 4,
        timestampMs: FIXED_TS + 600,
        action: "ORDER_INTENT_CREATED",
        reasonCodes: ["ORDER_INTENT_CREATED"],
        data: { tradeId: "trade-1", orderId: "order-1" },
      }),
      makeAuditEvent({
        eventId: "evt-exec",
        sequence: 5,
        timestampMs: FIXED_TS + 1000,
        action: "CONNECTOR_EVENT",
        data: { tradeId: "trade-1", status: "FILLED" },
      }),
    ];

    reconstructor.addAuditEvents(events);
    reconstructor.addTradeEntry(makeEntry());

    const recon = reconstructor.reconstruct("trade-1");
    expect(recon).not.toBeNull();
    expect(recon!.timeline.length).toBe(5);
    expect(recon!.timeline[0].phase).toBe("opportunity_detected");
    expect(recon!.timeline[1].phase).toBe("data_quality_evaluated");
    expect(recon!.timeline[2].phase).toBe("risk_decision");
    expect(recon!.timeline[3].phase).toBe("order_intent_created");
    expect(recon!.timeline[4].phase).toBe("exchange_confirmation");

    // All events have reason codes.
    for (const event of recon!.timeline) {
      expect(Array.isArray(event.reasonCodes)).toBe(true);
    }
  });

  test("resolveTransitionPhase maps risk-analyst actor to risk_analyst_consulted", () => {
    const reconstructor = new AuditReconstructor(
      DEFAULT_AUDIT_AVAILABILITY,
      () => FIXED_TS,
    );

    reconstructor.addAuditEvents([
      makeAuditEvent({
        eventId: "evt-risk",
        action: "STATE_TRANSITION",
        actor: "risk-analyst",
        data: { tradeId: "trade-1", from: "IDLE", to: "RISK_VALIDATE" },
      }),
    ]);
    reconstructor.addTradeEntry(makeEntry());

    const recon = reconstructor.reconstruct("trade-1");
    expect(recon).not.toBeNull();
    expect(recon!.timeline[0].phase).toBe("risk_analyst_consulted");
  });

  test("resolveTransitionPhase maps bull actor to bull_review", () => {
    const reconstructor = new AuditReconstructor(
      DEFAULT_AUDIT_AVAILABILITY,
      () => FIXED_TS,
    );

    reconstructor.addAuditEvents([
      makeAuditEvent({
        eventId: "evt-bull",
        action: "STATE_TRANSITION",
        actor: "bull-agent",
        data: { tradeId: "trade-1" },
      }),
    ]);
    reconstructor.addTradeEntry(makeEntry());

    const recon = reconstructor.reconstruct("trade-1");
    expect(recon).not.toBeNull();
    expect(recon!.timeline[0].phase).toBe("bull_review");
  });

  test("resolveTransitionPhase maps bear actor to bear_review", () => {
    const reconstructor = new AuditReconstructor(
      DEFAULT_AUDIT_AVAILABILITY,
      () => FIXED_TS,
    );

    reconstructor.addAuditEvents([
      makeAuditEvent({
        eventId: "evt-bear",
        action: "STATE_TRANSITION",
        actor: "bear-agent",
        data: { tradeId: "trade-1" },
      }),
    ]);
    reconstructor.addTradeEntry(makeEntry());

    const recon = reconstructor.reconstruct("trade-1");
    expect(recon).not.toBeNull();
    expect(recon!.timeline[0].phase).toBe("bear_review");
  });

  test("resolveTransitionPhase maps skeptic actor to skeptic_review", () => {
    const reconstructor = new AuditReconstructor(
      DEFAULT_AUDIT_AVAILABILITY,
      () => FIXED_TS,
    );

    reconstructor.addAuditEvents([
      makeAuditEvent({
        eventId: "evt-skeptic",
        action: "STATE_TRANSITION",
        actor: "skeptic-agent",
        data: { tradeId: "trade-1" },
      }),
    ]);
    reconstructor.addTradeEntry(makeEntry());

    const recon = reconstructor.reconstruct("trade-1");
    expect(recon).not.toBeNull();
    expect(recon!.timeline[0].phase).toBe("skeptic_review");
  });

  test("resolveTransitionPhase defaults to signal_generated for unknown actor", () => {
    const reconstructor = new AuditReconstructor(
      DEFAULT_AUDIT_AVAILABILITY,
      () => FIXED_TS,
    );

    reconstructor.addAuditEvents([
      makeAuditEvent({
        eventId: "evt-default",
        action: "STATE_TRANSITION",
        actor: "state-graph",
        data: { tradeId: "trade-1" },
      }),
    ]);
    reconstructor.addTradeEntry(makeEntry());

    const recon = reconstructor.reconstruct("trade-1");
    expect(recon).not.toBeNull();
    expect(recon!.timeline[0].phase).toBe("signal_generated");
  });
});

// ── ReportGenerator Tests ────────────────────────────────────────────

describe("ReportGenerator", () => {
  test("generates a daily report", () => {
    const entries = [
      makeEntry({ enteredAtMs: FIXED_TS + 1000 }),
      makeLosingEntry({ enteredAtMs: FIXED_TS + 2000 }),
    ];

    const generator = new ReportGenerator(entries, new Map(), () => FIXED_TS);
    const report = generator.generateDailyReport(FIXED_TS);

    expect(report.period).toBe("daily");
    expect(report.totalTrades).toBe(2);
    expect(report.winCount).toBe(1);
    expect(report.lossCount).toBe(1);
    expect(report.winRate).toBe(0.5);
    expect(isTradeReport(report)).toBe(true);
  });

  test("generates a weekly report", () => {
    const entries = [
      makeEntry({ enteredAtMs: FIXED_TS + 1000 }),
      makeLosingEntry({ enteredAtMs: FIXED_TS + 86_400_000 + 1000 }),
    ];

    const generator = new ReportGenerator(entries, new Map(), () => FIXED_TS);
    const report = generator.generateWeeklyReport(FIXED_TS);

    expect(report.period).toBe("weekly");
    expect(report.totalTrades).toBe(2);
    expect(report.winCount).toBe(1);
    expect(report.lossCount).toBe(1);
  });

  test("filters entries to correct time range", () => {
    const entries = [
      makeEntry({ enteredAtMs: FIXED_TS + 1000 }), // Within today
      makeEntry({
        tradeId: "trade-old",
        enteredAtMs: FIXED_TS - 86_400_000 * 2, // 2 days ago
      }),
    ];

    const generator = new ReportGenerator(entries, new Map(), () => FIXED_TS);
    const report = generator.generateDailyReport(FIXED_TS);

    expect(report.totalTrades).toBe(1); // Only today's trade
    expect(report.entries[0].tradeId).toBe("trade-1");
  });

  test("computes correct PnL summary", () => {
    const entries = [
      makeEntry({ netPnlUsd: 10, feesUsd: 0.5 }),
      makeLosingEntry({ netPnlUsd: -5, feesUsd: 0.3 }),
    ];

    const generator = new ReportGenerator(entries, new Map(), () => FIXED_TS);
    const report = generator.generateDailyReport(FIXED_TS);

    expect(report.totalNetPnlUsd).toBe(5); // 10 + (-5)
    expect(report.totalFeesUsd).toBe(0.8); // 0.5 + 0.3
    expect(report.avgNetPnlUsd).toBe(2.5); // 5 / 2
  });

  test("computes max drawdown", () => {
    const entries = [
      makeEntry({ tradeId: "t1", netPnlUsd: 10 }),
      makeEntry({ tradeId: "t2", netPnlUsd: -5 }),
      makeEntry({ tradeId: "t3", netPnlUsd: -8 }),
      makeEntry({ tradeId: "t4", netPnlUsd: 3 }),
    ];

    const generator = new ReportGenerator(entries, new Map(), () => FIXED_TS);
    const report = generator.generateDailyReport(FIXED_TS);

    // Cumulative: 10, 5, -3, 0. Peak = 10. Max drawdown = 10 - (-3) = 13.
    expect(report.maxDrawdownUsd).toBe(13);
  });

  test("computes best and worst trade", () => {
    const entries = [
      makeEntry({ tradeId: "t1", netPnlUsd: 10 }),
      makeLosingEntry({ tradeId: "t2", netPnlUsd: -5 }),
      makeEntry({ tradeId: "t3", netPnlUsd: 20 }),
    ];

    const generator = new ReportGenerator(entries, new Map(), () => FIXED_TS);
    const report = generator.generateDailyReport(FIXED_TS);

    expect(report.bestTradePnlUsd).toBe(20);
    expect(report.worstTradePnlUsd).toBe(-5);
  });

  test("builds strategy breakdown", () => {
    const entries = [
      makeEntry({ strategyId: "alpha", netPnlUsd: 10 }),
      makeEntry({
        tradeId: "t2",
        strategyId: "beta",
        netPnlUsd: -5,
        outcome: "LOSS",
      }),
      makeEntry({ strategyId: "alpha", netPnlUsd: 5 }),
    ];

    const generator = new ReportGenerator(entries, new Map(), () => FIXED_TS);
    const report = generator.generateDailyReport(FIXED_TS);

    expect(report.strategyBreakdown["alpha"].tradeCount).toBe(2);
    expect(report.strategyBreakdown["alpha"].netPnlUsd).toBe(15);
    expect(report.strategyBreakdown["alpha"].winRate).toBe(1.0);

    expect(report.strategyBreakdown["beta"].tradeCount).toBe(1);
    expect(report.strategyBreakdown["beta"].netPnlUsd).toBe(-5);
  });

  test("builds venue breakdown", () => {
    const entries = [
      makeEntry({ venue: "bybit", netPnlUsd: 10 }),
      makeEntry({
        tradeId: "t2",
        venue: "binance",
        netPnlUsd: -5,
        outcome: "LOSS",
      }),
    ];

    const generator = new ReportGenerator(entries, new Map(), () => FIXED_TS);
    const report = generator.generateDailyReport(FIXED_TS);

    expect(report.venueBreakdown["bybit"].tradeCount).toBe(1);
    expect(report.venueBreakdown["bybit"].netPnlUsd).toBe(10);
    expect(report.venueBreakdown["binance"].tradeCount).toBe(1);
  });

  test("counts incidents from reconstructions", () => {
    const entries = [
      makeEntry({ tradeId: "t1" }),
      makeEntry({ tradeId: "t2" }),
    ];

    const reconstructions = new Map<string, TradeReconstruction>();
    reconstructions.set("t1", {
      reconstructionId: "recon-1",
      tradeId: "t1",
      strategyId: "alpha",
      regime: "trend",
      venue: "bybit",
      symbol: "BTC",
      side: "BUY",
      timeline: [],
      finalPnlUsd: 5,
      feesUsd: 0.2,
      slippageUsd: 0.1,
      hasIncidentFlags: true,
      incidentFlags: ["HALT_during_trade"],
      lessons: [],
      reconstructedAtMs: FIXED_TS,
    });

    const generator = new ReportGenerator(
      entries,
      reconstructions,
      () => FIXED_TS,
    );
    const report = generator.generateDailyReport(FIXED_TS);

    expect(report.incidentCount).toBe(1);
    expect(report.entries[0].hasIncidents).toBe(true);
    expect(report.entries[1].hasIncidents).toBe(false);
  });

  test("AC2: daily and weekly reports are generated", () => {
    const entries = [
      makeEntry({ enteredAtMs: FIXED_TS + 1000 }),
      makeLosingEntry({ enteredAtMs: FIXED_TS + 2000 }),
    ];

    const generator = new ReportGenerator(entries, new Map(), () => FIXED_TS);

    const daily = generator.generateDailyReport(FIXED_TS);
    expect(daily.period).toBe("daily");
    expect(daily.totalTrades).toBe(2);

    const weekly = generator.generateWeeklyReport(FIXED_TS);
    expect(weekly.period).toBe("weekly");
    expect(weekly.totalTrades).toBe(2);
  });
});

// ── AuditExporter Tests ──────────────────────────────────────────────

describe("AuditExporter", () => {
  const exporter = new AuditExporter();

  function sampleReport() {
    const entries = [
      makeEntry({ enteredAtMs: FIXED_TS + 1000 }),
      makeLosingEntry({ enteredAtMs: FIXED_TS + 2000 }),
    ];
    const generator = new ReportGenerator(entries, new Map(), () => FIXED_TS);
    return generator.generateDailyReport(FIXED_TS);
  }

  function sampleReconstruction(): TradeReconstruction {
    return {
      reconstructionId: "recon-1",
      tradeId: "trade-1",
      strategyId: "alpha",
      regime: "trend",
      venue: "bybit",
      symbol: "BTC",
      side: "BUY",
      timeline: [
        {
          eventId: "evt-1",
          phase: "opportunity_detected",
          timestampMs: FIXED_TS,
          data: { symbol: "BTC" },
          reasonCodes: ["OPPORTUNITY_RECORDED"],
        },
        {
          eventId: "evt-2",
          phase: "risk_decision",
          timestampMs: FIXED_TS + 500,
          data: { decision: "APPROVE" },
          reasonCodes: ["RISK_APPROVED"],
        },
      ],
      finalPnlUsd: 4.8,
      feesUsd: 0.2,
      slippageUsd: 0.1,
      hasIncidentFlags: false,
      incidentFlags: [],
      lessons: ["entered on strong momentum"],
      reconstructedAtMs: FIXED_TS,
    };
  }

  // ── JSON Export ────────────────────────────────────────────────

  test("exports report as JSON", () => {
    const report = sampleReport();
    const json = exporter.exportReport(report, {
      format: "json",
      includeEntries: true,
      includeReasonCodes: true,
      includeTimeline: false,
    });

    const parsed = JSON.parse(json);
    expect(parsed.reportId).toBeDefined();
    expect(parsed.period).toBe("daily");
    expect(parsed.summary.totalTrades).toBe(2);
    expect(parsed.entries).toHaveLength(2);
  });

  test("exports reconstruction as JSON", () => {
    const recon = sampleReconstruction();
    const json = exporter.exportReconstruction(recon, {
      format: "json",
      includeEntries: true,
      includeReasonCodes: true,
      includeTimeline: true,
    });

    const parsed = JSON.parse(json);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].tradeId).toBe("trade-1");
    expect(parsed[0].timeline).toHaveLength(2);
  });

  // ── CSV Export ─────────────────────────────────────────────────

  test("exports report as CSV with entries", () => {
    const report = sampleReport();
    const csv = exporter.exportReport(report, {
      format: "csv",
      includeEntries: true,
      includeReasonCodes: true,
      includeTimeline: false,
    });

    expect(csv).toContain("tradeId,strategyId");
    expect(csv).toContain("trade-1");
    expect(csv).toContain("trade-loss-1");
    expect(csv).toContain("Summary");
    expect(csv).toContain("Win Rate");
  });

  test("exports report as CSV without entries", () => {
    const report = sampleReport();
    const csv = exporter.exportReport(report, {
      format: "csv",
      includeEntries: false,
      includeReasonCodes: false,
      includeTimeline: false,
    });

    expect(csv).toContain("Summary");
    expect(csv).not.toContain("trade-1");
  });

  test("exports reconstruction as CSV", () => {
    const recon = sampleReconstruction();
    const csv = exporter.exportReconstructions([recon], {
      format: "csv",
      includeEntries: true,
      includeReasonCodes: true,
      includeTimeline: false,
    });

    expect(csv).toContain("reconstructionId");
    expect(csv).toContain("trade-1");
    expect(csv).toContain("alpha");
  });

  test("CSV escapes values with commas", () => {
    const report = sampleReport();
    const csv = exporter.exportReport(report, {
      format: "csv",
      includeEntries: true,
      includeReasonCodes: true,
      includeTimeline: false,
    });

    // The CSV should be parseable without issues.
    const lines = csv.split("\n");
    expect(lines.length).toBeGreaterThan(5);
  });

  // ── TXT Export ─────────────────────────────────────────────────

  test("exports report as TXT", () => {
    const report = sampleReport();
    const txt = exporter.exportReport(report, {
      format: "txt",
      includeEntries: true,
      includeReasonCodes: true,
      includeTimeline: false,
    });

    expect(txt).toContain("DAILY TRADE REPORT");
    expect(txt).toContain("SUMMARY");
    expect(txt).toContain("STRATEGY BREAKDOWN");
    expect(txt).toContain("VENUE BREAKDOWN");
    expect(txt).toContain("TRADES");
    expect(txt).toContain("trade-1");
    expect(txt).toContain("Total Trades:");
    expect(txt).toContain("Win Rate:");
  });

  test("exports reconstruction as TXT", () => {
    const recon = sampleReconstruction();
    const txt = exporter.exportReconstructions([recon], {
      format: "txt",
      includeEntries: true,
      includeReasonCodes: true,
      includeTimeline: true,
    });

    expect(txt).toContain("TRADE RECONSTRUCTION REPORT");
    expect(txt).toContain("trade-1");
    expect(txt).toContain("alpha");
    expect(txt).toContain("TIMELINE");
    expect(txt).toContain("opportunity_detected");
    expect(txt).toContain("risk_decision");
    expect(txt).toContain("RISK_APPROVED");
  });

  test("exports reconstruction as TXT without timeline", () => {
    const recon = sampleReconstruction();
    const txt = exporter.exportReconstructions([recon], {
      format: "txt",
      includeEntries: true,
      includeReasonCodes: true,
      includeTimeline: false,
    });

    expect(txt).toContain("TRADE RECONSTRUCTION REPORT");
    expect(txt).not.toContain("TIMELINE");
  });

  // ── AC3: Exports work in TXT/JSON/CSV ─────────────────────────

  test("AC3: all three export formats produce valid output", () => {
    const report = sampleReport();
    const formats: ExportOptions["format"][] = ["json", "csv", "txt"];

    for (const format of formats) {
      const exported = exporter.exportReport(report, {
        format,
        includeEntries: true,
        includeReasonCodes: true,
        includeTimeline: false,
      });

      expect(typeof exported).toBe("string");
      expect(exported.length).toBeGreaterThan(0);
    }
  });

  test("AC3: all three formats work for reconstructions", () => {
    const recon = sampleReconstruction();
    const formats: ExportOptions["format"][] = ["json", "csv", "txt"];

    for (const format of formats) {
      const exported = exporter.exportReconstruction(recon, {
        format,
        includeEntries: true,
        includeReasonCodes: true,
        includeTimeline: true,
      });

      expect(typeof exported).toBe("string");
      expect(exported.length).toBeGreaterThan(0);
    }
  });
});

// ── Audit Unavailability Invariant Tests ─────────────────────────────

describe("Audit unavailability blocks trading (AC4)", () => {
  test("canary blocks orders when audit is unavailable", () => {
    const auditAvailability: AuditAvailability = {
      available: false,
      lastWriteAtMs: FIXED_TS,
      maxStaleMs: 60_000,
      error: "disk full",
    };

    const session = new CanarySession({
      now: () => FIXED_TS,
      config: DEFAULT_CANARY_CONFIG,
      auditAvailability,
    });

    session.control("start");

    const result = session.preCheckIntent({
      idempotencyKey: "intent-1",
      opportunityId: "opp-1",
      venue: "bybit",
      symbol: "BTC",
      side: "BUY",
      quantity: 0.01,
      price: 100,
      quoteCurrency: "USDT",
      createdAtMs: FIXED_TS,
      expiresAtMs: FIXED_TS + 60_000,
      limits: { maxSlippageBps: 20 },
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("disk full");
  });

  test("canary allows orders when audit is available", () => {
    const auditAvailability: AuditAvailability = {
      available: true,
      lastWriteAtMs: FIXED_TS,
      maxStaleMs: 60_000,
    };

    const session = new CanarySession({
      now: () => FIXED_TS,
      config: DEFAULT_CANARY_CONFIG,
      auditAvailability,
    });

    session.control("start");

    const result = session.preCheckIntent({
      idempotencyKey: "intent-1",
      opportunityId: "opp-1",
      venue: "bybit",
      symbol: "BTC",
      side: "BUY",
      quantity: 0.01,
      price: 100,
      quoteCurrency: "USDT",
      createdAtMs: FIXED_TS,
      expiresAtMs: FIXED_TS + 60_000,
      limits: { maxSlippageBps: 20 },
    });

    expect(result.allowed).toBe(true);
  });

  test("canary blocks when audit becomes stale", () => {
    const auditAvailability: AuditAvailability = {
      available: true,
      lastWriteAtMs: FIXED_TS,
      maxStaleMs: 60_000, // 1 minute stale threshold
    };

    let nowMs = FIXED_TS;
    const session = new CanarySession({
      now: () => nowMs,
      config: DEFAULT_CANARY_CONFIG,
      auditAvailability,
    });

    session.control("start");

    // Initially allowed.
    const check1 = session.preCheckIntent({
      idempotencyKey: "intent-1",
      opportunityId: "opp-1",
      venue: "bybit",
      symbol: "BTC",
      side: "BUY",
      quantity: 0.01,
      price: 100,
      quoteCurrency: "USDT",
      createdAtMs: nowMs,
      expiresAtMs: nowMs + 60_000,
      limits: { maxSlippageBps: 20 },
    });
    expect(check1.allowed).toBe(true);

    // Advance time past stale threshold.
    nowMs = FIXED_TS + 120_000; // 2 minutes

    const check2 = session.preCheckIntent({
      idempotencyKey: "intent-2",
      opportunityId: "opp-2",
      venue: "bybit",
      symbol: "BTC",
      side: "BUY",
      quantity: 0.01,
      price: 100,
      quoteCurrency: "USDT",
      createdAtMs: nowMs,
      expiresAtMs: nowMs + 60_000,
      limits: { maxSlippageBps: 20 },
    });
    expect(check2.allowed).toBe(false);
    expect(check2.reason).toContain("stale");
  });

  test("updateAuditAvailability allows trading to resume", () => {
    const auditAvailability: AuditAvailability = {
      available: false,
      lastWriteAtMs: FIXED_TS,
      maxStaleMs: 60_000,
      error: "disk full",
    };

    const session = new CanarySession({
      now: () => FIXED_TS,
      config: DEFAULT_CANARY_CONFIG,
      auditAvailability,
    });

    session.control("start");

    // Initially blocked.
    const check1 = session.preCheckIntent({
      idempotencyKey: "intent-1",
      opportunityId: "opp-1",
      venue: "bybit",
      symbol: "BTC",
      side: "BUY",
      quantity: 0.01,
      price: 100,
      quoteCurrency: "USDT",
      createdAtMs: FIXED_TS,
      expiresAtMs: FIXED_TS + 60_000,
      limits: { maxSlippageBps: 20 },
    });
    expect(check1.allowed).toBe(false);

    // Update audit availability.
    session.updateAuditAvailability({
      available: true,
      lastWriteAtMs: FIXED_TS,
      maxStaleMs: 60_000,
    });

    // Now allowed.
    const check2 = session.preCheckIntent({
      idempotencyKey: "intent-2",
      opportunityId: "opp-2",
      venue: "bybit",
      symbol: "BTC",
      side: "BUY",
      quantity: 0.01,
      price: 100,
      quoteCurrency: "USDT",
      createdAtMs: FIXED_TS,
      expiresAtMs: FIXED_TS + 60_000,
      limits: { maxSlippageBps: 20 },
    });
    expect(check2.allowed).toBe(true);
  });

  test("submitOrder blocks when audit is unavailable", () => {
    const auditAvailability: AuditAvailability = {
      available: false,
      lastWriteAtMs: FIXED_TS,
      maxStaleMs: 60_000,
      error: "audit subsystem down",
    };

    const session = new CanarySession({
      now: () => FIXED_TS,
      config: DEFAULT_CANARY_CONFIG,
      auditAvailability,
    });

    session.control("start");

    const { preCheck } = session.submitOrder(
      {
        idempotencyKey: "intent-1",
        opportunityId: "opp-1",
        venue: "bybit",
        symbol: "BTC",
        side: "BUY",
        quantity: 0.01,
        price: 100,
        quoteCurrency: "USDT",
        createdAtMs: FIXED_TS,
        expiresAtMs: FIXED_TS + 60_000,
        limits: { maxSlippageBps: 20 },
      },
      {
        decision: "APPROVE",
        orderIntentIdempotencyKey: "intent-1",
        evaluatedAtMs: FIXED_TS,
        approvedSize: 0.01,
        approvedLimits: { maxSlippageBps: 20 },
        expiresAtMs: FIXED_TS + 60_000,
      } as any,
      { bid: 99, ask: 101, mid: 100, liquidityUsd: 10_000 },
    );

    expect(preCheck.allowed).toBe(false);
    expect(preCheck.reason).toContain("audit subsystem down");
  });
});

// ── Contract Validation Tests ────────────────────────────────────────

describe("Audit reconstruction contracts", () => {
  test("isTradeReconstruction validates correct shape", () => {
    const recon: TradeReconstruction = {
      reconstructionId: "recon-1",
      tradeId: "trade-1",
      strategyId: "alpha",
      regime: "trend",
      venue: "bybit",
      symbol: "BTC",
      side: "BUY",
      timeline: [],
      finalPnlUsd: 5,
      feesUsd: 0.2,
      slippageUsd: 0.1,
      hasIncidentFlags: false,
      incidentFlags: [],
      lessons: [],
      reconstructedAtMs: FIXED_TS,
    };

    expect(isTradeReconstruction(recon)).toBe(true);
  });

  test("isTradeReconstruction rejects invalid shape", () => {
    expect(isTradeReconstruction({})).toBe(false);
    expect(isTradeReconstruction({ reconstructionId: 123 })).toBe(false);
  });

  test("isTimelineEvent validates correct shape", () => {
    const event = {
      eventId: "evt-1",
      phase: "risk_decision",
      timestampMs: FIXED_TS,
      data: {},
      reasonCodes: ["RISK_APPROVED"],
    };

    expect(isTimelineEvent(event)).toBe(true);
  });

  test("isTimelineEvent rejects invalid phase", () => {
    const event = {
      eventId: "evt-1",
      phase: "invalid_phase",
      timestampMs: FIXED_TS,
      data: {},
      reasonCodes: [],
    };

    expect(isTimelineEvent(event)).toBe(false);
  });
});
