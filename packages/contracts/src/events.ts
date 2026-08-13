import {
  isEnumOf,
  isNumber,
  isObjectOf,
  isString,
  parse,
  type Validator,
} from "./schema.ts";

/**
 * Base events carried by the in-memory event bus (Spec Alpha, user story 8).
 * Every event carries an idempotency key (`eventId`) so duplicates can be
 * deduplicated (user story 9) and replayed from the persisted store (10).
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

export interface BaseEvent<Payload = unknown> {
  /** Idempotency key. */
  eventId: string;
  type: BaseEventType;
  occurredAtMs: number;
  /** Producer id, e.g. "bybit-ws", "pancakeswap-rpc". */
  source: string;
  payload: Payload;
}

const isBaseEventType: Validator<BaseEventType> = isEnumOf(BASE_EVENT_TYPES);

export const isBaseEvent: Validator<BaseEvent> = isObjectOf({
  eventId: isString,
  type: isBaseEventType,
  occurredAtMs: isNumber,
  source: isString,
  payload: (value): value is unknown => true,
});

export function parseBaseEvent(value: unknown): BaseEvent {
  return parse(isBaseEvent, value, "BaseEvent");
}
