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
import { isRiskReasonCode, type RiskReasonCode } from "./reason-codes.ts";

/**
 * OpportunityCandidate: an opportunity hypothesis with expected net profit
 * after the full cost stack, its route, costs, and invalidation reasons
 * (Spec Alpha, user stories 15-17, 29).
 */

export const OPPORTUNITY_STATUS = [
  "PENDING",
  "CANDIDATE",
  "INVALID",
  "REJECTED",
  "APPROVED",
] as const;

export type OpportunityStatus = (typeof OPPORTUNITY_STATUS)[number];

/** Full cost stack from the Spec Alpha net profit formula. */
export interface CostBreakdown {
  tradingFeesUsd: number;
  slippageUsd: number;
  gasUsd: number;
  bridgeCostUsd: number;
  fundingCostUsd: number;
  latencyRiskUsd: number;
  failureRiskUsd: number;
  safetyBufferUsd: number;
}

export interface OpportunityCandidate {
  /** Candidate / hypothesis id. */
  id: string;
  /** MarketGraphSnapshot.snapshotId that produced this candidate. */
  snapshotId: string;
  /** Ordered node ids along the route. */
  route: string[];
  /** Gross spread before costs. */
  grossSpreadUsd: number;
  costs: CostBreakdown;
  /** grossSpreadUsd minus the full cost stack. */
  expectedNetProfitUsd: number;
  createdAtMs: number;
  status: OpportunityStatus;
  /** Reason codes when the route was discarded or rejected. */
  invalidationReasons?: RiskReasonCode[];
}

const isOpportunityStatus: Validator<OpportunityStatus> =
  isEnumOf(OPPORTUNITY_STATUS);

export const isCostBreakdown: Validator<CostBreakdown> = isObjectOf({
  tradingFeesUsd: isNumber,
  slippageUsd: isNumber,
  gasUsd: isNumber,
  bridgeCostUsd: isNumber,
  fundingCostUsd: isNumber,
  latencyRiskUsd: isNumber,
  failureRiskUsd: isNumber,
  safetyBufferUsd: isNumber,
});

const isOpportunityCandidateShape: Validator<OpportunityCandidate> = isObjectOf({
  id: isString,
  snapshotId: isString,
  route: isArrayOf(isString),
  grossSpreadUsd: isNumber,
  costs: isCostBreakdown,
  expectedNetProfitUsd: isNumber,
  createdAtMs: isNumber,
  status: isOpportunityStatus,
  invalidationReasons: isOptional(isArrayOf(isRiskReasonCode)),
});

/**
 * A discarded or rejected candidate must carry at least one reason code
 * (RISK.md:45 "every rejected OrderIntent carries reason codes"), so an
 * INVALID/REJECTED opportunity can never silently pass validation.
 */
export const isOpportunityCandidate: Validator<OpportunityCandidate> = (
  value,
): value is OpportunityCandidate => {
  if (!isOpportunityCandidateShape(value)) {
    return false;
  }
  const candidate = value as OpportunityCandidate;
  if (candidate.status === "INVALID" || candidate.status === "REJECTED") {
    return (candidate.invalidationReasons ?? []).length > 0;
  }
  return true;
};

export function parseOpportunityCandidate(value: unknown): OpportunityCandidate {
  return parse(isOpportunityCandidate, value, "OpportunityCandidate");
}
