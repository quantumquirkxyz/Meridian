import {
  isArrayOf,
  isEnumOf,
  isNumber,
  isObjectOf,
  isOptional,
  isString,
  isOneOf,
  parse,
  type Validator,
} from "./schema.ts";
import { isRiskReasonCode, type RiskReasonCode } from "./reason-codes.ts";
import { isOrderLimits, type OrderLimits } from "./limits.ts";

/**
 * RiskDecision: the deterministic Risk Engine's answer for an OrderIntent
 * (ADR-0003, RISK.md). Every rejected intent carries reason codes; every
 * approved one carries size, limits, and expiry (docs/RISK.md:45).
 *
 * Discriminated union: APPROVE / REDUCE_SIZE require the full approval payload,
 * REJECT requires reason codes, and the defensive outcomes require neither.
 */

export interface RiskDecisionBase {
  /** OrderIntent.idempotencyKey this decision applies to. */
  orderIntentIdempotencyKey: string;
  /** Reason codes, populated for REJECT / REDUCE_SIZE / defensive modes. */
  reasonCodes: RiskReasonCode[];
  evaluatedAtMs: number;
  /** Optional deterministic notes. */
  notes?: string;
}

export interface ApprovedRiskDecision extends RiskDecisionBase {
  decision: "APPROVE" | "REDUCE_SIZE";
  /** Resulting size. */
  approvedSize: number;
  /** Limits that bound the resulting order. */
  approvedLimits: OrderLimits;
  /** Decision expiry (Unix ms); an approval past expiry is void. */
  expiresAtMs: number;
}

export interface RejectedRiskDecision extends RiskDecisionBase {
  decision: "REJECT";
}

export interface DefensiveRiskDecision extends RiskDecisionBase {
  decision: "EXIT_ONLY" | "CANCEL_ONLY" | "CASH_ONLY" | "HALT_SYSTEM";
}

export type RiskDecision =
  | ApprovedRiskDecision
  | RejectedRiskDecision
  | DefensiveRiskDecision;

const isApprovedDecision: Validator<ApprovedRiskDecision> = isObjectOf({
  decision: isEnumOf(["APPROVE", "REDUCE_SIZE"] as const),
  orderIntentIdempotencyKey: isString,
  reasonCodes: isArrayOf(isRiskReasonCode),
  evaluatedAtMs: isNumber,
  approvedSize: isNumber,
  approvedLimits: isOrderLimits,
  expiresAtMs: isNumber,
  notes: isOptional(isString),
});

const isRejectedDecision: Validator<RejectedRiskDecision> = isObjectOf({
  decision: isEnumOf(["REJECT"] as const),
  orderIntentIdempotencyKey: isString,
  reasonCodes: isArrayOf(isRiskReasonCode),
  evaluatedAtMs: isNumber,
  notes: isOptional(isString),
});

const isDefensiveDecision: Validator<DefensiveRiskDecision> = isObjectOf({
  decision: isEnumOf([
    "EXIT_ONLY",
    "CANCEL_ONLY",
    "CASH_ONLY",
    "HALT_SYSTEM",
  ] as const),
  orderIntentIdempotencyKey: isString,
  reasonCodes: isArrayOf(isRiskReasonCode),
  evaluatedAtMs: isNumber,
  notes: isOptional(isString),
});

export const isRiskDecision: Validator<RiskDecision> = isOneOf<RiskDecision>([
  isApprovedDecision,
  isRejectedDecision,
  isDefensiveDecision,
]);

export function parseRiskDecision(value: unknown): RiskDecision {
  return parse(isRiskDecision, value, "RiskDecision");
}
