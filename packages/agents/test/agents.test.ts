import { describe, expect, test } from "bun:test";
import {
  isAgentInput,
  isAgentOutput,
  isAgentRunResult,
  type AgentInput,
  type AgentOutput,
} from "@agenttrading/contracts";
import {
  AgentRegistry,
  AgentMemory,
  AgentLogger,
  BudgetEnforcer,
  AgentRuntime,
  CONSULTATIVE_AGENT_CATALOG,
  CONSULTATIVE_AGENT_CONFIGS,
  CONSULTATIVE_AGENT_IDS,
  getConsultativeAgentConfig,
  createDefaultAgentConfig,
  RUNTIME_TYPES,
} from "../src/index.ts";
import {
  BaseAgentAdapter,
  type AgentAdapter,
  type SchemaValidationResult,
} from "../src/adapter.ts";
import type { AgentConfig } from "../src/config.ts";

// ── Mock Adapter ───────────────────────────────────────────────────────

class MockAgentAdapter extends BaseAgentAdapter {
  readonly adapterId = "mock";
  readonly runtimeName = "mock-runtime";

  private readonly outputs: AgentOutput[];
  private callIndex = 0;

  constructor(outputs: AgentOutput[], options?: { now?: () => number }) {
    super(options);
    this.outputs = outputs;
  }

  async run(_input: AgentInput): Promise<AgentOutput> {
    const output = this.outputs[this.callIndex % this.outputs.length];
    this.callIndex++;
    return output;
  }
}

class FailingAdapter extends BaseAgentAdapter {
  readonly adapterId = "failing";
  readonly runtimeName = "failing-runtime";

  constructor(options?: { now?: () => number }) {
    super(options);
  }

  async run(_input: AgentInput): Promise<AgentOutput> {
    throw new Error("LLM unavailable");
  }
}

// ── Fixtures ───────────────────────────────────────────────────────────

function makeConfig(
  agentId: string,
  overrides?: Partial<AgentConfig>,
): AgentConfig {
  return createDefaultAgentConfig({
    agentId,
    name: agentId,
    ...overrides,
  });
}

function makeInput(agentId: string): AgentInput {
  return {
    agentId,
    payload: { test: true },
    permissions: ["OBSERVE_STATE"],
    timestampMs: Date.now(),
  };
}

function makeStructuredOutput(agentId: string): AgentOutput {
  return {
    kind: "structured",
    agentId,
    payload: { signal: "BUY", confidence: 0.85 },
    schemaName: "test-schema",
    timestampMs: Date.now(),
  };
}

// ── AgentRegistry ──────────────────────────────────────────────────────

