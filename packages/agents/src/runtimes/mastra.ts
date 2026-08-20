/**
 * Mastra runtime adapter: bridges the Mastra framework with the
 * deterministic core through the AgentAdapter contract.
 *
 * Mastra provides memory, evals, and debate workflows (Issue #26 spec).
 * This adapter wraps Mastra's agent execution and adapts the outputs
 * to the typed AgentOutput contract.
 *
 * The core never imports this module; it only consumes the AgentAdapter
 * interface (AC #4: "core never imports an LLM framework").
 */

import type {
  AgentInput,
  AgentOutput,
  AgentMessage,
} from "@agenttrading/contracts";
import {
  BaseAgentAdapter,
  type SchemaValidationResult,
} from "../adapter.ts";
import type { AgentConfig } from "../config.ts";

/**
 * Mastra adapter configuration.
 */
export interface MastraAdapterConfig {
  /** API key for the Mastra provider. */
  apiKey?: string;
  /** Default model to use if not overridden per agent. */
  defaultModel?: string;
  /** Base URL for the Mastra API. */
  baseUrl?: string;
  /** Whether to enable Mastra's built-in memory features. */
  enableMemory?: boolean;
  /** Whether to enable Mastra's built-in eval features. */
  enableEvals?: boolean;
}

/**
 * A function that invokes Mastra's agent execution.
 * Abstracted to avoid a hard dependency on the `mastra` package.
 */
export type MastraGenerateFn = (options: {
  agentId: string;
  model: string;
  messages: Array<{ role: string; content: string }>;
  tools?: Record<string, unknown>;
  maxSteps?: number;
}) => Promise<{
  text?: string;
  object?: Record<string, unknown>;
  toolCalls?: Array<{ toolName: string; result: unknown }>;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}>;

/**
 * MastraAIAdapter: implements AgentAdapter for the Mastra framework.
 *
 * Optimized for memory, evals, and debate workflows. Mastra's built-in
 * memory features are leveraged for per-agent conversation history,
 * and eval features are used for output quality assessment.
 *
 * Usage:
 * ```ts
 * const adapter = new MastraAIAdapter({
 *   generateFn: myMastraGenerate,
 *   configs: new Map([["debate-bull", bullConfig]]),
 * });
 * ```
 */
export class MastraAIAdapter extends BaseAgentAdapter {
  readonly adapterId = "mastra";
  readonly runtimeName = "mastra";

  private readonly generateFn: MastraGenerateFn;
  private readonly configs: ReadonlyMap<string, AgentConfig>;
  private readonly defaultModel: string;
  private readonly enableMemory: boolean;
  private readonly enableEvals: boolean;

  constructor(options: {
    generateFn: MastraGenerateFn;
    configs: ReadonlyMap<string, AgentConfig>;
    defaultModel?: string;
    enableMemory?: boolean;
    enableEvals?: boolean;
  }) {
    super();
    this.generateFn = options.generateFn;
    this.configs = options.configs;
    this.defaultModel = options.defaultModel ?? "gpt-4o";
    this.enableMemory = options.enableMemory ?? true;
    this.enableEvals = options.enableEvals ?? true;
  }

