import { describe, expect, test } from "bun:test";
import type { AgentInput, AgentOutput, TradingScope } from "@agenttrading/contracts";
import {
  GeneralAgent,
  ScopeObserverAdapter,
  createDefaultAgentConfig,
  createScopeDeployment,
  defaultGeneralAgentId,
  deployPerScopeGeneralAgents,
  scopeIdOf,
  type AgentConfig,
} from "@agenttrading/agents";
import { BaseAgentAdapter } from "../src/adapter.ts";
import { AgentRegistry } from "../src/registry.ts";
import { AgentRuntime } from "../src/runtime.ts";

// ── Fixtures ───────────────────────────────────────────────────────────

const bybitScope: TradingScope = { kind: "CEX", venue: "bybit", pair: "BTC/USDT" };
const dexScope: TradingScope = {
  kind: "DEX",
  venue: "pancakeswap-v4",
  pool: "0xpool",
  pair: "BNB/USDT",
  chain: "bsc",
};

function makeConfig(agentId: string): AgentConfig {
  return createDefaultAgentConfig({ agentId, name: agentId });
}

function makeStructured(
  agentId: string,
  payload: Record<string, unknown>,
): AgentOutput {
  return {
    kind: "structured",
    agentId,
    payload,
    schemaName: "test-schema",
    timestampMs: 1_700_000_000_000,
  };
}

class FixedOutputAdapter extends BaseAgentAdapter {
  readonly adapterId = "fixed-output";
  readonly runtimeName = "fixed-runtime";

  constructor(private readonly output: AgentOutput) {
    super();
  }

  async run(_input: AgentInput): Promise<AgentOutput> {
    return this.output;
  }
}

// ── GeneralAgent ───────────────────────────────────────────────────────

describe("GeneralAgent (ADR-0013)", () => {
  test("emits a recommendation from scoped sub-agent votes", async () => {
    const registry = new AgentRegistry();
    registry.register(
      makeConfig("agent-bull"),
      new FixedOutputAdapter(makeStructured("agent-bull", { signal: "BUY", confidence: 0.7 })),
    );
    registry.register(
      makeConfig("agent-bear"),
      new FixedOutputAdapter(makeStructured("agent-bear", { signal: "SELL", confidence: 0.6 })),
    );
    const runtime = new AgentRuntime({ registry });

    const agent = new GeneralAgent({ agentId: "general-bybit-btc", scope: bybitScope, runtime });
    const { recommendation, invokedSubAgents } = await agent.runCycle({
      regime: "trending",
      market: { bid: 99, ask: 101, mid: 100, liquidityUsd: 10_000 },
    });

    expect(invokedSubAgents).toEqual(["agent-bull", "agent-bear"]);
    expect(recommendation.signal).toBe("BUY"); // highest confidence directional vote
    expect(recommendation.confidence).toBe(0.7);
    expect(recommendation.scopeId).toBe("bybit:BTC/USDT");
    expect(recommendation.agentId).toBe("general-bybit-btc");
    expect(recommendation.regime).toBe("trending");
    expect(recommendation.subAgentOutputs).toHaveLength(2);
  });

  test("defaults to HOLD when no directional agreement exists", async () => {
    const registry = new AgentRegistry();
    registry.register(
      makeConfig("agent-market-regime"),
      new FixedOutputAdapter(makeStructured("agent-market-regime", { signal: "HOLD", confidence: 0.5 })),
    );
    registry.register(
      makeConfig("agent-risk-analyst"),
      new FixedOutputAdapter(makeStructured("agent-risk-analyst", { confidence: 0.4 })),
    );
    const runtime = new AgentRuntime({ registry });

    const agent = new GeneralAgent({ agentId: "general-bybit-btc", scope: bybitScope, runtime });
    const { recommendation } = await agent.runCycle({
      regime: "stable",
      market: { bid: 99, ask: 101, mid: 100, liquidityUsd: 10_000 },
    });

    expect(recommendation.signal).toBe("HOLD");
  });

  test("HOLDs with zero confidence when no sub-agents produce output", async () => {
    const registry = new AgentRegistry();
    registry.register(makeConfig("agent-market-regime"), new FixedOutputAdapter({
      kind: "error",
      agentId: "agent-market-regime",
      errorCode: "LLM_INVOCATION_FAILED",
      message: "nope",
      timestampMs: 1_700_000_000_000,
      fallbackUsed: false,
    }));
    const runtime = new AgentRuntime({ registry });

    const agent = new GeneralAgent({ agentId: "general-bybit-btc", scope: bybitScope, runtime });
    const { recommendation } = await agent.runCycle({
      regime: "trending",
      market: { bid: 99, ask: 101, mid: 100, liquidityUsd: 10_000 },
    });

    expect(recommendation.signal).toBe("HOLD");
    expect(recommendation.confidence).toBe(0);
    expect(recommendation.subAgentIds).toEqual([]);
  });

  test("deployment default agent ID is stable for a scope", () => {
    expect(defaultGeneralAgentId(bybitScope)).toBe("general-scope-bybit-BTC-USDT");
  });
});

