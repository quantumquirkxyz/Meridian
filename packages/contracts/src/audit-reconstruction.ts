/**
 * Full audit reconstruction and reporting contracts (issue #39).
 *
 * Provides the shared typed vocabulary for:
 *   - End-to-end trade timeline reconstruction with reason codes
 *   - Daily and weekly report generation
 *   - TXT/JSON/CSV export formats
 *   - Audit availability invariant enforcement
 *
 * Acceptance criteria:
 *   AC1: Every trade is reconstructable end to end with reason codes.
 *   AC2: Daily and weekly reports are generated.
 *   AC3: Exports work in TXT/JSON/CSV.
 *   AC4: Audit unavailability blocks trading (invariant).
 */

import {
  isArrayOf,
  isBoolean,
  isEnumOf,
  isNumber,
  isObjectOf,
  isOptional,
  isRecordOf,
  isString,
  parse,
  type Validator,
} from "./schema.ts";

// ── Export Format ────────────────────────────────────────────────────

/** ExportFormat: the supported export file formats. */
export const EXPORT_FORMATS = ["txt", "json", "csv"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];
export const isExportFormat: Validator<ExportFormat> = isEnumOf(EXPORT_FORMATS);

// ── Report Period ────────────────────────────────────────────────────

/** ReportPeriod: the time aggregation period for reports. */
export const REPORT_PERIODS = ["daily", "weekly"] as const;
export type ReportPeriod = (typeof REPORT_PERIODS)[number];
export const isReportPeriod: Validator<ReportPeriod> = isEnumOf(REPORT_PERIODS);

// ── Timeline Phase ───────────────────────────────────────────────────

/**
 * TimelinePhase: the discrete phases of a trade's lifecycle.
 * Each phase has a start timestamp and optional end timestamp,
 * with structured data captured at each stage.
 */
export const TIMELINE_PHASES = [
  "opportunity_detected",
  "data_quality_evaluated",
  "graph_snapshot",
  "signal_generated",
  "risk_analyst_consulted",
  "risk_decision",
  "order_intent_created",
  "execution_submitted",
  "exchange_confirmation",
  "reconciliation",
  "position_closed",
  "report_finalized",
] as const;

export type TimelinePhase = (typeof TIMELINE_PHASES)[number];
export const isTimelinePhase: Validator<TimelinePhase> = isEnumOf(TIMELINE_PHASES);

// ── Timeline Event ───────────────────────────────────────────────────

/**
 * TimelineEvent: a single event in a trade's reconstruction timeline.
 * Captures the timestamp, phase, structured data, and reason codes
 * that explain why this event occurred.
 */
export interface TimelineEvent {
  /** Unique event identifier. */
  eventId: string;
  /** Timeline phase this event belongs to. */
  phase: TimelinePhase;
  /** Timestamp of this event (Unix ms). */
  timestampMs: number;
  /** Structured data for this phase. */
  data: Record<string, unknown>;
  /** Machine-readable reason codes explaining this event. */
  reasonCodes: string[];
}

export const isTimelineEvent: Validator<TimelineEvent> = isObjectOf({
  eventId: isString,
  phase: isTimelinePhase,
  timestampMs: isNumber,
  data: isObjectOf({}) as Validator<Record<string, unknown>>,
  reasonCodes: isArrayOf(isString),
});

export function parseTimelineEvent(value: unknown): TimelineEvent {
  return parse(isTimelineEvent, value, "TimelineEvent");
}

// ── Trade Reconstruction ─────────────────────────────────────────────

/**
 * TradeReconstruction: the full end-to-end reconstruction of a single
 * trade, from opportunity detection to final PnL. Every trade is
 * reconstructable with reason codes (AC1).
 */
