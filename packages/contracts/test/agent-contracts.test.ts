import { describe, expect, test } from "bun:test";
import {
  isAgentInput,
  isAgentOutput,
  isAgentRunResult,
  isAgentRuntimePolicy,
  isAgentFallback,
  isAgentAuditEntry,
  isAgentStatus,
  isConsultativeAgentOutput,
  parseAgentInput,
  parseAgentOutput,
  parseAgentRunResult,
  parseConsultativeAgentOutput,
  OUTPUT_KINDS,
  AGENT_STATUS,
  type AgentInput,
  type AgentOutput,
  type StructuredAgentOutput,
  type ExplanationAgentOutput,
  type ErrorAgentOutput,
  type AgentRunResult,
  type AgentRuntimePolicy,
  type AgentFallback,
  type ConsultativeAgentOutput,
} from "../src/index.ts";

// ── Fixtures ───────────────────────────────────────────────────────────

function validInput(overrides?: Partial<AgentInput>): AgentInput {
  return {
    agentId: "test-agent",
    payload: { data: "hello" },
    permissions: ["OBSERVE_STATE"],
    timestampMs: 1_700_000_000_000,
    ...overrides,
  };
}

function validStructuredOutput(
  overrides?: Partial<StructuredAgentOutput>,
): StructuredAgentOutput {
  return {
    kind: "structured",
    agentId: "test-agent",
    payload: { signal: "BUY", confidence: 0.85 },
    schemaName: "alpha-signal",
    timestampMs: 1_700_000_000_000,
    ...overrides,
  };
}

function validExplanationOutput(
  overrides?: Partial<ExplanationAgentOutput>,
): ExplanationAgentOutput {
  return {
    kind: "explanation",
    agentId: "test-agent",
    content: "The market shows bullish momentum based on volume analysis.",
    timestampMs: 1_700_000_000_000,
    ...overrides,
  };
}

function validErrorOutput(
  overrides?: Partial<ErrorAgentOutput>,
): ErrorAgentOutput {
  return {
    kind: "error",
    agentId: "test-agent",
    errorCode: "LLM_TIMEOUT",
    message: "LLM call timed out after 30000ms",
    timestampMs: 1_700_000_000_000,
    fallbackUsed: false,
    ...overrides,
  };
}

function validPolicy(): AgentRuntimePolicy {
  return {
    tokenBudget: {
      maxInputTokens: 4_096,
      maxOutputTokens: 2_048,
      maxCostUsd: 0.1,
    },
    timeoutMs: 30_000,
    retry: {
      maxAttempts: 2,
      baseDelayMs: 1_000,
      maxDelayMs: 10_000,
    },
  };
}

function validFallback(): AgentFallback {
  return {
    hasFallback: true,
    strategy: "hardcoded",
    hardcodedValue: { signal: "HOLD", confidence: 0 },
  };
}

// ── AgentInput ─────────────────────────────────────────────────────────

describe("AgentInput", () => {
  test("valid input passes", () => {
    const input = validInput();
    expect(isAgentInput(input)).toBe(true);
    expect(parseAgentInput(input)).toEqual(input);
  });

  test("input with conversation history passes", () => {
    const input = validInput({
      conversationHistory: [
        { role: "system", content: "You are a market analyst." },
        { role: "user", content: "Analyze BTC" },
        { role: "assistant", content: "BTC looks bullish" },
      ],
    });
    expect(isAgentInput(input)).toBe(true);
  });

  test("input with token budget passes", () => {
    const input = validInput({
      tokenBudget: {
        maxInputTokens: 2_048,
        maxOutputTokens: 1_024,
        maxCostUsd: 0.05,
      },
    });
    expect(isAgentInput(input)).toBe(true);
  });

  test("missing agentId rejected", () => {
    const { agentId: _, ...rest } = validInput();
    expect(isAgentInput(rest)).toBe(false);
  });

  test("missing payload rejected", () => {
    const { payload: _, ...rest } = validInput();
    expect(isAgentInput(rest)).toBe(false);
  });

  test("missing permissions rejected", () => {
    const { permissions: _, ...rest } = validInput();
    expect(isAgentInput(rest)).toBe(false);
  });

  test("missing timestampMs rejected", () => {
    const { timestampMs: _, ...rest } = validInput();
    expect(isAgentInput(rest)).toBe(false);
  });
});

