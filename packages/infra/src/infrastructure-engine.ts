/**
 * InfrastructureEngine: deterministic infrastructure hardening engine
 * (issue #38).
 *
 * Acceptance criteria:
 *   AC1: Health checks and heartbeats cover every connector and service.
 *   AC2: Failover works for WS/REST/RPC; circuit breakers trigger.
 *   AC3: Secrets are managed; keys rotate; state is backed up.
 *   AC4: A simulated partial failure degrades permissions/exposure,
 *        never increases risk.
 *
 * The engine is deterministic — no LLM, no I/O. It evaluates
 * infrastructure state (health, breakers, secrets, backups, error
 * budget) and produces a DegradationResult that maps to a SystemMode
 * on the safety ladder. Modes can only move down, never up (fail
 * closed, RISK.md).
 *
 * Detect-only semantics: This engine detects rotation and backup
 * needs but cannot trigger them — rotation and backup creation are
 * I/O operations handled by the infra layer. The engine produces
 * signals; the caller remediates.
 *
 * Usage:
 * ```ts
 * const engine = new InfrastructureEngine(config);
 * engine.registerComponent(health);
 * engine.recordHeartbeat("ws:bybit", nowMs);
 * engine.recordSuccess("ws:bybit");
 * engine.recordFailure("ws:bybit");
 * engine.recordSecret(secret);
 * engine.recordBackup(backup);
 * engine.recordObservation(true); // success
 * engine.recordObservation(false); // failure
 * const status = engine.evaluate(nowMs);
 * // status.degradation.resultingMode is the safe SystemMode
 * ```
 */

import type {
  BackupRecord,
  CircuitBreakerStatus,
  ComponentHealth,
  ConnectorType,
  DegradationResult,
  ErrorBudgetStatus,
  InfrastructureConfig,
  InfrastructureStatus,
  SecretRecord,
  SystemMode,
} from "@agenttrading/contracts";
import { DEFAULT_INFRASTRUCTURE_CONFIG } from "@agenttrading/contracts";

// ── Safety Ladder ───────────────────────────────────────────────────

/**
 * The SystemMode safety ladder. Modes are ordered from least restrictive
 * (NORMAL) to most restrictive (HALT). A mode at index i is "safer"
 * than mode at index j if i > j.
 */
const MODE_LADDER: readonly SystemMode[] = [
  "NORMAL",
  "OBSERVE_ONLY",
  "SIGNAL_ONLY",
  "REDUCE_ONLY",
  "CANCEL_ONLY",
  "CASH_ONLY",
  "HALT",
];

/**
 * Map a SystemMode to its position on the safety ladder.
 * Higher index = more restrictive.
 */
export function modeIndex(mode: SystemMode): number {
  return MODE_LADDER.indexOf(mode);
}

/** Ensure mode is at most as restrictive as `limit` (never goes up). */
function clampDown(mode: SystemMode, limit: SystemMode): SystemMode {
  const modeIdx = modeIndex(mode);
  const limitIdx = modeIndex(limit);
  // A higher index = more restrictive. We clamp to the more restrictive.
  return MODE_LADDER[Math.max(modeIdx, limitIdx)];
}

// ── Observation Window ──────────────────────────────────────────────

interface Observation {
  success: boolean;
  timestampMs: number;
}

// ── Engine ──────────────────────────────────────────────────────────

/**
 * InfrastructureEngine: evaluates infrastructure state and produces
 * safe degradation decisions.
 *
 * Detect-only: This engine tracks secret rotation state and backup
 * verification but does not perform I/O operations (actual rotation,
 * backup creation). It produces signals; callers remEDIATE.
 */
export class InfrastructureEngine {
  private readonly config: InfrastructureConfig;
  private readonly now: () => number;

  /** Component health registry. */
  private readonly components = new Map<string, ComponentHealth>();
  /** Circuit breaker state per component. */
  private readonly breakers = new Map<string, CircuitBreakerStatus>();
  /** Secret records. */
  private readonly secrets = new Map<string, SecretRecord>();
  /** Backup records. */
  private readonly backups: BackupRecord[] = [];
  /** Observations for error budget. */
  private readonly observations: Observation[] = [];

