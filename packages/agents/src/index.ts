/**
 * @agenttrading/agents — Agent adapter, registry, runtime orchestration,
 * and LLM runtime implementations (Vercel AI SDK, Mastra).
 *
 * ARCHITECTURE.md boundary: agents never imports core; agents depends
 * only on contracts. LLM framework imports are deferred to the runtime
 * adapter implementations (./runtimes/*).
 *
 * The core never imports this package; it only consumes the typed
 * contracts from @agenttrading/contracts and the AgentAdapter interface.
 */

/** Package version for smoke tests. */
export const AGENTS_VERSION = "0.1.0";

// ── Core Adapter ───────────────────────────────────────────────────────
export {
  BaseAgentAdapter,
  type AgentAdapter,
  type SchemaValidationResult,
} from "./adapter.ts";

// ── Config ─────────────────────────────────────────────────────────────
export {
  RUNTIME_TYPES,
  createDefaultAgentConfig,
  type AgentConfig,
  type RuntimeType,
} from "./config.ts";

// ── Registry ───────────────────────────────────────────────────────────
export { AgentRegistry, type AgentRegistration } from "./registry.ts";
export {
  CONSULTATIVE_AGENT_CATALOG,
  CONSULTATIVE_AGENT_CONFIGS,
  CONSULTATIVE_AGENT_IDS,
  getConsultativeAgentConfig,
  type ConsultativeAgentDefinition,
} from "./catalog.ts";

// ── Memory ─────────────────────────────────────────────────────────────
export { AgentMemory, type MemorySnapshot } from "./memory.ts";

// ── Logger ─────────────────────────────────────────────────────────────
export {
  LOG_LEVELS,
  AgentLogger,
  type AgentLogEntry,
  type LogLevel,
} from "./logger.ts";

// ── Budget ─────────────────────────────────────────────────────────────
export {
  BudgetEnforcer,
  type BudgetConsumption,
  type RetryState,
} from "./budget.ts";

// ── Runtime ────────────────────────────────────────────────────────────
export {
  AgentRuntime,
  type AgentRuntimeOptions,
} from "./runtime.ts";

// ── Re-export contracts for convenience ────────────────────────────────
export type {
  AgentInput,
  AgentOutput,
  AgentRunResult,
  AgentStatus,
  AgentMessage,
  AgentTokenBudget,
  AgentRuntimePolicy,
  AgentRetryPolicy,
  AgentFallback,
  AgentAuditEntry,
  StructuredAgentOutput,
  ExplanationAgentOutput,
  ErrorAgentOutput,
  OutputKind,
} from "@agenttrading/contracts";
