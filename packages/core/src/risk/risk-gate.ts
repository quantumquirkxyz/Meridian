import {
  type OrderIntent,
  type RiskDecision,
  type RiskDecisionOutcome,
  type RiskReasonCode,
  type SystemMode,
} from "@agenttrading/contracts";
import { SIGNAL_MODES } from "../modes.ts";

/**
 * RiskEngine: the complete deterministic risk engine (issue #27).
 *
 * Enforces all 18 minimum rules from RISK.md:
 *   1. MAX_RISK_PER_TRADE
 *   2. MAX_DAILY_LOSS
 *   3. MAX_WEEKLY_LOSS
 *   4. MAX_EXPOSURE_PER_TOKEN
 *   5. MAX_EXPOSURE_PER_VENUE
 *   6. MAX_EXPOSURE_PER_CHAIN
 *   7. MAX_OPEN_ORDERS
 *   8. MAX_SLIPPAGE
 *   9. MAX_GAS
 *  10. MAX_LATENCY
 *  11. MIN_DATA_QUALITY
 *  12. MIN_EDGE
 *  13. MIN_LIQUIDITY
 *  14. MAX_FUNDING_COST
 *  15. MAX_CORRELATION_CONCENTRATION
 *  16. DEGRADED_MODE
 *  17. RECONCILIATION_UNRESOLVED
 *  18. AUDIT_UNAVAILABLE
 *
 * Actions: APPROVE, REJECT, REDUCE_SIZE, EXIT_ONLY, CANCEL_ONLY,
 *          CASH_ONLY, HALT_SYSTEM.
 *
 * Every rejected intent carries reason codes; every approved one carries
 * size, limits, and expiry (RISK.md:45).
 *
 * This engine never calls an LLM. It is purely deterministic (ADR-0003).
 *
 * Boundary vs. canary pre-check (ADR-0011): the RiskEngine is the policy
 * authority — it evaluates the full RISK.md rule set and may REDUCE_SIZE or
 * emit defensive dicta with reason codes. The canary-session pre-check applies
 * hard operational canary limits (blocks with a blockReason). Their overlap in
 * loss/exposure/order-count limits is a deliberate fail-closed double gate with
 * different thresholds and outcomes, not accidental duplication.
 */

// ── Policy ──────────────────────────────────────────────────────────

/**
 * Full risk policy thresholds. All fields are optional — only rules with
 * a defined threshold are enforced; undefined means "no limit."
 */
export interface RiskPolicy {
  // Rule 1: MAX_RISK_PER_TRADE
  /** Maximum notional (USD) per single trade. Above this, REDUCE_SIZE. */
  maxRiskPerTradeUsd?: number;

  // Rule 2: MAX_DAILY_LOSS
  /** Maximum cumulative loss (USD) allowed in a calendar day. */
  maxDailyLossUsd?: number;

  // Rule 3: MAX_WEEKLY_LOSS
  /** Maximum cumulative loss (USD) allowed in a calendar week. */
  maxWeeklyLossUsd?: number;

  // Rule 4: MAX_EXPOSURE_PER_TOKEN
  /** Maximum net exposure (USD) in a single token across all venues. */
  maxExposurePerTokenUsd?: number;

  // Rule 5: MAX_EXPOSURE_PER_VENUE
  /** Maximum net exposure (USD) at a single venue. */
  maxExposurePerVenueUsd?: number;

  // Rule 6: MAX_EXPOSURE_PER_CHAIN
  /** Maximum net exposure (USD) on a single chain. */
  maxExposurePerChainUsd?: number;

  // Rule 7: MAX_OPEN_ORDERS
  /** Maximum number of concurrent open orders. */
  maxOpenOrders?: number;

  // Rule 8: MAX_SLIPPAGE
  /** Maximum allowed slippage in basis points. */
  maxSlippageBps?: number;

  // Rule 9: MAX_GAS
  /** Maximum allowed gas cost (USD). */
  maxGasUsd?: number;

  // Rule 10: MAX_LATENCY
  /** Maximum allowed execution latency (ms). */
  maxLatencyMs?: number;

  // Rule 11: MIN_DATA_QUALITY
  /** Minimum data quality score (0–1). */
  minDataQualityScore?: number;

  // Rule 12: MIN_EDGE
  /** Minimum expected net profit (USD). */
  minEdgeUsd?: number;

