/**
 * AgentRegistry: manages agent registrations, configuration lookup,
 * and adapter binding. Agents are registered with their config and
 * bound to a specific runtime adapter (Vercel AI SDK or Mastra).
 */

import type { AgentRuntimePolicy, AgentFallback } from "@agenttrading/contracts";
import type { AgentAdapter } from "./adapter.ts";
import type { AgentConfig, RuntimeType } from "./config.ts";

/**
 * Registration entry for a single agent.
 */
export interface AgentRegistration {
  /** The agent's configuration. */
  config: AgentConfig;
  /** The adapter bound to this agent. */
  adapter: AgentAdapter;
  /** Whether this agent is currently enabled. */
  enabled: boolean;
  /** Timestamp of registration (Unix ms). */
  registeredAtMs: number;
}

/**
 * AgentRegistry: manages all registered agents.
 */
export class AgentRegistry {
  private readonly registrations = new Map<string, AgentRegistration>();

  /**
   * Register a new agent with its config and adapter.
   */
  register(config: AgentConfig, adapter: AgentAdapter): void {
    if (this.registrations.has(config.agentId)) {
      throw new Error(`Agent already registered: ${config.agentId}`);
    }
    this.registrations.set(config.agentId, {
      config,
      adapter,
      enabled: true,
      registeredAtMs: Date.now(),
    });
  }

  /**
   * Unregister an agent.
   */
  unregister(agentId: string): boolean {
    return this.registrations.delete(agentId);
  }

  /**
   * Get a registered agent's full registration.
   */
  get(agentId: string): AgentRegistration | undefined {
    return this.registrations.get(agentId);
  }

  /**
   * Get an agent's configuration.
   */
  getConfig(agentId: string): AgentConfig | undefined {
    return this.registrations.get(agentId)?.config;
  }

  /**
   * Get an agent's adapter.
   */
  getAdapter(agentId: string): AgentAdapter | undefined {
    return this.registrations.get(agentId)?.adapter;
  }

  /**
   * Enable or disable an agent.
   */
  setEnabled(agentId: string, enabled: boolean): void {
    const registration = this.registrations.get(agentId);
    if (registration) {
      registration.enabled = enabled;
    }
  }

  /**
   * Check if an agent is registered and enabled.
   */
  isEnabled(agentId: string): boolean {
    return this.registrations.get(agentId)?.enabled ?? false;
  }

  /**
   * List all registered agent IDs.
   */
  listAgentIds(): string[] {
    return [...this.registrations.keys()];
  }

  /**
   * List all enabled agent IDs.
   */
  listEnabledAgentIds(): string[] {
    return [...this.registrations.entries()]
      .filter(([, reg]) => reg.enabled)
      .map(([id]) => id);
  }

  /**
   * Get agents by runtime type.
   */
  getByRuntime(runtime: RuntimeType): AgentRegistration[] {
    return [...this.registrations.values()].filter(
      (reg) => reg.config.runtime === runtime,
    );
  }

  /**
   * Get agents by layer.
   */
  getByLayer(
    layer: AgentConfig["layer"],
  ): AgentRegistration[] {
    return [...this.registrations.values()].filter(
      (reg) => reg.config.layer === layer,
    );
  }

  /**
   * Get mandatory agents (those required for review).
   */
  getMandatoryAgents(): AgentRegistration[] {
    return [...this.registrations.values()].filter(
      (reg) => reg.config.mandatory,
    );
  }

  /**
   * Get an agent's runtime policy.
   */
  getPolicy(agentId: string): AgentRuntimePolicy | undefined {
    return this.registrations.get(agentId)?.config.policy;
  }

  /**
   * Get an agent's fallback config.
   */
  getFallback(agentId: string): AgentFallback | undefined {
    return this.registrations.get(agentId)?.config.fallback;
  }

  /**
   * Get the total number of registered agents.
   */
  get size(): number {
    return this.registrations.size;
  }

  /**
   * Check if any agents are registered.
   */
  get isEmpty(): boolean {
    return this.registrations.size === 0;
  }
}