// ── ScopeObserverAdapter ───────────────────────────────────────────────

describe("ScopeObserverAdapter", () => {
  const flatMarket = {
    scope: { venue: "bybit", pair: "BTC/USDT" },
    regime: "trending",
    market: { bid: 99.5, ask: 100.5, mid: 100, liquidityUsd: 50_000 },
  };

  test("emits structured scope observations for catalog agents", async () => {
    const configs = new Map<string, AgentConfig>([
      ["agent-market-regime", makeConfig("agent-market-regime")],
      ["agent-arbitrage-alpha", makeConfig("agent-arbitrage-alpha")],
    ]);
    const adapter = new ScopeObserverAdapter(configs);

    const input: AgentInput = {
      agentId: "agent-market-regime",
      payload: flatMarket,
      permissions: ["OBSERVE_STATE"],
      timestampMs: 1_700_000_000_000,
    };
    const output = await adapter.run(input);

    expect(output.kind).toBe("structured");
    expect(output.agentId).toBe("agent-market-regime");
    expect((output as { payload: Record<string, unknown> }).payload.signal).toBeDefined();
    expect(typeof (output as { payload: Record<string, unknown> }).payload.confidence).toBe("number");
  });

  test("classifies a tight, liquid market as stable", async () => {
    const configs = new Map<string, AgentConfig>([
      ["agent-market-regime", makeConfig("agent-market-regime")],
    ]);
    const adapter = new ScopeObserverAdapter(configs);
    const input: AgentInput = {
      agentId: "agent-market-regime",
      payload: {
        ...flatMarket,
        market: { bid: 99.95, ask: 100.05, mid: 100, liquidityUsd: 100_000 },
      },
      permissions: ["OBSERVE_STATE"],
      timestampMs: 1_700_000_000_000,
    };
    const output = await adapter.run(input);
    const payload = (output as { payload: Record<string, unknown> }).payload;
    expect(payload.regime).toBe("stable");
    expect(payload.recommendedMode).toBe("ARBITRAGE_ON");
  });

  test("emits a signal that survives the GeneralAgent aggregate", async () => {
    const configs = new Map<string, AgentConfig>([
      ["agent-bull", makeConfig("agent-bull")],
      ["agent-bear", makeConfig("agent-bear")],
    ]);
    const adapter = new ScopeObserverAdapter(configs);

    const registry = new AgentRegistry();
    for (const [id, config] of configs) {
      registry.register(config, adapter);
    }
    const runtime = new AgentRuntime({ registry });
    const agent = new GeneralAgent({ agentId: "general-bybit-btc", scope: bybitScope, runtime });

    const { recommendation } = await agent.runCycle({
      regime: "trending",
      market: { bid: 99.5, ask: 100.5, mid: 100, liquidityUsd: 50_000 },
    });
    expect(recommendation.signal).toBeTruthy();
    expect(recommendation.scopeId).toBe(scopeIdOf(bybitScope));
  });
});

// ── Deployment factory ─────────────────────────────────────────────────

describe("deployPerScopeGeneralAgents", () => {
  test("deploys one general agent per trading scope", () => {
    const configs = new Map<string, AgentConfig>([
      ["agent-market-regime", makeConfig("agent-market-regime")],
      ["agent-bull", makeConfig("agent-bull")],
      ["agent-bear", makeConfig("agent-bear")],
    ]);
    const observer = new ScopeObserverAdapter(configs);

    const deployments = deployPerScopeGeneralAgents({
      scopes: [bybitScope, dexScope],
      configs,
      subAgentIds: ["agent-market-regime", "agent-bull", "agent-bear"],
      buildAdapter: () => observer,
    });

    expect(deployments).toHaveLength(2);
    expect(deployments[0].scope).toEqual(bybitScope);
    expect(deployments[1].scope).toEqual(dexScope);
    expect(deployments[0].agent.scopeId).toBe("bybit:BTC/USDT");
    expect(deployments[1].agent.scopeId).toBe("pancakeswap-v4:0xpool:BNB/USDT");
    expect(deployments[0].registeredSubAgents).toEqual(
      ["agent-market-regime", "agent-bull", "agent-bear"],
    );
  });

  test("createScopeDeployment wires a runnable per-scope general agent", async () => {
    const configs = new Map<string, AgentConfig>([
      ["agent-market-regime", makeConfig("agent-market-regime")],
    ]);
    const observer = new ScopeObserverAdapter(configs);

    const { agent, runtime, registry } = createScopeDeployment({
      scope: dexScope,
      configs,
      subAgentIds: ["agent-market-regime"],
      buildAdapter: () => observer,
    });

    expect(runtime.getRegistry().size).toBe(1);
    expect(registry.get("agent-market-regime")).toBeDefined();
    expect(agent.scope.pool).toBe("0xpool");

    const { recommendation } = await agent.runCycle({
      regime: "volatile",
      market: { bid: 60, ask: 62, mid: 61, liquidityUsd: 5_000 },
    });
    expect(recommendation.scopeId).toBe("pancakeswap-v4:0xpool:BNB/USDT");
  });
});