  // Rule 13: MIN_LIQUIDITY
  /** Minimum liquidity depth (USD) on the route. */
  minLiquidityDepthUsd?: number;

  // Rule 14: MAX_FUNDING_COST
  /** Maximum funding cost (USD) for the position. */
  maxFundingCostUsd?: number;

  // Rule 15: MAX_CORRELATION_CONCENTRATION
  /** Maximum allowed risk concentration in a single node (0–1). */
  maxCorrelationConcentration?: number;
}

/**
 * Default policy — every input-driven rule from RISK.md is enforced at
 * conservative production thresholds (the "full policy" set). Rules whose
 * threshold is undefined are not enforced; callers can relax or tighten any
 * threshold by spreading this object and overriding fields.
 */
export const DEFAULT_RISK_POLICY: Required<
  Pick<
    RiskPolicy,
    | "maxRiskPerTradeUsd"
    | "minEdgeUsd"
    | "minDataQualityScore"
    | "maxSlippageBps"
    | "maxGasUsd"
    | "maxLatencyMs"
    | "maxExposurePerTokenUsd"
    | "maxExposurePerVenueUsd"
    | "maxExposurePerChainUsd"
    | "maxOpenOrders"
    | "minLiquidityDepthUsd"
    | "maxFundingCostUsd"
    | "maxCorrelationConcentration"
  >
> = {
  maxRiskPerTradeUsd: 1_000_000,
  minEdgeUsd: 1,
  minDataQualityScore: 0.5,
  maxSlippageBps: 50,
  maxGasUsd: 50,
  maxLatencyMs: 5_000,
  maxExposurePerTokenUsd: 50_000,
  maxExposurePerVenueUsd: 100_000,
  maxExposurePerChainUsd: 200_000,
  maxOpenOrders: 10,
  minLiquidityDepthUsd: 10_000,
  maxFundingCostUsd: 20,
  maxCorrelationConcentration: 0.8,
};

// ── Input ───────────────────────────────────────────────────────────

/**
 * Everything the RiskEngine needs to evaluate one OrderIntent.
 * Optional fields are only checked when the corresponding rule is defined
 * in the policy.
 */
export interface RiskGateInput {
  orderIntent: OrderIntent;
  /** OpportunityCandidate.expectedNetProfitUsd that produced this intent. */
  expectedNetProfitUsd: number;
  mode: SystemMode;
  /** Set when the order must fail closed before execution due to inventory. */
  inventoryBlocked?: boolean;

  // Rule 11: MIN_DATA_QUALITY
  /** Data-quality score for the intent's data source (0–1). */
  dataQualityScore?: number;

  // Rule 2 & 3: MAX_DAILY_LOSS / MAX_WEEKLY_LOSS
  /** Cumulative loss (USD) since start of day. Negative = profit. */
  dailyLossUsd?: number;
  /** Cumulative loss (USD) since start of week. Negative = profit. */
  weeklyLossUsd?: number;

  // Rules 4–6: exposure
  /** Current net exposure (USD) in the intent's token across all venues. */
  tokenExposureUsd?: number;
  /** Current net exposure (USD) at the intent's venue. */
  venueExposureUsd?: number;
  /** Current net exposure (USD) on the intent's chain. */
  chainExposureUsd?: number;

  // Rule 7: MAX_OPEN_ORDERS
  /** Number of currently open orders. */
  openOrderCount?: number;

  // Rule 8: MAX_SLIPPAGE
  /** Estimated slippage for this trade (bps). */
  slippageBps?: number;

  // Rule 9: MAX_GAS
  /** Estimated gas cost (USD) for this trade. */
  gasCostUsd?: number;

  // Rule 10: MAX_LATENCY
  /** Estimated execution latency (ms). */
  latencyMs?: number;

  // Rule 13: MIN_LIQUIDITY
  /** Liquidity depth (USD) available on the route. */
  liquidityDepthUsd?: number;

  // Rule 14: MAX_FUNDING_COST
  /** Funding cost (USD) if holding this position. */
  fundingCostUsd?: number;

  // Rule 15: MAX_CORRELATION_CONCENTRATION
  /** Maximum risk concentration across route nodes (0–1). */
  riskConcentration?: number;

  // Rule 17: RECONCILIATION_UNRESOLVED
  /** Whether reconciliation is currently unresolved. */
  reconciliationUnresolved?: boolean;