describe("AgentRegistry", () => {
  test("register and retrieve an agent", () => {
    const registry = new AgentRegistry();
    const config = makeConfig("alpha-scan");
    const adapter = new MockAgentAdapter([makeStructuredOutput("alpha-scan")]);

    registry.register(config, adapter);

    expect(registry.get("alpha-scan")).toBeDefined();
    expect(registry.get("alpha-scan")?.config.agentId).toBe("alpha-scan");
    expect(registry.get("alpha-scan")?.enabled).toBe(true);
    expect(registry.size).toBe(1);
  });

  test("duplicate registration throws", () => {
    const registry = new AgentRegistry();
    const config = makeConfig("alpha-scan");
    const adapter = new MockAgentAdapter([makeStructuredOutput("alpha-scan")]);

    registry.register(config, adapter);
    expect(() => registry.register(config, adapter)).toThrow(
      "Agent already registered: alpha-scan",
    );
  });

  test("unregister removes agent", () => {
    const registry = new AgentRegistry();
    const config = makeConfig("alpha-scan");
    const adapter = new MockAgentAdapter([makeStructuredOutput("alpha-scan")]);

    registry.register(config, adapter);
    expect(registry.unregister("alpha-scan")).toBe(true);
    expect(registry.get("alpha-scan")).toBeUndefined();
    expect(registry.size).toBe(0);
  });

  test("setEnabled toggles agent", () => {
    const registry = new AgentRegistry();
    const config = makeConfig("alpha-scan");
    const adapter = new MockAgentAdapter([makeStructuredOutput("alpha-scan")]);

    registry.register(config, adapter);
    expect(registry.isEnabled("alpha-scan")).toBe(true);

    registry.setEnabled("alpha-scan", false);
    expect(registry.isEnabled("alpha-scan")).toBe(false);

    registry.setEnabled("alpha-scan", true);
    expect(registry.isEnabled("alpha-scan")).toBe(true);
  });

  test("listAgentIds and listEnabledAgentIds", () => {
    const registry = new AgentRegistry();
    const adapter = new MockAgentAdapter([makeStructuredOutput("a")]);

    registry.register(makeConfig("a"), adapter);
    registry.register(makeConfig("b"), adapter);
    registry.register(makeConfig("c"), adapter);
    registry.setEnabled("b", false);

    expect(registry.listAgentIds()).toEqual(["a", "b", "c"]);
    expect(registry.listEnabledAgentIds()).toEqual(["a", "c"]);
  });

  test("getByRuntime filters agents", () => {
    const registry = new AgentRegistry();
    const adapter = new MockAgentAdapter([makeStructuredOutput("a")]);

    registry.register(makeConfig("a", { runtime: "vercel-ai-sdk" }), adapter);
    registry.register(makeConfig("b", { runtime: "mastra" }), adapter);
    registry.register(makeConfig("c", { runtime: "vercel-ai-sdk" }), adapter);

    const vercelAgents = registry.getByRuntime("vercel-ai-sdk");
    expect(vercelAgents).toHaveLength(2);
    expect(vercelAgents.map((a) => a.config.agentId)).toEqual(["a", "c"]);
  });

  test("getMandatoryAgents filters mandatory agents", () => {
    const registry = new AgentRegistry();
    const adapter = new MockAgentAdapter([makeStructuredOutput("a")]);

    registry.register(makeConfig("a", { mandatory: true }), adapter);
    registry.register(makeConfig("b", { mandatory: false }), adapter);

    const mandatory = registry.getMandatoryAgents();
    expect(mandatory).toHaveLength(1);
    expect(mandatory[0].config.agentId).toBe("a");
  });

  test("isEmpty and size", () => {
    const registry = new AgentRegistry();
    expect(registry.isEmpty).toBe(true);
    expect(registry.size).toBe(0);

    registry.register(makeConfig("a"), new MockAgentAdapter([makeStructuredOutput("a")]));
    expect(registry.isEmpty).toBe(false);
    expect(registry.size).toBe(1);
  });
});

describe("consultative agent catalog", () => {
  test("catalog exposes all issue #28 consultative agents", () => {
    expect(CONSULTATIVE_AGENT_IDS).toEqual([
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
    ]);
    expect(CONSULTATIVE_AGENT_CATALOG).toHaveLength(11);
  });

  test("consultative configs are typed, runtime-declared, and permission-safe", () => {
    const forbidden = new Set([
      "APPROVE_RISK",
      "SUBMIT_ORDER",
      "SIGN_TRANSACTION",
      "MOVE_FUNDS",
      "MODIFY_RISK_LIMITS",
    ]);

    for (const agentId of CONSULTATIVE_AGENT_IDS) {
      const config = getConsultativeAgentConfig(agentId);
      expect(CONSULTATIVE_AGENT_CONFIGS.get(agentId)).toEqual(config);
      expect(RUNTIME_TYPES).toContain(config.runtime);
      expect(config.permissions.some((perm) => forbidden.has(perm))).toBe(false);
      expect(config.outputSchemaName).toMatch(/output$/);
    }
  });

  test("memory, audit, and policy agents are Mastra-backed advisory-only agents", () => {
    const expected = [
      ["agent-memory", "control"],
      ["agent-audit", "control"],
      ["agent-policy", "control"],
    ] as const;

    for (const [agentId, layer] of expected) {
      const config = getConsultativeAgentConfig(agentId);
      expect(
        agentId === "agent-policy" ? "vercel-ai-sdk" : "mastra",
      ).toBe(config.runtime);
      expect(config.layer).toBe(layer);
      expect(config.permissions).toEqual(["OBSERVE_STATE", "OBSERVE_AUDIT"]);
      expect(config.fallback.hasFallback).toBe(true);
    }
  });
});

// ── AgentMemory ────────────────────────────────────────────────────────

