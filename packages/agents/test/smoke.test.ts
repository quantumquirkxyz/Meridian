import { describe, expect, test } from "bun:test";
import { AGENTS_CORE_VERSION } from "@agenttrading/agents-core";
import {
  isAgentInput,
  isAgentOutput,
  isAgentRunResult,
  isAgentRuntimePolicy,
  isAgentFallback,
  type AgentInput,
  type AgentOutput,
} from "@agenttrading/contracts";
import { expectPackageSmoke } from "../../../test/smoke-helper.ts";

describe("@agenttrading/agents smoke", () => {
  test("package resolves and depends only on contracts", () => {
    expectPackageSmoke(AGENTS_CORE_VERSION, () => {
      // Verify agent contracts are accessible from contracts
      const input: AgentInput = {
        agentId: "smoke-test",
        payload: { test: true },
        permissions: ["OBSERVE_STATE"],
        timestampMs: 0,
      };
      expect(isAgentInput(input)).toBe(true);

      const output: AgentOutput = {
        kind: "structured",
        agentId: "smoke-test",
        payload: { result: "ok" },
        schemaName: "smoke",
        timestampMs: 0,
      };
      expect(isAgentOutput(output)).toBe(true);
    });
  });

  test("agents package re-exports agent contracts", () => {
    const {
      BaseAgentAdapter,
      AgentRegistry,
      AgentMemory,
      AgentLogger,
      BudgetEnforcer,
      AgentRuntime,
      createDefaultAgentConfig,
      RUNTIME_TYPES,
    } = require("../src/index.ts");

    expect(RUNTIME_TYPES).toEqual(["vercel-ai-sdk", "mastra"]);
    expect(typeof createDefaultAgentConfig).toBe("function");
    expect(typeof BaseAgentAdapter).toBe("function");
    expect(typeof AgentRegistry).toBe("function");
    expect(typeof AgentMemory).toBe("function");
    expect(typeof AgentLogger).toBe("function");
    expect(typeof BudgetEnforcer).toBe("function");
    expect(typeof AgentRuntime).toBe("function");
  });
});
