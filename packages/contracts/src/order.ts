import {
  isEnumOf,
  isNullable,
  isNumber,
  isObjectOf,
  isOptional,
  isString,
  parse,
  type Validator,
} from "./schema.ts";
import { isOrderLimits, type OrderLimits } from "./limits.ts";

/**
 * OrderIntent: a typed candidate order that only becomes a real order if the
 * Risk Engine approves it (ADR-0003). Carries an idempotency key, limits, and
 * expiry.
 */

export const ORDER_SIDES = ["BUY", "SELL"] as const;
export type OrderSide = (typeof ORDER_SIDES)[number];

export interface OrderIntent {
  /** Idempotency key for deduplication. */
  idempotencyKey: string;
  /** OpportunityCandidate.id that produced this intent. */
  opportunityId: string;
  venue: string;
  symbol: string;
  side: OrderSide;
  quantity: number;
  /** Limit price. */
  price: number;
  quoteCurrency: string;
  createdAtMs: number;
  /** Intents past expiry are never executed. */
  expiresAtMs: number;
  limits: OrderLimits;
}

const isOrderSide: Validator<OrderSide> = isEnumOf(ORDER_SIDES);

export const isOrderIntent: Validator<OrderIntent> = isObjectOf({
  idempotencyKey: isString,
  opportunityId: isString,
  venue: isString,
  symbol: isString,
  side: isOrderSide,
  quantity: isNumber,
  price: isNumber,
  quoteCurrency: isString,
  createdAtMs: isNumber,
  expiresAtMs: isNumber,
  limits: isOrderLimits,
});

export function parseOrderIntent(value: unknown): OrderIntent {
  return parse(isOrderIntent, value, "OrderIntent");
}

// ── OrderUpdate ─────────────────────────────────────────────────────

/**
 * OrderUpdate: a typed order state transition produced by a WebSocket feed
 * (e.g. Bybit, Binance). Normalizes exchange-specific order statuses into
 * a common vocabulary so downstream layers consume one shape.
 *
 * This is the WebSocket counterpart to OrderIntent/OrderSnapshot: an
 * OrderIntent proposes an order; an OrderUpdate reports how the exchange
 * treated it.
 */

export const ORDER_UPDATE_STATUSES = [
  "NEW",
  "PARTIALLY_FILLED",
  "FILLED",
  "CANCELLED",
  "REJECTED",
  "EXPIRED",
  "UNTRIGGERED",
] as const;

export type OrderUpdateStatus = (typeof ORDER_UPDATE_STATUSES)[number];

export const ORDER_UPDATE_SIDES = ["BUY", "SELL"] as const;
export type OrderUpdateSide = (typeof ORDER_UPDATE_SIDES)[number];

export const ORDER_UPDATE_TYPES = ["LIMIT", "MARKET", "STOP_LIMIT", "STOP_MARKET", "TAKE_PROFIT_LIMIT", "TAKE_PROFIT_MARKET", "TRAILING_STOP_MARKET"] as const;
export type OrderUpdateType = (typeof ORDER_UPDATE_TYPES)[number];

export interface OrderUpdate {
  /** Venue-assigned order id. */
  orderId: string;
  /** Optional client-supplied order link id. */
  orderLinkId?: string;
  /** Normalized symbol, e.g. "BTC/USDT". */
  symbol: string;
  /** Order side. */
  side: OrderUpdateSide;
  /** Order type. */
  orderType: OrderUpdateType;
  /** Limit price (null for market orders). */
  price: number | null;
  /** Original order quantity. */
  quantity: number;
  /** Normalized order status. */
  status: OrderUpdateStatus;
  /** Cumulative filled quantity. */
  cumulativeFilledQty: number;
  /** Leaves quantity (remaining). */
  leavesQty: number;
  /** Average fill price (null if no fills yet). */
  averagePrice: number | null;
  /** Event timestamp (Unix ms). */
  timestampMs: number;
  /** Venue-assigned stop order type, if applicable. */
  stopOrderType?: string;
  /** TPSL mode (e.g. "Full", "Partial"), if applicable. */
  tpslMode?: string;
  /** Trigger price, if applicable. */
  triggerPrice?: number;
  /** Optional raw reason for rejection/cancellation. */
  reason?: string;
}

const isOrderUpdateStatus: Validator<OrderUpdateStatus> = isEnumOf(ORDER_UPDATE_STATUSES);
const isOrderUpdateSide: Validator<OrderUpdateSide> = isEnumOf(ORDER_UPDATE_SIDES);
const isOrderUpdateType: Validator<OrderUpdateType> = isEnumOf(ORDER_UPDATE_TYPES);

const isNullableNumber: Validator<number | null> = isNullable(isNumber);

export const isOrderUpdate: Validator<OrderUpdate> = isObjectOf({
  orderId: isString,
  orderLinkId: isOptional(isString),
  symbol: isString,
  side: isOrderUpdateSide,
  orderType: isOrderUpdateType,
  price: isNullableNumber,
  quantity: isNumber,
  status: isOrderUpdateStatus,
  cumulativeFilledQty: isNumber,
  leavesQty: isNumber,
  averagePrice: isNullableNumber,
  timestampMs: isNumber,
  stopOrderType: isOptional(isString),
  tpslMode: isOptional(isString),
  triggerPrice: isOptional(isNumber),
  reason: isOptional(isString),
});

export function parseOrderUpdate(value: unknown): OrderUpdate {
  return parse(isOrderUpdate, value, "OrderUpdate");
}
