/**
 * Shared reason codes for risk decisions and data invalidation (RISK.md
 * "Minimum Risk Engine rules").
 */
import { isEnumOf, type Validator } from "./schema.ts";

export const RISK_REASON_CODES = [
  "MAX_RISK_PER_TRADE",
  "MAX_DAILY_LOSS",
  "MAX_WEEKLY_LOSS",
  "MAX_EXPOSURE_PER_TOKEN",
  "MAX_EXPOSURE_PER_VENUE",
  "MAX_EXPOSURE_PER_CHAIN",
  "MAX_OPEN_ORDERS",
  "MAX_SLIPPAGE",
  "MAX_GAS",
  "MAX_LATENCY",
  "MIN_DATA_QUALITY",
  "MIN_EDGE",
  "MIN_LIQUIDITY",
  "MAX_FUNDING_COST",
  "MAX_CORRELATION_CONCENTRATION",
  "DEGRADED_MODE",
  "RECONCILIATION_UNRESOLVED",
  "INVENTORY_BLOCKED",
  "AUDIT_UNAVAILABLE",
  "LOSS_STATE_MISSING",
] as const;

export type RiskReasonCode = (typeof RISK_REASON_CODES)[number];

/**
 * Route-specific reason codes for route invalidation.
 * These are used by the RouteEngine to explain why a route
 * was discarded, expired, or blocked.
 */
export const ROUTE_REASON_CODES = [
  "ROUTE_EXPIRED",
  "ROUTE_STALE",
  "ROUTE_BLOCKED",
  "ROUTE_SCORE_LOW",
  "ROUTE_TOO_LONG",
  "LIQUIDITY_EVAPORATED",
  "HIDDEN_CORRELATION",
] as const;

export type RouteReasonCode = (typeof ROUTE_REASON_CODES)[number];

export const isRouteReasonCode: Validator<RouteReasonCode> =
  isEnumOf(ROUTE_REASON_CODES);

export const isRiskReasonCode: Validator<RiskReasonCode> =
  isEnumOf(RISK_REASON_CODES);

export const RISK_DECISION_OUTCOMES = [
  "APPROVE",
  "REJECT",
  "REDUCE_SIZE",
  "EXIT_ONLY",
  "CANCEL_ONLY",
  "CASH_ONLY",
  "HALT_SYSTEM",
] as const;

export type RiskDecisionOutcome = (typeof RISK_DECISION_OUTCOMES)[number];
