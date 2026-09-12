/**
 * AuditLogger: writes every trading decision to a JSONL file.
 *
 * Each line is a self-contained JSON object with a timestamp, event type,
 * and the full payload. Designed for deterministic replay and post-session
 * reconstruction.
 *
 * SECURITY: Automatically sanitizes sensitive data before logging (SEC-004)
 */

import { appendFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

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
  /**
   * Whether to enable sensitive data sanitization (default: true).
   * When enabled, fields matching the sensitive field patterns are redacted.
   */
  sanitizeSensitiveData?: boolean;
}

/**
 * Sensitive field patterns that should be redacted from audit logs.
 * These are field names (case-insensitive) that typically contain secrets.
 */
const SENSITIVE_FIELD_PATTERNS = [
  "apikey",
  "apisecret",
  "privatekey",
  "secret",
  "password",
  "token",
  "signature",
  "walletbalance",
  "accountbalance",
  "totalbalance",
  "marginbalance",
  "availablebalance",
];

/**
 * Recursively sanitize sensitive data from an object.
 * Replaces sensitive field values with "[REDACTED]".
 */
function sanitizeData(data: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data)) {
    const keyLower = key.toLowerCase();

    // Check if this field matches any sensitive pattern
    const isSensitive = SENSITIVE_FIELD_PATTERNS.some(pattern =>
      keyLower.includes(pattern)
    );

    if (isSensitive) {
      sanitized[key] = "[REDACTED]";
    } else if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      // Recursively sanitize nested objects
      sanitized[key] = sanitizeData(value as Record<string, unknown>);
    } else if (Array.isArray(value)) {
      // Sanitize array elements if they are objects
      sanitized[key] = value.map(item =>
        typeof item === "object" && item !== null && !Array.isArray(item)
          ? sanitizeData(item as Record<string, unknown>)
          : item
      );
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * AuditLogger: appends JSONL lines to a file. Each line is a
 * self-contained JSON object for deterministic replay.
 */
export class AuditLogger {
  private readonly filePath: string;
  private readonly nowMs: () => number;
  private readonly sessionIdValue: string;
  private readonly sanitizeSensitiveData: boolean;
  private eventCount = 0;

  constructor(options: AuditLoggerOptions) {
    this.filePath = options.filePath;
    this.nowMs = options.nowMs ?? (() => Date.now());
    this.sessionIdValue = options.sessionId ?? generateSessionId(this.nowMs());
    this.sanitizeSensitiveData = options.sanitizeSensitiveData ?? true;

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
   *
   * SECURITY: Automatically sanitizes sensitive data before logging (SEC-004)
   */
  record(type: string, data: Record<string, unknown>): void {
    // Sanitize sensitive data if enabled
    const sanitizedData = this.sanitizeSensitiveData
      ? sanitizeData(data)
      : data;

    const event: AuditEvent = {
      timestampMs: this.nowMs(),
      type,
      data: sanitizedData,
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
 * Format: `sess-YYYYMMDD-HHmmss-<uuid>`.
 *
 * SECURITY: Uses crypto.randomUUID() for cryptographically secure randomness (SEC-013)
 */
export function generateSessionId(nowMs?: number): string {
  const d = new Date(nowMs ?? Date.now());
  const date = d.toISOString().slice(0, 10).replace(/-/g, "");
  const time = d.toISOString().slice(11, 19).replace(/:/g, "");
  const rand = randomUUID().slice(0, 8); // Use first 8 chars of UUID
  return `sess-${date}-${time}-${rand}`;
}
