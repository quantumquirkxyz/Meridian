import {
  type ConsultativeAgentId,
  CONSULTATIVE_AGENT_IDS,
} from "@agenttrading/contracts";
import { createDefaultAgentConfig, type AgentConfig } from "./config.ts";

/**
 * Canonical consultative agent catalog.
 *
 * The consultative layer is advisory only: every agent here is configured
 * with observation/proposal permissions and a runtime declaration, but no
 * execution-authority permissions. Runtime choice is explicit per agent so
 * the core can route debate-oriented agents to memory-capable runtimes.
 */

export interface ConsultativeAgentDefinition {
  id: ConsultativeAgentId;
  config: AgentConfig;
}

const basePolicy = {
  tokenBudget: {
    maxInputTokens: 4_096,
    maxOutputTokens: 2_048,
    maxCostUsd: 0.15,
  },
  timeoutMs: 30_000,
  retry: {
    maxAttempts: 2,
    baseDelayMs: 1_000,
    maxDelayMs: 10_000,
  },
};

function makeConsultativeConfig(
  agentId: ConsultativeAgentId,
  overrides: Partial<AgentConfig>,
): AgentConfig {
  const policy = overrides.policy ?? basePolicy;
  return createDefaultAgentConfig({
    agentId,
    name: agentId,
    ...overrides,
    policy: {
      tokenBudget: {
        ...policy.tokenBudget,
      },
      timeoutMs: policy.timeoutMs,
      retry: {
        ...policy.retry,
      },
    },
  });
}

