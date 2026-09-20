/**
 * GeneralAgent (ADR-0013): the cognitive coordinator of one trading scope.
 *
 * A trading scope is (venue, pair) on a CEX and (venue, pool, pair) on a DEX.
 * Each GeneralAgent:
 *   - holds the catalog sub-agents bound to its scope,
 *   - decides which sub-agents to invoke (skipping disabled/non-mandatory),
 *   - feeds them inputs scoped to its venue/pool/pair,
 *   - aggregates their structured outputs,
 *   - emits one GeneralAgentRecommendation per cycle for the Risk Engine gate.
 *
 * Invariants (ADR-0003): the general agent and its sub-agents observe only.
 * They never execute orders, approve risk, sign transactions, or move funds.
 */

import type {
  GeneralAgentRecommendation,
  GeneralAgentSignal,
  TradingScope,
} from "@agenttrading/contracts";
import {
  scopeIdOf,
  type AgentInput,
  type AgentMessage,
  type AgentOutput,
  type StructuredAgentOutput,
} from "@agenttrading/contracts";
import { AgentRuntime } from "@agenttrading/agents-core";

// ── Types ────────────────────────────────────────────────────────────

export interface GeneralAgentOptions {
  /** Identifier for this general agent (e.g. "general-scope-bybit-btc"). */
  agentId: string;
  /** The trading scope this agent owns. */
  scope: TradingScope;
  /** Agent runtime holding the registered catalog sub-agents. */
  runtime: AgentRuntime;
  /** Catalog agent IDs this scope's general agent consults. */
  subAgentIds?: string[];
  /** Injectable clock; defaults to Date.now. */
  now?: () => number;
}

export interface GeneralAgentCycleInput {
  /** Regime classification for this scope's market data. */
  regime: string;
  /** Market context for this scope. */
  market: {
    bid: number;
    ask: number;
    mid: number;
    liquidityUsd: number;
  };
  /** Optional scoped market snapshot already tailored to this scope. */
  payload?: Record<string, unknown>;
  /** Optional dialogue/memory context to include for sub-agents. */
  conversationHistory?: readonly AgentMessage[];
}

export interface GeneralAgentCycleResult {
  /** The aggregated recommendation emitted this cycle. */
  recommendation: GeneralAgentRecommendation;
  /** Catalog agents invoked this cycle (in order). */
  invokedSubAgents: string[];
  /** Catalog agents skipped this cycle (disabled or unknown). */
  skippedSubAgents: string[];
  /** Raw run results from invoked sub-agents. */
  subAgentResults: Array<
    | { agentId: string; kind: "structured"; output: StructuredAgentOutput }
    | { agentId: string; kind: "other"; output: AgentOutput }
  >;
}

// ── Default sub-agent set for a scope ────────────────────────────────

export const DEFAULT_SCOPE_SUB_AGENTS = [
  "agent-market-regime",
  "agent-arbitrage-alpha",
  "agent-bull",
  "agent-bear",
  "agent-skeptic",
  "agent-risk-analyst",
  "agent-execution-advisor",
] as const;

// ── General Agent ────────────────────────────────────────────────────

/**
 * GeneralAgent: a per-scope cognitive coordinator (ADR-0013).
 *
 * Usage:
 * ```ts
 * const agent = new GeneralAgent({
 *   agentId: "general-bybit-btc",
 *   scope: { kind: "CEX", venue: "bybit", pair: "BTC/USDT" },
 *   runtime,
 * });
 * const { recommendation } = await agent.runCycle({
 *   regime: "trending",
 *   market: { bid: 99, ask: 101, mid: 100, liquidityUsd: 10_000 },
 * });
 * ```
 */
export class GeneralAgent {
  readonly agentId: string;
  readonly scope: TradingScope;
  readonly scopeId: string;
  readonly subAgentIds: string[];

  private readonly runtime: AgentRuntime;
  private readonly now: () => number;
  private cyclesRun = 0;

  constructor(options: GeneralAgentOptions) {
    this.agentId = options.agentId;
    this.scope = { ...options.scope };
    this.scopeId = scopeIdOf(this.scope);
    this.subAgentIds = options.subAgentIds ?? [...DEFAULT_SCOPE_SUB_AGENTS];
    this.runtime = options.runtime;
    this.now = options.now ?? (() => Date.now());
  }

  /** Number of cycles this general agent has run. */
  get cycleCount(): number {
    return this.cyclesRun;
  }

