import {
  type OrderIntent,
  type OrderLimits,
  type RiskDecision,
  type SystemMode,
} from "@agenttrading/contracts";

/**
 * RiskGate: the minimal deterministic gate for RISK_VALIDATE (issue #13 AC4,
 * RISK.md "Minimum Risk Engine rules"). The skeleton implements a real
 * approve/reject/reduce decision with reason codes; the full rule set ships
 * with the Beta Risk Engine (ticket #27). It never calls an LLM.
 */

export interface RiskPolicy {
  /** Below this net profit an opportunity is rejected (rule 12, MIN_EDGE). */
  minEdgeUsd: number;
  /** Above this notional per trade, size is reduced (rule 1, MAX_RISK_PER_TRADE). */
  maxRiskPerTradeUsd: number;
  /** Below this data-quality score an intent is rejected (rule 11, MIN_DATA_QUALITY). */
  minDataQualityScore: number;
}

export const DEFAULT_RISK_POLICY: RiskPolicy = {
  minEdgeUsd: 1,
  maxRiskPerTradeUsd: 1_000_000,
  minDataQualityScore: 0.5,
};

/** Modes in which the gate may approve new orders. */
const EXECUTABLE_MODES: readonly SystemMode[] = [
  "NORMAL",
  "SIGNAL_ONLY",
  "PAPER_ONLY",
];

export interface RiskGateInput {
  orderIntent: OrderIntent;
  /** OpportunityCandidate.expectedNetProfitUsd that produced this intent. */
  expectedNetProfitUsd: number;
  mode: SystemMode;
  /** Optional data-quality score feeding the MIN_DATA_QUALITY rule. */
  dataQualityScore?: number;
  evaluatedAtMs: number;
}

export class RiskGate {
  constructor(private readonly policy: RiskPolicy = DEFAULT_RISK_POLICY) {}

  evaluate(input: RiskGateInput): RiskDecision {
    const base = {
      orderIntentIdempotencyKey: input.orderIntent.idempotencyKey,
      evaluatedAtMs: input.evaluatedAtMs,
    };

    if (!EXECUTABLE_MODES.includes(input.mode)) {
      return {
        ...base,
        decision: "EXIT_ONLY",
        reasonCodes: ["DEGRADED_MODE"],
        notes: `system in ${input.mode}; no new orders`,
      };
    }

    if (
      input.dataQualityScore !== undefined &&
      input.dataQualityScore < this.policy.minDataQualityScore
    ) {
      return {
        ...base,
        decision: "REJECT",
        reasonCodes: ["MIN_DATA_QUALITY"],
        notes: `data quality ${input.dataQualityScore} below ${this.policy.minDataQualityScore}`,
      };
    }

    if (input.expectedNetProfitUsd < this.policy.minEdgeUsd) {
      return {
        ...base,
        decision: "REJECT",
        reasonCodes: ["MIN_EDGE"],
        notes: `expected net profit ${input.expectedNetProfitUsd} below min edge ${this.policy.minEdgeUsd}`,
      };
    }

    const notionalUsd = input.orderIntent.quantity * input.orderIntent.price;
    if (notionalUsd > this.policy.maxRiskPerTradeUsd) {
      const approvedSize = this.policy.maxRiskPerTradeUsd / input.orderIntent.price;
      return {
        ...base,
        decision: "REDUCE_SIZE",
        reasonCodes: ["MAX_RISK_PER_TRADE"],
        approvedSize,
        approvedLimits: input.orderIntent.limits,
        expiresAtMs: input.evaluatedAtMs + RISK_APPROVAL_TTL_MS,
        notes: `notional ${notionalUsd} reduced to ${this.policy.maxRiskPerTradeUsd}`,
      };
    }

    return {
      ...base,
      decision: "APPROVE",
      approvedSize: input.orderIntent.quantity,
      approvedLimits: orderLimitsFrom(input.orderIntent.limits),
      expiresAtMs: input.evaluatedAtMs + RISK_APPROVAL_TTL_MS,
    };
  }
}

/** Approval validity window (ms); an approval past expiry is void. */
export const RISK_APPROVAL_TTL_MS = 60_000;

function orderLimitsFrom(limits: OrderLimits): OrderLimits {
  return { ...limits };
}