import {
  isArrayOf,
  isEnumOf,
  isFreeformRecord,
  isNumber,
  isObjectOf,
  isOptional,
  isString,
  parse,
  type Validator,
} from "./schema.ts";
import { isAuditEvent, type AuditEvent } from "./audit.ts";
import { isDataQualityReport, type DataQualityReport } from "./data-quality.ts";
import { isMarketGraphSnapshot, type MarketGraphSnapshot } from "./graph.ts";
import { isMarketDataSnapshot, type MarketDataSnapshot } from "./market-data.ts";

/**
 * Base events for the in-memory event bus (Spec Alpha, user story 8).
 * Components communicate via events; raw and normalized observations both
 * flow through the bus, are persisted to SQLite (bun:sqlite), and are
 * replayed deterministically (ADR-0006).
 */

export const BASE_EVENT_TYPES = [
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

export type BaseEventType = (typeof BASE_EVENT_TYPES)[number];

/**
 * Whether an event carries the venue's raw payload ("raw") or the normalized
 * typed shape ("normalized"). Both are persisted (issue #17 AC2).
 */
export const EVENT_KINDS = ["raw", "normalized"] as const;

export type EventKind = (typeof EVENT_KINDS)[number];

/** A single level in an order book. */
export interface OrderBookLevel {
  price: number;
  size: number;
}

/** ORDERBOOK_SNAPSHOT payload (top-of-book or full book). */
export interface OrderBookSnapshotPayload {
  venue: string;
  symbol: string;
  timestampMs: number;
  /** Best levels, best first on each side. */
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  /** Optional venue sequence number for ordering/dedup. */
  sequence?: number;
}

/** ORDERBOOK_DELTA payload; structurally identical to a snapshot slice. */
export interface OrderBookDeltaPayload extends OrderBookSnapshotPayload {}

/** POOL_STATE_UPDATE payload for DEX pools (reserves, derived price). */
export interface PoolStateUpdatePayload {
  venue: string;
  poolAddress: string;
  symbol: string;
  timestampMs: number;
  reserve0: number;
  reserve1: number;
  /** Derived pool price (token1 per token0). */
  price?: number;
  liquidityUsd?: number;
  /** Optional venue sequence number for ordering/dedup. */
  sequence?: number;
}

/** GAS_UPDATE payload (chain gas price). */
export interface GasUpdatePayload {
  venue: string;
  chain?: string;
  timestampMs: number;
  gasPriceGwei: number;
}

/** FUNDING_UPDATE payload (perpetual funding rate). */
export interface FundingUpdatePayload {
  venue: string;
  symbol: string;
  timestampMs: number;
  fundingRate: number;
}

/**
 * A normalized event's typed payload per event type. Used by consumers and by
 * deterministic graph reconstruction (issue #17 AC4).
 */
export interface NormalizedEventPayloads {
  MARKET_TICK: MarketDataSnapshot;
  ORDERBOOK_SNAPSHOT: OrderBookSnapshotPayload;
  ORDERBOOK_DELTA: OrderBookDeltaPayload;
  POOL_STATE_UPDATE: PoolStateUpdatePayload;
  GAS_UPDATE: GasUpdatePayload;
  FUNDING_UPDATE: FundingUpdatePayload;
  DATA_QUALITY_UPDATE: DataQualityReport;
  GRAPH_UPDATED: MarketGraphSnapshot;
  AUDIT_EVENT: AuditEvent;
}

/**
 * Event envelope shared by the in-memory bus and the SQLite store.
 * `eventId` is the idempotency key: publishing the same `eventId` twice is a
 * no-op (issue #17 AC1). `sequence` is assigned by the store and is the
 * deterministic replay order.
 */
export interface EventEnvelope {
  eventId: string;
  sequence: number;
  type: BaseEventType;
  kind: EventKind;
  timestampMs: number;
  /** Producer id, e.g. "bybit-ws-linear". */
  source: string;
  /** Raw venue payload (kind "raw") or normalized typed payload (kind "normalized"). */
  payload: Record<string, unknown>;
}

export const isBaseEventType: Validator<BaseEventType> = isEnumOf(BASE_EVENT_TYPES);
export const isEventKind: Validator<EventKind> = isEnumOf(EVENT_KINDS);

export const isOrderBookLevel: Validator<OrderBookLevel> = isObjectOf({
  price: isNumber,
  size: isNumber,
});

export const isOrderBookSnapshotPayload: Validator<OrderBookSnapshotPayload> =
  isObjectOf({
    venue: isString,
    symbol: isString,
    timestampMs: isNumber,
    bids: isArrayOf(isOrderBookLevel),
    asks: isArrayOf(isOrderBookLevel),
    sequence: isOptional(isNumber),
  });

/** Structurally identical to snapshot; reuses the same validator. */
export const isOrderBookDeltaPayload: Validator<OrderBookDeltaPayload> =
  isOrderBookSnapshotPayload;

export const isPoolStateUpdatePayload: Validator<PoolStateUpdatePayload> =
  isObjectOf({
    venue: isString,
    poolAddress: isString,
    symbol: isString,
    timestampMs: isNumber,
    reserve0: isNumber,
    reserve1: isNumber,
    price: isOptional(isNumber),
    liquidityUsd: isOptional(isNumber),
    sequence: isOptional(isNumber),
  });

export const isGasUpdatePayload: Validator<GasUpdatePayload> = isObjectOf({
  venue: isString,
  chain: isOptional(isString),
  timestampMs: isNumber,
  gasPriceGwei: isNumber,
});

export const isFundingUpdatePayload: Validator<FundingUpdatePayload> = isObjectOf({
  venue: isString,
  symbol: isString,
  timestampMs: isNumber,
  fundingRate: isNumber,
});

/**
 * Runtime validator map keyed by event type. Keeps the dispatch in sync with
 * the BaseEventType union — one entry per event, no repeated switch.
 */
const NORMALIZED_VALIDATORS: Record<BaseEventType, Validator<unknown>> = {
  MARKET_TICK: isMarketDataSnapshot,
  ORDERBOOK_SNAPSHOT: isOrderBookSnapshotPayload,
  ORDERBOOK_DELTA: isOrderBookDeltaPayload,
  POOL_STATE_UPDATE: isPoolStateUpdatePayload,
  GAS_UPDATE: isGasUpdatePayload,
  FUNDING_UPDATE: isFundingUpdatePayload,
  DATA_QUALITY_UPDATE: isDataQualityReport,
  GRAPH_UPDATED: isMarketGraphSnapshot,
  AUDIT_EVENT: isAuditEvent,
};

/** Validates a normalized payload against its event type. */
export function isNormalizedEventPayload(
  type: BaseEventType,
  payload: Record<string, unknown>,
): boolean {
  return NORMALIZED_VALIDATORS[type](payload);
}

const isEventEnvelopeShape: Validator<EventEnvelope> = isObjectOf({
  eventId: isString,
  sequence: isNumber,
  type: isBaseEventType,
  kind: isEventKind,
  timestampMs: isNumber,
  source: isString,
  payload: isFreeformRecord,
});

/**
 * Raw events accept any JSON-serializable object payload; normalized events
 * must match the typed payload for their event type.
 */
export const isEventEnvelope: Validator<EventEnvelope> = (
  value,
): value is EventEnvelope => {
  if (!isEventEnvelopeShape(value)) {
    return false;
  }
  const envelope = value as EventEnvelope;
  if (envelope.kind === "raw") {
    return true;
  }
  return isNormalizedEventPayload(envelope.type, envelope.payload);
};

export function parseEventEnvelope(value: unknown): EventEnvelope {
  return parse(isEventEnvelope, value, "EventEnvelope");
}

export function parseMarketTickPayload(value: unknown): MarketDataSnapshot {
  return parse(isMarketDataSnapshot, value, "MARKET_TICK payload");
}

export function parseOrderBookSnapshotPayload(
  value: unknown,
): OrderBookSnapshotPayload {
  return parse(isOrderBookSnapshotPayload, value, "ORDERBOOK_SNAPSHOT payload");
}

export function parsePoolStateUpdatePayload(
  value: unknown,
): PoolStateUpdatePayload {
  return parse(isPoolStateUpdatePayload, value, "POOL_STATE_UPDATE payload");
}

export function parseGraphUpdatedPayload(value: unknown): MarketGraphSnapshot {
  return parse(isMarketGraphSnapshot, value, "GRAPH_UPDATED payload");
}

/**
 * Builds a deterministic idempotency key for a logical event. The publisher
 * may supply any unique key; this helper keeps recorded sessions stable.
 */
export function makeEventId(segments: readonly (string | number)[]): string {
  return segments.join(":");
}
