/**
 * OpenRouter adapter factory: creates a generateFn compatible with
 * VercelAISDKAdapter that routes through OpenRouter.
 *
 * This module does NOT import the `ai` package directly — the concrete
 * generateText call is injected by the caller (CLI). This keeps the
 * agents package free of LLM framework dependencies (ARCHITECTURE.md).
 *
 * Usage (in CLI):
 * ```ts
 * import { generateText } from "ai";
 * import { createOpenAI } from "@ai-sdk/openai";
 * import { VercelAISDKAdapter } from "@agenttrading/agents";
 * import { createOpenRouterGenerateFn } from "@agenttrading/agents/runtimes/openrouter";
 *
 * const openrouter = createOpenAI({ apiKey, baseURL: "https://openrouter.ai/api/v1" });
 * const generateFn = createOpenRouterGenerateFn({ generateText: generateText as any, openrouter });
 * const adapter = new VercelAISDKAdapter({ generateFn, configs });
 * ```
 */

/**
 * OpenRouter adapter configuration.
 */
export interface OpenRouterAdapterConfig {
  /**
   * The generateText function from the `ai` package.
   * Typed as `(...args: any[]) => any` to avoid a hard dependency on the
   * `ai` package's type definitions at the type level.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  generateText: (...args: any[]) => Promise<any>;
  /** The OpenAI-compatible provider instance (from @ai-sdk/openai). */
  openrouter: (model: string) => unknown;
}

/**
 * Create a generate function compatible with VercelAISDKAdapter
 * that routes through OpenRouter.
 *
 * @param config - The generateText function and OpenRouter provider.
 * @returns A generateFn compatible with VercelAISDKAdapter.
 */
export function createOpenRouterGenerateFn(
  config: OpenRouterAdapterConfig,
): (options: {
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
}> {
  return async (options) => {
    const result = await config.generateText({
      model: config.openrouter(options.model),
      messages: options.messages,
      temperature: options.temperature,
    });

    // Try to parse the response as JSON for structured output.
    let object: Record<string, unknown> | undefined;
    try {
      const parsed = JSON.parse(result.text);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        object = parsed;
      }
    } catch {
      // Not JSON — return as text.
    }

    const usage = result.usage ?? { inputTokens: 0, outputTokens: 0 };
    return {
      text: result.text,
      object,
      usage: {
        promptTokens: usage.inputTokens ?? 0,
        completionTokens: usage.outputTokens ?? 0,
        totalTokens: (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0),
      },
    };
  };
}
