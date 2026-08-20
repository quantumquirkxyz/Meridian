/**
 * AgentAdapter: the typed contract that isolates the deterministic core
 * from LLM frameworks (Vercel AI SDK, Mastra). The StateGraph only
 * consumes typed, validated outputs; no free-text output can trigger
 * execution (AC #2).
 *
 * Every agent exposes run(input) → typed output validated against its
 * schema (AC #1). The adapter ensures this contract is enforced at the
 * boundary between LLM and deterministic layers.
 */

import type {
  AgentInput,
  AgentOutput,
  AgentAuditEntry,
} from "@agenttrading/contracts";

/**
 * Validation result for schema checks.
 */
export interface SchemaValidationResult {
  valid: boolean;
  /** Errors if invalid. */
  errors?: string[];
}

/**
 * AgentAdapter: the core adapter interface.
 *
 * A runtime implements this interface to bridge an LLM framework with
 * the deterministic core. The adapter:
 * 1. Validates agent output against the declared schema (AC #1)
 * 2. Prevents free-text output from triggering execution (AC #2)
 * 3. Supports deterministic fallback when the LLM fails (AC #3)
 * 4. Operates within budget, timeout, and retry policies (AC #4)
 *
 * The core never imports an LLM framework; it only consumes the
 * AgentAdapter interface and the typed contracts from @agenttrading/contracts.
 */
export interface AgentAdapter {
  /** Unique identifier for this adapter. */
  readonly adapterId: string;

  /**
   * Human-readable name of the LLM runtime this adapter wraps.
   * Examples: "vercel-ai-sdk", "mastra".
   */
  readonly runtimeName: string;

  /**
   * Run an agent with the given input and produce a typed, validated output.
   *
   * The adapter must:
   * - Invoke the LLM (or its equivalent) with the agent's configuration
   * - Validate the output against the agent's output schema
   * - Return a structured output that the core can consume
   * - If validation fails and a fallback exists, use the fallback
   * - If validation fails and no fallback exists, return an error output
   *
   * The adapter enforces token budget and timeout internally. The core
   * specifies these in the AgentInput.
   */
  run(input: AgentInput): Promise<AgentOutput>;

  /**
   * Validate an agent's output against its declared schema.
   * Returns a validation result with errors if the output doesn't match.
   */
  validateOutput(
    agentId: string,
    output: Record<string, unknown>,
    schemaName: string,
  ): SchemaValidationResult;

  /**
   * Produce a deterministic fallback output for an agent.
   * Called when the LLM fails or the output fails validation.
   */
  fallback(agentId: string, reason: string): AgentOutput;

  /**
   * Build the audit entry for a completed run.
   */
  buildAuditEntry(params: {
    agentId: string;
    action: string;
    fallbackUsed: boolean;
    tokensConsumed?: number;
    costUsd?: number;
    metadata?: Record<string, unknown>;
  }): AgentAuditEntry;
}

/**
 * Base implementation of the AgentAdapter providing shared utilities.
 * Runtime-specific adapters extend this and implement `run()`.
 */
export abstract class BaseAgentAdapter implements AgentAdapter {
  abstract readonly adapterId: string;
  abstract readonly runtimeName: string;

  abstract run(input: AgentInput): Promise<AgentOutput>;

  /**
   * Default output schema registry. Runtime adapters register schemas
   * for each agent they manage. Returns a validator function or null
   * if no schema is registered for the agent.
   */
  private readonly schemaValidators = new Map<
    string,
    (output: Record<string, unknown>) => SchemaValidationResult
  >();

  /**
   * Register a schema validator for an agent.
   */
  registerSchema(
    agentId: string,
    validator: (output: Record<string, unknown>) => SchemaValidationResult,
  ): void {
    this.schemaValidators.set(agentId, validator);
  }

  /**
   * Validate output against registered schema.
   */
  validateOutput(
    agentId: string,
    output: Record<string, unknown>,
    _schemaName: string,
  ): SchemaValidationResult {
    const validator = this.schemaValidators.get(agentId);
    if (!validator) {
      // No schema registered: output is valid by default.
      // Schemas are optional per-agent; when absent, the output passes.
      return { valid: true };
    }
    return validator(output);
  }

  /**
   * Default fallback: returns an error output indicating fallback failure.
   * Subclasses should override to provide deterministic fallback values.
   */
  fallback(agentId: string, reason: string): AgentOutput {
    return {
      kind: "error",
      agentId,
      errorCode: "FALLBACK_TRIGGERED",
      message: `Deterministic fallback triggered: ${reason}`,
      timestampMs: Date.now(),
      fallbackUsed: true,
    };
  }

  /**
   * Build an audit entry for a completed agent run.
   */
  buildAuditEntry(params: {
    agentId: string;
    action: string;
    fallbackUsed: boolean;
    tokensConsumed?: number;
    costUsd?: number;
    metadata?: Record<string, unknown>;
  }): AgentAuditEntry {
    return {
      eventId: `agent-${params.agentId}-${Date.now()}`,
      timestampMs: Date.now(),
      agentId: params.agentId,
      action: params.action,
      fallbackUsed: params.fallbackUsed,
      tokensConsumed: params.tokensConsumed,
      costUsd: params.costUsd,
      metadata: params.metadata,
    };
  }
}
