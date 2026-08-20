/**
 * AgentConfig: per-agent configuration. Runtime per agent declared in
 * config (Issue #26 spec). Each agent declares its input/output schemas,
 * runtime preference, policies, and fallback behavior.
 */

import type {
  AgentRuntimePolicy,
  AgentFallback,
} from "@agenttrading/contracts";

/**
 * Supported LLM runtime types.
 * Runtime per agent declared in config (Issue #26 spec).
 */
export const RUNTIME_TYPES = ["vercel-ai-sdk", "mastra"] as const;

export type RuntimeType = (typeof RUNTIME_TYPES)[number];

/**
 * AgentConfig: complete configuration for a single agent.
 */
export interface AgentConfig {
  /** Unique agent identifier. */
  agentId: string;
  /** Human-readable agent name. */
  name: string;
  /** Agent description for documentation and audit. */
  description: string;
  /** Which layer of the agent architecture this agent belongs to. */
  layer:
    | "perception"
    | "analytical"
    | "deliberative"
    | "control"
    | "deterministic";
  /** The LLM runtime to use for this agent. */
  runtime: RuntimeType;
  /** Input schema: JSON Schema-compatible object describing expected input. */
  inputSchema: Record<string, unknown>;
  /** Output schema: JSON Schema-compatible object describing expected output. */
  outputSchema: Record<string, unknown>;
  /** Output schema name for observability and audit. */
  outputSchemaName: string;
  /** Runtime policy: budget, timeout, and retry. */
  policy: AgentRuntimePolicy;
  /** Deterministic fallback when the LLM fails (AC #3). */
  fallback: AgentFallback;
  /** Permissions this agent requires. */
  permissions: string[];
  /** System prompt for the agent (passed to the LLM runtime). */
  systemPrompt?: string;
  /** Whether this agent is mandatory for the review step. */
  mandatory: boolean;
  /** Optional model override (e.g., "gpt-4o", "claude-sonnet-4-20250514"). */
  modelOverride?: string;
}

/**
 * Create a default AgentConfig with sensible defaults.
 */
export function createDefaultAgentConfig(
  overrides: Partial<AgentConfig> & Pick<AgentConfig, "agentId" | "name">,
): AgentConfig {
  const { name: _name, agentId, ...rest } = overrides;
  return {
    agentId,
    name: _name,
    description: "",
    layer: "analytical",
    runtime: "vercel-ai-sdk",
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    outputSchemaName: "default",
    policy: {
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
    },
    fallback: {
      hasFallback: false,
      strategy: "reject",
    },
    permissions: ["OBSERVE_STATE"],
    mandatory: false,
    ...rest,
  };
}
