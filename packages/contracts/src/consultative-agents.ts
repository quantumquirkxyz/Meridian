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
import { isSystemMode, type SystemMode } from "./modes.ts";

/**
 * Typed consultative agent contracts.
 *
 * These agents are advisory only. Their outputs are structured and validated,
 * but they cannot carry execution authority. The deterministic core can use
 * them for analysis, debate, and recommendations, while execution remains
 * reserved for the Risk and Execution engines.
 */

export const CONSULTATIVE_AGENT_IDS = [
  "agent-planner-supervisor",
  "agent-arbitrage-alpha",
  "agent-market-regime",
  "agent-bull",
  "agent-bear",
  "agent-skeptic",
  "agent-risk-analyst",
  "agent-execution-advisor",
] as const;

export type ConsultativeAgentId = (typeof CONSULTATIVE_AGENT_IDS)[number];

export interface AgentAnalysisBase {
  agentId: ConsultativeAgentId;
  confidence: number;
  summary: string;
  assumptions: string[];
  invalidationReasons?: RiskReasonCode[];
}

export interface PlannerSupervisorOutput extends AgentAnalysisBase {
  agentId: "agent-planner-supervisor";
  plannedSteps: string[];
  recommendedMode: SystemMode;
}

export interface ArbitrageAlphaOutput extends AgentAnalysisBase {
  agentId: "agent-arbitrage-alpha";
  candidateSignal: string;
  expectedNetProfitUsd: number;
  costBreakdownUsd: {
    feesUsd: number;
    slippageUsd: number;
    gasUsd: number;
    bridgeCostUsd: number;
    fundingCostUsd: number;
    latencyRiskUsd: number;
    failureRiskUsd: number;
    safetyBufferUsd: number;
  };
}

export interface MarketRegimeOutput extends AgentAnalysisBase {
  agentId: "agent-market-regime";
  regime: "bullish" | "bearish" | "choppy" | "mean_reverting" | "unknown";
  recommendedMode: SystemMode;
}

export interface DebateOutputBase extends AgentAnalysisBase {
  candidateId: string;
  confidenceDelta: number;
  invalidationReasons: RiskReasonCode[];
}

export interface BullOutput extends DebateOutputBase {
  agentId: "agent-bull";
  stance: "bullish";
}

export interface BearOutput extends DebateOutputBase {
  agentId: "agent-bear";
  stance: "bearish";
}

export interface SkepticOutput extends DebateOutputBase {
  agentId: "agent-skeptic";
  stance: "skeptical";
  requiredEvidence: string[];
}

export interface RiskAnalystOutput extends AgentAnalysisBase {
  agentId: "agent-risk-analyst";
  riskNarrative: string;
  controls: string[];
  residualRisks: string[];
}

export interface ExecutionAdvisorOutput extends AgentAnalysisBase {
  agentId: "agent-execution-advisor";
  executionPlanCandidates: Array<{
    venue: string;
    orderType: "limit" | "market" | "post_only";
    expectedNetProfitUsd: number;
    assumptions: string[];
    invalidationReasons?: RiskReasonCode[];
  }>;
  recommendedMode: Exclude<SystemMode, "HALT">;
}

export type ConsultativeAgentOutput =
  | PlannerSupervisorOutput
  | ArbitrageAlphaOutput
  | MarketRegimeOutput
  | BullOutput
  | BearOutput
  | SkepticOutput
  | RiskAnalystOutput
  | ExecutionAdvisorOutput;

const isAgentAnalysisBase = {
  agentId: isEnumOf(CONSULTATIVE_AGENT_IDS),
  confidence: isNumber,
  summary: isString,
  assumptions: isArrayOf(isString),
  invalidationReasons: isOptional(isArrayOf(isRiskReasonCode)),
};

const isPlannerSupervisorOutput: Validator<PlannerSupervisorOutput> = isObjectOf({
  ...isAgentAnalysisBase,
  agentId: isEnumOf(["agent-planner-supervisor"] as const),
  plannedSteps: isArrayOf(isString),
  recommendedMode: isSystemMode,
});

