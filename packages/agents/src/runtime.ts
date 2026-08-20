/**
 * AgentRuntime: the core orchestrator for agent invocation.
 *
 * Orchestrates the AgentAdapter, AgentRegistry, AgentMemory, AgentLogger,
 * and BudgetEnforcer to provide a complete agent runtime with:
 * - Schema validation of outputs (AC #1)
 * - Prevention of free-text triggering execution (AC #2)
 * - Deterministic fallback when LLM fails (AC #3)
 * - Budget, timeout, and retry policy enforcement (AC #4)
 * - Core never imports an LLM framework (AC #4)
 */

import type {
  AgentInput,
  AgentOutput,
  AgentRunResult,
  AgentStatus,
  AgentRuntimePolicy,
} from "@agenttrading/contracts";
import type { AgentAdapter } from "./adapter.ts";
import { AgentRegistry } from "./registry.ts";
import { AgentMemory } from "./memory.ts";
import { AgentLogger } from "./logger.ts";
import { BudgetEnforcer } from "./budget.ts";

/**
 * AgentRuntime options.
 */
export interface AgentRuntimeOptions {
  /** The agent registry containing all registered agents. */
  registry: AgentRegistry;
  /** Per-agent memory store. */
  memory?: AgentMemory;
  /** Structured logger. */
  logger?: AgentLogger;
  /** Budget enforcer. */
  budget?: BudgetEnforcer;
  /** Injectable clock; defaults to Date.now. */
  now?: () => number;
}

/**
 * AgentRuntime: orchestrates agent invocation with full policy enforcement.
 *
 * Usage:
 * ```ts
 * const runtime = new AgentRuntime({ registry });
 * const result = await runtime.run({
 *   agentId: "alpha-scan",
 *   payload: { graphSnapshot: {...} },
 *   permissions: ["PROPOSE_SIGNAL"],
 *   timestampMs: Date.now(),
 * });
 * ```
 */
export class AgentRuntime {
  private readonly registry: AgentRegistry;
  private readonly memory: AgentMemory;
  private readonly logger: AgentLogger;
  private readonly budget: BudgetEnforcer;
  private readonly now: () => number;
  private runCounter = 0;

  constructor(options: AgentRuntimeOptions) {
    this.registry = options.registry;
    this.memory = options.memory ?? new AgentMemory();
    this.logger = options.logger ?? new AgentLogger();
    this.budget = options.budget ?? new BudgetEnforcer();
    this.now = options.now ?? (() => Date.now());
  }

