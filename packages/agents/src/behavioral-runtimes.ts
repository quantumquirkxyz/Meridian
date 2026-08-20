import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import type {
  AgentInput,
  AgentOutput,
  AgentMessage,
} from "@agenttrading/contracts";
import { parseConsultativeAgentOutput } from "@agenttrading/contracts";
import type { ConsultativeAgentOutput } from "@agenttrading/contracts";
import { BaseAgentAdapter } from "./adapter.ts";
import type { AgentConfig } from "./config.ts";

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

type DurableMemoryRecord = {
  cases: MemoryCase[];
  performance: MemoryPerformance[];
};

type EvalInput = {
  decisionSummary?: string;
  qualityDimensions?: Record<string, number>;
  failurePatterns?: string[];
  candidateId?: string;
};

type EvalResult = {
  qualityScore: number;
  decisionSummary: string;
  consistencyFindings: string[];
  failurePatterns: string[];
};

type DurableEvaluationRecord = {
  agentId: string;
  timestampMs: number;
  candidateId?: string;
  result: EvalResult;
};

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function clampQuality(score: number): number {
  return Math.max(0, Math.min(1, score));
}

function roundQuality(score: number): number {
  return Math.round(score * 100) / 100;
}

function ensureParentDir(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
}

function readJson<T>(filePath: string, fallback: T): T {
  if (!existsSync(filePath)) {
    return fallback;
  }
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function writeJson(filePath: string, data: unknown): void {
  ensureParentDir(filePath);
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

class DurableMemoryStore {
  constructor(private readonly filePath: string) {}

  load(agentId: string): DurableMemoryRecord {
    const all = readJson<Record<string, DurableMemoryRecord>>(this.filePath, {});
    return all[agentId] ?? { cases: [], performance: [] };
  }

  save(agentId: string, record: DurableMemoryRecord): void {
    const all = readJson<Record<string, DurableMemoryRecord>>(this.filePath, {});
    all[agentId] = record;
    writeJson(this.filePath, all);
  }
}

class DurableEvaluationStore {
  constructor(private readonly filePath: string) {}

  append(record: DurableEvaluationRecord): void {
    const entries = readJson<DurableEvaluationRecord[]>(this.filePath, []);
    entries.push(record);
    writeJson(this.filePath, entries);
  }
}

class ConsultativeEvalsRunner {
  run(input: EvalInput): EvalResult {
    const values = Object.values(input.qualityDimensions ?? {}).filter(
      (value): value is number => typeof value === "number",
    );
    const dimensionScore =
      values.length > 0
        ? values.reduce((sum, value) => sum + value, 0) / values.length
        : 0.5;
    const failurePenalty = input.failurePatterns?.length ? 0.1 : 0;
    const qualityScore = clampQuality(
      roundQuality(0.4 + dimensionScore * 0.4 + 0.15 - failurePenalty),
    );
    const decisionSummary =
      input.decisionSummary ??
      `Decision reviewed for ${input.candidateId ?? "unknown candidate"}`;
    const consistencyFindings = [
      ...(input.decisionSummary ? [] : ["decisionSummary missing from evaluated payload"]),
      ...(values.length === 0 ? ["no quantitative quality dimensions were supplied"] : []),
      ...(input.failurePatterns?.length
        ? [`failure patterns observed: ${input.failurePatterns.join(", ")}`]
        : []),
    ];

    return {
      qualityScore,
      decisionSummary,
      consistencyFindings,
      failurePatterns: input.failurePatterns ?? [],
    };
  }
}

export class MemoryConsultativeAdapter extends BaseAgentAdapter {
  readonly adapterId = "memory-consultative";
  readonly runtimeName = "mastra";

  constructor(
    private readonly configs: ReadonlyMap<string, AgentConfig>,
    memoryFilePath = resolve(".agent-state/consultative-memory.json"),
  ) {
    super();
    this.memoryStore = new DurableMemoryStore(memoryFilePath);
  }

  private readonly memoryStore: DurableMemoryStore;

  async run(input: AgentInput): Promise<AgentOutput> {
    const config = this.configs.get(input.agentId);
    if (!config) {
      return this.fallback(input.agentId, "missing memory config");
    }

    const payload = asObject(input.payload);
    const snapshot = this.memoryStore.load(input.agentId);
    const historyWarnings = (input.conversationHistory ?? []).map(
      (message) => `${message.role}: ${message.content}`,
    );

    const recalledCases = [...snapshot.cases]
      .sort((a, b) => b.relevance - a.relevance)
      .map((entry) => ({
        ...entry,
        warning: entry.warning ?? (entry.relevance < 0.5 ? "low relevance; verify before reuse" : undefined),
      }));

    const recalledPerformance = [...snapshot.performance];
    const recommendedFollowUps = [
      ...normalizeStrings(payload.followUps),
      ...(historyWarnings.length > 0 ? ["review prior conversation context before acting"] : []),
      ...(recalledCases.length === 0 ? ["persist cases into durable memory before the next recall"] : []),
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
          ? `Recalled ${recalledCases.length} precedent(s) from durable memory storage`
          : "No prior cases were available in durable memory storage",
      assumptions: [
        "durable memory storage is the source of truth for prior cases",
        ...(historyWarnings.length > 0 ? ["conversation history may omit older state"] : []),
      ],
      recalledCases,
      recalledPerformance,
      recommendedFollowUps,
    };

    this.memoryStore.save(input.agentId, {
      cases: recalledCases,
      performance: recalledPerformance,
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

  constructor(
    private readonly configs: ReadonlyMap<string, AgentConfig>,
    evalFilePath = resolve(".agent-state/consultative-evals.json"),
  ) {
    super();
    this.evalStore = new DurableEvaluationStore(evalFilePath);
    this.evalsRunner = new ConsultativeEvalsRunner();
  }

  private readonly evalStore: DurableEvaluationStore;
  private readonly evalsRunner: ConsultativeEvalsRunner;

  async run(input: AgentInput): Promise<AgentOutput> {
    const config = this.configs.get(input.agentId);
    if (!config) {
      return this.fallback(input.agentId, "missing audit config");
    }

    const payload = asObject(input.payload);
    const evalInput = {
      decisionSummary:
        typeof payload.decisionSummary === "string"
          ? payload.decisionSummary
          : undefined,
      candidateId: asObject(payload.signal).candidateId as string | undefined,
      qualityDimensions: asObject(payload.signal).qualityDimensions as Record<string, number> | undefined,
      failurePatterns: normalizeStrings(payload.failurePatterns ?? asObject(payload.signal).failurePatterns),
    } satisfies EvalInput;
    const result = this.evalsRunner.run(evalInput);

    this.evalStore.append({
      agentId: input.agentId,
      timestampMs: input.timestampMs,
      candidateId: evalInput.candidateId,
      result,
    });

    const output: ConsultativeAgentOutput = {
      agentId: "agent-audit" as const,
      confidence: result.qualityScore,
      summary: `Audit scored the decision at ${Math.round(result.qualityScore * 100)}% quality`,
      assumptions: ["audit evaluation is derived from persisted eval results"],
      qualityScore: result.qualityScore,
      decisionSummary: result.decisionSummary,
      consistencyFindings: result.consistencyFindings,
      failurePatterns: evalInput.failurePatterns,
    };

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
    const policy = asObject(payload.policy);
    const blockedVenues = normalizeStrings(policy.blockedVenues);
    const internalLimits = normalizeStrings(policy.internalLimits);
    const userConfiguredTerms = normalizeStrings(policy.userConfiguredTerms);
    const terms = normalizeStrings(policy.terms);
    const venue = typeof policy.venue === "string" ? policy.venue : undefined;

    const blockedByVenue = venue ? blockedVenues.includes(venue) : false;
    const termsConflict = terms.some((term) => userConfiguredTerms.includes(term));
    const reviewRequired = Boolean(
      (typeof payload.reviewRequired === "boolean" ? payload.reviewRequired : false) ||
        blockedByVenue ||
        termsConflict ||
        internalLimits.length > 0,
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

    const validation = parseConsultativeAgentOutput(output);

    return {
      kind: "structured",
      agentId: input.agentId,
      payload: validation as unknown as Record<string, unknown>,
      schemaName: config.outputSchemaName,
      timestampMs: input.timestampMs,
    };
  }
}