  /**
   * Run one cognitive cycle for this scope.
   *
   * 1. Build a scoped AgentInput for each enabled sub-agent.
   * 2. Invoke the sub-agents through the runtime (skipping disabled/unknown).
   * 3. Aggregate the structured outputs into one recommendation.
   *
   * Observation-only: the emitted recommendation never carries execution
   * authority (ADR-0003); the Risk Engine remains the gate.
   */
  async runCycle(input: GeneralAgentCycleInput): Promise<GeneralAgentCycleResult> {
    const timestampMs = this.now();
    this.cyclesRun++;

    const scopedPayload: Record<string, unknown> = {
      scope: {
        venue: this.scope.venue,
        pair: this.scope.pair,
        pool: this.scope.pool,
        chain: this.scope.chain,
      },
      regime: input.regime,
      market: input.market,
      ...(input.payload ?? {}),
    };

    const invokedSubAgents: string[] = [];
    const skippedSubAgents: string[] = [];
    const subAgentResults: GeneralAgentCycleResult["subAgentResults"] = [];
    const structuredOutputs: StructuredAgentOutput[] = [];

    for (const subAgentId of this.subAgentIds) {
      const registration = this.runtime.getRegistry().get(subAgentId);
      if (!registration || !registration.enabled) {
        skippedSubAgents.push(subAgentId);
        continue;
      }

      invokedSubAgents.push(subAgentId);

      const agentInput: AgentInput = {
        agentId: subAgentId,
        payload: scopedPayload,
        permissions: ["OBSERVE_STATE", "OBSERVE_AUDIT"],
        conversationHistory: input.conversationHistory,
        timestampMs,
      };

      const result = await this.runtime.run(agentInput);

      if (result.output.kind === "structured") {
        structuredOutputs.push(result.output);
        subAgentResults.push({
          agentId: subAgentId,
          kind: "structured",
          output: result.output,
        });
      } else {
        subAgentResults.push({ agentId: subAgentId, kind: "other", output: result.output });
      }
    }

    const recommendation = this.aggregate({
      scope: this.scope,
      regime: input.regime,
      structuredOutputs,
      timestampMs,
    });

    return {
      recommendation,
      invokedSubAgents,
      skippedSubAgents,
      subAgentResults,
    };
  }

  // ── Aggregation ─────────────────────────────────────────────────────

  /**
   * Aggregate structured sub-agent outputs into a single recommendation.
   *
   * Deterministic v1: the signal is the best-confidence directional vote
   * among sub-agents whose payload carries a directional field; HOLD when
   * there is no binding signal. Extra keys are allowed on payloads so
   * sub-agent outputs stay forward-compatible.
   */
  private aggregate(params: {
    scope: TradingScope;
    regime: string;
    structuredOutputs: StructuredAgentOutput[];
    timestampMs: number;
  }): GeneralAgentRecommendation {
    let signal: GeneralAgentSignal = "HOLD";
    let confidence = 0;
    let reasoning: string;
    let subAgentIds: string[] = [];

    const votes: Array<{ signal: GeneralAgentSignal; confidence: number; from: string }> = [];

    for (const output of params.structuredOutputs) {
      const vote = this.readDirectionalVote(output.payload);
      if (vote !== undefined) {
        votes.push({
          signal: vote.signal,
          confidence: vote.confidence,
          from: output.agentId,
        });
      }
    }

    if (votes.length > 0) {
      // Highest-confidence directional vote, resolved ties by first-seen order.
      votes.sort((a, b) => b.confidence - a.confidence);
      signal = votes[0].signal;
      confidence = votes[0].confidence;
      subAgentIds = votes.map((v) => v.from);
      const supporters = votes
        .filter((v) => v.signal === signal)
        .map((v) => v.from)
        .join(", ");
      reasoning = params.structuredOutputs.length === 0
        ? "no sub-agent output available; holding"
        : `signal ${signal} (confidence ${confidence.toFixed(2)}) from ${supporters}`;
    } else {
      signal = "HOLD";
      confidence = params.structuredOutputs.length === 0 ? 0 : 0.2;
      subAgentIds = params.structuredOutputs.map((o) => o.agentId);
      reasoning = params.structuredOutputs.length === 0
        ? "no sub-agent output available; holding"
        : "no directional agreement among sub-agents; holding";
    }

    return {
      scopeId: this.scopeId,
      agentId: this.agentId,
      scope: { ...this.scope },
      regime: params.regime,
      signal,
      confidence,
      reasoning,
      subAgentIds,
      subAgentOutputs: params.structuredOutputs,
      timestampMs: params.timestampMs,
    };
  }

  /**
   * Read a strictly-typed directional vote (BUY/SELL + confidence) from a
   * sub-agent payload. Returns undefined when the payload carries no
   * directional signal. Payloads stay `Record<string, unknown>` (schema
   * forward-compat); the optional keys are narrowed to a typed vote here so
   * the aggregation never touches raw strings.
   */
  private readDirectionalVote(
    payload: Record<string, unknown>,
  ): { signal: "BUY" | "SELL"; confidence: number } | undefined {
    let signal: "BUY" | "SELL" | undefined;
    for (const key of ["signal", "recommendation", "action"] as const) {
      const value = payload[key];
      if (value === "BUY") {
        signal = "BUY";
        break;
      }
      if (value === "SELL") {
        signal = "SELL";
        break;
      }
    }
    if (signal === undefined) return undefined;

    const raw = payload["confidence"];
    const numeric =
      typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
    const confidence = Number.isFinite(numeric)
      ? Math.min(1, Math.max(0, numeric))
      : 0.5;
    return { signal, confidence };
  }
}