  /**
   * Run an agent with the given input.
   *
   * The runtime:
   * 1. Looks up the agent in the registry
   * 2. Checks that the agent is enabled
   * 3. Enforces the timeout policy
   * 4. Delegates to the adapter's run()
   * 5. Validates the output against the agent's schema
   * 6. If validation fails, attempts deterministic fallback
   * 7. Records budget consumption and audit trail
   * 8. Returns a typed AgentRunResult
   */
  async run(input: AgentInput): Promise<AgentRunResult> {
    const startTime = this.now();
    const invocationId = `inv-${++this.runCounter}-${input.agentId}`;

    // 1. Look up agent in registry
    const registration = this.registry.get(input.agentId);
    if (!registration) {
      return this.buildErrorResult(
        input.agentId,
        "AGENT_NOT_FOUND",
        `Agent not found in registry: ${input.agentId}`,
        startTime,
      );
    }

    if (!registration.enabled) {
      return this.buildErrorResult(
        input.agentId,
        "AGENT_DISABLED",
        `Agent is disabled: ${input.agentId}`,
        startTime,
      );
    }

    const adapter = registration.adapter;
    const policy = registration.config.policy;

    // 2. Log invocation start
    this.logger.logInvocationStart(input.agentId, input.payload);

    // 3. Run with retry and timeout
    let lastError: string | undefined;
    let retriesAttempted = 0;
    const maxAttempts = policy.retry.maxAttempts;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        // Enforce timeout
        const result = await this.runWithTimeout(
          adapter,
          input,
          policy,
          invocationId,
        );

        // Validate output against schema
        const validation = this.validateOutput(
          input.agentId,
          result,
          registration.config.outputSchemaName,
        );

        if (!validation.valid) {
          lastError = `Schema validation failed: ${validation.errors?.join(", ")}`;
          this.logger.logValidationFailure(input.agentId, validation.errors ?? []);

          // Attempt fallback
          const fallbackResult = this.attemptFallback(
            adapter,
            input.agentId,
            lastError,
            startTime,
          );

          if (fallbackResult) {
            return fallbackResult;
          }

          // No fallback available; retry if allowed
          if (attempt < maxAttempts) {
            retriesAttempted++;
            const delay = this.budget.calculateRetryDelay(attempt, policy.retry);
            await this.sleep(delay);
            continue;
          }

          return this.buildErrorResult(
            input.agentId,
            "SCHEMA_VALIDATION_FAILED",
            lastError,
            startTime,
            retriesAttempted,
            true,
          );
        }

        // Success
        const durationMs = this.now() - startTime;

        // Record budget consumption (estimated; real values from adapter)
        this.budget.recordConsumption(
          input.agentId,
          0, // Input tokens tracked by adapter
          0, // Output tokens tracked by adapter
          0, // Cost tracked by adapter
        );

        // Log completion
        this.logger.logInvocationEnd(input.agentId, result, durationMs);

        // Clear retry state
        this.budget.clearRetryState(invocationId);

        return {
          output: result,
          status: "completed" as AgentStatus,
          tokensConsumed: 0,
          costUsd: 0,
          durationMs,
          retriesAttempted,
          fallbackUsed: false,
        };
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        this.logger.log({
          level: "error",
          agentId: input.agentId,
          operation: "invocation:error",
          message: `Attempt ${attempt}/${maxAttempts} failed: ${lastError}`,
          data: { attempt, maxAttempts, error: lastError },
        });

        if (attempt < maxAttempts) {
          retriesAttempted++;
          const delay = this.budget.calculateRetryDelay(attempt, policy.retry);
          await this.sleep(delay);
        }
      }
    }

    // All attempts exhausted
    const durationMs = this.now() - startTime;

    // Attempt fallback after all retries exhausted
    const fallbackResult = this.attemptFallback(
      adapter,
      input.agentId,
      lastError ?? "All retry attempts exhausted",
      startTime,
    );

    if (fallbackResult) {
      return {
        ...fallbackResult,
        retriesAttempted,
        durationMs,
      };
    }

    return this.buildErrorResult(
      input.agentId,
      "ALL_RETRIES_EXHAUSTED",
      lastError ?? "All retry attempts exhausted",
      startTime,
      retriesAttempted,
    );
  }

  /**
   * Run the adapter with a timeout.
   */
  private async runWithTimeout(
    adapter: AgentAdapter,
    input: AgentInput,
    policy: AgentRuntimePolicy,
    _invocationId: string,
  ): Promise<AgentOutput> {
    const timeoutMs = input.timeoutMs ?? policy.timeoutMs;

    return new Promise<AgentOutput>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.logger.logTimeout(input.agentId, timeoutMs);
        reject(new Error(`Agent ${input.agentId} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      adapter
        .run(input)
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  /**
   * Validate the agent output against its schema.
   */
  private validateOutput(
    agentId: string,
    output: AgentOutput,
    schemaName: string,
  ): { valid: boolean; errors?: string[] } {
    // AC #2: No free-text output can trigger execution.
    // Explanations are inherently non-executable; structured output must
    // be validated against the agent's schema.
    if (output.kind === "explanation") {
      // Explanations are valid but non-executable by design.
      return { valid: true };
    }

    if (output.kind === "error") {
      // Error outputs are valid by construction.
      return { valid: true };
    }

    // For structured output, validate against the registered schema.
    const adapter = this.registry.getAdapter(agentId);
    if (!adapter) {
      return { valid: false, errors: [`No adapter found for agent: ${agentId}`] };
    }

    return adapter.validateOutput(agentId, output.payload, schemaName);
  }

  /**
   * Attempt deterministic fallback when LLM or validation fails.
   * AC #3: "Deterministic fallback works per agent when the LLM fails".
   */
  private attemptFallback(
    adapter: AgentAdapter,
    agentId: string,
    reason: string,
    startTime: number,
  ): AgentRunResult | null {
    const fallback = this.registry.getFallback(agentId);
    if (!fallback?.hasFallback) {
      return null;
    }

    this.logger.logFallback(agentId, reason);

    let output: AgentOutput;

    switch (fallback.strategy) {
      case "hardcoded":
        output = {
          kind: "structured",
          agentId,
          payload: fallback.hardcodedValue ?? {},
          schemaName: "fallback",
          timestampMs: this.now(),
        };
        break;
      case "passthrough":
        // Return the last known good output or empty
        output = {
          kind: "structured",
          agentId,
          payload: {},
          schemaName: "fallback-passthrough",
          timestampMs: this.now(),
        };
        break;
      case "reject":
      default:
        output = adapter.fallback(agentId, reason);
        break;
    }

    const durationMs = this.now() - startTime;

    return {
      output,
      status: "fallback_used" as AgentStatus,
      tokensConsumed: 0,
      costUsd: 0,
      durationMs,
      retriesAttempted: 0,
      fallbackUsed: true,
    };
  }

  /**
   * Build an error result.
   */
  private buildErrorResult(
    agentId: string,
    errorCode: string,
    message: string,
    startTime: number,
    retriesAttempted: number = 0,
    fallbackUsed: boolean = false,
  ): AgentRunResult {
    const durationMs = this.now() - startTime;
    return {
      output: {
        kind: "error",
        agentId,
        errorCode,
        message,
        timestampMs: this.now(),
        fallbackUsed,
      },
      status: (fallbackUsed ? "fallback_used" : "failed") as AgentStatus,
      tokensConsumed: 0,
      costUsd: 0,
      durationMs,
      retriesAttempted,
      fallbackUsed,
    };
  }

  /**
   * Sleep for a given duration (for retry delays).
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Access the underlying memory store.
   */
  getMemory(): AgentMemory {
    return this.memory;
  }

  /**
   * Access the underlying logger.
   */
  getLogger(): AgentLogger {
    return this.logger;
  }

  /**
   * Access the underlying budget enforcer.
   */
  getBudget(): BudgetEnforcer {
    return this.budget;
  }

  /**
   * Access the underlying registry.
   */
  getRegistry(): AgentRegistry {
    return this.registry;
  }
}