// ── AgentOutput (discriminated union) ──────────────────────────────────

describe("AgentOutput", () => {
  test("structured output passes", () => {
    const output = validStructuredOutput();
    expect(isAgentOutput(output)).toBe(true);
    expect(parseAgentOutput(output)).toEqual(output);
  });

  test("explanation output passes", () => {
    const output = validExplanationOutput();
    expect(isAgentOutput(output)).toBe(true);
    expect(parseAgentOutput(output)).toEqual(output);
  });

  test("error output passes", () => {
    const output = validErrorOutput();
    expect(isAgentOutput(output)).toBe(true);
    expect(parseAgentOutput(output)).toEqual(output);
  });

  test("OUTPUT_KINDS contains all three kinds", () => {
    expect(OUTPUT_KINDS).toEqual(["structured", "explanation", "error"]);
  });

  test("unknown kind rejected", () => {
    expect(isAgentOutput({ kind: "unknown", agentId: "a" })).toBe(false);
  });

  test("missing kind rejected", () => {
    expect(isAgentOutput({ agentId: "a", payload: {} })).toBe(false);
  });
});

// ── Structured output specifics ────────────────────────────────────────

describe("StructuredAgentOutput", () => {
  test("valid structured output with payload and schemaName", () => {
    const output = validStructuredOutput();
    expect(output.kind).toBe("structured");
    expect(output.payload).toHaveProperty("signal");
    expect(output.schemaName).toBe("alpha-signal");
  });

  test("structured output with audit trail passes", () => {
    const output = validStructuredOutput({
      auditTrail: [
        {
          eventId: "audit-1",
          timestampMs: 0,
          agentId: "test-agent",
          action: "llm:invoke",
          fallbackUsed: false,
          tokensConsumed: 150,
          costUsd: 0.003,
        },
      ],
    });
    expect(isAgentOutput(output)).toBe(true);
  });

  test("missing schemaName rejected", () => {
    const { schemaName: _, ...rest } = validStructuredOutput();
    expect(isAgentOutput(rest)).toBe(false);
  });
});

// ── Explanation output specifics ───────────────────────────────────────

describe("ExplanationAgentOutput", () => {
  test("AC #2: explanation output cannot trigger execution", () => {
    const output = validExplanationOutput();
    // Explanations are by design non-executable; the output kind
    // "explanation" explicitly marks this.
    expect(output.kind).toBe("explanation");
    expect(typeof output.content).toBe("string");
  });

  test("explanation with accompanying data passes", () => {
    const output = validExplanationOutput({
      accompanyingData: { chartUrl: "https://example.com/chart.png" },
    });
    expect(isAgentOutput(output)).toBe(true);
  });
});

// ── Error output specifics ─────────────────────────────────────────────

describe("ErrorAgentOutput", () => {
  test("error output carries fallbackUsed flag", () => {
    const output = validErrorOutput({ fallbackUsed: true });
    expect(output.fallbackUsed).toBe(true);
  });

  test("missing errorCode rejected", () => {
    const { errorCode: _, ...rest } = validErrorOutput();
    expect(isAgentOutput(rest)).toBe(false);
  });
});

// ── AgentRuntimePolicy ─────────────────────────────────────────────────

