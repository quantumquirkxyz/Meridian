import { describe, expect, test } from "bun:test";
import {
  DEFAULT_INFRASTRUCTURE_CONFIG,
  isInfrastructureConfig,
  isInfrastructureStatus,
  type BackupRecord,
  type ComponentHealth,
  type InfrastructureConfig,
  type SecretRecord,
} from "@agenttrading/contracts";
import { InfrastructureEngine, modeIndex } from "../src/infrastructure-engine.ts";

// ── Helpers ─────────────────────────────────────────────────────────

const NOW_MS = 1_700_000_000_000;
const ONE_MIN = 60_000;
const ONE_HOUR = 3_600_000;
const ONE_DAY = 86_400_000;

function health(overrides: Partial<ComponentHealth> = {}): ComponentHealth {
  return {
    componentId: "ws:bybit",
    kind: "connector",
    connectorType: "ws",
    state: "healthy",
    lastHeartbeatMs: NOW_MS,
    heartbeatTimeoutMs: 30_000,
    ...overrides,
  };
}

function secret(overrides: Partial<SecretRecord> = {}): SecretRecord {
  return {
    secretId: "key-bybit-trading",
    label: "Bybit Trading Key",
    secretRef: "vault://bybit/trading",
    lastRotatedAtMs: NOW_MS - ONE_DAY,
    rotationIntervalMs: 90 * ONE_DAY,
    expiresAtMs: 0,
    active: true,
    ...overrides,
  };
}

function backup(overrides: Partial<BackupRecord> = {}): BackupRecord {
  return {
    backupId: "backup-1",
    createdAtMs: NOW_MS,
    sizeBytes: 1024,
    checksum: "abc123",
    verified: true,
    ...overrides,
  };
}

function config(overrides: Partial<InfrastructureConfig> = {}): InfrastructureConfig {
  return {
    ...DEFAULT_INFRASTRUCTURE_CONFIG,
    ...overrides,
  };
}

// ── Contract Validation ─────────────────────────────────────────────

describe("InfrastructureConfig contract", () => {
  test("validates default config", () => {
    expect(isInfrastructureConfig(DEFAULT_INFRASTRUCTURE_CONFIG)).toBe(true);
  });

  test("parses a valid config", () => {
    const parsed = DEFAULT_INFRASTRUCTURE_CONFIG;
    expect(parsed.configId).toBe("infra-default-1");
    expect(parsed.failoverConfigs).toHaveLength(3);
    expect(parsed.errorBudget.allowedFailureRate).toBe(0.01);
  });

  test("rejects invalid config", () => {
    expect(isInfrastructureConfig({})).toBe(false);
    expect(isInfrastructureConfig({ configId: 123 })).toBe(false);
  });
});

// ── AC1: Health Checks & Heartbeats ────────────────────────────────

