import {
  isArrayOf,
  isEnumOf,
  isNonEmptyArrayOf,
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
 * Discriminated union: APPROVE requires the full approval payload; REDUCE_SIZE
 * requires the approval payload plus reason codes; REJECT and the defensive
 * outcomes require reason codes.
 */

export interface RiskDecisionBase {
  /** OrderIntent.idempotencyKey this decision applies to. */
  orderIntentIdempotencyKey: string;
  evaluatedAtMs: number;
  /** Optional deterministic notes. */
  notes?: string;
}

const APPROVAL_OUTCOMES = [
  "APPROVE",
] as const satisfies readonly RiskDecisionOutcome[];

const REDUCE_SIZE_OUTCOMES = [
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

interface ApprovalPayload {
  /** Resulting size. */
  approvedSize: number;
  /** Limits that bound the resulting order. */
  approvedLimits: OrderLimits;
  /** Decision expiry (Unix ms); an approval past expiry is void. */
  expiresAtMs: number;
}

export interface ApprovedRiskDecision extends RiskDecisionBase, ApprovalPayload {
  decision: (typeof APPROVAL_OUTCOMES)[number];
}

export interface ReduceRiskDecision extends RiskDecisionBase, ApprovalPayload {
  decision: (typeof REDUCE_SIZE_OUTCOMES)[number];
  /** Reason codes; a reduction always explains itself. */
  reasonCodes: [RiskReasonCode, ...RiskReasonCode[]];
}

export interface RejectedRiskDecision extends RiskDecisionBase {
  decision: (typeof REJECTION_OUTCOMES)[number];
  /** Reason codes; a rejection always explains itself. */
  reasonCodes: [RiskReasonCode, ...RiskReasonCode[]];
}

export interface DefensiveRiskDecision extends RiskDecisionBase {
  decision: (typeof DEFENSIVE_OUTCOMES)[number];
  /** Reason codes; a defensive outcome always explains itself. */
  reasonCodes: [RiskReasonCode, ...RiskReasonCode[]];
}

export type RiskDecision =
  | ApprovedRiskDecision
  | ReduceRiskDecision
  | RejectedRiskDecision
  | DefensiveRiskDecision;

/** Shared base fields of every RiskDecision variant (RiskDecisionBase). */
const baseShape: {
  [K in keyof RiskDecisionBase]: Validator<RiskDecisionBase[K]>;
} = {
  orderIntentIdempotencyKey: isString,
  evaluatedAtMs: isNumber,
  notes: isOptional(isString),
};

const isExplainedReasonCodes = isNonEmptyArrayOf(isRiskReasonCode);

/** Shared payload fields of every approval-style decision. */
const approvalPayloadShape = {
  approvedSize: isNumber,
  approvedLimits: isOrderLimits,
  expiresAtMs: isNumber,
};

const isApprovedDecision: Validator<ApprovedRiskDecision> = isObjectOf({
  decision: isEnumOf(APPROVAL_OUTCOMES),
  ...baseShape,
  ...approvalPayloadShape,
});

const isReduceDecision: Validator<ReduceRiskDecision> = isObjectOf({
  decision: isEnumOf(REDUCE_SIZE_OUTCOMES),
  ...baseShape,
  reasonCodes: isExplainedReasonCodes,
  ...approvalPayloadShape,
});

const isRejectedDecision: Validator<RejectedRiskDecision> = isObjectOf({
  decision: isEnumOf(REJECTION_OUTCOMES),
  ...baseShape,
  reasonCodes: isExplainedReasonCodes,
});

const isDefensiveDecision: Validator<DefensiveRiskDecision> = isObjectOf({
  decision: isEnumOf(DEFENSIVE_OUTCOMES),
  ...baseShape,
  reasonCodes: isExplainedReasonCodes,
});

export const isRiskDecision: Validator<RiskDecision> = isOneOf<RiskDecision>([
  isApprovedDecision,
  isReduceDecision,
  isRejectedDecision,
  isDefensiveDecision,
]);

export function parseRiskDecision(value: unknown): RiskDecision {
  return parse(isRiskDecision, value, "RiskDecision");
}