  constructor(
    config: InfrastructureConfig = DEFAULT_INFRASTRUCTURE_CONFIG,
    now?: () => number,
  ) {
    this.config = { ...config };
    this.now = now ?? (() => Date.now());
  }

  // ── AC1: Health Checks & Heartbeats ─────────────────────────────

  /**
   * Register a component for health tracking.
   */
  registerComponent(health: ComponentHealth): void {
    this.components.set(health.componentId, { ...health });
  }

  /**
   * Record a heartbeat for a component.
   */
  recordHeartbeat(componentId: string, timestampMs: number): void {
    const comp = this.components.get(componentId);
    if (comp === undefined) return;
    comp.lastHeartbeatMs = timestampMs;
    // Reset to healthy on heartbeat if it was unhealthy due to timeout.
    if (comp.state === "unhealthy" && comp.message?.includes("heartbeat timeout")) {
      comp.state = "healthy";
      comp.message = undefined;
    }
  }

  /**
   * Evaluate all component health states based on heartbeats.
   * Returns the list of unhealthy component ids.
   */
  evaluateHealth(nowMs: number): string[] {
    const unhealthy: string[] = [];
    for (const [id, comp] of this.components) {
      const elapsed = nowMs - comp.lastHeartbeatMs;
      if (elapsed > comp.heartbeatTimeoutMs) {
        comp.state = "unhealthy";
        comp.message = `heartbeat timeout: ${elapsed}ms since last heartbeat (timeout: ${comp.heartbeatTimeoutMs}ms)`;
        unhealthy.push(id);
      } else if (elapsed > comp.heartbeatTimeoutMs * 0.75) {
        // Approaching timeout — mark as degraded.
        comp.state = "degraded";
        comp.message = `heartbeat approaching timeout: ${elapsed}ms (timeout: ${comp.heartbeatTimeoutMs}ms)`;
        unhealthy.push(id);
      }
    }
    return unhealthy;
  }

  // ── AC2: Circuit Breakers & Failover ─────────────────────────────

  /**
   * Initialize a circuit breaker for a component.
   */
  initBreaker(componentId: string, connectorType: ConnectorType): void {
    this.breakers.set(componentId, {
      componentId,
      connectorType,
      state: "closed",
      failureCount: 0,
      failureThreshold: this.config.circuitBreakerDefaults.failureThreshold,
      openedAtMs: 0,
      cooldownMs: this.config.circuitBreakerDefaults.cooldownMs,
    });
  }

  /**
   * Record a success for a component (resets failure count, closes breaker).
   */
  recordSuccess(componentId: string): void {
    const breaker = this.breakers.get(componentId);
    if (breaker !== undefined) {
      breaker.failureCount = 0;
      if (breaker.state === "half-open") {
        breaker.state = "closed";
        breaker.openedAtMs = 0;
      }
    }
    // Also update component health.
    const comp = this.components.get(componentId);
    if (comp !== undefined && comp.state !== "healthy") {
      comp.state = "healthy";
      comp.message = undefined;
    }
  }

  /**
   * Record a failure for a component (increments failure count,
   * trips breaker if threshold exceeded).
   */
  recordFailure(componentId: string): void {
    const breaker = this.breakers.get(componentId);
    if (breaker === undefined) return;

    breaker.failureCount += 1;

    if (breaker.state === "half-open") {
      // Failure in half-open → re-open.
      breaker.state = "open";
      breaker.openedAtMs = this.now();
    } else if (breaker.failureCount >= breaker.failureThreshold) {
      // Trip the breaker.
      breaker.state = "open";
      breaker.openedAtMs = this.now();
    }

    // Update component health.
    const comp = this.components.get(componentId);
    if (comp !== undefined) {
      comp.state = "unhealthy";
      comp.message = `circuit breaker ${breaker.state}: ${breaker.failureCount} consecutive failures`;
    }
  }

