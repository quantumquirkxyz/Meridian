import {
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

export const isDataQualityState: Validator<DataQualityState> =
  isEnumOf(DATA_QUALITY_STATES);

/** Quality report emitted per data source (user story 17). */
export interface DataQualityReport {
  /** Source id, e.g. "bybit-ws-linear". */
  source: string;
  state: DataQualityState;
  /** Quality score in [0, 1]. */
  score01: number;
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
  score01: isInRange(0, 1),
  updatedAtMs: isNumber,
  lastSeenMs: isNumber,
  reason: isOptional(isString),
});

export function parseDataQualityReport(value: unknown): DataQualityReport {
  return parse(isDataQualityReport, value, "DataQualityReport");
}
