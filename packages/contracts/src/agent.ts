import {
  isArrayOf,
  isBoolean,
  isEnumOf,
  isFreeformRecord,
  isNumber,
  isObjectOf,
  isOptional,
  isString,
  isOneOf,
  parse,
  type Validator,
} from "./schema.ts";

/**
 * Agent adapter contracts (Beta.2, Issue #26).
 *
 * The AgentAdapter is the typed contract that isolates the deterministic
 * core from LLM frameworks (Vercel AI SDK, Mastra). The StateGraph only
 * consumes typed, validated outputs; no free-text output can trigger
 * execution.
 *
 * All types here live in the dependency-free contracts package. Runtime
 * adapter implementations live in `packages/agents`.
 */

// ── Output Kind (discriminated union) ──────────────────────────────────

/**
 * Output kind: the structural category of an agent's response.
 * Used to discriminate between validated structured output, free-form
 * explanation (non-executable), and errors. This is the key mechanism
 * that prevents free-text output from triggering execution (AC #2).
 */
export const OUTPUT_KINDS = [
  "structured",
  "explanation",
  "error",
] as const;

export type OutputKind = (typeof OUTPUT_KINDS)[number];

// ── Agent Input ────────────────────────────────────────────────────────

/**
 * AgentInput: the typed contract for agent invocation.
 *
 * Every agent receives a typed input payload plus context. The payload
 * conforms to the agent's declared input schema (AC #1: "Every agent
 * exposes run(input) → typed output validated against its schema").
 */
export interface AgentInput {
  /** Unique agent identifier. */
  agentId: string;
  /** Typed input payload; conforms to the agent's input schema. */
  payload: Record<string, unknown>;
  /** Permissions available to the agent for this invocation. */
  permissions: string[];
  /** Optional conversation history for agents with memory. */
  conversationHistory?: readonly AgentMessage[];
  /** Timestamp of this invocation (Unix ms). */
  timestampMs: number;
  /** Optional token budget for this invocation. */
  tokenBudget?: AgentTokenBudget;
  /** Optional timeout in milliseconds for this invocation. */
  timeoutMs?: number;
}

/**
 * AgentMessage: a single message in an agent's conversation history.
 * Used by per-agent memory (AC #2: deterministic fallback and memory).
 */
export interface AgentMessage {
  /** Role of the message sender. */
  role: "system" | "user" | "assistant";
  /** Message content. */
  content: string;
  /** Optional timestamp. */
  timestampMs?: number;
}

// ── Agent Output ───────────────────────────────────────────────────────

/**
 * AgentOutput: the typed contract for agent responses.
 *
 * A discriminated union on `kind`:
 * - `structured`: validated against the agent's output schema; may be
 *   consumed by downstream deterministic components.
 * - `explanation`: free-form text; explicitly flagged as non-executable.
 *   No structured output can be inferred from it (AC #2).
 * - `error`: agent failed to produce a valid output.
 */
export interface StructuredAgentOutput {
  kind: "structured";
  agentId: string;
  /** Typed output payload; conforms to the agent's output schema. */
  payload: Record<string, unknown>;
  /** Schema name this output conforms to, for observability. */
  schemaName: string;
  timestampMs: number;
  /** Optional audit trail for this output. */
  auditTrail?: AgentAuditEntry[];
}

export interface ExplanationAgentOutput {
  kind: "explanation";
  agentId: string;
  /** Free-form explanation text. Non-executable by design. */
  content: string;
  timestampMs: number;
  /** Optional structured data that accompanied the explanation. */
  accompanyingData?: Record<string, unknown>;
}

export interface ErrorAgentOutput {
  kind: "error";
  agentId: string;
  /** Error code for programmatic handling. */
  errorCode: string;
  /** Human-readable error message. */
  message: string;
  timestampMs: number;
  /** Whether the deterministic fallback was used. */
  fallbackUsed: boolean;
}

