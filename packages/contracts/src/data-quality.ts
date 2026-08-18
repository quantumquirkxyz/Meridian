import {
  isBoolean,
  isEnumOf,
  isInRange,
  isNumber,
  isObjectOf,
  isOptional,
  isString,
  parse,
  type Validator,
} from "./schema.ts";

/**
 * Per-source data quality state (Spec Alpha, user story 17).
 * HEALTHY: analysis allowed. DEGRADED: observation only.
 * STALE: block dependent strategies. DISCONNECTED: alert + reconnect.
 */
export const DATA_QUALITY_STATES = [
  "HEALTHY",
  "DEGRADED",
  "STALE",
  "DISCONNECTED",
] as const;

export type DataQualityState = (typeof DATA_QUALITY_STATES)[number];

export const EXCHANGE_STATUSES = [
  "online",
  "degraded",
  "maintenance",
  "offline",
] as const;

export type ExchangeStatus = (typeof EXCHANGE_STATUSES)[number];

export const isDataQualityState: Validator<DataQualityState> =
  isEnumOf(DATA_QUALITY_STATES);

/**
 * State ordering from least to most restrictive. Used by `isStateAtLeast` and
 * `deriveDataQualityState` to compare severity.
 */
export const DATA_QUALITY_STATE_ORDER: readonly DataQualityState[] = [
  "HEALTHY",
  "DEGRADED",
  "STALE",
  "DISCONNECTED",
];

const STATE_RANK = new Map<DataQualityState, number>(
  DATA_QUALITY_STATE_ORDER.map((s, i) => [s, i]),
);

/** True when `actual` is at least as restrictive as `threshold`. */
export function isStateAtLeast(
  actual: DataQualityState,
  threshold: DataQualityState,
): boolean {
  return (STATE_RANK.get(actual) ?? 0) >= (STATE_RANK.get(threshold) ?? 0);
}

/**
 * Raw quality metrics collected from a data source. The scorer combines these
 * into a single [0, 1] score and derives the canonical state.
 */
export interface DataQualityMetrics {
  /** Source id, e.g. "bybit-ws-linear". */
  source: string;
  /** End-to-end latency in ms. */
  latencyMs: number;
  /** Time since the last observation in ms. */
  stalenessMs: number;
  /** Number of missed/dropped observations in the evaluation window. */
  gapCount: number;
  /** Whether WebSocket and REST feeds are consistent. */
  wsRestConsistent: boolean;
  /** Whether the RPC/HTTP endpoint is reachable. */
  rpcHealthy: boolean;
  /** Exchange-reported status ("online", "maintenance", etc.). */
  exchangeStatus: ExchangeStatus;
}

export const isDataQualityMetrics: Validator<DataQualityMetrics> = isObjectOf({
  source: isString,
  latencyMs: isNumber,
  stalenessMs: isNumber,
  gapCount: isNumber,
  wsRestConsistent: isBoolean,
  rpcHealthy: isBoolean,
  exchangeStatus: isEnumOf(EXCHANGE_STATUSES),
});

export function parseDataQualityMetrics(value: unknown): DataQualityMetrics {
  return parse(isDataQualityMetrics, value, "DataQualityMetrics");
}

/**
 * Scoring thresholds used by `computeDataQualityScore`. All weights are
 * normalized so the final score lands in [0, 1].
 */
export interface DataQualityScoringThresholds {
  /** Latency at or below which the latency component scores 1.0. */
  latencyIdealMs: number;
  /** Latency at or above which the latency component scores 0.0. */
  latencyMaxMs: number;
  /** Staleness at or below which the staleness component scores 1.0. */
  stalenessIdealMs: number;
  /** Staleness at or above which the staleness component scores 0.0. */
  stalenessMaxMs: number;
  /** Maximum gap count before the gap component scores 0.0. */
  maxGaps: number;
  /** Weight for the latency component (0-1). */
  weightLatency: number;
  /** Weight for the staleness component (0-1). */
  weightStaleness: number;
  /** Weight for the gap component (0-1). */
  weightGaps: number;
  /** Weight for the ws/rest consistency component (0-1). */
  weightConsistency: number;
  /** Weight for the RPC health component (0-1). */
  weightRpcHealth: number;
  /** Weight for the exchange status component (0-1). */
  weightExchangeStatus: number;
}