describe("AC1: Health checks and heartbeats cover every connector and service", () => {
  test("registers and tracks a connector component", () => {
    const engine = new InfrastructureEngine(config(), () => NOW_MS);
    const h = health();
    engine.registerComponent(h);

    const comp = engine.getComponent("ws:bybit");
    expect(comp).toBeDefined();
    expect(comp!.state).toBe("healthy");
    expect(comp!.kind).toBe("connector");
    expect(comp!.connectorType).toBe("ws");
  });

  test("registers a service component (no connector type)", () => {
    const engine = new InfrastructureEngine(config(), () => NOW_MS);
    engine.registerComponent(health({
      componentId: "service:risk-engine",
      kind: "service",
      connectorType: undefined,
    }));

    const comp = engine.getComponent("service:risk-engine");
    expect(comp).toBeDefined();
    expect(comp!.kind).toBe("service");
    expect(comp!.connectorType).toBeUndefined();
  });

  test("records heartbeat and refreshes component state", () => {
    const engine = new InfrastructureEngine(config(), () => NOW_MS);
    engine.registerComponent(health({
      state: "unhealthy",
      lastHeartbeatMs: NOW_MS - 60_000,
      message: "heartbeat timeout: 60000ms since last heartbeat (timeout: 30000ms)",
    }));

    engine.recordHeartbeat("ws:bybit", NOW_MS);

    const comp = engine.getComponent("ws:bybit");
    expect(comp!.state).toBe("healthy");
    expect(comp!.message).toBeUndefined();
  });

  test("detects unhealthy component via heartbeat timeout", () => {
    const engine = new InfrastructureEngine(config(), () => NOW_MS);
    engine.registerComponent(health({
      lastHeartbeatMs: NOW_MS - 60_000, // 60s ago, timeout is 30s.
    }));

    const unhealthy = engine.evaluateHealth(NOW_MS);
    expect(unhealthy).toContain("ws:bybit");

    const comp = engine.getComponent("ws:bybit");
    expect(comp!.state).toBe("unhealthy");
    expect(comp!.message).toContain("heartbeat timeout");
  });

  test("detects degraded component approaching timeout", () => {
    const engine = new InfrastructureEngine(config(), () => NOW_MS);
    engine.registerComponent(health({
      lastHeartbeatMs: NOW_MS - 25_000, // 25s ago, timeout is 30s (83% → degraded).
    }));

    const unhealthy = engine.evaluateHealth(NOW_MS);
    expect(unhealthy).toContain("ws:bybit");

    const comp = engine.getComponent("ws:bybit");
    expect(comp!.state).toBe("degraded");
    expect(comp!.message).toContain("approaching timeout");
  });

  test("healthy component stays healthy when heartbeat is fresh", () => {
    const engine = new InfrastructureEngine(config(), () => NOW_MS);
    engine.registerComponent(health({
      lastHeartbeatMs: NOW_MS - 5_000, // 5s ago, well within timeout.
    }));

    const unhealthy = engine.evaluateHealth(NOW_MS);
    expect(unhealthy).not.toContain("ws:bybit");

    const comp = engine.getComponent("ws:bybit");
    expect(comp!.state).toBe("healthy");
  });

  test("multiple components are tracked independently", () => {
    const engine = new InfrastructureEngine(config(), () => NOW_MS);
    engine.registerComponent(health({
      componentId: "ws:bybit",
      lastHeartbeatMs: NOW_MS - 5_000, // fresh
    }));
    engine.registerComponent(health({
      componentId: "rest:binance",
      lastHeartbeatMs: NOW_MS - 60_000, // stale
    }));
    engine.registerComponent(health({
      componentId: "rpc:ethereum",
      lastHeartbeatMs: NOW_MS - 2_000, // fresh
    }));

    const unhealthy = engine.evaluateHealth(NOW_MS);
    expect(unhealthy).not.toContain("ws:bybit");
    expect(unhealthy).toContain("rest:binance");
    expect(unhealthy).not.toContain("rpc:ethereum");
  });
});

// ── AC2: Circuit Breakers & Failover ────────────────────────────────

