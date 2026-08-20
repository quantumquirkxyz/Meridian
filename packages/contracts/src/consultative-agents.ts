import {
  isArrayOf,
  isBoolean,
  isBooleanLiteralFalse,
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
  "agent-memory",
  "agent-audit",
  "agent-policy",
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
  invalidationReasons: [RiskReasonCode, ...RiskReasonCode[]];
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

export interface MemoryAgentOutput extends AgentAnalysisBase {
  agentId: "agent-memory";
  recalledCases: Array<{
    caseId: string;
    pattern: string;
    relevance: number;
    warning?: string;
  }>;
  recommendedFollowUps: string[];
}

export interface AuditAgentOutput extends AgentAnalysisBase {
  agentId: "agent-audit";
  qualityScore: number;
  decisionSummary: string;
  consistencyFindings: string[];
  failurePatterns: string[];
}

export interface PolicyAgentOutput extends AgentAnalysisBase {
  agentId: "agent-policy";
  internalLimits: string[];
  blockedVenues: string[];
  userConfiguredTerms: string[];
  reviewRequired: boolean;
  approvalPower: false;
  notes: string[];
}

export type ConsultativeAgentOutput =
  | PlannerSupervisorOutput
  | ArbitrageAlphaOutput
  | MarketRegimeOutput
  | BullOutput
  | BearOutput
  | SkepticOutput
  | RiskAnalystOutput
  | ExecutionAdvisorOutput
  | MemoryAgentOutput
  | AuditAgentOutput
  | PolicyAgentOutput;

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

// `invalidationReasons` is intentionally normalized from array shape here.
const isArbitrageAlphaOutput = isObjectOf({
  ...isAgentAnalysisBase,
  agentId: isEnumOf(["agent-arbitrage-alpha"] as const),
  candidateSignal: isString,
  expectedNetProfitUsd: isNumber,
  invalidationReasons: isArrayOf(isRiskReasonCode),
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
}) as Validator<ArbitrageAlphaOutput>;

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

const isMemoryAgentOutput: Validator<MemoryAgentOutput> = isObjectOf({
  ...isAgentAnalysisBase,
  agentId: isEnumOf(["agent-memory"] as const),
  recalledCases: isArrayOf(
    isObjectOf({
      caseId: isString,
      pattern: isString,
      relevance: isNumber,
      warning: isOptional(isString),
    }),
  ),
  recommendedFollowUps: isArrayOf(isString),
});

const isAuditAgentOutput: Validator<AuditAgentOutput> = isObjectOf({
  ...isAgentAnalysisBase,
  agentId: isEnumOf(["agent-audit"] as const),
  qualityScore: isNumber,
  decisionSummary: isString,
  consistencyFindings: isArrayOf(isString),
  failurePatterns: isArrayOf(isString),
});

const isPolicyAgentOutput: Validator<PolicyAgentOutput> = isObjectOf({
  ...isAgentAnalysisBase,
  agentId: isEnumOf(["agent-policy"] as const),
  internalLimits: isArrayOf(isString),
  blockedVenues: isArrayOf(isString),
  userConfiguredTerms: isArrayOf(isString),
  reviewRequired: isBoolean,
  approvalPower: isBooleanLiteralFalse,
  notes: isArrayOf(isString),
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
    isMemoryAgentOutput,
    isAuditAgentOutput,
    isPolicyAgentOutput,
  ]);

export function parseConsultativeAgentOutput(
  value: unknown,
): ConsultativeAgentOutput {
  return parse(isConsultativeAgentOutput, value, "ConsultativeAgentOutput");
}
