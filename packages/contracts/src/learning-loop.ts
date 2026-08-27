import {
  isBoolean,
  isEnumOf,
  isNullable,
  isNumber,
  isObjectOf,
  isString,
  parse,
  type Validator,
} from "./schema.ts";

/**
 * Governed learning loop contracts (issue #36).
 *
 * The learning loop records every trade outcome (journal), detects when
 * a strategy's edge is decaying, and manages a promotion pipeline that
 * prevents any strategy change from reaching scale without passing through
 * backtest → review → canary → scale.
 *
 * Core invariant: learning never mutates production directly. It only
 * produces recommendations that a human or automation must approve.
 */

// ── Promotion Stages ─────────────────────────────────────────────────

/**
 * PromotionStage: the ordered stages a strategy or parameter change must
 * pass through before reaching scale.
 *
 * The pipeline is strict: no stage may be skipped.
 */
export const PROMOTION_STAGES = [
  "hypothesis",
  "backtest",
  "review",
  "canary",
  "scale",
] as const;

export type PromotionStage = (typeof PROMOTION_STAGES)[number];

export const isPromotionStage: Validator<PromotionStage> =
  isEnumOf(PROMOTION_STAGES);

/**
 * Return the index of a stage in the promotion pipeline.
 * Throws if the stage is not recognized.
 */
export function stageIndex(stage: PromotionStage): number {
  return PROMOTION_STAGES.indexOf(stage);
}

/**
 * Return the next stage in the pipeline, or null if already at scale.
 */
export function nextStage(
  current: PromotionStage,
): PromotionStage | null {
  const idx = stageIndex(current);
  if (idx >= PROMOTION_STAGES.length - 1) return null;
  return PROMOTION_STAGES[idx + 1];
}

// ── Promotion Stage Outcome ───────────────────────────────────────────

export const PROMOTION_OUTCOMES = [
  "pass",
  "fail",
  "pending",
  "skipped", // Used for validation testing only; no pipeline code path produces this.
] as const;

export type PromotionOutcome = (typeof PROMOTION_OUTCOMES)[number];

export const isPromotionOutcome: Validator<PromotionOutcome> =
  isEnumOf(PROMOTION_OUTCOMES);

// ── Trade Journal Entry ───────────────────────────────────────────────

/**
 * TradeJournalEntry: an immutable record of a single trade outcome.
 * Every filled, cancelled, or rejected order produces exactly one entry.
 */
export interface TradeJournalEntry {
  /** Unique trade identifier (typically the orderId). */
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
  /** Entry price. */
  entryPrice: number;
  /** Exit price (null if still open or cancelled without fill). */
  exitPrice: number | null;
  /** Quantity filled. */
  filledQuantity: number;
  /** Notional value at entry (USD). */
  notionalUsd: number;
  /** Realized PnL (USD). Positive = profit, negative = loss. */
  pnlUsd: number;
  /** Fees paid (USD). */
  feesUsd: number;
  /** Net PnL after fees (USD). */
  netPnlUsd: number;
  /** Trade outcome classification. */
  outcome: "WIN" | "LOSS" | "BREAKEVEN" | "CANCELLED" | "REJECTED";
  /** Entry timestamp (Unix ms). */
  enteredAtMs: number;
  /** Exit timestamp (Unix ms). null if still open. */
  exitedAtMs: number | null;
  /** Duration of the trade (ms). null if still open. */
  durationMs: number | null;
  /** Arbitrary metadata for analysis (e.g. slippage, funding). */
  metadata?: Record<string, unknown>;
}

export const isTradeJournalEntry: Validator<TradeJournalEntry> =
  isObjectOf({
    tradeId: isString,
    strategyId: isString,
    regime: isString,
    venue: isString,
    symbol: isString,
    side: isEnumOf(["BUY", "SELL"] as const),
    entryPrice: isNumber,
    exitPrice: isNullable(isNumber),
    filledQuantity: isNumber,
    notionalUsd: isNumber,
    pnlUsd: isNumber,
    feesUsd: isNumber,
    netPnlUsd: isNumber,
    outcome: isEnumOf([
      "WIN",
      "LOSS",
      "BREAKEVEN",
      "CANCELLED",
      "REJECTED",
    ] as const),
    enteredAtMs: isNumber,
    exitedAtMs: isNullable(isNumber),
    durationMs: isNullable(isNumber),
  });

