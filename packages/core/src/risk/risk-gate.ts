import {
  type OrderIntent,
  type RiskDecision,
  type SystemMode,
} from "@agenttrading/contracts";
import { SIGNAL_MODES } from "../modes.ts";

/**
 * RiskGate: the minimal deterministic gate for RISK_VALIDATE (issue #13 AC4,
 * RISK.md "Minimum Risk Engine rules"). The skeleton implements a real
 * approve/reject/reduce decision with reason codes; the full rule set ships
 * with the Beta Risk Engine (ticket #27). It never calls an LLM.
 */

/**
 * Thresholds the skeleton gate evaluates. Rules map to RISK.md "Minimum Risk
 * Engine rules": MAX_RISK_PER_TRADE (rule 1), MIN_EDGE (rule 12),
 * MIN_DATA_QUALITY (rule 11).
 */
export interface RiskPolicy {
  /** Below this net profit an opportunity is rejected (rule 12, MIN_EDGE). */
  minEdgeUsd: number;
  /** Above this notional per trade, size is reduced (rule 1, MAX_RISK_PER_TRADE). */
  maxRiskPerTradeUsd: number;
  /** Below this data-quality score an intent is rejected (rule 11, MIN_DATA_QUALITY). */
  minDataQualityScore: number;
}

/** Default thresholds for the skeleton RiskGate (same policy in every flow). */
export const DEFAULT_RISK_POLICY: RiskPolicy = {
  minEdgeUsd: 1,
  maxRiskPerTradeUsd: 1_000_000,
  minDataQualityScore: 0.5,
};

/** Everything the RiskGate needs to evaluate one OrderIntent. */
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

  /**
   * Evaluates an OrderIntent against the minimum rules and returns a typed
   * RiskDecision: APPROVE / REDUCE_SIZE (with the full approval payload and
   * expiry), REJECT, or a defensive EXIT_ONLY outcome — always with reason
   * codes where required (RISK.md:45). The skeleton gate emits only EXIT_ONLY
   * as the defensive outcome; the contract's CANCEL_ONLY / CASH_ONLY /
   * HALT_SYSTEM outcomes are reserved for the Beta Risk Engine (ticket #27)
   * and are already reachable through the graph's risk-to-audit edge.
   */
  evaluate(input: RiskGateInput): RiskDecision {
    const base = {
      orderIntentIdempotencyKey: input.orderIntent.idempotencyKey,
      evaluatedAtMs: input.evaluatedAtMs,
    };

    // The gate only evaluates new orders in signal-capable modes (SIGNAL_MODES).
    // Execution itself is additionally gated by the graph's EXECUTION_MODES, so
    // e.g. in SIGNAL_ONLY the gate may approve but risk-to-precheck blocks it.
    if (!SIGNAL_MODES.includes(input.mode)) {
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
        approvedLimits: { ...input.orderIntent.limits },
        expiresAtMs: input.evaluatedAtMs + RISK_APPROVAL_TTL_MS,
        notes: `notional ${notionalUsd} reduced to ${this.policy.maxRiskPerTradeUsd}`,
      };
    }

    return {
      ...base,
      decision: "APPROVE",
      approvedSize: input.orderIntent.quantity,
      approvedLimits: { ...input.orderIntent.limits },
      expiresAtMs: input.evaluatedAtMs + RISK_APPROVAL_TTL_MS,
    };
  }
}

/** Approval validity window (ms); an approval past expiry is void. */
export const RISK_APPROVAL_TTL_MS = 60_000;