export type AgentOutput =
  | StructuredAgentOutput
  | ExplanationAgentOutput
  | ErrorAgentOutput;

// ── Budget / Policy Types ──────────────────────────────────────────────

/**
 * AgentTokenBudget: token and cost budget for an agent invocation.
 * Enforced by the runtime; core never imports an LLM framework (AC #4).
 */
export interface AgentTokenBudget {
  /** Maximum input tokens allowed. */
  maxInputTokens: number;
  /** Maximum output tokens allowed. */
  maxOutputTokens: number;
  /** Maximum cost in USD for this invocation. */
  maxCostUsd: number;
}

/**
 * AgentRuntimePolicy: budget, timeout, and retry enforcement.
 * The runtime enforces these policies; the core only specifies them
 * in the agent config (AC #4: "Budget, timeout, and retry policies
 * are enforced; core never imports an LLM framework").
 */
export interface AgentRuntimePolicy {
  /** Token/cost budget per invocation. */
  tokenBudget: AgentTokenBudget;
  /** Maximum time an agent invocation may take (ms). */
  timeoutMs: number;
  /** Retry policy when the LLM call fails. */
  retry: AgentRetryPolicy;
}

/**
 * AgentRetryPolicy: retry behavior on LLM failure.
 */
export interface AgentRetryPolicy {
  /** Maximum number of retry attempts. */
  maxAttempts: number;
  /** Base delay between retries (ms). Exponential backoff applied. */
  baseDelayMs: number;
  /** Maximum delay between retries (ms), capping exponential backoff. */
  maxDelayMs: number;
}

/**
 * AgentFallback: deterministic fallback when the LLM fails.
 * AC #3: "Deterministic fallback works per agent when the LLM fails".
 */
export interface AgentFallback {
  /** Whether this agent has a deterministic fallback. */
  hasFallback: boolean;
  /**
   * Fallback strategy: "hardcoded" returns a static value,
   * "passthrough" returns the input unchanged, "reject" returns an error.
   */
  strategy: "hardcoded" | "passthrough" | "reject";
  /** The hardcoded fallback value (when strategy is "hardcoded"). */
  hardcodedValue?: Record<string, unknown>;
}

// ── Audit ──────────────────────────────────────────────────────────────

/**
 * AgentAuditEntry: traceability record for an agent invocation.
 * Every agent action must be traceable (CONTEXT.md §16).
 */
export interface AgentAuditEntry {
  /** Unique identifier for this audit entry. */
  eventId: string;
  /** Timestamp (Unix ms). */
  timestampMs: number;
  /** The agent that produced this entry. */
  agentId: string;
  /** Action taken by the agent. */
  action: string;
  /** Whether the fallback was used. */
  fallbackUsed: boolean;
  /** Optional: tokens consumed in this step. */
  tokensConsumed?: number;
  /** Optional: cost incurred in this step. */
  costUsd?: number;
  /** Additional context. */
  metadata?: Record<string, unknown>;
}

// ── Runtime Status ─────────────────────────────────────────────────────

export const AGENT_STATUS = [
  "pending",
  "running",
  "completed",
  "failed",
  "timeout",
  "budget_exceeded",
  "fallback_used",
] as const;

export type AgentStatus = (typeof AGENT_STATUS)[number];

/**
 * AgentRunResult: the result of a single agent run, including the output,
 * status, and budget consumption.
 */
export interface AgentRunResult {
  /** The agent's output. */
  output: AgentOutput;
  /** Final status of the run. */
  status: AgentStatus;
  /** Actual tokens consumed (input + output). */
  tokensConsumed: number;
  /** Actual cost in USD. */
  costUsd: number;
  /** Duration of the run (ms). */
  durationMs: number;
  /** Number of retries attempted. */
  retriesAttempted: number;
  /** Whether deterministic fallback was used. */
  fallbackUsed: boolean;
}