export interface TradeReconstruction {
  /** Unique reconstruction identifier. */
  reconstructionId: string;
  /** Trade identifier (links to TradeJournalEntry.tradeId). */
  tradeId: string;
  /** Strategy that produced this trade. */
  strategyId: string;
  /** Market regime at the time of the trade. */
  regime: string;
  /** Venue where the trade was executed. */
  venue: string;
  /** Asset symbol traded. */
  symbol: string;
  /** Trade side. */
  side: "BUY" | "SELL";
  /** Ordered timeline events for this trade. */
  timeline: TimelineEvent[];
  /** Final PnL after fees and slippage (USD). */
  finalPnlUsd: number;
  /** Fees paid (USD). */
  feesUsd: number;
  /** Slippage cost (USD). */
  slippageUsd: number;
  /** Whether any incident flags were raised during this trade. */
  hasIncidentFlags: boolean;
  /** Incident flags (empty if no incidents). */
  incidentFlags: string[];
  /** Lessons learned or metadata attached to this trade. */
  lessons: string[];
  /** Reconstruction timestamp (Unix ms). */
  reconstructedAtMs: number;
}

export const isTradeReconstruction: Validator<TradeReconstruction> =
  isObjectOf({
    reconstructionId: isString,
    tradeId: isString,
    strategyId: isString,
    regime: isString,
    venue: isString,
    symbol: isString,
    side: isEnumOf(["BUY", "SELL"] as const),
    timeline: isArrayOf(isTimelineEvent),
    finalPnlUsd: isNumber,
    feesUsd: isNumber,
    slippageUsd: isNumber,
    hasIncidentFlags: isBoolean,
    incidentFlags: isArrayOf(isString),
    lessons: isArrayOf(isString),
    reconstructedAtMs: isNumber,
  });

export function parseTradeReconstruction(
  value: unknown,
): TradeReconstruction {
  return parse(isTradeReconstruction, value, "TradeReconstruction");
}

// ── Report Entry ─────────────────────────────────────────────────────

/**
 * ReportEntry: a single trade summary within a daily or weekly report.
 */
export interface ReportEntry {
  /** Trade identifier. */
  tradeId: string;
  /** Strategy identifier. */
  strategyId: string;
  /** Market regime. */
  regime: string;
  /** Venue. */
  venue: string;
  /** Asset symbol. */
  symbol: string;
  /** Trade side. */
  side: "BUY" | "SELL";
  /** Entry price. */
  entryPrice: number;
  /** Exit price. */
  exitPrice: number | null;
  /** Net PnL after fees (USD). */
  netPnlUsd: number;
  /** Fees paid (USD). */
  feesUsd: number;
  /** Trade outcome. */
  outcome: "WIN" | "LOSS" | "BREAKEVEN" | "CANCELLED" | "REJECTED";
  /** Whether any incident flags were raised. */
  hasIncidents: boolean;
  /** Reason codes for this trade. */
  reasonCodes: string[];
}

export const isReportEntry: Validator<ReportEntry> = isObjectOf({
  tradeId: isString,
  strategyId: isString,
  regime: isString,
  venue: isString,
  symbol: isString,
  side: isEnumOf(["BUY", "SELL"] as const),
  entryPrice: isNumber,
  exitPrice: isOptional(isNumber) as Validator<number | null>,
  netPnlUsd: isNumber,
  feesUsd: isNumber,
  outcome: isEnumOf(["WIN", "LOSS", "BREAKEVEN", "CANCELLED", "REJECTED"] as const),
  hasIncidents: isBoolean,
  reasonCodes: isArrayOf(isString),
});

// ── Daily/Weekly Report ──────────────────────────────────────────────

/**
 * TradeReport: a daily or weekly aggregation of trade activity.
 * Generated from the trade journal and audit reconstruction data.
 */
export interface TradeReport {
  /** Unique report identifier. */
  reportId: string;
  /** Report period (daily or weekly). */
  period: ReportPeriod;
  /** Period start timestamp (Unix ms). */
  periodStartMs: number;
  /** Period end timestamp (Unix ms). */
  periodEndMs: number;
  /** Total number of trades in this period. */
  totalTrades: number;
  /** Number of winning trades. */
  winCount: number;
  /** Number of losing trades. */
  lossCount: number;
  /** Number of breakeven trades. */
  breakevenCount: number;
  /** Win rate [0, 1]. */
  winRate: number;
  /** Total net PnL after fees (USD). */
  totalNetPnlUsd: number;
  /** Total fees paid (USD). */
  totalFeesUsd: number;
  /** Total slippage cost (USD). */
  totalSlippageUsd: number;
  /** Average net PnL per trade (USD). */
  avgNetPnlUsd: number;
  /** Maximum drawdown (USD) in this period. */
  maxDrawdownUsd: number;
  /** Best trade PnL (USD). */
  bestTradePnlUsd: number;
  /** Worst trade PnL (USD). */
  worstTradePnlUsd: number;
  /** Number of incident flags in this period. */
  incidentCount: number;
  /** Performance by strategy. */
  strategyBreakdown: Record<string, { tradeCount: number; netPnlUsd: number; winRate: number }>;
  /** Performance by venue. */
  venueBreakdown: Record<string, { tradeCount: number; netPnlUsd: number; winRate: number }>;
  /** Individual trade entries. */
  entries: ReportEntry[];
  /** Report generation timestamp (Unix ms). */
  generatedAtMs: number;
}