describe("AC2: Failover works for WS/REST/RPC; circuit breakers trigger", () => {
  test("initializes a circuit breaker in closed state", () => {
    const engine = new InfrastructureEngine(config(), () => NOW_MS);
    engine.initBreaker("ws:bybit", "ws");

    const breaker = engine.getBreaker("ws:bybit");
    expect(breaker).toBeDefined();
    expect(breaker!.state).toBe("closed");
    expect(breaker!.failureCount).toBe(0);
    expect(breaker!.connectorType).toBe("ws");
  });

  test("records success resets failure count", () => {
    const engine = new InfrastructureEngine(config(), () => NOW_MS);
    engine.initBreaker("ws:bybit", "ws");
    engine.recordFailure("ws:bybit");
    engine.recordFailure("ws:bybit");
    expect(engine.getBreaker("ws:bybit")!.failureCount).toBe(2);

    engine.recordSuccess("ws:bybit");
    expect(engine.getBreaker("ws:bybit")!.failureCount).toBe(0);
    expect(engine.getBreaker("ws:bybit")!.state).toBe("closed");
  });

  test("trips breaker after failure threshold is reached", () => {
    const engine = new InfrastructureEngine(config(), () => NOW_MS);
    engine.initBreaker("ws:bybit", "ws");

    // Default threshold is 5.
    for (let i = 0; i < 5; i++) {
      engine.recordFailure("ws:bybit");
    }

    const breaker = engine.getBreaker("ws:bybit");
    expect(breaker!.state).toBe("open");
    expect(breaker!.failureCount).toBe(5);
    expect(breaker!.openedAtMs).toBe(NOW_MS);
  });

  test("does not trip before threshold", () => {
    const engine = new InfrastructureEngine(config(), () => NOW_MS);
    engine.initBreaker("ws:bybit", "ws");

    for (let i = 0; i < 4; i++) {
      engine.recordFailure("ws:bybit");
    }

    const breaker = engine.getBreaker("ws:bybit");
    expect(breaker!.state).toBe("closed");
  });

  test("transitions from open to half-open after cooldown", () => {
    const engine = new InfrastructureEngine(config(), () => NOW_MS);
    engine.initBreaker("ws:bybit", "ws");

    for (let i = 0; i < 5; i++) engine.recordFailure("ws:bybit");
    expect(engine.getBreaker("ws:bybit")!.state).toBe("open");

    // Before cooldown.
    const openBreakers = engine.evaluateBreakers(NOW_MS + 30_000);
    expect(openBreakers).toContain("ws:bybit");
    expect(engine.getBreaker("ws:bybit")!.state).toBe("open");

    // After cooldown (60s).
    engine.evaluateBreakers(NOW_MS + 60_000);
    expect(engine.getBreaker("ws:bybit")!.state).toBe("half-open");
  });

  test("half-open failure re-opens the breaker", () => {
    const engine = new InfrastructureEngine(config(), () => NOW_MS);
    engine.initBreaker("ws:bybit", "ws");

    for (let i = 0; i < 5; i++) engine.recordFailure("ws:bybit");
    engine.evaluateBreakers(NOW_MS + 60_000); // → half-open
    expect(engine.getBreaker("ws:bybit")!.state).toBe("half-open");

    engine.recordFailure("ws:bybit");
    expect(engine.getBreaker("ws:bybit")!.state).toBe("open");
  });

  test("half-open success closes the breaker", () => {
    const engine = new InfrastructureEngine(config(), () => NOW_MS);
    engine.initBreaker("ws:bybit", "ws");

    for (let i = 0; i < 5; i++) engine.recordFailure("ws:bybit");
    engine.evaluateBreakers(NOW_MS + 60_000); // → half-open
    expect(engine.getBreaker("ws:bybit")!.state).toBe("half-open");

    engine.recordSuccess("ws:bybit");
    expect(engine.getBreaker("ws:bybit")!.state).toBe("closed");
  });

  test("returns failover target when primary is down", () => {
    const cfg = config({
      failoverConfigs: [
        { connectorType: "ws", fallbacks: ["ws:okx", "ws:deribit"], requestTimeoutMs: 5000, enabled: true },
        { connectorType: "rest", fallbacks: [], requestTimeoutMs: 10000, enabled: true },
        { connectorType: "rpc", fallbacks: [], requestTimeoutMs: 15000, enabled: true },
      ],
    });
    const engine = new InfrastructureEngine(cfg, () => NOW_MS);
    engine.initBreaker("ws:bybit", "ws");
    engine.initBreaker("ws:okx", "ws");
    engine.initBreaker("ws:deribit", "ws");

    // Trip the primary.
    for (let i = 0; i < 5; i++) engine.recordFailure("ws:bybit");

    const target = engine.getFailoverTarget("ws", "ws:bybit");
    expect(target).toBe("ws:okx");
  });

  test("returns null when no failover available", () => {
    const engine = new InfrastructureEngine(config(), () => NOW_MS);
    engine.initBreaker("ws:bybit", "ws");

    const target = engine.getFailoverTarget("ws", "ws:bybit");
    expect(target).toBeNull();
  });

  test("failover skips down fallbacks", () => {
    const cfg = config({
      failoverConfigs: [
        { connectorType: "ws", fallbacks: ["ws:okx", "ws:deribit"], requestTimeoutMs: 5000, enabled: true },
        { connectorType: "rest", fallbacks: [], requestTimeoutMs: 10000, enabled: true },
        { connectorType: "rpc", fallbacks: [], requestTimeoutMs: 15000, enabled: true },
      ],
    });
    const engine = new InfrastructureEngine(cfg, () => NOW_MS);
    engine.initBreaker("ws:bybit", "ws");
    engine.initBreaker("ws:okx", "ws");
    engine.initBreaker("ws:deribit", "ws");

    // Trip both primary and first fallback.
    for (let i = 0; i < 5; i++) engine.recordFailure("ws:bybit");
    for (let i = 0; i < 5; i++) engine.recordFailure("ws:okx");

    const target = engine.getFailoverTarget("ws", "ws:bybit");
    expect(target).toBe("ws:deribit");
  });

  test("evaluateBreakers returns all open component ids", () => {
    const engine = new InfrastructureEngine(config(), () => NOW_MS);
    engine.initBreaker("ws:bybit", "ws");
    engine.initBreaker("rest:binance", "rest");
    engine.initBreaker("rpc:ethereum", "rpc");

    for (let i = 0; i < 5; i++) engine.recordFailure("ws:bybit");
    for (let i = 0; i < 5; i++) engine.recordFailure("rest:binance");

    const openBreakers = engine.evaluateBreakers(NOW_MS);
    expect(openBreakers).toContain("ws:bybit");
    expect(openBreakers).toContain("rest:binance");
    expect(openBreakers).not.toContain("rpc:ethereum");
  });
});

