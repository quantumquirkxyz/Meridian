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

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Deterministic, scope-aware observer for the consultative catalog agents.
 *
 * ADR-0013: general agents must produce a scoped recommendation every cycle
 * without requiring an LLM call per sub-agent. This adapter reads the scoped
 * market payload and emits the catalog agents' deliberation from market
 * geometry (spread, liquidity, regime) alone. When an LLM is configured for
 * a deployment, the live layer overrides this adapter for the analytical and
 * deliberative agents; memory/audit/policy keep their behavioral adapters.
 *
 * Every emitted output is advisory: it carries a directional `signal` and a
 * `confidence` so the general agent aggregation layer can vote on it.
 */
export class ScopeObserverAdapter extends BaseAgentAdapter {
  readonly adapterId = "scope-observer";
  readonly runtimeName = "vercel-ai-sdk";

  constructor(private readonly configs: ReadonlyMap<string, AgentConfig>) {
    super();
  }

  async run(input: AgentInput): Promise<AgentOutput> {
    const config = this.configs.get(input.agentId);
    if (!config) {
      return this.fallback(input.agentId, "missing scope observer config");
    }

    const payload = asObject(input.payload);
    const market = asObject(payload.market);

    const bid = readNumber(market.bid);
    const ask = readNumber(market.ask);
    const mid = readNumber(market.mid);
    const liquidityUsd = readNumber(market.liquidityUsd);

    const spreadBps =
      typeof mid === "number" && typeof bid === "number" && typeof ask === "number" && mid > 0
        ? ((ask - bid) / mid) * 10_000
        : undefined;

    const direction: Record<string, unknown> = {
      object: "signal",
      signal: this.inferSignal(mid, bid, ask, spreadBps, liquidityUsd),
      confidence: this.inferConfidence(spreadBps, liquidityUsd),
    };

    let output: Record<string, unknown>;
    switch (input.agentId) {
      case "agent-market-regime": {
        const regime = this.classifyRegime(spreadBps, liquidityUsd);
        output = {
          ...direction,
          regime,
          recommendedMode:
            regime === "stable" ? "ARBITRAGE_ON" : regime === "volatile" ? "RISK_OFF" : "OBSERVE_ONLY",
          summary: `Regime classified as ${regime} from live market geometry`,
          assumptions: ["regime is inferred from spread and liquidity only"],
        };
        break;
      }
      case "agent-arbitrage-alpha": {
        const hasViableArb = typeof spreadBps === "number" && spreadBps >= 15;
        output = {
          ...direction,
          candidateSignal: hasViableArb ? "BUY" : "NO_TRADE",
          expectedNetProfitUsd:
            typeof mid === "number" && hasViableArb && typeof liquidityUsd === "number"
              ? Math.round(Math.min(liquidityUsd, 1_000) * (spreadBps ?? 0) * 0.0001 * 100) / 100
              : 0,
          summary: hasViableArb
            ? `Spread of ${Math.round(spreadBps ?? 0)} bps clears the execution cost hurdle`
            : "No viable spread for an arbitrage leg",
          assumptions: ["cost stack is folded into the bps hurdle", "no cross-venue bridge required"],
        };
        break;
      }
      case "agent-bull": {
        const optimistic = typeof spreadBps === "number" && spreadBps < 20 && direction.signal !== "SELL";
        output = {
          ...direction,
          signal: optimistic ? "BUY" : "HOLD",
          stance: optimistic ? "bullish" : "neutral",
          summary: optimistic ? "Lean constructive while the spread is tight" : "No constructive edge from market geometry",
          assumptions: ["bull case rests on live spread tightness"],
        };
        break;
      }
      case "agent-bear": {
        const defensive = typeof spreadBps === "number" && spreadBps >= 35;
        output = {
          ...direction,
          signal: defensive ? "SELL" : "HOLD",
          stance: defensive ? "bearish" : "neutral",
          summary: defensive ? "Wide spread suggests adverse selection risk" : "No bearish edge from market geometry",
          assumptions: ["bear case reacts to liquidity/thinness only"],
        };
        break;
      }
      case "agent-skeptic": {
        const weak = typeof liquidityUsd === "number" && liquidityUsd < 10_000;
        output = {
          ...direction,
          signal: weak ? "HOLD" : direction.signal,
          flags: [
            ...(weak ? ["liquidity below the 10k USD confidence floor"] : []),
            ...(typeof spreadBps === "number" && spreadBps >= 50 ? ["extreme spread; quote may be stale"] : []),
          ],
          summary:
            weak || (typeof spreadBps === "number" && spreadBps >= 50)
              ? "Candidate does not resist skeptical pressure from market data"
              : "Candidate survives skeptical checking of market geometry",
          assumptions: ["skeptic checks liquidity and spread only"],
        };
        break;
      }
      case "agent-risk-analyst": {
        const riskLevel = typeof spreadBps === "number" && spreadBps >= 35 ? 0.9 : 0.4;
        output = {
          ...direction,
          signal: "HOLD",
          riskLevel,
          recommendedControls: [
            ...(riskLevel >= 0.7 ? ["require explicit man-in-the-loop approval"] : []),
            ...(riskLevel < 0.7 ? ["keep size capped by the standing per-order limit"] : []),
          ],
          summary: `Risk posture scored at ${Math.round(riskLevel * 100)}% from market geometry`,
          assumptions: ["risk is derived from spread and liquidity, not orderbook depth"],
        };
        break;
      }
      case "agent-execution-advisor": {
        output = {
          ...direction,
          recommendedMode: typeof liquidityUsd === "number" && liquidityUsd >= 10_000 ? "ARBITRAGE_ON" : "OBSERVE_ONLY",
          executionDraft: {
            venue: asObject(payload.scope).venue ?? "unknown",
            maxSlippageBps: 50,
            deadlineMs: Date.now() + 30_000,
          },
          summary: "Execution recommendation derived from liquidity floor only",
          assumptions: ["execution advice is non-binding and advisory"],
        };
        break;
      }
      case "agent-planner-supervisor": {
        output = {
          ...direction,
          plannedSteps: [
            { order: 1, action: "observe", detail: "collect market geometry into the consensus readout" },
            { order: 2, action: "decide", detail: "aggregate scoped votes into a general agent recommendation" },
            { order: 3, action: "act", detail: "route the recommendation through the engine's pre-check seam" },
          ],
          recommendedMode: direction.signal === "BUY" ? "ARBITRAGE_ON" : "OBSERVE_ONLY",
          summary: "Plan derived deterministically from the scoped market readout",
          assumptions: ["plan is advisory; execution authority lives in the engine"],
        };
        break;
      }
      default: {
        output = {
          ...direction,
          purpose: "generic scope observation",
          summary: "Advisory readout of the scoped market state",
          assumptions: ["no specialized deliberation available for this agent"],
        };
        break;
      }
    }

    return {
      kind: "structured",
      agentId: input.agentId,
      payload: output,
      schemaName: config.outputSchemaName,
      timestampMs: input.timestampMs,
      auditTrail: [
        this.buildAuditEntry({
          agentId: input.agentId,
          action: "scope-observe",
          fallbackUsed: false,
        }),
      ],
    };
  }