  // Rule 18: AUDIT_UNAVAILABLE
  /** Whether the audit subsystem is unavailable. */
  auditUnavailable?: boolean;

  // Rule 16: degraded modes are detected from the `mode` field via SIGNAL_MODES

  evaluatedAtMs: number;
}

// ── Result ──────────────────────────────────────────────────────────

/** The evaluated risk action plus the reason codes that triggered it. */
export interface RiskEvaluation {
  decision: RiskDecisionOutcome;
  reasonCodes: RiskReasonCode[];
  /** Approved size when decision is APPROVE or REDUCE_SIZE. */
  approvedSize?: number;
  /** Approved limits when decision is APPROVE or REDUCE_SIZE. */
  approvedLimits?: OrderIntent["limits"];
  /** Decision expiry (Unix ms) when decision is APPROVE or REDUCE_SIZE. */
  expiresAtMs?: number;
  /** Human-readable explanation of what triggered the decision. */
  notes: string;
}

// ── Helpers ─────────────────────────────────────────────────────────

/** Non-empty reason-code tuple required by every non-approve decision. */
type ReasonCodeTuple = [RiskReasonCode, ...RiskReasonCode[]];

function toReasonTuple(codes: RiskReasonCode[]): ReasonCodeTuple {
  // Every non-approve rule pushes at least one reason code before returning,
  // so the tuple-upcast is safe (kept typed; never `as any`).
  return codes as ReasonCodeTuple;
}

function evaluationToRiskDecision(
  eval_: RiskEvaluation,
  idempotencyKey: string,
  limits: OrderIntent["limits"],
  evaluatedAtMs: number,
): RiskDecision {
  const base = {
    orderIntentIdempotencyKey: idempotencyKey,
    evaluatedAtMs,
    notes: eval_.notes,
  };

  switch (eval_.decision) {
    case "APPROVE":
      return {
        ...base,
        decision: "APPROVE" as const,
        approvedSize: eval_.approvedSize ?? 0,
        approvedLimits: eval_.approvedLimits ?? limits,
        expiresAtMs: eval_.expiresAtMs ?? evaluatedAtMs + RISK_APPROVAL_TTL_MS,
      };
    case "REDUCE_SIZE":
      return {
        ...base,
        decision: "REDUCE_SIZE" as const,
        approvedSize: eval_.approvedSize ?? 0,
        approvedLimits: eval_.approvedLimits ?? limits,
        expiresAtMs: eval_.expiresAtMs ?? evaluatedAtMs + RISK_APPROVAL_TTL_MS,
        reasonCodes: toReasonTuple(eval_.reasonCodes),
      };
    case "REJECT":
      return {
        ...base,
        decision: "REJECT" as const,
        reasonCodes: toReasonTuple(eval_.reasonCodes),
      };
    case "EXIT_ONLY":
    case "CANCEL_ONLY":
    case "CASH_ONLY":
    case "HALT_SYSTEM":
      return {
        ...base,
        decision: eval_.decision,
        reasonCodes: toReasonTuple(eval_.reasonCodes),
      };
    default:
      return {
        ...base,
        decision: "REJECT" as const,
        reasonCodes: toReasonTuple(eval_.reasonCodes),
      };
  }
}

// ── Engine ──────────────────────────────────────────────────────────

/**
 * Full deterministic RiskEngine. Evaluates all 18 RISK.md rules against
 * an OrderIntent and produces a typed RiskDecision with reason codes.
 *
 * The engine is stateless — all context (exposures, losses, open orders)
 * is passed in via RiskGateInput. The caller is responsible for tracking
 * cumulative state between evaluations.
 */
export class RiskEngine {
  private readonly policy: RiskPolicy;

  constructor(policy: RiskPolicy = DEFAULT_RISK_POLICY) {
    this.policy = { ...policy };
  }

  /**
   * Evaluates an OrderIntent against all 18 rules and returns a typed
   * RiskDecision. Rules are checked in priority order — defensive rules
   * (system-level halts) first, then loss limits, then per-trade limits.
   */
  evaluate(input: RiskGateInput): RiskDecision {
    const eval_ = this.evaluateInternal(input);
    return evaluationToRiskDecision(
      eval_,
      input.orderIntent.idempotencyKey,
      input.orderIntent.limits,
      input.evaluatedAtMs,
    );
  }