export function parseTradeJournalEntry(
  value: unknown,
): TradeJournalEntry {
  return parse(isTradeJournalEntry, value, "TradeJournalEntry");
}

// ── Fill Params ──────────────────────────────────────────────────────

/**
 * FillParams: the subset of fields needed to record a filled trade.
 * Shared type used by TradeJournal.recordFill, LearningEngine.recordFill,
 * and CanarySession journal integration.
 */
export interface FillParams {
  tradeId: string;
  strategyId: string;
  regime: string;
  venue: string;
  symbol: string;
  side: "BUY" | "SELL";
  entryPrice: number;
  exitPrice: number;
  filledQuantity: number;
  feesUsd?: number;
  enteredAtMs: number;
  exitedAtMs: number;
  metadata?: Record<string, unknown>;
}

// ── Strategy Performance Snapshot ─────────────────────────────────────

/**
 * StrategyPerformance: aggregated performance metrics for a strategy
 * over a specific time window.
 */
export interface StrategyPerformance {
  /** Strategy identifier. */
  strategyId: string;
  /** Total number of trades in the window. */
  tradeCount: number;
  /** Number of winning trades. */
  winCount: number;
  /** Number of losing trades. */
  lossCount: number;
  /** Win rate [0, 1]. */
  winRate: number;
  /** Total PnL (USD). */
  totalPnlUsd: number;
  /** Average PnL per trade (USD). */
  avgPnlUsd: number;
  /** Sharpe-like ratio: avgPnl / stddev(pnl). 0 if insufficient data. */
  sharpeRatio: number;
  /** Maximum drawdown (USD) in the window. */
  maxDrawdownUsd: number;
  /** Profit factor: gross_profit / |gross_loss|. 0 if no losses. */
  profitFactor: number;
  /** Average trade duration (ms). */
  avgDurationMs: number;
  /** Window start (Unix ms). */
  windowStartMs: number;
  /** Window end (Unix ms). */
  windowEndMs: number;
}

export const isStrategyPerformance: Validator<StrategyPerformance> =
  isObjectOf({
    strategyId: isString,
    tradeCount: isNumber,
    winCount: isNumber,
    lossCount: isNumber,
    winRate: isNumber,
    totalPnlUsd: isNumber,
    avgPnlUsd: isNumber,
    sharpeRatio: isNumber,
    maxDrawdownUsd: isNumber,
    profitFactor: isNumber,
    avgDurationMs: isNumber,
    windowStartMs: isNumber,
    windowEndMs: isNumber,
  });

export function parseStrategyPerformance(
  value: unknown,
): StrategyPerformance {
  return parse(isStrategyPerformance, value, "StrategyPerformance");
}

// ── Edge Decay Signal ─────────────────────────────────────────────────

/**
 * EdgeDecaySignal: flags when a strategy's edge is decaying.
 * Emitted by the EdgeDecayDetector when rolling performance metrics
 * cross configured thresholds.
 */
export interface EdgeDecaySignal {
  /** Unique signal identifier. */
  signalId: string;
  /** Strategy experiencing edge decay. */
  strategyId: string;
  /** Decay severity. */
  severity: "low" | "medium" | "high" | "critical";
  /** Human-readable description of the decay. */
  reason: string;
  /** Current rolling Sharpe ratio. */
  currentSharpe: number;
  /** Previous rolling Sharpe ratio (for trend). */
  previousSharpe: number;
  /** Current rolling win rate. */
  currentWinRate: number;
  /** Previous rolling win rate. */
  previousWinRate: number;
  /** Current rolling profit factor. */
  currentProfitFactor: number;
  /** Previous rolling profit factor. */
  previousProfitFactor: number;
  /** Timestamp of signal detection (Unix ms). */
  detectedAtMs: number;
  /** Recommended action. */
  recommendation: "monitor" | "reduce_exposure" | "pause" | "demote";
}

export const isEdgeDecaySignal: Validator<EdgeDecaySignal> = isObjectOf({
  signalId: isString,
  strategyId: isString,
  severity: isEnumOf(["low", "medium", "high", "critical"] as const),
  reason: isString,
  currentSharpe: isNumber,
  previousSharpe: isNumber,
  currentWinRate: isNumber,
  previousWinRate: isNumber,
  currentProfitFactor: isNumber,
  previousProfitFactor: isNumber,
  detectedAtMs: isNumber,
  recommendation: isEnumOf([
    "monitor",
    "reduce_exposure",
    "pause",
    "demote",
  ] as const),
});