// ── AC3: Secrets, Rotation, Backups ─────────────────────────────────

describe("AC3: Secrets are managed; keys rotate; state is backed up", () => {
  test("records and tracks a secret", () => {
    const engine = new InfrastructureEngine(config(), () => NOW_MS);
    engine.recordSecret(secret());

    const s = engine.getSecret("key-bybit-trading");
    expect(s).toBeDefined();
    expect(s!.active).toBe(true);
  });

  test("detects secret needing rotation", () => {
    const engine = new InfrastructureEngine(config(), () => NOW_MS);
    engine.recordSecret(secret({
      lastRotatedAtMs: NOW_MS - 100 * ONE_DAY, // 100 days ago, rotation interval is 90 days.
    }));

    const result = engine.evaluateSecrets(NOW_MS);
    expect(result.ok).toBe(false);
    expect(result.needingRotation).toBe(1);
  });

  test("detects expired secret", () => {
    const engine = new InfrastructureEngine(config(), () => NOW_MS);
    engine.recordSecret(secret({
      expiresAtMs: NOW_MS - ONE_DAY, // expired yesterday.
      rotationIntervalMs: 0, // no rotation schedule.
    }));

    const result = engine.evaluateSecrets(NOW_MS);
    expect(result.ok).toBe(false);
    expect(result.needingRotation).toBe(1);
  });

  test("detects inactive secret", () => {
    const engine = new InfrastructureEngine(config(), () => NOW_MS);
    engine.recordSecret(secret({
      active: false,
      rotationIntervalMs: 0,
      expiresAtMs: 0,
    }));

    const result = engine.evaluateSecrets(NOW_MS);
    expect(result.ok).toBe(false);
    expect(result.needingRotation).toBe(1);
  });

  test("secrets are OK when all are current and active", () => {
    const engine = new InfrastructureEngine(config(), () => NOW_MS);
    engine.recordSecret(secret()); // rotated 1 day ago, interval 90 days.

    const result = engine.evaluateSecrets(NOW_MS);
    expect(result.ok).toBe(true);
    expect(result.needingRotation).toBe(0);
  });

  test("records and tracks backups", () => {
    const engine = new InfrastructureEngine(config(), () => NOW_MS);
    engine.recordBackup(backup());

    const backups = engine.getBackups();
    expect(backups).toHaveLength(1);
    expect(backups[0].verified).toBe(true);
  });

  test("evaluateBackups checks verified count against minimum", () => {
    const engine = new InfrastructureEngine(config(), () => NOW_MS);
    // Default min retention is 3.
    engine.recordBackup(backup({ backupId: "b1" }));
    engine.recordBackup(backup({ backupId: "b2" }));

    const result = engine.evaluateBackups();
    expect(result.ok).toBe(false);
    expect(result.count).toBe(2);

    engine.recordBackup(backup({ backupId: "b3" }));
    const result2 = engine.evaluateBackups();
    expect(result2.ok).toBe(true);
    expect(result2.count).toBe(3);
  });

  test("unverified backups don't count toward retention", () => {
    const engine = new InfrastructureEngine(config(), () => NOW_MS);
    engine.recordBackup(backup({ backupId: "b1", verified: false }));
    engine.recordBackup(backup({ backupId: "b2", verified: true }));
    engine.recordBackup(backup({ backupId: "b3", verified: true }));

    const result = engine.evaluateBackups();
    expect(result.ok).toBe(false); // only 2 verified, need 3.
    expect(result.count).toBe(2);
  });
});

