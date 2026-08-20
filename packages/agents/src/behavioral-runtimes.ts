import type {
  AgentInput,
  AgentOutput,
  AgentMessage,
} from "@agenttrading/contracts";
import {
  parseConsultativeAgentOutput,
} from "@agenttrading/contracts";
import type { ConsultativeAgentOutput } from "@agenttrading/contracts";
import { BaseAgentAdapter } from "./adapter.ts";
import type { AgentConfig } from "./config.ts";
import { AgentMemory } from "./memory.ts";
import type { AgentLogger } from "./logger.ts";

type MemoryCase = {
  caseId: string;
  pattern: string;
  relevance: number;
  warning?: string;
};

type MemoryPerformance = {
  outcome: string;
  resultUsd: number;
  lesson: string;
};

type AuditSignal = {
  candidateId?: string;
  expectedNetProfitUsd?: number;
  qualityDimensions?: Record<string, number>;
  failurePatterns?: string[];
};

type PolicySignal = {
  internalLimits?: string[];
  blockedVenues?: string[];
  userConfiguredTerms?: string[];
  venue?: string;
  terms?: string[];
  requestType?: string;
};

function normalizeStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function clampQuality(score: number): number {
  return Math.max(0, Math.min(1, score));
}

function roundQuality(score: number): number {
  return Math.round(score * 100) / 100;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function summarizeMessages(messages: readonly AgentMessage[] | undefined): string[] {
  if (!messages) return [];
  return messages.map((message) => `${message.role}: ${message.content}`);
}

function registerConsultativeOutputSchema(
  adapter: BaseAgentAdapter,
  agentId: string,
): void {
  adapter.registerSchema(agentId, (candidate) => {
    try {
      parseConsultativeAgentOutput(candidate);
      return { valid: true };
    } catch (error) {
      return {
        valid: false,
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  });
}

export class MemoryConsultativeAdapter extends BaseAgentAdapter {
  readonly adapterId = "memory-consultative";
  readonly runtimeName = "mastra";

  constructor(
    private readonly memory: AgentMemory,
    private readonly configs: ReadonlyMap<string, AgentConfig>,
  ) {
    super();
  }

  async run(input: AgentInput): Promise<AgentOutput> {
    const config = this.configs.get(input.agentId);
    if (!config) {
      return this.fallback(input.agentId, "missing memory config");
    }

    const payload = asObject(input.payload);
    const caseState = this.memory.getState<MemoryCase[]>(input.agentId, "cases") ?? [];
    const performanceState = this.memory.getState<MemoryPerformance[]>(input.agentId, "performance") ?? [];
    const historyWarnings = summarizeMessages(input.conversationHistory);

    const recalledCases = [...caseState]
      .sort((a, b) => b.relevance - a.relevance)
      .map((entry) => ({
        ...entry,
        warning: entry.warning ?? (entry.relevance < 0.5 ? "low relevance; verify before reuse" : undefined),
      }));

    const recalledPerformance = [...performanceState];

    const recommendedFollowUps = [
      ...normalizeStrings(payload.followUps),
      ...(historyWarnings.length > 0 ? ["review prior conversation context before acting"] : []),
      ...(recalledCases.length === 0 ? ["persist cases into memory before the next recall"] : []),
    ];

    const output: ConsultativeAgentOutput = {
      agentId: "agent-memory" as const,
      confidence: clampQuality(
        roundQuality(
          recalledCases.length > 0
            ? Math.min(1, 0.55 + recalledCases[0]!.relevance * 0.35)
            : 0.35,
        ),
      ),
      summary:
        recalledCases.length > 0
          ? `Recalled ${recalledCases.length} precedent(s) from durable memory state`
          : "No prior cases were available in durable memory state",
      assumptions: [
        "memory store is the source of truth for prior cases",
        ...(historyWarnings.length > 0 ? ["conversation history may omit older state"] : []),
      ],
      recalledCases,
      recalledPerformance,
      recommendedFollowUps,
    };

    registerConsultativeOutputSchema(this, input.agentId);

    this.memory.addMessage(input.agentId, {
      role: "assistant",
      content: output.summary,
      timestampMs: input.timestampMs,
    });
    this.memory.setState(input.agentId, "lastRecall", {
      timestampMs: input.timestampMs,
      recalledCaseIds: recalledCases.map((entry) => entry.caseId),
    });

    return {
      kind: "structured",
      agentId: input.agentId,
      payload: output as unknown as Record<string, unknown>,
      schemaName: config.outputSchemaName,
      timestampMs: input.timestampMs,
    };
  }
}

export class AuditConsultativeAdapter extends BaseAgentAdapter {
  readonly adapterId = "audit-consultative";
  readonly runtimeName = "mastra";

  constructor(private readonly configs: ReadonlyMap<string, AgentConfig>) {
    super();
  }

  async run(input: AgentInput): Promise<AgentOutput> {
    const config = this.configs.get(input.agentId);
    if (!config) {
      return this.fallback(input.agentId, "missing audit config");
    }

    const payload = asObject(input.payload);
    const signal = asObject(payload.signal) as AuditSignal;
    const dimensions = signal.qualityDimensions ?? {};
    const values = Object.values(dimensions).filter((value): value is number => typeof value === "number");
    const dimensionScore = values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0.5;
    const failurePatterns = normalizeStrings(payload.failurePatterns ?? signal.failurePatterns);
    const consistencyFindings = [
      ...(payload.decisionSummary ? [] : ["decisionSummary missing from evaluated payload"]),
      ...(values.length === 0 ? ["no quantitative quality dimensions were supplied"] : []),
      ...(failurePatterns.length > 0 ? [`failure patterns observed: ${failurePatterns.join(", ")}`] : []),
    ];

    const qualityScore = clampQuality(
      roundQuality(
        0.4 + dimensionScore * 0.4 + (failurePatterns.length === 0 ? 0.15 : -0.1),
      ),
    );

    const output: ConsultativeAgentOutput = {
      agentId: "agent-audit" as const,
      confidence: qualityScore,
      summary: `Audit scored the decision at ${Math.round(qualityScore * 100)}% quality`,
      assumptions: ["audit evaluation is derived from structured evidence"],
      qualityScore,
      decisionSummary:
        typeof payload.decisionSummary === "string"
          ? payload.decisionSummary
          : `Decision reviewed for ${signal.candidateId ?? "unknown candidate"}`,
      consistencyFindings,
      failurePatterns,
    };

    registerConsultativeOutputSchema(this, input.agentId);

    return {
      kind: "structured",
      agentId: input.agentId,
      payload: output as unknown as Record<string, unknown>,
      schemaName: config.outputSchemaName,
      timestampMs: input.timestampMs,
    };
  }
}

export class PolicyConsultativeAdapter extends BaseAgentAdapter {
  readonly adapterId = "policy-consultative";
  readonly runtimeName = "vercel-ai-sdk";

  constructor(private readonly configs: ReadonlyMap<string, AgentConfig>) {
    super();
  }

  async run(input: AgentInput): Promise<AgentOutput> {
    const config = this.configs.get(input.agentId);
    if (!config) {
      return this.fallback(input.agentId, "missing policy config");
    }

    const payload = asObject(input.payload);
    const policy = asObject(payload.policy) as PolicySignal;
    const blockedVenues = normalizeStrings(policy.blockedVenues);
    const internalLimits = normalizeStrings(policy.internalLimits);
    const userConfiguredTerms = normalizeStrings(policy.userConfiguredTerms);
    const terms = normalizeStrings(policy.terms);
    const venue = typeof policy.venue === "string" ? policy.venue : undefined;

    const blockedByVenue = venue ? blockedVenues.includes(venue) : false;
    const termsConflict = terms.some((term) => userConfiguredTerms.includes(term));
    const reviewRequired = Boolean(
      (typeof payload.reviewRequired === "boolean"
        ? payload.reviewRequired
        : false) || blockedByVenue || termsConflict || internalLimits.length > 0,
    );

    const output: ConsultativeAgentOutput = {
      agentId: "agent-policy" as const,
      confidence: reviewRequired ? 0.9 : 0.7,
      summary: reviewRequired
        ? "Policy review flagged internal constraints and requires human review"
        : "Policy review found no blocking internal constraints",
      assumptions: ["policy checks are limited to internal limits and user-configured terms"],
      internalLimits,
      blockedVenues,
      userConfiguredTerms,
      reviewRequired,
      approvalPower: false as const,
      notes: [
        ...(blockedByVenue ? [`venue ${venue} is blocked by internal policy`] : []),
        ...(termsConflict ? ["user-configured terms overlap with the request"] : []),
        ...(blockedVenues.length === 0 ? ["no blocked venues were supplied"] : []),
      ],
    };

    registerConsultativeOutputSchema(this, input.agentId);

    return {
      kind: "structured",
      agentId: input.agentId,
      payload: output as unknown as Record<string, unknown>,
      schemaName: config.outputSchemaName,
      timestampMs: input.timestampMs,
    };
  }
}