export const CONSULTATIVE_AGENT_CATALOG: readonly ConsultativeAgentDefinition[] =
  [
    {
      id: "agent-planner-supervisor",
      config: makeConsultativeConfig("agent-planner-supervisor", {
        description: "Produces analysis plans and coordination guidance.",
        layer: "deliberative",
        runtime: "vercel-ai-sdk",
        outputSchemaName: "planner-supervisor-output",
        permissions: ["OBSERVE_STATE", "PROPOSE_SIGNAL", "PROPOSE_EXECUTION_PLAN"],
        mandatory: true,
        fallback: {
          hasFallback: true,
          strategy: "hardcoded",
          hardcodedValue: {
            plannedSteps: [],
            recommendedMode: "OBSERVE_ONLY",
            summary: "Fallback planning unavailable",
            confidence: 0,
            assumptions: ["analysis unavailable"],
          },
        },
      }),
    },
    {
      id: "agent-arbitrage-alpha",
      config: makeConsultativeConfig("agent-arbitrage-alpha", {
        description: "Produces candidate arbitrage signals with cost stacks.",
        layer: "analytical",
        runtime: "vercel-ai-sdk",
        outputSchemaName: "arbitrage-alpha-output",
        permissions: ["OBSERVE_MARKET_DATA", "PROPOSE_SIGNAL"],
        mandatory: true,
        fallback: {
          hasFallback: true,
          strategy: "hardcoded",
          hardcodedValue: {
            candidateSignal: "NO_TRADE",
            expectedNetProfitUsd: 0,
            costBreakdownUsd: {
              feesUsd: 0,
              slippageUsd: 0,
              gasUsd: 0,
              bridgeCostUsd: 0,
              fundingCostUsd: 0,
              latencyRiskUsd: 0,
              failureRiskUsd: 0,
              safetyBufferUsd: 0,
            },
            summary: "Fallback signal unavailable",
            confidence: 0,
            assumptions: ["analysis unavailable"],
          },
        },
      }),
    },
    {
      id: "agent-market-regime",
      config: makeConsultativeConfig("agent-market-regime", {
        description: "Classifies regime and recommends a system mode.",
        layer: "analytical",
        runtime: "vercel-ai-sdk",
        outputSchemaName: "market-regime-output",
        permissions: ["OBSERVE_MARKET_DATA", "OBSERVE_STATE", "PROPOSE_SIGNAL"],
        mandatory: true,
      }),
    },
    {
      id: "agent-bull",
      config: makeConsultativeConfig("agent-bull", {
        description: "Arguments for the constructive side of a candidate.",
        layer: "deliberative",
        runtime: "mastra",
        outputSchemaName: "bull-output",
        permissions: ["OBSERVE_STATE", "PROPOSE_RISK_REVIEW"],
        mandatory: true,
      }),
    },
    {
      id: "agent-bear",
      config: makeConsultativeConfig("agent-bear", {
        description: "Arguments against the candidate and its assumptions.",
        layer: "deliberative",
        runtime: "mastra",
        outputSchemaName: "bear-output",
        permissions: ["OBSERVE_STATE", "PROPOSE_RISK_REVIEW"],
        mandatory: true,
      }),
    },
    {
      id: "agent-skeptic",
      config: makeConsultativeConfig("agent-skeptic", {
        description: "Invalidates weak candidates and requests evidence.",
        layer: "deliberative",
        runtime: "mastra",
        outputSchemaName: "skeptic-output",
        permissions: ["OBSERVE_STATE", "PROPOSE_RISK_REVIEW"],
        mandatory: true,
      }),
    },
    {
      id: "agent-risk-analyst",
      config: makeConsultativeConfig("agent-risk-analyst", {
        description: "Narrates risk posture and recommended controls.",
        layer: "control",
        runtime: "vercel-ai-sdk",
        outputSchemaName: "risk-analyst-output",
        permissions: ["OBSERVE_STATE", "PROPOSE_RISK_REVIEW"],
        mandatory: true,
      }),
    },
    {
      id: "agent-execution-advisor",
      config: makeConsultativeConfig("agent-execution-advisor", {
        description: "Suggests execution plan candidates without executing.",
        layer: "deliberative",
        runtime: "vercel-ai-sdk",
        outputSchemaName: "execution-advisor-output",
        permissions: ["OBSERVE_STATE", "PROPOSE_EXECUTION_PLAN"],
        mandatory: true,
      }),
    },
    {
      id: "agent-memory",
      config: makeConsultativeConfig("agent-memory", {
        description:
          "Recalls prior incidents, failure patterns, and related precedents.",
        layer: "control",
        runtime: "mastra",
        outputSchemaName: "memory-output",
        permissions: ["OBSERVE_STATE", "OBSERVE_AUDIT"],
        mandatory: true,
        fallback: {
          hasFallback: true,
          strategy: "hardcoded",
          hardcodedValue: {
            agentId: "agent-memory",
            recalledCases: [],
            recommendedFollowUps: [
              "memory lookup unavailable; proceed with explicit uncertainty",
            ],
            summary: "Memory recall unavailable",
            confidence: 0,
            assumptions: ["historical context unavailable"],
          },
        },
      }),
    },
    {
      id: "agent-audit",
      config: makeConsultativeConfig("agent-audit", {
        description:
          "Scores output quality and emits decision summaries for review.",
        layer: "control",
        runtime: "mastra",
        outputSchemaName: "audit-output",
        permissions: ["OBSERVE_STATE", "OBSERVE_AUDIT"],
        mandatory: true,
        fallback: {
          hasFallback: true,
          strategy: "hardcoded",
          hardcodedValue: {
            agentId: "agent-audit",
            qualityScore: 0,
            decisionSummary: "Audit unavailable",
            consistencyFindings: ["audit evaluation unavailable"],
            failurePatterns: ["unavailable"],
            summary: "Audit evaluation unavailable",
            confidence: 0,
            assumptions: ["audit context unavailable"],
          },
        },
      }),
    },
    {
      id: "agent-policy",
      config: makeConsultativeConfig("agent-policy", {
        description:
          "Reviews internal limits and blocked venues without approval power.",
        layer: "control",
        runtime: "vercel-ai-sdk",
        outputSchemaName: "policy-output",
        permissions: ["OBSERVE_STATE", "OBSERVE_AUDIT"],
        mandatory: true,
        fallback: {
          hasFallback: true,
          strategy: "hardcoded",
          hardcodedValue: {
            agentId: "agent-policy",
            internalLimits: ["fallback policy unavailable"],
            blockedVenues: [],
            userConfiguredTerms: ["policy review unavailable"],
            reviewRequired: true,
            approvalPower: false,
            notes: ["policy review unavailable"],
            summary: "Policy review unavailable",
            confidence: 0,
            assumptions: ["policy context unavailable"],
          },
        },
      }),
    },
  ] satisfies readonly ConsultativeAgentDefinition[];

export const CONSULTATIVE_AGENT_CONFIGS: ReadonlyMap<
  ConsultativeAgentId,
  AgentConfig
> = new Map(
  CONSULTATIVE_AGENT_CATALOG.map((definition) => [definition.id, definition.config]),
);

export function getConsultativeAgentConfig(
  agentId: ConsultativeAgentId,
): AgentConfig {
  const config = CONSULTATIVE_AGENT_CONFIGS.get(agentId);
  if (!config) {
    throw new Error(`Unknown consultative agent: ${agentId}`);
  }
  return config;
}

export { CONSULTATIVE_AGENT_IDS };