export const DEFAULT_SCORING_THRESHOLDS: DataQualityScoringThresholds = {
  latencyIdealMs: 50,
  latencyMaxMs: 5_000,
  stalenessIdealMs: 1_000,
  stalenessMaxMs: 30_000,
  maxGaps: 10,
  weightLatency: 0.25,
  weightStaleness: 0.30,
  weightGaps: 0.15,
  weightConsistency: 0.10,
  weightRpcHealth: 0.10,
  weightExchangeStatus: 0.10,
};

/**
 * Clamps a value into [0, 1].
 */
function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Linear interpolation from `max` (score 0) to `ideal` (score 1). Values
 * beyond the range are clamped.
 */
function linearScore(
  value: number,
  ideal: number,
  max: number,
): number {
  if (max <= ideal) return value <= ideal ? 1 : 0;
  if (value <= ideal) return 1;
  if (value >= max) return 0;
  return clamp01((max - value) / (max - ideal));
}

interface QualityComponents {
  latency: number;
  staleness: number;
  gaps: number;
  consistency: number;
  rpcHealth: number;
  exchangeStatus: number;
}

function computeQualityComponents(
  metrics: DataQualityMetrics,
  thresholds: DataQualityScoringThresholds,
): QualityComponents {
  const latency = linearScore(
    metrics.latencyMs,
    thresholds.latencyIdealMs,
    thresholds.latencyMaxMs,
  );
  const staleness = linearScore(
    metrics.stalenessMs,
    thresholds.stalenessIdealMs,
    thresholds.stalenessMaxMs,
  );
  const gaps =
    thresholds.maxGaps > 0
      ? clamp01(1 - metrics.gapCount / thresholds.maxGaps)
      : metrics.gapCount === 0
        ? 1
        : 0;
  const consistency = metrics.wsRestConsistent ? 1 : 0;
  const rpcHealth = metrics.rpcHealthy ? 1 : 0;
  const exchangeStatus =
    metrics.exchangeStatus === "online"
      ? 1
      : metrics.exchangeStatus === "degraded"
        ? 0.5
        : 0;

  return { latency, staleness, gaps, consistency, rpcHealth, exchangeStatus };
}

/**
 * Computes a composite data quality score in [0, 1] from raw metrics.
 *
 * Components (all normalized to [0, 1]):
 * - Latency: linear decay from ideal to max
 * - Staleness: linear decay from ideal to max
 * - Gaps: linear decay from 0 to maxGaps
 * - WS/REST consistency: 1.0 if consistent, 0.0 otherwise
 * - RPC health: 1.0 if healthy, 0.0 otherwise
 * - Exchange status: 1.0 if "online", 0.5 if "degraded", 0.0 otherwise
 *
 * The final score is the weighted sum, clamped to [0, 1].
 */
export function computeDataQualityScore(
  metrics: DataQualityMetrics,
  thresholds: DataQualityScoringThresholds = DEFAULT_SCORING_THRESHOLDS,
): number {
  const { latency, staleness, gaps, consistency, rpcHealth, exchangeStatus } =
    computeQualityComponents(metrics, thresholds);

  const raw =
    latency * thresholds.weightLatency +
    staleness * thresholds.weightStaleness +
    gaps * thresholds.weightGaps +
    consistency * thresholds.weightConsistency +
    rpcHealth * thresholds.weightRpcHealth +
    exchangeStatus * thresholds.weightExchangeStatus;

  return clamp01(raw);
}

/**
 * Derives the canonical `DataQualityState` from a composite score and the
 * raw metrics. The state machine transitions are:
 *
 * - DISCONNECTED: exchange status is neither "online" nor "degraded", or RPC
 *   is unhealthy AND staleness exceeds the max threshold.
 * - STALE: staleness exceeds the max threshold, or score < 0.3.
 * - DEGRADED: score < 0.7, any individual component is below 0.5, or the
 *   exchange reports a "degraded" status.
 * - HEALTHY: all other cases (score >= 0.7 and no disqualifying conditions).
 */
export function deriveDataQualityState(
  score: number,
  metrics: DataQualityMetrics,
  thresholds: DataQualityScoringThresholds = DEFAULT_SCORING_THRESHOLDS,
): DataQualityState {
  const isDisconnected =
    (metrics.exchangeStatus !== "online" &&
      metrics.exchangeStatus !== "degraded") ||
    (!metrics.rpcHealthy && metrics.stalenessMs >= thresholds.stalenessMaxMs);

  if (isDisconnected) return "DISCONNECTED";

  const isStale =
    metrics.stalenessMs >= thresholds.stalenessMaxMs || score < 0.3;

  if (isStale) return "STALE";

  const { latency, staleness, gaps } = computeQualityComponents(
    metrics,
    thresholds,
  );

  const hasWeakComponent =
    latency < 0.5 ||
    staleness < 0.5 ||
    gaps < 0.5 ||
    !metrics.wsRestConsistent ||
    !metrics.rpcHealthy;

  const isDegraded =
    score < 0.7 || hasWeakComponent || metrics.exchangeStatus === "degraded";

  if (isDegraded) return "DEGRADED";

  return "HEALTHY";
}