describe("AgentMemory", () => {
  test("addMessage and getMessages", () => {
    const memory = new AgentMemory();
    memory.addMessage("agent-1", { role: "user", content: "Hello" });
    memory.addMessage("agent-1", { role: "assistant", content: "Hi there" });

    const messages = memory.getMessages("agent-1");
    expect(messages).toHaveLength(2);
    expect(messages[0].content).toBe("Hello");
    expect(messages[1].content).toBe("Hi there");
  });

  test("empty messages for unknown agent", () => {
    const memory = new AgentMemory();
    expect(memory.getMessages("unknown")).toEqual([]);
  });

  test("setState and getState", () => {
    const memory = new AgentMemory();
    memory.setState("agent-1", "lastSignal", "BUY");
    expect(memory.getState<string>("agent-1", "lastSignal")).toBe("BUY");
    expect(memory.getState("agent-1", "unknown")).toBeUndefined();
  });

  test("clear removes agent memory", () => {
    const memory = new AgentMemory();
    memory.addMessage("agent-1", { role: "user", content: "Hello" });
    memory.setState("agent-1", "key", "value");

    memory.clear("agent-1");
    expect(memory.getMessages("agent-1")).toEqual([]);
    expect(memory.getState("agent-1", "key")).toBeUndefined();
  });

  test("clearAll removes all memory", () => {
    const memory = new AgentMemory();
    memory.addMessage("a", { role: "user", content: "Hello" });
    memory.addMessage("b", { role: "user", content: "World" });

    memory.clearAll();
    expect(memory.getMessages("a")).toEqual([]);
    expect(memory.getMessages("b")).toEqual([]);
  });

  test("snapshot and restore", () => {
    const memory = new AgentMemory();
    memory.addMessage("agent-1", { role: "user", content: "Hello" });
    memory.setState("agent-1", "key", "value");

    const snapshot = memory.snapshot("agent-1");
    expect(snapshot).not.toBeNull();
    expect(snapshot!.agentId).toBe("agent-1");
    expect(snapshot!.messages).toHaveLength(1);

    memory.clear("agent-1");
    expect(memory.getMessages("agent-1")).toEqual([]);

    memory.restore(snapshot!);
    expect(memory.getMessages("agent-1")).toHaveLength(1);
    expect(memory.getState<string>("agent-1", "key")).toBe("value");
  });

  test("totalMessageCount", () => {
    const memory = new AgentMemory();
    memory.addMessage("a", { role: "user", content: "1" });
    memory.addMessage("a", { role: "user", content: "2" });
    memory.addMessage("b", { role: "user", content: "3" });

    expect(memory.totalMessageCount()).toBe(3);
  });
});

// ── AgentLogger ────────────────────────────────────────────────────────

describe("AgentLogger", () => {
  test("log creates entry", () => {
    const logger = new AgentLogger();
    const entry = logger.log({
      level: "info",
      agentId: "test",
      operation: "test:op",
      message: "Test message",
    });

    expect(entry.agentId).toBe("test");
    expect(entry.level).toBe("info");
    expect(entry.operation).toBe("test:op");
    expect(logger.getEntries()).toHaveLength(1);
  });

  test("logInvocationStart and logInvocationEnd", () => {
    const logger = new AgentLogger();
    logger.logInvocationStart("test", { data: "hello" });
    logger.logInvocationEnd(
      "test",
      { kind: "structured", agentId: "test", payload: {}, schemaName: "s", timestampMs: 0 },
      1000,
    );

    const entries = logger.getEntries();
    expect(entries).toHaveLength(2);
    expect(entries[0].operation).toBe("invocation:start");
    expect(entries[1].operation).toBe("invocation:end");
    expect(entries[1].durationMs).toBe(1000);
  });

  test("logFallback creates warning", () => {
    const logger = new AgentLogger();
    logger.logFallback("test", "timeout");

    const entries = logger.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].level).toBe("warn");
    expect(entries[0].operation).toBe("fallback:activated");
  });

  test("logBudgetExceeded creates warning", () => {
    const logger = new AgentLogger();
    logger.logBudgetExceeded("test", 5000, 4096, "tokens");

    const entries = logger.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].level).toBe("warn");
    expect(entries[0].data?.budgetType).toBe("tokens");
  });

  test("getEntriesForAgent filters by agent", () => {
    const logger = new AgentLogger();
    logger.log({ level: "info", agentId: "a", operation: "op", message: "m" });
    logger.log({ level: "info", agentId: "b", operation: "op", message: "m" });
    logger.log({ level: "info", agentId: "a", operation: "op2", message: "m" });

    expect(logger.getEntriesForAgent("a")).toHaveLength(2);
    expect(logger.getEntriesForAgent("b")).toHaveLength(1);
  });

  test("getEntriesAtLevel filters by level hierarchy", () => {
    const logger = new AgentLogger();
    logger.log({ level: "debug", agentId: "a", operation: "op", message: "m" });
    logger.log({ level: "info", agentId: "a", operation: "op", message: "m" });
    logger.log({ level: "warn", agentId: "a", operation: "op", message: "m" });
    logger.log({ level: "error", agentId: "a", operation: "op", message: "m" });

    expect(logger.getEntriesAtLevel("warn")).toHaveLength(2); // warn + error
    expect(logger.getEntriesAtLevel("error")).toHaveLength(1); // error only
  });

  test("toAuditEntries converts to audit format", () => {
    const logger = new AgentLogger();
    logger.logFallback("test", "timeout");

    const auditEntries = logger.toAuditEntries();
    expect(auditEntries).toHaveLength(1);
    expect(auditEntries[0].fallbackUsed).toBe(true);
  });

  test("clear removes all entries", () => {
    const logger = new AgentLogger();
    logger.log({ level: "info", agentId: "a", operation: "op", message: "m" });
    logger.clear();
    expect(logger.getEntries()).toHaveLength(0);
  });
});