export const isTradeReport: Validator<TradeReport> = isObjectOf({
  reportId: isString,
  period: isReportPeriod,
  periodStartMs: isNumber,
  periodEndMs: isNumber,
  totalTrades: isNumber,
  winCount: isNumber,
  lossCount: isNumber,
  breakevenCount: isNumber,
  winRate: isNumber,
  totalNetPnlUsd: isNumber,
  totalFeesUsd: isNumber,
  totalSlippageUsd: isNumber,
  avgNetPnlUsd: isNumber,
  maxDrawdownUsd: isNumber,
  bestTradePnlUsd: isNumber,
  worstTradePnlUsd: isNumber,
  incidentCount: isNumber,
  strategyBreakdown: isRecordOf(
    isObjectOf({
      tradeCount: isNumber,
      netPnlUsd: isNumber,
      winRate: isNumber,
    }) as Validator<{ tradeCount: number; netPnlUsd: number; winRate: number }>),
  venueBreakdown: isRecordOf(
    isObjectOf({
      tradeCount: isNumber,
      netPnlUsd: isNumber,
      winRate: isNumber,
    }) as Validator<{ tradeCount: number; netPnlUsd: number; winRate: number }>),
  entries: isArrayOf(isReportEntry),
  generatedAtMs: isNumber,
});

export function parseTradeReport(value: unknown): TradeReport {
  return parse(isTradeReport, value, "TradeReport");
}

// ── Audit Availability Status ────────────────────────────────────────

/**
 * AuditAvailability: tracks whether the audit subsystem is available.
 * When audit is unavailable, trading MUST be blocked (AC4 invariant).
 */
export interface AuditAvailability {
  /** Whether the audit subsystem is currently available. */
  available: boolean;
  /** Timestamp of the last successful audit write (Unix ms). 0 if never. */
  lastWriteAtMs: number;
  /** Maximum allowed age (ms) of the last write before audit is considered stale. */
  maxStaleMs: number;
  /** Error message if audit is unavailable. */
  error?: string;
}

export const isAuditAvailability: Validator<AuditAvailability> = isObjectOf({
  available: isBoolean,
  lastWriteAtMs: isNumber,
  maxStaleMs: isNumber,
  error: isOptional(isString),
});

export function parseAuditAvailability(value: unknown): AuditAvailability {
  return parse(isAuditAvailability, value, "AuditAvailability");
}

/**
 * Default audit availability config: audit is considered stale after 5 minutes
 * without a successful write.
 */
export const DEFAULT_AUDIT_AVAILABILITY: AuditAvailability = {
  available: true,
  lastWriteAtMs: 0,
  maxStaleMs: 300_000, // 5 minutes
};

// ── Export Options ───────────────────────────────────────────────────

/**
 * ExportOptions: configuration for report export.
 */
export interface ExportOptions {
  /** Export format. */
  format: ExportFormat;
  /** Whether to include individual trade entries (true) or just summaries. */
  includeEntries: boolean;
  /** Whether to include reason codes in the export. */
  includeReasonCodes: boolean;
  /** Whether to include timeline data for each trade. */
  includeTimeline: boolean;
}

export const isExportOptions: Validator<ExportOptions> = isObjectOf({
  format: isExportFormat,
  includeEntries: isBoolean,
  includeReasonCodes: isBoolean,
  includeTimeline: isBoolean,
});

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  format: "json",
  includeEntries: true,
  includeReasonCodes: true,
  includeTimeline: false,
};