  private inferSignal(
    mid: number | undefined,
    bid: number | undefined,
    ask: number | undefined,
    spreadBps: number | undefined,
    liquidityUsd: number | undefined,
  ): "BUY" | "SELL" | "HOLD" {
    if (typeof bid === "number" && typeof ask === "number" && typeof mid === "number" && bid > 0 && ask >= bid) {
      if (typeof spreadBps === "number" && spreadBps < 12) return "BUY";
      if (typeof spreadBps === "number" && spreadBps >= 45) return "SELL";
      if (typeof liquidityUsd === "number" && liquidityUsd < 5_000) return "HOLD";
    }
    return "HOLD";
  }

  private inferConfidence(spreadBps: number | undefined, liquidityUsd: number | undefined): number {
    if (typeof spreadBps === "undefined") return 0.2;
    let confidence = 0.5;
    if (spreadBps < 15) confidence += 0.25;
    if (spreadBps >= 35) confidence -= 0.2;
    if (typeof liquidityUsd === "number" && liquidityUsd >= 10_000) confidence += 0.15;
    if (typeof liquidityUsd === "number" && liquidityUsd < 5_000) confidence -= 0.2;
    return Math.max(0.1, Math.min(0.95, Math.round(confidence * 100) / 100));
  }

  private classifyRegime(spreadBps: number | undefined, liquidityUsd: number | undefined): "stable" | "volatile" | "trending" {
    if (typeof spreadBps === "undefined") return "trending";
    if (spreadBps < 10 && typeof liquidityUsd === "number" && liquidityUsd >= 10_000) return "stable";
    if (spreadBps >= 30) return "volatile";
    return "trending";
  }
}