// ── AC4: Degradation Safety ─────────────────────────────────────────

describe("AC4: Simulated partial failure degrades permissions/exposure, never increases risk", () => {
  test("all healthy → no mode change", () => {
    const engine = new InfrastructureEngine(config(), () => NOW_MS);
    engine.registerComponent(health());
    for (let i = 0; i < 3; i++) engine.recordBackup(backup({ backupId: `b${i}` }));

    const result = engine.evaluateDegradation("NORMAL", NOW_MS);
    expect(result.resultingMode).toBe("NORMAL");
    expect(result.modeDowngraded).toBe(false);
  });

  test("unhealthy component → at least OBSERVE_ONLY", () => {
    const engine = new InfrastructureEngine(config(), () => NOW_MS);
    engine.registerComponent(health({
      lastHeartbeatMs: NOW_MS - 60_000, // stale
    }));
    for (let i = 0; i < 3; i++) engine.recordBackup(backup({ backupId: `b${i}` }));

    const result = engine.evaluateDegradation("NORMAL", NOW_MS);
    expect(result.resultingMode).toBe("OBSERVE_ONLY");
    expect(result.modeDowngraded).toBe(true);
    expect(result.unhealthyComponents).toContain("ws:bybit");
  });

  test("open circuit breaker → at least SIGNAL_ONLY", () => {
    const engine = new InfrastructureEngine(config(), () => NOW_MS);
    engine.registerComponent(health());
    for (let i = 0; i < 3; i++) engine.recordBackup(backup({ backupId: `b${i}` }));
    engine.initBreaker("ws:bybit", "ws");
    for (let i = 0; i < 5; i++) engine.recordFailure("ws:bybit");

    const result = engine.evaluateDegradation("NORMAL", NOW_MS);
    expect(result.resultingMode).toBe("SIGNAL_ONLY");
    expect(result.modeDowngraded).toBe(true);
    expect(result.openBreakers).toContain("ws:bybit");
  });

  test("secrets need rotation → at least REDUCE_ONLY", () => {
    const engine = new InfrastructureEngine(config(), () => NOW_MS);
    engine.registerComponent(health());
    for (let i = 0; i < 3; i++) engine.recordBackup(backup({ backupId: `b${i}` }));
    engine.recordSecret(secret({
      lastRotatedAtMs: NOW_MS - 100 * ONE_DAY, // overdue
    }));

    const result = engine.evaluateDegradation("NORMAL", NOW_MS);
    expect(result.resultingMode).toBe("REDUCE_ONLY");
    expect(result.modeDowngraded).toBe(true);
  });

  test("no verified backups → at least CANCEL_ONLY", () => {
    const engine = new InfrastructureEngine(config(), () => NOW_MS);
    engine.registerComponent(health());

    // No backups recorded → not enough verified backups.
    const result = engine.evaluateDegradation("NORMAL", NOW_MS);
    expect(result.resultingMode).toBe("CANCEL_ONLY");
    expect(result.modeDowngraded).toBe(true);
  });

  test("error budget exhausted → HALT", () => {
    const engine = new InfrastructureEngine(config(), () => NOW_MS);
    engine.registerComponent(health());

    for (let i = 0; i < 3; i++) engine.recordBackup(backup({ backupId: `b${i}` }));
    // Record enough observations to meet minObservations (10) with > 1% failure.
    for (let i = 0; i < 10; i++) engine.recordObservation(true);
    for (let i = 0; i < 3; i++) engine.recordObservation(false); // 3 failures out of 13 → ~23% failure rate.

    const result = engine.evaluateDegradation("NORMAL", NOW_MS);
    expect(result.resultingMode).toBe("HALT");
    expect(result.modeDowngraded).toBe(true);
    expect(result.errorBudgetExhausted).toBe(true);
  });

  test("multiple failures → most restrictive mode wins", () => {
    const engine = new InfrastructureEngine(config(), () => NOW_MS);
    engine.registerComponent(health({
      lastHeartbeatMs: NOW_MS - 60_000, // unhealthy
    }));
    for (let i = 0; i < 3; i++) engine.recordBackup(backup({ backupId: `b${i}` }));
    engine.initBreaker("ws:bybit", "ws");
    for (let i = 0; i < 5; i++) engine.recordFailure("ws:bybit"); // open breaker

    const result = engine.evaluateDegradation("NORMAL", NOW_MS);
    // Open breaker is more restrictive than unhealthy, so SIGNAL_ONLY.
    expect(result.resultingMode).toBe("SIGNAL_ONLY");
  });

  // ── SAFETY INVARIANT: mode never goes UP ──────────────────────

  test("SAFETY: never upgrades mode from SIGNAL_ONLY to less restrictive", () => {
    const engine = new InfrastructureEngine(config(), () => NOW_MS);
    engine.registerComponent(health());
    for (let i = 0; i < 3; i++) engine.recordBackup(backup({ backupId: `b${i}` }));

    const result = engine.evaluateDegradation("SIGNAL_ONLY", NOW_MS);
    expect(result.resultingMode).toBe("SIGNAL_ONLY");
    expect(modeIndex(result.resultingMode)).toBeGreaterThanOrEqual(modeIndex("SIGNAL_ONLY"));
  });

  test("SAFETY: never upgrades mode from REDUCE_ONLY", () => {
    const engine = new InfrastructureEngine(config(), () => NOW_MS);
    engine.registerComponent(health());

    const result = engine.evaluateDegradation("REDUCE_ONLY", NOW_MS);
    // REDUCE_ONLY + no backups → CANCEL_ONLY (more restrictive, which is fine).
    expect(modeIndex(result.resultingMode)).toBeGreaterThanOrEqual(modeIndex("REDUCE_ONLY"));
  });

  test("SAFETY: already HALT stays HALT regardless of infrastructure", () => {
    const engine = new InfrastructureEngine(config(), () => NOW_MS);
    engine.registerComponent(health());
    engine.recordSecret(secret()); // secrets OK.

    const result = engine.evaluateDegradation("HALT", NOW_MS);
    expect(result.resultingMode).toBe("HALT");
  });

  test("SAFETY: partial failure (1 unhealthy out of 3) only downgrades", () => {
    const engine = new InfrastructureEngine(config(), () => NOW_MS);
    engine.registerComponent(health({
      componentId: "ws:bybit",
      lastHeartbeatMs: NOW_MS - 60_000, // unhealthy
    }));
    engine.registerComponent(health({
      componentId: "rest:binance",
      lastHeartbeatMs: NOW_MS, // healthy
    }));
    engine.registerComponent(health({
      componentId: "rpc:ethereum",
      lastHeartbeatMs: NOW_MS, // healthy
    }));

    const result = engine.evaluateDegradation("NORMAL", NOW_MS);
    expect(modeIndex(result.resultingMode)).toBeGreaterThanOrEqual(modeIndex("NORMAL"));
    expect(result.modeDowngraded).toBe(true);
  });

  test("SAFETY: secrets OK + backups OK → mode limited only by health/breakers", () => {
    const engine = new InfrastructureEngine(config(), () => NOW_MS);
    engine.registerComponent(health());
    // Provide enough verified backups.
    for (let i = 0; i < 3; i++) engine.recordBackup(backup({ backupId: `b${i}` }));
    // Secrets are fresh.

    const result = engine.evaluateDegradation("NORMAL", NOW_MS);
    expect(result.resultingMode).toBe("NORMAL");
  });

  test("SAFETY: cascading degradation covers all severity levels", () => {
    const engine = new InfrastructureEngine(config(), () => NOW_MS);
    engine.registerComponent(health({
      lastHeartbeatMs: NOW_MS - 60_000, // unhealthy
    }));
    engine.initBreaker("ws:bybit", "ws");
    for (let i = 0; i < 5; i++) engine.recordFailure("ws:bybit"); // open
    engine.recordSecret(secret({
      lastRotatedAtMs: NOW_MS - 100 * ONE_DAY, // needs rotation
    }));
    // No backups → CANCEL_ONLY
    // Error budget → HALT
    for (let i = 0; i < 10; i++) engine.recordObservation(true);
    engine.recordObservation(false);

    const result = engine.evaluateDegradation("NORMAL", NOW_MS);
    expect(result.resultingMode).toBe("HALT");
    expect(modeIndex(result.resultingMode)).toBeGreaterThanOrEqual(modeIndex("NORMAL"));
  });
});

