/**
 * Shared audit staleness evaluation (S2 fix).
 *
 * Single source of truth for audit availability checks. Used by both
 * AuditReconstructor and CanarySession to avoid duplicated staleness logic.
 */

import type { AuditAvailability } from "@agenttrading/contracts";

/**
 * Result of evaluating audit availability.
 */
export interface AuditStalenessResult {
  /** Whether audit is available (not stale and not explicitly unavailable). */
  available: boolean;
  /** Error message if unavailable or stale. */
  error?: string;
}

/**
 * Evaluate whether the audit subsystem is available and not stale.
 *
 * This is the single source of truth for audit availability checks (S2).
 * Both AuditReconstructor and CanarySession delegate to this function.
 *
 * @param availability The current audit availability state.
 * @param nowMs Current timestamp (Unix ms).
 * @returns The evaluation result with available flag and optional error.
 */
export function evaluateAuditStaleness(
  availability: AuditAvailability,
  nowMs: number,
): AuditStalenessResult {
  // Explicitly unavailable.
  if (!availability.available) {
    return {
      available: false,
      error: availability.error ?? "audit unavailable",
    };
  }

  // Never written — not yet stale.
  if (availability.lastWriteAtMs === 0) {
    return { available: true };
  }

  // Check staleness.
  const elapsed = nowMs - availability.lastWriteAtMs;
  if (elapsed > availability.maxStaleMs) {
    return {
      available: false,
      error:
        availability.error ??
        `audit stale: ${(elapsed / 1000).toFixed(0)}s since last write (max: ${(availability.maxStaleMs / 1000).toFixed(0)}s)`,
    };
  }

  return { available: true };
}