  /** Internal evaluation returning the full RiskEvaluation. */
  private evaluateInternal(input: RiskGateInput): RiskEvaluation {
    const result: RiskEvaluation = {
      decision: "APPROVE",
      reasonCodes: [],
      notes: "",
    };

    // ── Defensive rules (system-level) ──────────────────────────────

    // Inventory blocks are fail-closed risk decisions.
    if (input.inventoryBlocked) {
      result.decision = "REJECT";
      result.reasonCodes.push("INVENTORY_BLOCKED");
      result.notes = "inventory blocked execution; no trading allowed";
      return result;
    }

    // Rule 18: AUDIT_UNAVAILABLE — fail closed
    if (input.auditUnavailable) {
      result.decision = "REJECT";
      result.reasonCodes.push("AUDIT_UNAVAILABLE");
      result.notes = "audit subsystem unavailable; no trading allowed";
      return result;
    }

    // Rule 17: RECONCILIATION_UNRESOLVED — fail closed
    if (input.reconciliationUnresolved) {
      result.decision = "REJECT";
      result.reasonCodes.push("RECONCILIATION_UNRESOLVED");
      result.notes = "reconciliation unresolved; no new orders";
      return result;
    }

    // Rule 16: DEGRADED_MODE — no trading in degraded/defensive modes
    if (!SIGNAL_MODES.includes(input.mode)) {
      result.decision = "EXIT_ONLY";
      result.reasonCodes.push("DEGRADED_MODE");
      result.notes = `system in ${input.mode}; no new orders`;
      return result;
    }

    // ── Loss limits ─────────────────────────────────────────────────

    // Rule 2: MAX_DAILY_LOSS
    if (
      this.policy.maxDailyLossUsd !== undefined &&
      input.dailyLossUsd !== undefined &&
      input.dailyLossUsd >= this.policy.maxDailyLossUsd
    ) {
      result.decision = "CASH_ONLY";
      result.reasonCodes.push("MAX_DAILY_LOSS");
      result.notes = `daily loss ${input.dailyLossUsd} >= limit ${this.policy.maxDailyLossUsd}`;
      return result;
    }

    // Rule 3: MAX_WEEKLY_LOSS
    if (
      this.policy.maxWeeklyLossUsd !== undefined &&
      input.weeklyLossUsd !== undefined &&
      input.weeklyLossUsd >= this.policy.maxWeeklyLossUsd
    ) {
      result.decision = "CANCEL_ONLY";
      result.reasonCodes.push("MAX_WEEKLY_LOSS");
      result.notes = `weekly loss ${input.weeklyLossUsd} >= limit ${this.policy.maxWeeklyLossUsd}`;
      return result;
    }

    // ── Exposure limits ─────────────────────────────────────────────

    // Rule 4: MAX_EXPOSURE_PER_TOKEN
    if (this.policy.maxExposurePerTokenUsd !== undefined) {
      const projected =
        (input.tokenExposureUsd ?? 0) +
        input.orderIntent.quantity * input.orderIntent.price;
      if (projected >= this.policy.maxExposurePerTokenUsd) {
        result.decision = "REDUCE_SIZE";
        result.reasonCodes.push("MAX_EXPOSURE_PER_TOKEN");
        const allowedAdditional =
          this.policy.maxExposurePerTokenUsd - (input.tokenExposureUsd ?? 0);
        result.approvedSize = Math.max(
          0,
          allowedAdditional / input.orderIntent.price,
        );
        result.notes = `projected token exposure ${projected} >= limit ${this.policy.maxExposurePerTokenUsd}`;
        return result;
      }
    }

    // Rule 5: MAX_EXPOSURE_PER_VENUE
    if (this.policy.maxExposurePerVenueUsd !== undefined) {
      const projected =
        (input.venueExposureUsd ?? 0) +
        input.orderIntent.quantity * input.orderIntent.price;
      if (projected >= this.policy.maxExposurePerVenueUsd) {
        result.decision = "REDUCE_SIZE";
        result.reasonCodes.push("MAX_EXPOSURE_PER_VENUE");
        const allowedAdditional =
          this.policy.maxExposurePerVenueUsd - (input.venueExposureUsd ?? 0);
        result.approvedSize = Math.max(
          0,
          allowedAdditional / input.orderIntent.price,
        );
        result.notes = `projected venue exposure ${projected} >= limit ${this.policy.maxExposurePerVenueUsd}`;
        return result;
      }
    }

    // Rule 6: MAX_EXPOSURE_PER_CHAIN
    if (this.policy.maxExposurePerChainUsd !== undefined) {
      const projected =
        (input.chainExposureUsd ?? 0) +
        input.orderIntent.quantity * input.orderIntent.price;
      if (projected >= this.policy.maxExposurePerChainUsd) {
        result.decision = "REDUCE_SIZE";
        result.reasonCodes.push("MAX_EXPOSURE_PER_CHAIN");
        const allowedAdditional =
          this.policy.maxExposurePerChainUsd - (input.chainExposureUsd ?? 0);
        result.approvedSize = Math.max(
          0,
          allowedAdditional / input.orderIntent.price,
        );
        result.notes = `projected chain exposure ${projected} >= limit ${this.policy.maxExposurePerChainUsd}`;
        return result;
      }
    }

    // ── Operational limits ──────────────────────────────────────────

    // Rule 7: MAX_OPEN_ORDERS
    if (
      this.policy.maxOpenOrders !== undefined &&
      input.openOrderCount !== undefined &&
      input.openOrderCount >= this.policy.maxOpenOrders
    ) {
      result.decision = "REJECT";
      result.reasonCodes.push("MAX_OPEN_ORDERS");
      result.notes = `open order count ${input.openOrderCount} >= limit ${this.policy.maxOpenOrders}`;
      return result;
    }

    // Rule 8: MAX_SLIPPAGE
    if (
      this.policy.maxSlippageBps !== undefined &&
      input.slippageBps !== undefined &&
      input.slippageBps > this.policy.maxSlippageBps
    ) {
      result.decision = "REJECT";
      result.reasonCodes.push("MAX_SLIPPAGE");
      result.notes = `slippage ${input.slippageBps} bps > limit ${this.policy.maxSlippageBps} bps`;
      return result;
    }

    // Rule 9: MAX_GAS
    if (
      this.policy.maxGasUsd !== undefined &&
      input.gasCostUsd !== undefined &&
      input.gasCostUsd > this.policy.maxGasUsd
    ) {
      result.decision = "REJECT";
      result.reasonCodes.push("MAX_GAS");
      result.notes = `gas cost ${input.gasCostUsd} > limit ${this.policy.maxGasUsd}`;
      return result;
    }

    // Rule 10: MAX_LATENCY
    if (
      this.policy.maxLatencyMs !== undefined &&
      input.latencyMs !== undefined &&
      input.latencyMs > this.policy.maxLatencyMs
    ) {
      result.decision = "REJECT";
      result.reasonCodes.push("MAX_LATENCY");
      result.notes = `latency ${input.latencyMs}ms > limit ${this.policy.maxLatencyMs}ms`;
      return result;
    }

    // Rule 11: MIN_DATA_QUALITY
    if (
      this.policy.minDataQualityScore !== undefined &&
      input.dataQualityScore !== undefined &&
      input.dataQualityScore < this.policy.minDataQualityScore
    ) {
      result.decision = "REJECT";
      result.reasonCodes.push("MIN_DATA_QUALITY");
      result.notes = `data quality ${input.dataQualityScore} < ${this.policy.minDataQualityScore}`;
      return result;
    }

    // Rule 12: MIN_EDGE
    if (
      this.policy.minEdgeUsd !== undefined &&
      input.expectedNetProfitUsd < this.policy.minEdgeUsd
    ) {
      result.decision = "REJECT";
      result.reasonCodes.push("MIN_EDGE");
      result.notes = `expected net profit ${input.expectedNetProfitUsd} < min edge ${this.policy.minEdgeUsd}`;
      return result;
    }

    // Rule 13: MIN_LIQUIDITY
    if (
      this.policy.minLiquidityDepthUsd !== undefined &&
      input.liquidityDepthUsd !== undefined &&
      input.liquidityDepthUsd < this.policy.minLiquidityDepthUsd
    ) {
      result.decision = "REJECT";
      result.reasonCodes.push("MIN_LIQUIDITY");
      result.notes = `liquidity ${input.liquidityDepthUsd} < ${this.policy.minLiquidityDepthUsd}`;
      return result;
    }

    // Rule 14: MAX_FUNDING_COST
    if (
      this.policy.maxFundingCostUsd !== undefined &&
      input.fundingCostUsd !== undefined &&
      input.fundingCostUsd > this.policy.maxFundingCostUsd
    ) {
      result.decision = "REJECT";
      result.reasonCodes.push("MAX_FUNDING_COST");
      result.notes = `funding cost ${input.fundingCostUsd} > ${this.policy.maxFundingCostUsd}`;
      return result;
    }

    // Rule 15: MAX_CORRELATION_CONCENTRATION
    if (
      this.policy.maxCorrelationConcentration !== undefined &&
      input.riskConcentration !== undefined &&
      input.riskConcentration > this.policy.maxCorrelationConcentration
    ) {
      result.decision = "REJECT";
      result.reasonCodes.push("MAX_CORRELATION_CONCENTRATION");
      result.notes = `risk concentration ${input.riskConcentration} > ${this.policy.maxCorrelationConcentration}`;
      return result;
    }

    // ── Rule 1: MAX_RISK_PER_TRADE (checked last — may REDUCE_SIZE) ─

    const notionalUsd = input.orderIntent.quantity * input.orderIntent.price;
    if (
      this.policy.maxRiskPerTradeUsd !== undefined &&
      notionalUsd > this.policy.maxRiskPerTradeUsd
    ) {
      result.decision = "REDUCE_SIZE";
      result.reasonCodes.push("MAX_RISK_PER_TRADE");
      const approvedSize = this.policy.maxRiskPerTradeUsd / input.orderIntent.price;
      result.approvedSize = approvedSize;
      result.notes = `notional ${notionalUsd} > per-trade limit ${this.policy.maxRiskPerTradeUsd}; reduced to ${approvedSize}`;
      return result;
    }

    // ── All rules passed ────────────────────────────────────────────

    result.decision = "APPROVE";
    result.approvedSize = input.orderIntent.quantity;
    result.approvedLimits = { ...input.orderIntent.limits };
    result.expiresAtMs = input.evaluatedAtMs + RISK_APPROVAL_TTL_MS;
    result.notes = "all rules passed";
    return result;
  }
}