  /**
   * Evaluate circuit breakers: transition open → half-open when cooldown
   * expires. Returns the list of non-closed breaker component ids
   * (open or half-open).
   */
  evaluateBreakers(nowMs: number): string[] {
    const nonClosed: string[] = [];

    for (const breaker of this.breakers.values()) {
      if (breaker.state === "open") {
        const elapsed = nowMs - breaker.openedAtMs;
        if (elapsed >= breaker.cooldownMs) {
          breaker.state = "half-open";
        }
      }

      if (breaker.state === "open" || breaker.state === "half-open") {
        nonClosed.push(breaker.componentId);
      }
    }

    return nonClosed;
  }

  /**
   * Get the failover target for a connector type, given the failing
   * component. Returns the first available fallback, or null.
   */
  getFailoverTarget(connectorType: ConnectorType, failingComponentId: string): string | null {
    const config = this.config.failoverConfigs.find(
      (f) => f.connectorType === connectorType,
    );
    if (config === undefined || !config.enabled) return null;

    for (const fallbackId of config.fallbacks) {
      if (fallbackId === failingComponentId) continue;
      const breaker = this.breakers.get(fallbackId);
      // Only return fallbacks that are not open.
      if (breaker === undefined || breaker.state === "closed") {
        return fallbackId;
      }
    }
    return null;
  }

  // ── AC3: Secrets & Backups ───────────────────────────────────────

  /**
   * Register a secret for tracking.
   *
   * Detect-only: This records the secret's rotation state. Actual key
   * rotation is an I/O operation performed by the caller.
   */
  recordSecret(secret: SecretRecord): void {
    this.secrets.set(secret.secretId, { ...secret });
  }

  /**
   * Record a backup.
   *
   * Detect-only: This records a backup's verification state. Actual
   * backup creation is an I/O operation performed by the caller.
   */
  recordBackup(backup: BackupRecord): void {
    // Maintain a sorted list (newest first).
    this.backups.push({ ...backup });
    this.backups.sort((a, b) => b.createdAtMs - a.createdAtMs);
    // Enforce retention.
    if (this.config.minBackupRetention > 0) {
      while (this.backups.length > this.config.minBackupRetention * 2) {
        this.backups.pop();
      }
    }
  }

  /**
   * Evaluate secrets: check which need rotation or are expired.
   * Returns the count of secrets needing rotation.
   *
   * Detect-only: This identifies secrets that need rotation. The
   * caller must perform the actual rotation (I/O operation).
   */
  evaluateSecrets(nowMs: number): { ok: boolean; needingRotation: number } {
    let needingRotation = 0;
    for (const secret of this.secrets.values()) {
      const rotationDue =
        secret.rotationIntervalMs > 0 &&
        nowMs - secret.lastRotatedAtMs > secret.rotationIntervalMs;
      const expired = secret.expiresAtMs > 0 && nowMs > secret.expiresAtMs;
      if (rotationDue || expired || !secret.active) {
        needingRotation += 1;
      }
    }
    return {
      ok: needingRotation === 0,
      needingRotation,
    };
  }

  /**
   * Evaluate backups: check whether enough verified backups exist.
   *
   * Detect-only: This identifies insufficient backup coverage. The
   * caller must create backups (I/O operation).
   */
  evaluateBackups(): { ok: boolean; count: number } {
    const verified = this.backups.filter((b) => b.verified);
    return {
      ok: verified.length >= this.config.minBackupRetention,
      count: verified.length,
    };
  }

  // ── Error Budget ─────────────────────────────────────────────────

  /**
   * Record a success or failure observation for error budget tracking.
   */
  recordObservation(success: boolean): void {
    this.observations.push({ success, timestampMs: this.now() });
  }

  /**
   * Evaluate the error budget for the current window.
   */
  evaluateErrorBudget(nowMs: number): ErrorBudgetStatus {
    const budget = this.config.errorBudget;
    const windowStart = nowMs - budget.windowMs;

    // Prune observations outside the window.
    const inWindow = this.observations.filter(
      (o) => o.timestampMs >= windowStart,
    );

    const total = inWindow.length;
    const failed = inWindow.filter((o) => !o.success).length;
    const rate = total > 0 ? failed / total : 0;

    const budgetExhausted =
      total >= budget.minObservations && rate > budget.allowedFailureRate;

    return {
      totalObservations: total,
      failedObservations: failed,
      actualFailureRate: rate,
      budgetExhausted,
    };
  }