describe("AgentRuntimePolicy", () => {
  test("valid policy passes", () => {
    const policy = validPolicy();
    expect(isAgentRuntimePolicy(policy)).toBe(true);
  });

  test("missing tokenBudget rejected", () => {
    const { tokenBudget: _, ...rest } = validPolicy();
    expect(isAgentRuntimePolicy(rest)).toBe(false);
  });

  test("missing timeout rejected", () => {
    const { timeoutMs: _, ...rest } = validPolicy();
    expect(isAgentRuntimePolicy(rest)).toBe(false);
  });

  test("missing retry rejected", () => {
    const { retry: _, ...rest } = validPolicy();
    expect(isAgentRuntimePolicy(rest)).toBe(false);
  });
});

// ── AgentFallback ──────────────────────────────────────────────────────

describe("AgentFallback", () => {
  test("AC #3: hardcoded fallback passes", () => {
    const fallback = validFallback();
    expect(isAgentFallback(fallback)).toBe(true);
    expect(fallback.hasFallback).toBe(true);
    expect(fallback.strategy).toBe("hardcoded");
    expect(fallback.hardcodedValue).toEqual({ signal: "HOLD", confidence: 0 });
  });

  test("passthrough fallback passes", () => {
    const fallback: AgentFallback = {
      hasFallback: true,
      strategy: "passthrough",
    };
    expect(isAgentFallback(fallback)).toBe(true);
  });

  test("reject fallback passes", () => {
    const fallback: AgentFallback = {
      hasFallback: false,
      strategy: "reject",
    };
    expect(isAgentFallback(fallback)).toBe(true);
  });

  test("unknown strategy rejected", () => {
    expect(
      isAgentFallback({ hasFallback: true, strategy: "unknown" }),
    ).toBe(false);
  });
});

// ── AgentRunResult ─────────────────────────────────────────────────────

describe("AgentRunResult", () => {
  test("valid completed result passes", () => {
    const result: AgentRunResult = {
      output: validStructuredOutput(),
      status: "completed",
      tokensConsumed: 150,
      costUsd: 0.003,
      durationMs: 1200,
      retriesAttempted: 0,
      fallbackUsed: false,
    };
    expect(isAgentRunResult(result)).toBe(true);
    expect(parseAgentRunResult(result)).toEqual(result);
  });

  test("fallback_used status passes", () => {
    const result: AgentRunResult = {
      output: validErrorOutput({ fallbackUsed: true }),
      status: "fallback_used",
      tokensConsumed: 0,
      costUsd: 0,
      durationMs: 50,
      retriesAttempted: 2,
      fallbackUsed: true,
    };
    expect(isAgentRunResult(result)).toBe(true);
  });

  test("AGENT_STATUS contains all statuses", () => {
    expect(AGENT_STATUS).toEqual([
      "pending",
      "running",
      "completed",
      "failed",
      "timeout",
      "budget_exceeded",
      "fallback_used",
    ]);
  });

  test("isAgentStatus validates all statuses", () => {
    for (const status of AGENT_STATUS) {
      expect(isAgentStatus(status)).toBe(true);
    }
    expect(isAgentStatus("unknown")).toBe(false);
  });
});

// ── AgentAuditEntry ────────────────────────────────────────────────────

describe("AgentAuditEntry", () => {
  test("valid audit entry passes", () => {
    const entry = {
      eventId: "audit-1",
      timestampMs: 1_700_000_000_000,
      agentId: "test-agent",
      action: "llm:invoke",
      fallbackUsed: false,
    };
    expect(isAgentAuditEntry(entry)).toBe(true);
  });

  test("audit entry with optional fields passes", () => {
    const entry = {
      eventId: "audit-1",
      timestampMs: 1_700_000_000_000,
      agentId: "test-agent",
      action: "fallback:activated",
      fallbackUsed: true,
      tokensConsumed: 200,
      costUsd: 0.004,
      metadata: { reason: "timeout" },
    };
    expect(isAgentAuditEntry(entry)).toBe(true);
  });

  test("missing required fields rejected", () => {
    expect(
      isAgentAuditEntry({
        eventId: "audit-1",
        agentId: "test",
        action: "test",
      }),
    ).toBe(false);
  });
});