const isArbitrageAlphaOutput: Validator<ArbitrageAlphaOutput> = isObjectOf({
  ...isAgentAnalysisBase,
  agentId: isEnumOf(["agent-arbitrage-alpha"] as const),
  candidateSignal: isString,
  expectedNetProfitUsd: isNumber,
  costBreakdownUsd: isObjectOf({
    feesUsd: isNumber,
    slippageUsd: isNumber,
    gasUsd: isNumber,
    bridgeCostUsd: isNumber,
    fundingCostUsd: isNumber,
    latencyRiskUsd: isNumber,
    failureRiskUsd: isNumber,
    safetyBufferUsd: isNumber,
  }),
});

const isMarketRegimeOutput: Validator<MarketRegimeOutput> = isObjectOf({
  ...isAgentAnalysisBase,
  agentId: isEnumOf(["agent-market-regime"] as const),
  regime: isEnumOf([
    "bullish",
    "bearish",
    "choppy",
    "mean_reverting",
    "unknown",
  ] as const),
  recommendedMode: isSystemMode,
});

const isDebateOutputBase = {
  ...isAgentAnalysisBase,
  candidateId: isString,
  confidenceDelta: isNumber,
  invalidationReasons: isArrayOf(isRiskReasonCode),
};

const isBullOutput: Validator<BullOutput> = isObjectOf({
  ...isDebateOutputBase,
  agentId: isEnumOf(["agent-bull"] as const),
  stance: isEnumOf(["bullish"] as const),
});

const isBearOutput: Validator<BearOutput> = isObjectOf({
  ...isDebateOutputBase,
  agentId: isEnumOf(["agent-bear"] as const),
  stance: isEnumOf(["bearish"] as const),
});

const isSkepticOutput: Validator<SkepticOutput> = isObjectOf({
  ...isDebateOutputBase,
  agentId: isEnumOf(["agent-skeptic"] as const),
  stance: isEnumOf(["skeptical"] as const),
  requiredEvidence: isArrayOf(isString),
});

const isRiskAnalystOutput: Validator<RiskAnalystOutput> = isObjectOf({
  ...isAgentAnalysisBase,
  agentId: isEnumOf(["agent-risk-analyst"] as const),
  riskNarrative: isString,
  controls: isArrayOf(isString),
  residualRisks: isArrayOf(isString),
});

const isExecutionAdvisorOutput: Validator<ExecutionAdvisorOutput> = isObjectOf({
  ...isAgentAnalysisBase,
  agentId: isEnumOf(["agent-execution-advisor"] as const),
  executionPlanCandidates: isArrayOf(
    isObjectOf({
      venue: isString,
      orderType: isEnumOf(["limit", "market", "post_only"] as const),
      expectedNetProfitUsd: isNumber,
      assumptions: isArrayOf(isString),
      invalidationReasons: isOptional(isArrayOf(isRiskReasonCode)),
    }),
  ),
  recommendedMode: isEnumOf([
    "NORMAL",
    "OBSERVE_ONLY",
    "SIGNAL_ONLY",
    "PAPER_ONLY",
    "CANCEL_ONLY",
    "REDUCE_ONLY",
    "CASH_ONLY",
  ] as const),
});

export const isConsultativeAgentOutput: Validator<ConsultativeAgentOutput> =
  isOneOf<ConsultativeAgentOutput>([
    isPlannerSupervisorOutput,
    isArbitrageAlphaOutput,
    isMarketRegimeOutput,
    isBullOutput,
    isBearOutput,
    isSkepticOutput,
    isRiskAnalystOutput,
    isExecutionAdvisorOutput,
  ]);

export function parseConsultativeAgentOutput(
  value: unknown,
): ConsultativeAgentOutput {
  return parse(isConsultativeAgentOutput, value, "ConsultativeAgentOutput");
}
