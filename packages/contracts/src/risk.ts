import {
  isArrayOf,
  isEnumOf,
  isNumber,
  isObjectOf,
  isOptional,
  isString,
  parse,
  type Validator,
} from "./schema.ts";
import {
  RISK_DECISION_OUTCOMES,
  RISK_REASON_CODES,
  type RiskDecisionOutcome,
  type RiskReasonCode,
} from "./reason-codes.ts";
import type { OrderLimits } from "./order.ts";

/**
 * RiskDecision: the deterministic Risk Engine's answer for an OrderIntent
 * (ADR-0003, RISK.md). Every rejected intent carries reason codes; every
 * approved one carries size, limits, and expiry.
 */
export interface RiskDecision {
  decision: RiskDecisionOutcome;
  /** OrderIntent.idempotencyKey this decision applies to. */
  orderIntentIdempotencyKey: string;
  /** Reason codes, populated for REJECT / REDUCE_SIZE / defensive modes. */
  reasonCodes: RiskReasonCode[];
  evaluatedAtMs: number;
  /** Resulting size (APPROVE / REDUCE_SIZE). */
  approvedSize?: number;
  /** Limits that bound the resulting order. */
  approvedLimits?: OrderLimits;
  /** Decision expiry (Unix ms); an approval past expiry is void. */
  expiresAtMs?: number;
  /** Optional deterministic notes. */
  notes?: string;
}

const isRiskDecisionOutcome: Validator<RiskDecisionOutcome> =
  isEnumOf(RISK_DECISION_OUTCOMES);

const isRiskReasonCode: Validator<RiskReasonCode> = isEnumOf(RISK_REASON_CODES);

export const isRiskDecision: Validator<RiskDecision> = isObjectOf({
  decision: isRiskDecisionOutcome,
  orderIntentIdempotencyKey: isString,
  reasonCodes: isArrayOf(isRiskReasonCode),
  evaluatedAtMs: isNumber,
  approvedSize: isOptional(isNumber),
  approvedLimits: isOptional(
    (value): value is OrderLimits => typeof value === "object" && value !== null,
  ),
  expiresAtMs: isOptional(isNumber),
  notes: isOptional(isString),
});

export function parseRiskDecision(value: unknown): RiskDecision {
  return parse(isRiskDecision, value, "RiskDecision");
}