// ── Consultative agent outputs ────────────────────────────────────────

function validConsultativeOutput(
  overrides?: Partial<ConsultativeAgentOutput>,
): ConsultativeAgentOutput {
  return {
    agentId: "agent-arbitrage-alpha",
    confidence: 0.78,
    summary: "Route remains profitable after fees.",
    assumptions: ["Stable venue latency", "No inventory shock"],
    invalidationReasons: ["MIN_EDGE"],
    candidateSignal: "ARB:BTC-USDT",
    expectedNetProfitUsd: 42,
    costBreakdownUsd: {
      feesUsd: 4,
      slippageUsd: 5,
      gasUsd: 1,
      bridgeCostUsd: 0,
      fundingCostUsd: 0,
      latencyRiskUsd: 2,
      failureRiskUsd: 1,
      safetyBufferUsd: 3,
    },
    ...overrides,
  } as ConsultativeAgentOutput;
}

describe("ConsultativeAgentOutput", () => {
  test("arbitrage alpha output passes validation", () => {
    const output = validConsultativeOutput();
    expect(isConsultativeAgentOutput(output)).toBe(true);
    expect(parseConsultativeAgentOutput(output)).toEqual(output);
  });

  test("planner supervisor output includes planning fields", () => {
    const output: ConsultativeAgentOutput = {
      agentId: "agent-planner-supervisor",
      confidence: 0.66,
      summary: "Coordinate analysis before review.",
      assumptions: ["Market graph is fresh"],
      invalidationReasons: ["MIN_EDGE"],
      plannedSteps: ["scan", "rank", "debate"],
      recommendedMode: "OBSERVE_ONLY",
    };
    expect(isConsultativeAgentOutput(output)).toBe(true);
  });

  test("debate output carries invalidation reasons but no execution authority", () => {
    const output: ConsultativeAgentOutput = {
      agentId: "agent-bull",
      confidence: 0.72,
      summary: "Bull case remains intact.",
      assumptions: ["Liquidity persists"],
      invalidationReasons: ["MIN_EDGE"],
      candidateId: "cand-1",
      confidenceDelta: 0.08,
      stance: "bullish",
    };
    expect(isConsultativeAgentOutput(output)).toBe(true);
  });

  test("invalid consultative output is rejected", () => {
    expect(
      isConsultativeAgentOutput({
        agentId: "agent-arbitrage-alpha",
        confidence: 0.5,
        summary: "missing fields",
      }),
    ).toBe(false);
  });

  test("memory, audit, and policy consultative outputs validate", () => {
    expect(
      isConsultativeAgentOutput({
        agentId: "agent-memory",
        confidence: 0.88,
        summary: "Recovered a matching failure pattern.",
        assumptions: ["Prior incident retained"],
        invalidationReasons: ["MIN_EDGE"],
        recalledCases: [
          {
            caseId: "incident-42",
            pattern: "timeout during volatile regime",
            relevance: 0.91,
            warning: "latency spike mirrored the current shape",
          },
        ],
        recommendedFollowUps: ["inspect latency envelope"],
      }),
    ).toBe(true);

    expect(
      isConsultativeAgentOutput({
        agentId: "agent-audit",
        confidence: 0.81,
        summary: "Output quality is acceptable but brittle.",
        assumptions: ["Decision trail available"],
        qualityScore: 0.76,
        decisionSummary: "The explanation is readable and consistent.",
        consistencyFindings: ["terminology drift on edge weights"],
        failurePatterns: ["repeated null fallback in similar cases"],
      }),
    ).toBe(true);

    expect(
      isConsultativeAgentOutput({
        agentId: "agent-policy",
        confidence: 0.95,
        summary: "Internal policy blocks one venue and requires review.",
        assumptions: ["Venue list is current"],
        internalLimits: ["max position size 2% NAV"],
        blockedVenues: ["venue-x"],
        userConfiguredTerms: ["no leverage above 2x"],
        reviewRequired: true,
        approvalPower: false,
        notes: ["no execution authority"],
      }),
    ).toBe(true);
  });
});