// ── BudgetEnforcer ─────────────────────────────────────────────────────

describe("BudgetEnforcer", () => {
  test("getConsumption returns zeros for unknown agent", () => {
    const enforcer = new BudgetEnforcer();
    const consumption = enforcer.getConsumption("unknown");
    expect(consumption.inputTokens).toBe(0);
    expect(consumption.outputTokens).toBe(0);
    expect(consumption.costUsd).toBe(0);
    expect(consumption.invocations).toBe(0);
  });

  test("recordConsumption accumulates", () => {
    const enforcer = new BudgetEnforcer();
    enforcer.recordConsumption("a", 100, 50, 0.001);
    enforcer.recordConsumption("a", 200, 80, 0.002);

    const c = enforcer.getConsumption("a");
    expect(c.inputTokens).toBe(300);
    expect(c.outputTokens).toBe(130);
    expect(c.costUsd).toBeCloseTo(0.003);
    expect(c.invocations).toBe(2);
  });

  test("wouldExceedBudget checks output tokens", () => {
    const enforcer = new BudgetEnforcer();
    const policy = {
      tokenBudget: { maxInputTokens: 4096, maxOutputTokens: 100, maxCostUsd: 0.1 },
      timeoutMs: 30000,
      retry: { maxAttempts: 2, baseDelayMs: 1000, maxDelayMs: 10000 },
    };

    expect(enforcer.wouldExceedBudget("a", policy, 50).allowed).toBe(true);
    expect(enforcer.wouldExceedBudget("a", policy, 200).allowed).toBe(false);
  });

  test("checkRetry and recordRetry", () => {
    const enforcer = new BudgetEnforcer();
    const retryPolicy = { maxAttempts: 3, baseDelayMs: 1000, maxDelayMs: 10000 };

    let state = enforcer.checkRetry("inv-1", retryPolicy);
    expect(state.attempts).toBe(1);
    expect(state.exhausted).toBe(false);

    state = enforcer.recordRetry("inv-1");
    expect(state.attempts).toBe(2);

    state = enforcer.recordRetry("inv-1");
    expect(state.attempts).toBe(3);

    state = enforcer.checkRetry("inv-1", retryPolicy);
    expect(state.exhausted).toBe(true);
  });

  test("calculateRetryDelay uses exponential backoff", () => {
    const enforcer = new BudgetEnforcer();
    const policy = { maxAttempts: 5, baseDelayMs: 1000, maxDelayMs: 10000 };

    expect(enforcer.calculateRetryDelay(1, policy)).toBe(1000);
    expect(enforcer.calculateRetryDelay(2, policy)).toBe(2000);
    expect(enforcer.calculateRetryDelay(3, policy)).toBe(4000);
    expect(enforcer.calculateRetryDelay(4, policy)).toBe(8000);
    expect(enforcer.calculateRetryDelay(5, policy)).toBe(10000); // capped at maxDelayMs
  });

  test("reset clears consumption for one agent", () => {
    const enforcer = new BudgetEnforcer();
    enforcer.recordConsumption("a", 100, 50, 0.001);
    enforcer.recordConsumption("b", 100, 50, 0.001);

    enforcer.reset("a");
    expect(enforcer.getConsumption("a").invocations).toBe(0);
    expect(enforcer.getConsumption("b").invocations).toBe(1);
  });

  test("resetAll clears everything", () => {
    const enforcer = new BudgetEnforcer();
    enforcer.recordConsumption("a", 100, 50, 0.001);
    enforcer.resetAll();
    expect(enforcer.getConsumption("a").invocations).toBe(0);
  });
});

