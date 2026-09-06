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
export {
  AuditConsultativeAdapter,
  MemoryConsultativeAdapter,
  PolicyConsultativeAdapter,
  ScopeObserverAdapter,
} from "./behavioral-runtimes.ts";

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

// ── General Agent per trading scope (ADR-0013) ─────────────────────────
export {
  GeneralAgent,
  DEFAULT_SCOPE_SUB_AGENTS,
  type GeneralAgentCycleInput,
  type GeneralAgentCycleResult,
  type GeneralAgentOptions,
} from "./general-agent.ts";
export {
  createScopeDeployment,
  deployPerScopeGeneralAgents,
  defaultGeneralAgentId,
  type ScopeDeployment,
  type ScopeDeploymentOptions,
  type DeployPerScopeOptions,
} from "./deployment.ts";

// LLM runtime adapters (Vercel AI SDK, OpenRouter) are available via
// subpath exports only (package.json exports map). They are NOT re-exported
// from the main barrel to preserve ARCHITECTURE.md boundary rules.

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
export type {
  TradingScope,
  TradingScopeKind,
  GeneralAgentRecommendation,
  GeneralAgentSignal,
} from "@agenttrading/contracts";
export {
  TRADING_SCOPE_KINDS,
  GENERAL_AGENT_SIGNALS,
  scopeIdOf,
  isTradingScope,
  parseTradingScope,
  isGeneralAgentRecommendation,
  parseGeneralAgentRecommendation,
} from "@agenttrading/contracts";
