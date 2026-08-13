/**
 * Shared reason codes for risk decisions and data invalidation (RISK.md
 * "Minimum Risk Engine rules").
 */
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
  "AUDIT_UNAVAILABLE",
] as const;

export type RiskReasonCode = (typeof RISK_REASON_CODES)[number];

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