/** Quality report emitted per data source (user story 17). */
export interface DataQualityReport {
  /** Source id, e.g. "bybit-ws-linear". */
  source: string;
  state: DataQualityState;
  /** Quality score in [0, 1]. */
  score: number;
  /** When the report was produced (Unix ms). */
  updatedAtMs: number;
  /** Timestamp of the last observation from the source (Unix ms). */
  lastSeenMs: number;
  /** Optional human-readable reason for the state. */
  reason?: string;
}

export const isDataQualityReport: Validator<DataQualityReport> = isObjectOf({
  source: isString,
  state: isDataQualityState,
  score: isInRange(0, 1),
  updatedAtMs: isNumber,
  lastSeenMs: isNumber,
  reason: isOptional(isString),
});

export function parseDataQualityReport(value: unknown): DataQualityReport {
  return parse(isDataQualityReport, value, "DataQualityReport");
}

/**
 * Convenience: compute a full `DataQualityReport` from raw metrics in one call.
 */
export function evaluateDataQuality(
  metrics: DataQualityMetrics,
  nowMs: number,
  thresholds: DataQualityScoringThresholds = DEFAULT_SCORING_THRESHOLDS,
): DataQualityReport {
  const score = computeDataQualityScore(metrics, thresholds);
  const state = deriveDataQualityState(score, metrics, thresholds);
  const lastSeenMs = nowMs - metrics.stalenessMs;

  let reason: string | undefined;
  if (state === "DISCONNECTED") {
    reason =
      !metrics.rpcHealthy
        ? "RPC unreachable"
        : `exchange status: ${metrics.exchangeStatus}`;
  } else if (state === "STALE") {
    reason =
      metrics.stalenessMs >= thresholds.stalenessMaxMs
        ? `staleness ${metrics.stalenessMs}ms exceeds max ${thresholds.stalenessMaxMs}ms`
        : `score ${score.toFixed(3)} below 0.3 threshold`;
  } else if (state === "DEGRADED") {
    const { latency, staleness, gaps } = computeQualityComponents(
      metrics,
      thresholds,
    );
    const parts: string[] = [];
    if (score < 0.7) parts.push(`score ${score.toFixed(3)}`);
    if (latency < 0.5) parts.push("latency");
    if (staleness < 0.5) parts.push("staleness");
    if (gaps < 0.5) parts.push("gaps");
    if (!metrics.wsRestConsistent) parts.push("WS/REST inconsistent");
    if (!metrics.rpcHealthy) parts.push("RPC unhealthy");
    if (metrics.exchangeStatus === "degraded") parts.push("exchange status degraded");
    reason = parts.length > 0 ? parts.join("; ") : undefined;
  }

  return {
    source: metrics.source,
    state,
    score,
    updatedAtMs: nowMs,
    lastSeenMs,
    reason,
  };
}

/**
 * Per-state behavior rules. Consumers should query this table instead of
 * repeating switch/if-cascades on `DataQualityState`.
 */
export const STATE_RULES: Record<
  DataQualityState,
  { tradable: boolean; canGenerateSignals: boolean }
> = {
  HEALTHY: { tradable: true, canGenerateSignals: true },
  DEGRADED: { tradable: false, canGenerateSignals: false },
  STALE: { tradable: false, canGenerateSignals: false },
  DISCONNECTED: { tradable: false, canGenerateSignals: false },
};

/**
 * Generic helper: marks edges as non-tradable when their source is at least
 * as restrictive as the given threshold. Pure function — returns a new array.
 */
export function markEdgesByQuality<
  E extends { source: string; tradable: boolean },
>(edges: readonly E[], reports: readonly DataQualityReport[], threshold: DataQualityState = "DEGRADED"): E[] {
  const reportsBySource = new Map(reports.map((r) => [r.source, r] as const));
  return edges.map((edge) => {
    const report = reportsBySource.get(edge.source);
    // Fail closed: no report for an edge's source → mark non-tradable.
    if (!report || isStateAtLeast(report.state, threshold)) {
      return { ...edge, tradable: false };
    }
    return edge;
  });
}