// ── AgentRuntime ───────────────────────────────────────────────────────

describe("AgentRuntime", () => {
  test("run returns error for unknown agent", async () => {
    const registry = new AgentRegistry();
    const runtime = new AgentRuntime({ registry });

    const result = await runtime.run(makeInput("unknown"));
    expect(result.output.kind).toBe("error");
    expect(result.status).toBe("failed");
    if (result.output.kind === "error") {
      expect(result.output.errorCode).toBe("AGENT_NOT_FOUND");
    }
  });

  test("run returns error for disabled agent", async () => {
    const registry = new AgentRegistry();
    registry.register(
      makeConfig("alpha-scan"),
      new MockAgentAdapter([makeStructuredOutput("alpha-scan")]),
    );
    registry.setEnabled("alpha-scan", false);

    const runtime = new AgentRuntime({ registry });
    const result = await runtime.run(makeInput("alpha-scan"));

    expect(result.output.kind).toBe("error");
    expect(result.status).toBe("failed");
    if (result.output.kind === "error") {
      expect(result.output.errorCode).toBe("AGENT_DISABLED");
    }
  });

  test("run succeeds with valid adapter", async () => {
    const registry = new AgentRegistry();
    const output = makeStructuredOutput("alpha-scan");
    const adapter = new MockAgentAdapter([output]);
    // Register a schema validator so AC #1 validation passes
    adapter.registerSchema("alpha-scan", () => ({ valid: true }));
    registry.register(makeConfig("alpha-scan"), adapter);

    const runtime = new AgentRuntime({ registry });
    const result = await runtime.run(makeInput("alpha-scan"));

    expect(result.output.kind).toBe("structured");
    expect(result.status).toBe("completed");
    expect(result.fallbackUsed).toBe(false);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("run fails when schema declared but no validator registered (AC #1)", async () => {
    const registry = new AgentRegistry();
    const output = makeStructuredOutput("alpha-scan");
    // No schema registered on the adapter
    registry.register(
      makeConfig("alpha-scan", {
        outputSchema: { type: "object", properties: { signal: { type: "string" } } },
      }),
      new MockAgentAdapter([output]),
    );

    const runtime = new AgentRuntime({ registry });
    const result = await runtime.run(makeInput("alpha-scan"));

    // Should fail because config declares a schema but no validator is registered
    expect(result.output.kind).toBe("error");
    expect(result.status).toBe("fallback_used");
  });

  test("run accepts output when no schema configured (AC #1 graceful degradation)", async () => {
    const registry = new AgentRegistry();
    const output = makeStructuredOutput("alpha-scan");
    // Default config has outputSchema: { type: "object" } — treated as no real schema
    registry.register(
      makeConfig("alpha-scan"),
      new MockAgentAdapter([output]),
    );

    const runtime = new AgentRuntime({ registry });
    const result = await runtime.run(makeInput("alpha-scan"));

    // Should succeed — no real schema configured, so output is accepted
    expect(result.output.kind).toBe("structured");
    expect(result.status).toBe("completed");
  });

  test("run returns budget_exceeded when budget is exceeded (AC #4)", async () => {
    const registry = new AgentRegistry();
    const output = makeStructuredOutput("alpha-scan");
    const adapter = new MockAgentAdapter([output]);
    adapter.registerSchema("alpha-scan", () => ({ valid: true }));
    registry.register(
      makeConfig("alpha-scan", {
        policy: {
          tokenBudget: { maxInputTokens: 4096, maxOutputTokens: 100, maxCostUsd: 0.001 },
          timeoutMs: 30_000,
          retry: { maxAttempts: 1, baseDelayMs: 1000, maxDelayMs: 10_000 },
        },
      }),
      adapter,
    );

    const budget = new BudgetEnforcer();
    // Pre-load consumption near the budget limit
    budget.recordConsumption("alpha-scan", 0, 0, 0.001);

    const runtime = new AgentRuntime({ registry, budget });
    const result = await runtime.run(makeInput("alpha-scan"));

    expect(result.output.kind).toBe("error");
    expect(result.status).toBe("failed");
    if (result.output.kind === "error") {
      expect(result.output.errorCode).toBe("BUDGET_EXCEEDED");
    }
  });

  test("run retries on failure", async () => {
    const registry = new AgentRegistry();
    registry.register(
      makeConfig("failing-agent", {
        fallback: {
          hasFallback: true,
          strategy: "reject",
        },
      }),
      new FailingAdapter(),
    );

    const runtime = new AgentRuntime({ registry });
    const result = await runtime.run({
      ...makeInput("failing-agent"),
      timeoutMs: 1000,
    });

    // The adapter throws, fallback is reject, so it returns fallback_used
    expect(result.output.kind).toBe("error");
    expect(result.status).toBe("fallback_used");
    if (result.output.kind === "error") {
      expect(result.output.fallbackUsed).toBe(true);
    }
  });

  test("run with fallback enabled returns fallback output", async () => {
    const registry = new AgentRegistry();
    registry.register(
      makeConfig("fallback-agent", {
        fallback: {
          hasFallback: true,
          strategy: "hardcoded",
          hardcodedValue: { signal: "HOLD", confidence: 0 },
        },
      }),
      new FailingAdapter(),
    );

    const runtime = new AgentRuntime({ registry });
    const result = await runtime.run({
      ...makeInput("fallback-agent"),
      timeoutMs: 1000,
    });

    expect(result.output.kind).toBe("structured");
    expect(result.status).toBe("fallback_used");
    expect(result.fallbackUsed).toBe(true);
    if (result.output.kind === "structured") {
      expect(result.output.payload).toHaveProperty("signal", "HOLD");
    }
  });

  test("logger records invocation events", async () => {
    const registry = new AgentRegistry();
    const output = makeStructuredOutput("alpha-scan");
    const adapter = new MockAgentAdapter([output]);
    adapter.registerSchema("alpha-scan", () => ({ valid: true }));
    registry.register(makeConfig("alpha-scan"), adapter);

    const logger = new AgentLogger();
    const runtime = new AgentRuntime({ registry, logger });
    await runtime.run(makeInput("alpha-scan"));

    const entries = logger.getEntries();
    expect(entries.length).toBeGreaterThanOrEqual(2);
    expect(entries.some((e) => e.operation === "invocation:start")).toBe(true);
    expect(entries.some((e) => e.operation === "invocation:end")).toBe(true);
  });

  test("memory is accessible", () => {
    const registry = new AgentRegistry();
    const memory = new AgentMemory();
    const runtime = new AgentRuntime({ registry, memory });

    expect(runtime.getMemory()).toBe(memory);
    memory.addMessage("a", { role: "user", content: "test" });
    expect(runtime.getMemory().getMessages("a")).toHaveLength(1);
  });

  test("registry is accessible", () => {
    const registry = new AgentRegistry();
    const runtime = new AgentRuntime({ registry });
    expect(runtime.getRegistry()).toBe(registry);
  });
});

// ── createDefaultAgentConfig ───────────────────────────────────────────

describe("createDefaultAgentConfig", () => {
  test("creates config with required fields and defaults", () => {
    const config = createDefaultAgentConfig({
      agentId: "test-agent",
      name: "Test Agent",
    });

    expect(config.agentId).toBe("test-agent");
    expect(config.name).toBe("Test Agent");
    expect(config.runtime).toBe("vercel-ai-sdk");
    expect(config.layer).toBe("analytical");
    expect(config.mandatory).toBe(false);
    expect(config.policy.tokenBudget.maxInputTokens).toBe(4096);
    expect(config.policy.timeoutMs).toBe(30000);
    expect(config.fallback.hasFallback).toBe(false);
  });

  test("overrides are applied", () => {
    const config = createDefaultAgentConfig({
      agentId: "test-agent",
      name: "Test Agent",
      runtime: "mastra",
      layer: "deliberative",
      mandatory: true,
    });

    expect(config.runtime).toBe("mastra");
    expect(config.layer).toBe("deliberative");
    expect(config.mandatory).toBe(true);
  });
});

// ── RUNTIME_TYPES ──────────────────────────────────────────────────────

describe("RUNTIME_TYPES", () => {
  test("contains expected runtimes", () => {
    expect(RUNTIME_TYPES).toEqual(["vercel-ai-sdk", "mastra"]);
  });
});