// ── Full Status Evaluation ──────────────────────────────────────────

describe("Full status evaluation", () => {
  test("produces a complete InfrastructureStatus", () => {
    const engine = new InfrastructureEngine(config(), () => NOW_MS);
    engine.registerComponent(health());
    engine.initBreaker("ws:bybit", "ws");
    engine.recordSecret(secret());
    engine.recordBackup(backup());

    const status = engine.evaluate(NOW_MS);
    expect(status.components).toHaveLength(1);
    expect(status.breakers).toHaveLength(1);
    expect(status.secretsOk).toBe(true);
    expect(status.backupsOk).toBe(false); // only 1 backup, need 3.
    expect(status.degradation.resultingMode).toBeDefined();
  });

  test("status passes the contract validator", () => {
    const engine = new InfrastructureEngine(config(), () => NOW_MS);
    engine.registerComponent(health());
    engine.recordSecret(secret());
    engine.recordBackup(backup());

    const status = engine.evaluate(NOW_MS);
    expect(isInfrastructureStatus(status)).toBe(true);
  });
});

// ── Engine Constructor Defaults ─────────────────────────────────────

describe("Engine defaults", () => {
  test("uses default config when none provided", () => {
    const engine = new InfrastructureEngine();
    engine.registerComponent(health());
    const result = engine.evaluate(NOW_MS);
    expect(result).toBeDefined();
  });

  test("custom failure threshold", () => {
    const engine = new InfrastructureEngine(config({
      circuitBreakerDefaults: { failureThreshold: 2, cooldownMs: 30_000 },
    }), () => NOW_MS);
    engine.initBreaker("ws:bybit", "ws");

    engine.recordFailure("ws:bybit");
    expect(engine.getBreaker("ws:bybit")!.state).toBe("closed");

    engine.recordFailure("ws:bybit");
    expect(engine.getBreaker("ws:bybit")!.state).toBe("open");
  });

  test("custom error budget", () => {
    const engine = new InfrastructureEngine(config({
      errorBudget: { allowedFailureRate: 0.5, windowMs: ONE_HOUR, minObservations: 5 },
    }), () => NOW_MS);

    // 3 failures out of 6 = 50% → at budget limit (not exceeded).
    for (let i = 0; i < 3; i++) engine.recordObservation(true);
    for (let i = 0; i < 3; i++) engine.recordObservation(false);

    const budget = engine.evaluateErrorBudget(NOW_MS);
    expect(budget.budgetExhausted).toBe(false); // 50% = not > 50%

    // 5 failures out of 9 = ~56% → exceeds budget.
    engine.recordObservation(false);
    engine.recordObservation(false);
    engine.recordObservation(true);
    const budget2 = engine.evaluateErrorBudget(NOW_MS);
    expect(budget2.budgetExhausted).toBe(true);
  });
});


