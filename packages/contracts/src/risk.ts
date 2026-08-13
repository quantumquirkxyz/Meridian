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
import {
  isRiskReasonCode,
  type RiskDecisionOutcome,
  type RiskReasonCode,
} from "./reason-codes.ts";
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

const APPROVAL_OUTCOMES = [
  "APPROVE",
  "REDUCE_SIZE",
] as const satisfies readonly RiskDecisionOutcome[];

const REJECTION_OUTCOMES = [
  "REJECT",
] as const satisfies readonly RiskDecisionOutcome[];

const DEFENSIVE_OUTCOMES = [
  "EXIT_ONLY",
  "CANCEL_ONLY",
  "CASH_ONLY",
  "HALT_SYSTEM",
] as const satisfies readonly RiskDecisionOutcome[];

export interface ApprovedRiskDecision extends RiskDecisionBase {
  decision: (typeof APPROVAL_OUTCOMES)[number];
  /** Resulting size. */
  approvedSize: number;
  /** Limits that bound the resulting order. */
  approvedLimits: OrderLimits;
  /** Decision expiry (Unix ms); an approval past expiry is void. */
  expiresAtMs: number;
}

export interface RejectedRiskDecision extends RiskDecisionBase {
  decision: (typeof REJECTION_OUTCOMES)[number];
}

export interface DefensiveRiskDecision extends RiskDecisionBase {
  decision: (typeof DEFENSIVE_OUTCOMES)[number];
}

export type RiskDecision =
  | ApprovedRiskDecision
  | RejectedRiskDecision
  | DefensiveRiskDecision;

/** Shared base fields of every RiskDecision variant (RiskDecisionBase). */
const baseShape: {
  [K in keyof RiskDecisionBase]: Validator<RiskDecisionBase[K]>;
} = {
  orderIntentIdempotencyKey: isString,
  reasonCodes: isArrayOf(isRiskReasonCode),
  evaluatedAtMs: isNumber,
  notes: isOptional(isString),
};

const isApprovedDecision: Validator<ApprovedRiskDecision> = isObjectOf({
  decision: isEnumOf(APPROVAL_OUTCOMES),
  ...baseShape,
  approvedSize: isNumber,
  approvedLimits: isOrderLimits,
  expiresAtMs: isNumber,
});

const isRejectedDecision: Validator<RejectedRiskDecision> = isObjectOf({
  decision: isEnumOf(REJECTION_OUTCOMES),
  ...baseShape,
});

const isDefensiveDecision: Validator<DefensiveRiskDecision> = isObjectOf({
  decision: isEnumOf(DEFENSIVE_OUTCOMES),
  ...baseShape,
});

export const isRiskDecision: Validator<RiskDecision> = isOneOf<RiskDecision>([
  isApprovedDecision,
  isRejectedDecision,
  isDefensiveDecision,
]);

export function parseRiskDecision(value: unknown): RiskDecision {
  return parse(isRiskDecision, value, "RiskDecision");
}
