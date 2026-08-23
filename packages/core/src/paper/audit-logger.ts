/**
 * PaperAuditLogger: writes every paper-trading decision to a JSONL file.
 *
 * Each line is a self-contained JSON object with a timestamp, event type,
 * and the full payload. Designed for deterministic replay and post-session
 * reconstruction.
 */

import { appendFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

/** A single audit event written to the JSONL file. */
export interface PaperAuditEvent {
  /** Event timestamp (Unix ms). */
  timestampMs: number;
  /** Event type discriminator. */
  type: string;
  /** Event payload. */
  data: Record<string, unknown>;
}

/**
 * Options for the paper audit logger.
 */
export interface PaperAuditLoggerOptions {
  /** Path to the JSONL output file. */
  filePath: string;
  /** Injectable clock; defaults to Date.now. */
  nowMs?: () => number;
}

/**
 * PaperAuditLogger: appends JSONL lines to a file. Each line is a
 * self-contained JSON object for deterministic replay.
 */
export class PaperAuditLogger {
  private readonly filePath: string;
  private readonly nowMs: () => number;
  private eventCount = 0;

  constructor(options: PaperAuditLoggerOptions) {
    this.filePath = options.filePath;
    this.nowMs = options.nowMs ?? (() => Date.now());

    // Ensure the directory exists and create the file.
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

  /**
   * Record an audit event. Appends a single JSONL line to the file.
   */
  record(type: string, data: Record<string, unknown>): void {
    const event: PaperAuditEvent = {
      timestampMs: this.nowMs(),
      type,
      data,
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