/**
 * Approval validity window (ms); an approval past expiry is void.
 * Matches the existing RISK_APPROVAL_TTL_MS contract.
 */
export const RISK_APPROVAL_TTL_MS = 60_000;

/**
 * Convenience: extract the action list from a policy, returning which
 * rules have defined thresholds. Useful for testing and diagnostics.
 */
export function activeRules(policy: RiskPolicy): RiskReasonCode[] {
  const rules: RiskReasonCode[] = [];
  if (policy.maxRiskPerTradeUsd !== undefined) rules.push("MAX_RISK_PER_TRADE");
  if (policy.maxDailyLossUsd !== undefined) rules.push("MAX_DAILY_LOSS");
  if (policy.maxWeeklyLossUsd !== undefined) rules.push("MAX_WEEKLY_LOSS");
  if (policy.maxExposurePerTokenUsd !== undefined)
    rules.push("MAX_EXPOSURE_PER_TOKEN");
  if (policy.maxExposurePerVenueUsd !== undefined)
    rules.push("MAX_EXPOSURE_PER_VENUE");
  if (policy.maxExposurePerChainUsd !== undefined)
    rules.push("MAX_EXPOSURE_PER_CHAIN");
  if (policy.maxOpenOrders !== undefined) rules.push("MAX_OPEN_ORDERS");
  if (policy.maxSlippageBps !== undefined) rules.push("MAX_SLIPPAGE");
  if (policy.maxGasUsd !== undefined) rules.push("MAX_GAS");
  if (policy.maxLatencyMs !== undefined) rules.push("MAX_LATENCY");
  if (policy.minDataQualityScore !== undefined) rules.push("MIN_DATA_QUALITY");
  if (policy.minEdgeUsd !== undefined) rules.push("MIN_EDGE");
  if (policy.minLiquidityDepthUsd !== undefined) rules.push("MIN_LIQUIDITY");
  if (policy.maxFundingCostUsd !== undefined) rules.push("MAX_FUNDING_COST");
  if (policy.maxCorrelationConcentration !== undefined)
    rules.push("MAX_CORRELATION_CONCENTRATION");
  return rules;
}

// ── Backward compatibility ──────────────────────────────────────────

/**
*/