  /**
   * Run an agent using the Mastra framework.
   *
   * Leverages Mastra's memory and eval capabilities when enabled.
   * Builds the prompt from config, invokes Mastra's agent, and wraps
   * the result in a typed AgentOutput.
   */
  async run(input: AgentInput): Promise<AgentOutput> {
    const config = this.configs.get(input.agentId);
    if (!config) {
      return {
        kind: "error",
        agentId: input.agentId,
        errorCode: "CONFIG_NOT_FOUND",
        message: `No configuration found for agent: ${input.agentId}`,
        timestampMs: Date.now(),
        fallbackUsed: false,
      };
    }

    try {
      // Build messages
      const messages = this.buildMessages(input, config);

      const model = config.modelOverride ?? this.defaultModel;

      // Invoke Mastra's agent execution
      const result = await this.generateFn({
        agentId: input.agentId,
        model,
        messages,
        maxSteps: config.policy.retry.maxAttempts,
      });

      // Parse the output
      const outputPayload = result.object ?? this.parseTextOutput(result.text ?? "");

      // Register schema validator
      this.registerSchemaFromConfig(input.agentId, config);

      // If evals are enabled, assess the output quality
      const evalResult = this.enableEvals
        ? this.assessOutputQuality(outputPayload, config)
        : null;

      // If memory is enabled, the Mastra framework handles conversation
      // persistence internally; we don't need to manage it here.

      return {
        kind: "structured",
        agentId: input.agentId,
        payload: {
          ...outputPayload,
          ...(evalResult ? { _evalQuality: evalResult } : {}),
        },
        schemaName: config.outputSchemaName,
        timestampMs: Date.now(),
        auditTrail: [
          this.buildAuditEntry({
            agentId: input.agentId,
            action: "mastra:invoke",
            fallbackUsed: false,
            tokensConsumed: result.usage?.totalTokens,
            metadata: {
              toolCalls: result.toolCalls?.length ?? 0,
              evalQuality: evalResult,
            },
          }),
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        kind: "error",
        agentId: input.agentId,
        errorCode: "LLM_INVOCATION_FAILED",
        message: `Mastra invocation failed: ${message}`,
        timestampMs: Date.now(),
        fallbackUsed: false,
      };
    }
  }

  /**
   * Build messages for Mastra's agent execution.
   * Mastra supports structured messages with tool definitions.
   */
  private buildMessages(
    input: AgentInput,
    config: AgentConfig,
  ): Array<{ role: string; content: string }> {
    const messages: Array<{ role: string; content: string }> = [];

    if (config.systemPrompt) {
      messages.push({ role: "system", content: config.systemPrompt });
    }

    // Add conversation history (Mastra handles memory persistence)
    if (this.enableMemory && input.conversationHistory) {
      for (const msg of input.conversationHistory) {
        messages.push({ role: msg.role, content: msg.content });
      }
    }

    // Add current input
    messages.push({
      role: "user",
      content: JSON.stringify(input.payload),
    });

    return messages;
  }

  /**
   * Basic output quality assessment for evals.
   * Returns a quality score and issues detected.
   */
  private assessOutputQuality(
    output: Record<string, unknown>,
    config: AgentConfig,
  ): { score: number; issues: string[] } | null {
    const issues: string[] = [];
    let score = 1.0;

    // Check for empty output
    if (Object.keys(output).length === 0) {
      issues.push("Empty output payload");
      score -= 0.5;
    }

    // Check for common quality issues
    if ("error" in output) {
      issues.push("Output contains error field");
      score -= 0.3;
    }

    // Check if output matches expected schema structure
    const outputSchema = config.outputSchema;
    const properties = (outputSchema as Record<string, unknown>).properties as Record<string, unknown> | undefined;
    if (properties) {
      for (const key of Object.keys(properties)) {
        if (!(key in output)) {
          issues.push(`Missing expected field: ${key}`);
          score -= 0.1;
        }
      }
    }

    return {
      score: Math.max(0, score),
      issues,
    };
  }

  /**
   * Register a schema validator from the agent's output config.
   */
  private registerSchemaFromConfig(
    agentId: string,
    config: AgentConfig,
  ): void {
    this.registerSchema(agentId, (output) => {
      const schema = config.outputSchema;
      const required = (schema as Record<string, unknown>).required as string[] | undefined;
      const errors: string[] = [];

      if (required) {
        for (const key of required) {
          if (!(key in output)) {
            errors.push(`Missing required field: ${key}`);
          }
        }
      }

      return { valid: errors.length === 0, errors: errors.length > 0 ? errors : undefined };
    });
  }

  /**
   * Parse a text output into a structured payload.
   */
  private parseTextOutput(text: string): Record<string, unknown> {
    try {
      const parsed = JSON.parse(text);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        return parsed;
      }
      return { content: text };
    } catch {
      return { content: text };
    }
  }
}
