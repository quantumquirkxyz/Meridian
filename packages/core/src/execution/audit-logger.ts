/**
 * AuditLogger: writes every trading decision to a JSONL file.
 *
 * Each line is a self-contained JSON object with a timestamp, event type,
 * and the full payload. Designed for deterministic replay and post-session
 * reconstruction.
 */

import { appendFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

/** A single audit event written to the JSONL file. */
export interface AuditEvent {
  /** Event timestamp (Unix ms). */
  timestampMs: number;
  /** Event type discriminator. */
  type: string;
  /** Event payload. */
  data: Record<string, unknown>;
  /** Session identifier for correlating events across a run. */
  sessionId: string;
}

/**
 * Options for the audit logger.
 */
export interface AuditLoggerOptions {
  /** Path to the JSONL output file. */
  filePath: string;
  /** Injectable clock; defaults to Date.now. */
  nowMs?: () => number;
  /** Session identifier written to every event. Generated if omitted. */
  sessionId?: string;
}

/**
 * AuditLogger: appends JSONL lines to a file. Each line is a
 * self-contained JSON object for deterministic replay.
 */
export class AuditLogger {
  private readonly filePath: string;
  private readonly nowMs: () => number;
  private readonly sessionIdValue: string;
  private eventCount = 0;

  constructor(options: AuditLoggerOptions) {
    this.filePath = options.filePath;
    this.nowMs = options.nowMs ?? (() => Date.now());
    this.sessionIdValue = options.sessionId ?? generateSessionId(this.nowMs());

    const dir = dirname(this.filePath);
    try {
      mkdirSync(dir, { recursive: true });
    } catch {
      // Directory may already exist.
    }
    writeFileSync(this.filePath, "", "utf-8");
  }

  /** Total events logged. */
  get count(): number {
    return this.eventCount;
  }

  /** The session identifier for this logger instance. */
  get sessionId(): string {
    return this.sessionIdValue;
  }

  /**
   * Record an audit event. Appends a single JSONL line to the file.
   */
  record(type: string, data: Record<string, unknown>): void {
    const event: AuditEvent = {
      timestampMs: this.nowMs(),
      type,
      data,
      sessionId: this.sessionIdValue,
    };

    const line = JSON.stringify(event);
    appendFileSync(this.filePath, line + "\n", "utf-8");
    this.eventCount++;
  }

  /**
   * Flush is a no-op (appendFileSync is synchronous). Included for
   * API symmetry with async loggers.
   */
  flush(): void {
    // Synchronous writes — nothing to flush.
  }
}

/**
 * Generate a session ID from a timestamp and random suffix.
 * Format: `sess-YYYYMMDD-HHmmss-<hex>`.
 */
export function generateSessionId(nowMs?: number): string {
  const d = new Date(nowMs ?? Date.now());
  const date = d.toISOString().slice(0, 10).replace(/-/g, "");
  const time = d.toISOString().slice(11, 19).replace(/:/g, "");
  const rand = Math.random().toString(16).slice(2, 8);
  return `sess-${date}-${time}-${rand}`;
}
