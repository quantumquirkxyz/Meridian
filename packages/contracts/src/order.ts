import {
  isEnumOf,
  isNumber,
  isObjectOf,
  isOptional,
  isString,
  parse,
  type Validator,
} from "./schema.ts";
import { isRiskDecision } from "./risk.ts";
import type { RiskDecision } from "./risk.ts";

/**
 * OrderIntent: a typed candidate order that only becomes a real order if the
 * Risk Engine approves it (ADR-0003). Carries an idempotency key, limits, and
 * expiry.
 */

export const ORDER_SIDES = ["BUY", "SELL"] as const;
export type OrderSide = (typeof ORDER_SIDES)[number];

export interface OrderLimits {
  maxSlippageBps?: number;
  maxGasUsd?: number;
  maxLatencyMs?: number;
  /** Minimum data quality state required to execute. */
  minDataQuality?: "HEALTHY" | "DEGRADED" | "STALE";
}

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
  /** Filled by the Risk Engine; an approved intent becomes executable. */
  riskApproval?: RiskDecision | null;
}

const isOrderSide: Validator<OrderSide> = isEnumOf(ORDER_SIDES);

export const isOrderLimits: Validator<OrderLimits> = isObjectOf({
  maxSlippageBps: isOptional(isNumber),
  maxGasUsd: isOptional(isNumber),
  maxLatencyMs: isOptional(isNumber),
  minDataQuality: isOptional(isEnumOf(["HEALTHY", "DEGRADED", "STALE"] as const)),
});

const isOptionalRiskApproval: Validator<RiskDecision | null | undefined> = (
  value,
): value is RiskDecision | null | undefined => {
  if (value === undefined || value === null) {
    return true;
  }
  return isRiskDecision(value);
};

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
  riskApproval: isOptionalRiskApproval,
});

export function parseOrderIntent(value: unknown): OrderIntent {
  return parse(isOrderIntent, value, "OrderIntent");
}