  // ── AC4: Degradation Evaluation ──────────────────────────────────

  /**
   * Evaluate the full infrastructure state and produce a degradation
   * result. This is the main entry point that ties everything together.
   *
   * AC4: A simulated partial failure degrades permissions/exposure,
   *      never increases risk. The resulting mode is always ≤ the
   *      input mode on the safety ladder.
   *
   * @param inputMode The current system mode. The output will never be
   *   less restrictive than this.
   * @param nowMs Current timestamp for time-based evaluations.
   */
  evaluateDegradation(
    inputMode: SystemMode,
    nowMs: number,
  ): DegradationResult {
    // 1. Evaluate health.
    const unhealthyComponents = this.evaluateHealth(nowMs);

    // 2. Evaluate circuit breakers.
    const openBreakers = this.evaluateBreakers(nowMs);

    // 3. Evaluate secrets and backups (once each, reused below).
    const secrets = this.evaluateSecrets(nowMs);
    const backups = this.evaluateBackups();

    // 4. Evaluate error budget.
    const errorBudget = this.evaluateErrorBudget(nowMs);

    // 5. Determine the most restrictive mode required.
    let requiredMode: SystemMode = inputMode;
    let reason: string | undefined;

    if (unhealthyComponents.length > 0) {
      requiredMode = clampDown(requiredMode, "OBSERVE_ONLY");
      reason = `unhealthy components: ${unhealthyComponents.join(", ")}`;
    }

    if (openBreakers.length > 0) {
      requiredMode = clampDown(requiredMode, "SIGNAL_ONLY");
      reason = `open circuit breakers: ${openBreakers.join(", ")}`;
    }

    if (!secrets.ok) {
      requiredMode = clampDown(requiredMode, "REDUCE_ONLY");
      reason = `secrets need rotation: ${secrets.needingRotation}`;
    }

    if (!backups.ok) {
      requiredMode = clampDown(requiredMode, "CANCEL_ONLY");
      reason = `insufficient verified backups: ${backups.count}/${this.config.minBackupRetention}`;
    }

    if (errorBudget.budgetExhausted) {
      requiredMode = clampDown(requiredMode, "HALT");
      reason = `error budget exhausted: ${(errorBudget.actualFailureRate * 100).toFixed(1)}% failure rate`;
    }

    // 6. Ensure mode never goes UP (AC4 safety invariant).
    const resultingMode = clampDown(requiredMode, inputMode);

    return {
      resultingMode,
      modeDowngraded: resultingMode !== inputMode,
      unhealthyComponents,
      openBreakers,
      errorBudgetExhausted: errorBudget.budgetExhausted,
      reason,
    };
  }

  /**
   * Evaluate the complete infrastructure status.
   */
  evaluate(nowMs: number): InfrastructureStatus {
    // Force health/breaker evaluation.
    this.evaluateHealth(nowMs);
    this.evaluateBreakers(nowMs);

    // Evaluate secrets and backups once, reuse for status and degradation.
    const secrets = this.evaluateSecrets(nowMs);
    const backups = this.evaluateBackups();

    return {
      components: [...this.components.values()],
      breakers: [...this.breakers.values()],
      secretsOk: secrets.ok,
      secretsNeedingRotation: secrets.needingRotation,
      backupsOk: backups.ok,
      backupCount: backups.count,
      errorBudget: this.evaluateErrorBudget(nowMs),
      degradation: this.evaluateDegradation("NORMAL", nowMs),
    };
  }

  // ── Read-only accessors ──────────────────────────────────────────

  getComponent(id: string): ComponentHealth | undefined {
    return this.components.get(id);
  }

  getBreaker(id: string): CircuitBreakerStatus | undefined {
    return this.breakers.get(id);
  }

  getSecret(id: string): SecretRecord | undefined {
    return this.secrets.get(id);
  }

  getBackups(): readonly BackupRecord[] {
    return [...this.backups];
  }
}
