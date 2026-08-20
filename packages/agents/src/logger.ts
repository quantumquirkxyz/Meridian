/**
 * AgentLogger: structured logging for agent invocations, outputs, and
 * audit trail. Every agent action must be traceable (CONTEXT.md §16).
 */

import type {
  AgentAuditEntry,
  AgentOutput,
} from "@agenttrading/contracts";

/**
 * Log levels for agent operations.
 */
export const LOG_LEVELS = [
  "debug",
  "info",
  "warn",
  "error",
] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

/**
 * A single log entry.
 */
export interface AgentLogEntry {
  /** Unique identifier. */
  entryId: string;
  /** Log level. */
  level: LogLevel;
  /** Agent identifier. */
  agentId: string;
  /** Operation being logged. */
  operation: string;
  /** Human-readable message. */
  message: string;
  /** Timestamp (Unix ms). */
  timestampMs: number;
  /** Optional structured data. */
  data?: Record<string, unknown>;
  /** Optional duration if this is a timing entry. */
  durationMs?: number;
}

/**
 * AgentLogger: collects structured log entries for agent operations.
 * In production, entries would be flushed to the audit/event store.
 */
export class AgentLogger {
  private readonly entries: AgentLogEntry[] = [];
  private entryCounter = 0;

  /**
   * Log an agent operation.
   */
  log(params: {
    level: LogLevel;
    agentId: string;
    operation: string;
    message: string;
    data?: Record<string, unknown>;
    durationMs?: number;
  }): AgentLogEntry {
    const entry: AgentLogEntry = {
      entryId: `log-${++this.entryCounter}-${params.agentId}`,
      level: params.level,
      agentId: params.agentId,
      operation: params.operation,
      message: params.message,
      timestampMs: Date.now(),
      data: params.data,
      durationMs: params.durationMs,
    };
    this.entries.push(entry);
    return entry;
  }

  /**
   * Log an agent invocation start.
   */
  logInvocationStart(agentId: string, input: Record<string, unknown>): AgentLogEntry {
    return this.log({
      level: "info",
      agentId,
      operation: "invocation:start",
      message: `Agent ${agentId} invocation started`,
      data: { inputKeys: Object.keys(input) },
    });
  }

  /**
   * Log an agent invocation completion.
   */
  logInvocationEnd(
    agentId: string,
    output: AgentOutput,
    durationMs: number,
  ): AgentLogEntry {
    return this.log({
      level: "info",
      agentId,
      operation: "invocation:end",
      message: `Agent ${agentId} invocation completed: ${output.kind}`,
      data: { outputKind: output.kind },
      durationMs,
    });
  }

  /**
   * Log a fallback activation.
   */
  logFallback(agentId: string, reason: string): AgentLogEntry {
    return this.log({
      level: "warn",
      agentId,
      operation: "fallback:activated",
      message: `Deterministic fallback activated for ${agentId}: ${reason}`,
      data: { reason },
    });
  }

  /**
   * Log a schema validation failure.
   */
  logValidationFailure(
    agentId: string,
    errors: string[],
  ): AgentLogEntry {
    return this.log({
      level: "error",
      agentId,
      operation: "validation:failed",
      message: `Output validation failed for ${agentId}`,
      data: { errors },
    });
  }

  /**
   * Log a budget exceeded event.
   */
  logBudgetExceeded(
    agentId: string,
    consumed: number,
    limit: number,
    budgetType: "tokens" | "cost",
  ): AgentLogEntry {
    return this.log({
      level: "warn",
      agentId,
      operation: "budget:exceeded",
      message: `${budgetType} budget exceeded for ${agentId}: ${consumed} / ${limit}`,
      data: { consumed, limit, budgetType },
    });
  }

  /**
   * Log a timeout event.
   */
  logTimeout(agentId: string, timeoutMs: number): AgentLogEntry {
    return this.log({
      level: "error",
      agentId,
      operation: "timeout",
      message: `Agent ${agentId} timed out after ${timeoutMs}ms`,
      data: { timeoutMs },
    });
  }

  /**
   * Get all log entries.
   */
  getEntries(): readonly AgentLogEntry[] {
    return this.entries;
  }

  /**
   * Get log entries for a specific agent.
   */
  getEntriesForAgent(agentId: string): readonly AgentLogEntry[] {
    return this.entries.filter((e) => e.agentId === agentId);
  }

  /**
   * Get log entries at or above a given level.
   */
  getEntriesAtLevel(level: LogLevel): readonly AgentLogEntry[] {
    const hierarchy: Record<LogLevel, number> = {
      debug: 0,
      info: 1,
      warn: 2,
      error: 3,
    };
    const threshold = hierarchy[level];
    return this.entries.filter((e) => hierarchy[e.level] >= threshold);
  }

  /**
   * Convert log entries to audit entries for the audit store.
   */
  toAuditEntries(): AgentAuditEntry[] {
    return this.entries.map((entry) => ({
      eventId: entry.entryId,
      timestampMs: entry.timestampMs,
      agentId: entry.agentId,
      action: entry.operation,
      fallbackUsed: entry.operation.startsWith("fallback:"),
      metadata: entry.data,
    }));
  }

  /**
   * Clear all log entries.
   */
  clear(): void {
    this.entries.length = 0;
  }
}
