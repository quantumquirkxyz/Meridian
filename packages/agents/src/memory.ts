/**
 * AgentMemory: per-agent memory store for conversation history and state.
 * Each agent maintains its own memory isolated from other agents.
 * Memory is cleared between invocations unless explicitly persisted.
 */

import type { AgentMessage } from "@agenttrading/contracts";

/**
 * Memory snapshot for persistence and replay.
 */
export interface MemorySnapshot {
  /** Agent this memory belongs to. */
  agentId: string;
  /** Conversation messages. */
  messages: AgentMessage[];
  /** Arbitrary key-value state. */
  state: Record<string, unknown>;
  /** Timestamp of this snapshot. */
  timestampMs: number;
}

/**
 * AgentMemory: manages per-agent conversation history and state.
 */
export class AgentMemory {
  private readonly stores = new Map<
    string,
    { messages: AgentMessage[]; state: Record<string, unknown> }
  >();

  /**
   * Get conversation history for an agent.
   */
  getMessages(agentId: string): readonly AgentMessage[] {
    return this.stores.get(agentId)?.messages ?? [];
  }

  /**
   * Append a message to an agent's conversation history.
   */
  addMessage(agentId: string, message: AgentMessage): void {
    const store = this.getOrCreate(agentId);
    store.messages.push(message);
  }

  /**
   * Get a state value for an agent.
   */
  getState<T = unknown>(agentId: string, key: string): T | undefined {
    return this.stores.get(agentId)?.state[key] as T | undefined;
  }

  /**
   * Set a state value for an agent.
   */
  setState(agentId: string, key: string, value: unknown): void {
    const store = this.getOrCreate(agentId);
    store.state[key] = value;
  }

  /**
   * Clear all memory for an agent.
   */
  clear(agentId: string): void {
    this.stores.delete(agentId);
  }

  /**
   * Clear all memory for all agents.
   */
  clearAll(): void {
    this.stores.clear();
  }

  /**
   * Export a snapshot for persistence.
   */
  snapshot(agentId: string): MemorySnapshot | null {
    const store = this.stores.get(agentId);
    if (!store) return null;
    return {
      agentId,
      messages: [...store.messages],
      state: { ...store.state },
      timestampMs: Date.now(),
    };
  }

  /**
   * Restore from a snapshot.
   */
  restore(snapshot: MemorySnapshot): void {
    this.stores.set(snapshot.agentId, {
      messages: [...snapshot.messages],
      state: { ...snapshot.state },
    });
  }

  /**
   * Get the total message count across all agents.
   */
  totalMessageCount(): number {
    let count = 0;
    for (const store of this.stores.values()) {
      count += store.messages.length;
    }
    return count;
  }

  private getOrCreate(
    agentId: string,
  ): { messages: AgentMessage[]; state: Record<string, unknown> } {
    let store = this.stores.get(agentId);
    if (!store) {
      store = { messages: [], state: {} };
      this.stores.set(agentId, store);
    }
    return store;
  }
}
