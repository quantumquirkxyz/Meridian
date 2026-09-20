/**
 * Vercel AI SDK runtime adapter: bridges the Vercel AI SDK with the
 * deterministic core through the AgentAdapter contract.
 *
 * This is the default runtime (Issue #26 spec). It wraps the Vercel AI
 * SDK's `generateText` / `generateObject` functions and adapts their
 * outputs to the typed AgentOutput contract.
 *
 * The core never imports this module; it only consumes the AgentAdapter
 * interface (AC #4: "core never imports an LLM framework").
 */

import type {
  AgentInput,
  AgentOutput,
} from "@agenttrading/contracts";
import {
  BaseAgentAdapter,
} from "@agenttrading/agents-core";
import type { AgentConfig } from "@agenttrading/agents-core";

/**
 * Vercel AI SDK adapter configuration.
 */
export interface VercelAdapterConfig {
  /** API key for the LLM provider. */
  apiKey?: string;
  /** Default model to use if not overridden per agent. */
  defaultModel?: string;
  /** Base URL for API calls (for OpenRouter, self-hosted, or proxy setups). */
  baseUrl?: string;
}

/**
 * A function that invokes the Vercel AI SDK's generateText/generateObject.
 * Abstracted to avoid a hard dependency on the `ai` package at the
 * type level — the concrete import is deferred to the adapter's
 * implementation method.
 */
export type VercelGenerateFn = (options: {
  model: string;
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  maxTokens?: number;
  baseUrl?: string;
}) => Promise<{
  text?: string;
  object?: Record<string, unknown>;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}>;

/**
 * VercelAISDKAdapter: implements AgentAdapter for the Vercel AI SDK.
 *
 * Usage:
 * ```ts
 * const adapter = new VercelAISDKAdapter({
 *   generateFn: myGenerateFunction,
 *   configs: new Map([["alpha-scan", alphaConfig]]),
 * });
 * ```
 */
export class VercelAISDKAdapter extends BaseAgentAdapter {
  readonly adapterId = "vercel-ai-sdk";
  readonly runtimeName = "vercel-ai-sdk";

  private readonly generateFn: VercelGenerateFn;
  private readonly configs: ReadonlyMap<string, AgentConfig>;
  private readonly defaultModel: string;
  private readonly baseUrl?: string;

  constructor(options: {
    generateFn: VercelGenerateFn;
    configs: ReadonlyMap<string, AgentConfig>;
    defaultModel?: string;
    baseUrl?: string;
  }) {
    super();
    this.generateFn = options.generateFn;
    this.configs = options.configs;
    this.defaultModel = options.defaultModel ?? "gpt-4o-mini";
    this.baseUrl = options.baseUrl;
  }

  /**
   * Run an agent using the Vercel AI SDK.
   *
   * Builds the prompt from the agent's config and input, invokes the
   * generate function, and wraps the result in a typed AgentOutput.
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
      // Build messages from system prompt + conversation history + current input
      const messages: Array<{ role: string; content: string }> = [];

      if (config.systemPrompt) {
        messages.push({ role: "system", content: config.systemPrompt });
      }

      // Add conversation history
      if (input.conversationHistory) {
        for (const msg of input.conversationHistory) {
          messages.push({ role: msg.role, content: msg.content });
        }
      }

      // Add current input as user message
      messages.push({
        role: "user",
        content: JSON.stringify(input.payload),
      });

      const model = config.modelOverride ?? this.defaultModel;
      const maxTokens = input.tokenBudget?.maxOutputTokens ?? config.policy.tokenBudget.maxOutputTokens;

      const generateOptions: Parameters<VercelGenerateFn>[0] = {
        model,
        messages,
        maxTokens,
      };

      // Pass baseUrl to generateFn so it can route to OpenRouter or any custom endpoint
      if (this.baseUrl) {
        (generateOptions as Record<string, unknown>).baseUrl = this.baseUrl;
      }

      const result = await this.generateFn(generateOptions);

      // Parse the output
      const outputPayload = result.object ?? this.parseTextOutput(result.text ?? "");

      // Register the output schema validator for this agent
      this.registerSchemaFromConfig(input.agentId, config);

      // Validate against schema
      const validation = this.validateOutput(
        input.agentId,
        outputPayload,
        config.outputSchemaName,
      );

      if (!validation.valid) {
        // Return structured output with validation warning; the runtime
        // will handle fallback if needed.
        return {
          kind: "structured",
          agentId: input.agentId,
          payload: outputPayload,
          schemaName: config.outputSchemaName,
          timestampMs: Date.now(),
          auditTrail: [
            this.buildAuditEntry({
              agentId: input.agentId,
              action: "schema-validation-warning",
              fallbackUsed: false,
              tokensConsumed: result.usage?.totalTokens,
            }),
          ],
        };
      }

      return {
        kind: "structured",
        agentId: input.agentId,
        payload: outputPayload,
        schemaName: config.outputSchemaName,
        timestampMs: Date.now(),
        auditTrail: [
          this.buildAuditEntry({
            agentId: input.agentId,
            action: "llm:invoke",
            fallbackUsed: false,
            tokensConsumed: result.usage?.totalTokens,
          }),
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        kind: "error",
        agentId: input.agentId,
        errorCode: "LLM_INVOCATION_FAILED",
        message: `Vercel AI SDK invocation failed: ${message}`,
        timestampMs: Date.now(),
        fallbackUsed: false,
      };
    }
  }

  /**
   * Register a schema validator from the agent's output config.
   * Uses a basic structural check against the output schema shape.
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
   * Attempts JSON parsing first; falls back to wrapping in { content: text }.
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