export function parseEdgeDecaySignal(value: unknown): EdgeDecaySignal {
  return parse(isEdgeDecaySignal, value, "EdgeDecaySignal");
}

// ── Promotion Record ──────────────────────────────────────────────────

/**
 * PromotionRecord: tracks a strategy or parameter change through the
 * promotion pipeline. Each record represents one proposed change and
 * its journey from hypothesis to scale (or rejection at any stage).
 */
export interface PromotionRecord {
  /** Unique promotion identifier. */
  promotionId: string;
  /** Strategy identifier. */
  strategyId: string;
  /** Description of the proposed change. */
  description: string;
  /** Current stage in the pipeline. */
  currentStage: PromotionStage;
  /** Outcome at each stage. */
  stageOutcomes: Record<PromotionStage, PromotionOutcome>;
  /** Stage-specific notes (e.g. backtest results, review comments). */
  stageNotes: Record<PromotionStage, string>;
  /** Timestamp when the promotion was created (Unix ms). */
  createdAtMs: number;
  /** Timestamp of the last stage transition (Unix ms). */
  lastTransitionAtMs: number;
  /** Timestamp when the promotion reached scale or was rejected (Unix ms). */
  completedAtMs: number | null;
  /** Whether this promotion is currently active (in pipeline). */
  active: boolean;
  /** Whether the promotion was manually approved at the review stage. */
  humanApproved: boolean;
}

export const isPromotionRecord: Validator<PromotionRecord> = isObjectOf({
  promotionId: isString,
  strategyId: isString,
  description: isString,
  currentStage: isPromotionStage,
  stageOutcomes: isObjectOf({
    hypothesis: isPromotionOutcome,
    backtest: isPromotionOutcome,
    review: isPromotionOutcome,
    canary: isPromotionOutcome,
    scale: isPromotionOutcome,
  }),
  stageNotes: isObjectOf({
    hypothesis: isString,
    backtest: isString,
    review: isString,
    canary: isString,
    scale: isString,
  }),
  createdAtMs: isNumber,
  lastTransitionAtMs: isNumber,
  completedAtMs: isNullable(isNumber),
  active: isBoolean,
  humanApproved: isBoolean,
});

export function parsePromotionRecord(value: unknown): PromotionRecord {
  return parse(isPromotionRecord, value, "PromotionRecord");
}

// ── Learning Recommendation ───────────────────────────────────────────

/**
 * LearningRecommendation: the output of the learning engine.
 * Learning never mutates production directly — it only produces
 * recommendations that must be approved by a human or automation.
 */
export interface LearningRecommendation {
  /** Unique recommendation identifier. */
  recommendationId: string;
  /** Type of recommendation. */
  type:
    | "promote"
    | "demote"
    | "pause"
    | "adjust_parameters"
    | "add_regime"
    | "remove_regime";
  /** Strategy this recommendation applies to. */
  strategyId: string;
  /** Human-readable summary. */
  summary: string;
  /** Supporting evidence (performance data, decay signals, etc.). */
  evidence: Record<string, unknown>;
  /** Confidence in this recommendation [0, 1]. */
  confidence: number;
  /** Whether this recommendation requires human approval. */
  requiresApproval: boolean;
  /** Timestamp of recommendation (Unix ms). */
  createdAtMs: number;
  /** Whether this recommendation has been acted upon. */
  actedUpon: boolean;
}

export const isLearningRecommendation: Validator<LearningRecommendation> =
  isObjectOf({
    recommendationId: isString,
    type: isEnumOf([
      "promote",
      "demote",
      "pause",
      "adjust_parameters",
      "add_regime",
      "remove_regime",
    ] as const),
    strategyId: isString,
    summary: isString,
    evidence: isObjectOf({}) as Validator<Record<string, unknown>>,
    confidence: isNumber,
    requiresApproval: isBoolean,
    createdAtMs: isNumber,
    actedUpon: isBoolean,
  });

export function parseLearningRecommendation(
  value: unknown,
): LearningRecommendation {
  return parse(isLearningRecommendation, value, "LearningRecommendation");
}

// ── Learning Loop Config ──────────────────────────────────────────────

