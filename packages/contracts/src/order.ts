import {
  isEnumOf,
  isNumber,
  isObjectOf,
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