// ── Validators ─────────────────────────────────────────────────────────

const isAgentMessage: Validator<AgentMessage> = isObjectOf({
  role: isEnumOf(["system", "user", "assistant"] as const),
  content: isString,
  timestampMs: isOptional(isNumber),
});

const isAgentTokenBudget: Validator<AgentTokenBudget> = isObjectOf({
  maxInputTokens: isNumber,
  maxOutputTokens: isNumber,
  maxCostUsd: isNumber,
});

export const isAgentInput: Validator<AgentInput> = isObjectOf({
  agentId: isString,
  payload: isFreeformRecord,
  permissions: isArrayOf(isString),
  conversationHistory: isOptional(isArrayOf(isAgentMessage)),
  timestampMs: isNumber,
  tokenBudget: isOptional(isAgentTokenBudget),
  timeoutMs: isOptional(isNumber),
});

const isStructuredAgentOutput: Validator<StructuredAgentOutput> = isObjectOf({
  kind: isEnumOf(["structured"] as const),
  agentId: isString,
  payload: isFreeformRecord,
  schemaName: isString,
  timestampMs: isNumber,
});

const isExplanationAgentOutput: Validator<ExplanationAgentOutput> = isObjectOf({
  kind: isEnumOf(["explanation"] as const),
  agentId: isString,
  content: isString,
  timestampMs: isNumber,
  accompanyingData: isOptional(isFreeformRecord),
});

const isErrorAgentOutput: Validator<ErrorAgentOutput> = isObjectOf({
  kind: isEnumOf(["error"] as const),
  agentId: isString,
  errorCode: isString,
  message: isString,
  timestampMs: isNumber,
  fallbackUsed: isBoolean,
});

export const isAgentOutput: Validator<AgentOutput> = isOneOf<AgentOutput>([
  isStructuredAgentOutput,
  isExplanationAgentOutput,
  isErrorAgentOutput,
]);

const isAgentRetryPolicy: Validator<AgentRetryPolicy> = isObjectOf({
  maxAttempts: isNumber,
  baseDelayMs: isNumber,
  maxDelayMs: isNumber,
});

export const isAgentRuntimePolicy: Validator<AgentRuntimePolicy> = isObjectOf({
  tokenBudget: isAgentTokenBudget,
  timeoutMs: isNumber,
  retry: isAgentRetryPolicy,
});

export const isAgentFallback: Validator<AgentFallback> = isObjectOf({
  hasFallback: isBoolean,
  strategy: isEnumOf(["hardcoded", "passthrough", "reject"] as const),
  hardcodedValue: isOptional(isFreeformRecord),
});

const isAgentAuditEntry: Validator<AgentAuditEntry> = isObjectOf({
  eventId: isString,
  timestampMs: isNumber,
  agentId: isString,
  action: isString,
  fallbackUsed: isBoolean,
  tokensConsumed: isOptional(isNumber),
  costUsd: isOptional(isNumber),
  metadata: isOptional(isFreeformRecord),
});

export { isAgentAuditEntry };

export const isAgentStatus: Validator<AgentStatus> = isEnumOf(AGENT_STATUS);

export const isAgentRunResult: Validator<AgentRunResult> = isObjectOf({
  output: isAgentOutput,
  status: isAgentStatus,
  tokensConsumed: isNumber,
  costUsd: isNumber,
  durationMs: isNumber,
  retriesAttempted: isNumber,
  fallbackUsed: isBoolean,
});

// ── Parse helpers ──────────────────────────────────────────────────────

export function parseAgentInput(value: unknown): AgentInput {
  return parse(isAgentInput, value, "AgentInput");
}

export function parseAgentOutput(value: unknown): AgentOutput {
  return parse(isAgentOutput, value, "AgentOutput");
}

export function parseAgentRunResult(value: unknown): AgentRunResult {
  return parse(isAgentRunResult, value, "AgentRunResult");
}