/**
 * LearningLoopConfig: configuration for the governed learning loop.
 * Controls journal retention, decay detection thresholds, and
 * promotion pipeline gates.
 */
export interface LearningLoopConfig {
  /** Unique configuration identifier. */
  configId: string;
  /** Human-readable name. */
  name: string;

  // ── Journal ────────────────────────────────────────────────────
  /** Maximum number of journal entries to retain (0 = unlimited). */
  maxJournalEntries: number;
  /** Minimum trades before performance analysis is meaningful. */
  minTradesForAnalysis: number;

  // ── Edge Decay Detection ───────────────────────────────────────
  /** Rolling window size (number of trades) for decay detection. */
  decayWindowTrades: number;
  /** Previous window size for trend comparison. */
  decayPreviousWindowTrades: number;
  /** Sharpe ratio below which decay is flagged as "low" severity. */
  decaySharpeLowThreshold: number;
  /** Sharpe ratio below which decay is flagged as "medium". */
  decaySharpeMediumThreshold: number;
  /** Sharpe ratio below which decay is flagged as "high". */
  decaySharpeHighThreshold: number;
  /** Sharpe ratio below which decay is flagged as "critical". */
  decaySharpeCriticalThreshold: number;
  /** Win rate below which decay is flagged. */
  decayWinRateThreshold: number;
  /** Profit factor below which decay is flagged. */
  decayProfitFactorThreshold: number;

  // ── Promotion Pipeline ─────────────────────────────────────────
  /** Minimum backtest trades before promotion to review. */
  promotionMinBacktestTrades: number;
  /** Minimum canary trades before promotion to scale. */
  promotionMinCanaryTrades: number;
  /** Minimum win rate required at backtest stage. */
  promotionBacktestMinWinRate: number;
  /** Minimum Sharpe ratio required at backtest stage. */
  promotionBacktestMinSharpe: number;
  /** Minimum win rate required at canary stage. */
  promotionCanaryMinWinRate: number;
  /** Whether human approval is required at the review stage. */
  promotionRequireHumanApproval: boolean;

  /** How long (ms) a promotion can remain active before being flagged stale. */
  promotionStaleThresholdMs: number;
}

export const isLearningLoopConfig: Validator<LearningLoopConfig> =
  isObjectOf({
    configId: isString,
    name: isString,
    maxJournalEntries: isNumber,
    minTradesForAnalysis: isNumber,
    decayWindowTrades: isNumber,
    decayPreviousWindowTrades: isNumber,
    decaySharpeLowThreshold: isNumber,
    decaySharpeMediumThreshold: isNumber,
    decaySharpeHighThreshold: isNumber,
    decaySharpeCriticalThreshold: isNumber,
    decayWinRateThreshold: isNumber,
    decayProfitFactorThreshold: isNumber,
    promotionMinBacktestTrades: isNumber,
    promotionMinCanaryTrades: isNumber,
    promotionBacktestMinWinRate: isNumber,
    promotionBacktestMinSharpe: isNumber,
    promotionCanaryMinWinRate: isNumber,
    promotionRequireHumanApproval: isBoolean,
    promotionStaleThresholdMs: isNumber,
  });

export function parseLearningLoopConfig(
  value: unknown,
): LearningLoopConfig {
  return parse(isLearningLoopConfig, value, "LearningLoopConfig");
}

/**
 * Default learning loop configuration with conservative thresholds.
 */
export const DEFAULT_LEARNING_LOOP_CONFIG: LearningLoopConfig = {
  configId: "learning-loop-default-1",
  name: "Default Learning Loop",
  maxJournalEntries: 10_000,
  minTradesForAnalysis: 20,
  decayWindowTrades: 50,
  decayPreviousWindowTrades: 50,
  decaySharpeLowThreshold: 0.5,
  decaySharpeMediumThreshold: 0.0,
  decaySharpeHighThreshold: -0.5,
  decaySharpeCriticalThreshold: -1.0,
  decayWinRateThreshold: 0.4,
  decayProfitFactorThreshold: 1.0,
  promotionMinBacktestTrades: 100,
  promotionMinCanaryTrades: 30,
  promotionBacktestMinWinRate: 0.55,
  promotionBacktestMinSharpe: 0.5,
  promotionCanaryMinWinRate: 0.52,
  promotionRequireHumanApproval: true,
  promotionStaleThresholdMs: 604_800_000, // 7 days
};
