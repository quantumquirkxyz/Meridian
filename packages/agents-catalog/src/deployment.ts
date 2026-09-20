/**
 * Scope deployment factory (ADR-0013).
 *
 * Deploys one general agent per trading scope, each bound to the shared
 * catalog sub-agents via a per-scope AgentRuntime. The factory keeps the
 * cognitive layer per-scope while sub-agent roles stay catalog-defined.
 */

import type { TradingScope } from "@agenttrading/contracts";
import { scopeIdOf } from "@agenttrading/contracts";
import type { AgentAdapter } from "@agenttrading/agents-core";
import type { AgentConfig } from "@agenttrading/agents-core";
import { AgentRegistry } from "@agenttrading/agents-core";
import { AgentRuntime } from "@agenttrading/agents-core";
import { GeneralAgent, type GeneralAgentOptions } from "@agenttrading/agents-general";

// ── Types ────────────────────────────────────────────────────────────

export interface ScopeDeploymentOptions {
  /** The trading scope this deployment owns. */
  scope: TradingScope;
  /** Optional explicit agent ID; defaults to scopeIdOf(scope). */
  agentId?: string;
  /** Catalog sub-agent IDs this general agent consults. */
  subAgentIds?: string[];
  /** Catalog agent configs used to configure the per-scope registry. */
  configs: Map<string, AgentConfig>;
  /**
   * Build the concrete AgentAdapter for a catalog agent config.
   * The adapter determines the runtime (behavioral, LLM, etc.).
   */
  buildAdapter: (agentId: string, config: AgentConfig) => AgentAdapter;
  /** Injectable clock; defaults to Date.now. */
  now?: () => number;
}

export interface ScopeDeployment {
  /** The deployed general agent for this scope. */
  agent: GeneralAgent;
  /** The scope the deployment owns. */
  scope: TradingScope;
  /** The per-scope runtime used by this deployment's general agent. */
  runtime: AgentRuntime;
  /** The per-scope registry holding this scope's sub-agents. */
  registry: AgentRegistry;
  /** Sub-agent IDs that were registered (available) for this scope. */
  registeredSubAgents: string[];
}

// ── Default general agent naming ─────────────────────────────────────

/**
 * Default general agent ID for a trading scope.
 * Stable across reloads — derivation is symmetric with scopeIdOf().
 */
export function defaultGeneralAgentId(scope: TradingScope): string {
  const scopeId = scopeIdOf(scope).replace(/[^A-Za-z0-9._-]/g, "-");
  return `general-scope-${scopeId}`;
}

// ── Factory ──────────────────────────────────────────────────────────

/**
 * Build a single per-scope deployment.
 *
 * A fresh AgentRegistry + AgentRuntime is created per scope so budgets,
 * memory, and lifecycle management are per-scope (ADR-0013); the catalog
 * sub-agents are registered into it via the provided adapter builder.
 */
export function createScopeDeployment(options: ScopeDeploymentOptions): ScopeDeployment {
  const agentId = options.agentId ?? defaultGeneralAgentId(options.scope);
  const registry = new AgentRegistry();

  const registeredSubAgents: string[] = [];
  const subAgentIds = options.subAgentIds ?? [];
  for (const catalogId of subAgentIds) {
    const config = options.configs.get(catalogId);
    if (!config) continue;
    const adapter = options.buildAdapter(catalogId, config);
    registry.register(config, adapter);
    registeredSubAgents.push(catalogId);
  }

  const runtime = new AgentRuntime({ registry, now: options.now });

  const agent = new GeneralAgent({
    agentId,
    scope: options.scope,
    runtime,
    subAgentIds: registeredSubAgents,
    now: options.now,
  });

  return { agent, scope: options.scope, runtime, registry, registeredSubAgents };
}

// ── Bulk deployment ──────────────────────────────────────────────────

export interface DeployPerScopeOptions {
  /** All trading scopes to deploy a general agent for. */
  scopes: readonly TradingScope[];
  /** Catalog agent configs used to configure each per-scope registry. */
  configs: Map<string, AgentConfig>;
  /** Catalog sub-agent IDs to register into every scope. */
  subAgentIds: string[];
  /** Build the concrete AgentAdapter for a catalog agent config. */
  buildAdapter: (agentId: string, config: AgentConfig) => AgentAdapter;
  /** Inject a single shared clock for all deployments. */
  now?: () => number;
}

/**
 * Deploy one general agent per trading scope (ADR-0013).
 * The shared catalog becomes the sub-agent library for every scope.
 */
export function deployPerScopeGeneralAgents(
  options: DeployPerScopeOptions,
): ScopeDeployment[] {
  return options.scopes.map((scope) =>
    createScopeDeployment({
      scope,
      configs: options.configs,
      subAgentIds: options.subAgentIds,
      buildAdapter: options.buildAdapter,
      now: options.now,
    }),
  );
}