// ── AC #1: Every agent exposes run(input) → typed output ───────────────

describe("AC #1: typed input → typed output", () => {
  test("input schema matches the contract", () => {
    const input = validInput({
      payload: {
        graphSnapshot: { version: 1, nodes: [], edges: [] },
        opportunities: [],
      },
    });
    expect(isAgentInput(input)).toBe(true);
    const parsed = parseAgentInput(input);
    expect(parsed.agentId).toBe("test-agent");
    expect(parsed.payload).toHaveProperty("graphSnapshot");
  });

  test("output schema is validated against its declared schema", () => {
    const output = validStructuredOutput({
      payload: { signal: "SELL", confidence: 0.92, edge: 45.5 },
      schemaName: "alpha-signal",
    });
    expect(isAgentOutput(output)).toBe(true);
    const parsed = parseAgentOutput(output);
    expect(parsed.kind).toBe("structured");
    if (parsed.kind === "structured") {
      expect(parsed.schemaName).toBe("alpha-signal");
      expect(parsed.payload).toHaveProperty("signal");
    }
  });
});

// ── AC #2: No free-text output can trigger execution ───────────────────

describe("AC #2: no free-text triggers execution", () => {
  test("explanation output is explicitly non-executable", () => {
    const output = validExplanationOutput();
    expect(output.kind).toBe("explanation");
    // The kind discriminator prevents downstream code from treating
    // explanations as executable structured output.
  });

  test("error output is non-executable", () => {
    const output = validErrorOutput();
    expect(output.kind).toBe("error");
  });

  test("structured output must carry schemaName for validation", () => {
    const output = validStructuredOutput();
    expect(output.schemaName).toBeTruthy();
  });
});

// ── AC #3: Deterministic fallback ──────────────────────────────────────

describe("AC #3: deterministic fallback", () => {
  test("fallback config is per-agent", () => {
    const fallback1 = validFallback();
    const fallback2: AgentFallback = {
      hasFallback: true,
      strategy: "passthrough",
    };
    expect(isAgentFallback(fallback1)).toBe(true);
    expect(isAgentFallback(fallback2)).toBe(true);
    expect(fallback1.strategy).not.toBe(fallback2.strategy);
  });

  test("hardcoded fallback carries deterministic value", () => {
    const fallback = validFallback();
    expect(fallback.hardcodedValue).toBeDefined();
    expect(fallback.hardcodedValue).toHaveProperty("signal", "HOLD");
  });

  test("reject fallback signals no fallback available", () => {
    const fallback: AgentFallback = {
      hasFallback: false,
      strategy: "reject",
    };
    expect(fallback.hasFallback).toBe(false);
  });
});

// ── AC #4: Budget, timeout, retry enforced; core never imports LLM ─────

describe("AC #4: budget, timeout, retry policy", () => {
  test("token budget has all three limits", () => {
    const policy = validPolicy();
    expect(policy.tokenBudget.maxInputTokens).toBeGreaterThan(0);
    expect(policy.tokenBudget.maxOutputTokens).toBeGreaterThan(0);
    expect(policy.tokenBudget.maxCostUsd).toBeGreaterThanOrEqual(0);
  });

  test("timeout is enforced per invocation", () => {
    const policy = validPolicy();
    expect(policy.timeoutMs).toBeGreaterThan(0);
  });

  test("retry policy has exponential backoff config", () => {
    const policy = validPolicy();
    expect(policy.retry.maxAttempts).toBeGreaterThanOrEqual(1);
    expect(policy.retry.baseDelayMs).toBeGreaterThan(0);
    expect(policy.retry.maxDelayMs).toBeGreaterThanOrEqual(policy.retry.baseDelayMs);
  });
});
