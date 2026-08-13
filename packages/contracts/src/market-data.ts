import {
  isNumber,
  isObjectOf,
  isOptional,
  isString,
  parse,
  type Validator,
} from "./schema.ts";

/**
 * Normalized market observation shared across venues (CEX REST/WebSocket and
 * DEX RPC). Every connector normalizes into this single typed shape so that
 * downstream layers consume one vocabulary (Spec Alpha, user story 3).
 */
export interface MarketDataSnapshot {
  /** Venue id, e.g. "bybit" or "pancakeswap-v4". */
  venue: string;
  /** Normalized symbol, e.g. "BTC/USDT". */
  symbol: string;
  /** Event/observation time (Unix ms). */
  timestampMs: number;
  /** Best bid; null when no bid is present (e.g. a tick with no book). */
  bid: number | null;
  /** Best ask; null when no ask is present. */
  ask: number | null;
  /** Mid price ((bid + ask) / 2); null when either side is missing. */
  mid: number | null;
  /** Total resting depth on both sides, in quote units. */
  depth: number;
  /** End-to-end latency in ms (receive time - exchange timestamp). */
  latencyMs: number;
  /** Source stream id, e.g. "bybit-ws-linear", "pancakeswap-rpc-pool". */
  source: string;
  /** Optional venue sequence number for ordering/dedup. */
  sequence?: number;
}

const isNullableNumber: Validator<number | null> = (value): value is number | null =>
  value === null || (typeof value === "number" && Number.isFinite(value));

export const isMarketDataSnapshot: Validator<MarketDataSnapshot> = isObjectOf({
  venue: isString,
  symbol: isString,
  timestampMs: isNumber,
  bid: isNullableNumber,
  ask: isNullableNumber,
  mid: isNullableNumber,
  depth: isNumber,
  latencyMs: isNumber,
  source: isString,
  sequence: isOptional(isNumber),
});

export function parseMarketDataSnapshot(value: unknown): MarketDataSnapshot {
  return parse(isMarketDataSnapshot, value, "MarketDataSnapshot");
}
