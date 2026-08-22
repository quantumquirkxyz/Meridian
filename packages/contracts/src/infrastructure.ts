import {
  isArrayOf,
  isBoolean,
  isEnumOf,
  isNumber,
  isObjectOf,
  isOptional,
  isString,
  parse,
  type Validator,
} from "./schema.ts";
import { isSystemMode, type SystemMode } from "./modes.ts";

/**
 * Infrastructure hardening contracts (issue #38).
 *
 * Provides the shared typed vocabulary for health checks, heartbeats,
 * circuit breakers, failover, secrets management, key rotation, state
 * backup, and error budgets.
 *
 * Acceptance criteria:
 *   AC1: Health checks and heartbeats cover every connector and service.
 *   AC2: Failover works for WS/REST/RPC; circuit breakers trigger.
 *   AC3: Secrets are managed; keys rotate; state is backed up.
 *   AC4: A simulated partial failure degrades permissions/exposure,
 *        never increases risk.
 */

// ── Health Check ────────────────────────────────────────────────────

/**
 * HealthCheckResult: the result of evaluating a single component's health.
 * A component can be a connector (WS/REST/RPC), a service (risk engine,
 * audit log, etc.), or any infrastructure dependency.
 */
export const HEALTH_STATES = ["healthy", "degraded", "unhealthy"] as const;
export type HealthState = (typeof HEALTH_STATES)[number];
export const isHealthState: Validator<HealthState> = isEnumOf(HEALTH_STATES);

export const COMPONENT_KINDS = [
  "connector",
  "service",
  "engine",
] as const;
export type ComponentKind = (typeof COMPONENT_KINDS)[number];
export const isComponentKind: Validator<ComponentKind> = isEnumOf(COMPONENT_KINDS);

export const CONNECTOR_TYPES = ["ws", "rest", "rpc"] as const;
export type ConnectorType = (typeof CONNECTOR_TYPES)[number];
export const isConnectorType: Validator<ConnectorType> = isEnumOf(CONNECTOR_TYPES);

/**
 * ComponentHealth: the health status of a single component.
 *
 * AC1: Health checks and heartbeats cover every connector and service.
 */
export interface ComponentHealth {
  /** Unique component identifier (e.g. "ws:bybit", "rest:binance", "rpc:ethereum"). */
  componentId: string;
  /** Whether this component is a connector, service, or engine. */
  kind: ComponentKind;
  /** If kind === "connector", the connector transport type. */
  connectorType?: ConnectorType;
  /** Current health state. */
  state: HealthState;
  /** Timestamp of the last successful heartbeat (Unix ms). */
  lastHeartbeatMs: number;
  /** Heartbeat interval (ms). If no heartbeat arrives within this window, the component is considered unhealthy. */
  heartbeatTimeoutMs: number;
  /** Optional human-readable health message. */
  message?: string;
}

export const isComponentHealth: Validator<ComponentHealth> = isObjectOf({
  componentId: isString,
  kind: isComponentKind,
  connectorType: isOptional(isConnectorType),
  state: isHealthState,
  lastHeartbeatMs: isNumber,
  heartbeatTimeoutMs: isNumber,
  message: isOptional(isString),
});

// ── Circuit Breaker ─────────────────────────────────────────────────

/**
 * Circuit breaker states per https://martinfowler.com/bliki/CircuitBreaker.html
 */
export const CIRCUIT_BREAKER_STATES = [
  "closed",
  "open",
  "half-open",
] as const;
export type CircuitBreakerState = (typeof CIRCUIT_BREAKER_STATES)[number];
export const isCircuitBreakerState: Validator<CircuitBreakerState> =
  isEnumOf(CIRCUIT_BREAKER_STATES);

/**
 * CircuitBreakerStatus: tracks the failure state of a single connector.
 *
 * AC2: Failover works for WS/REST/RPC; circuit breakers trigger.
 */
export interface CircuitBreakerStatus {
  /** Component this breaker protects. */
  componentId: string;
  /** Connector type (ws, rest, rpc). */
  connectorType: ConnectorType;
  /** Current breaker state. */
  state: CircuitBreakerState;
  /** Number of consecutive failures. Resets to 0 on success. */
  failureCount: number;
  /** Threshold at which the breaker trips to open. */
  failureThreshold: number;
  /** Timestamp when the breaker opened (Unix ms). 0 if not open. */
  openedAtMs: number;
  /** Cooldown (ms) before transitioning from open to half-open. */
  cooldownMs: number;
}

export const isCircuitBreakerStatus: Validator<CircuitBreakerStatus> = isObjectOf({
  componentId: isString,
  connectorType: isConnectorType,
  state: isCircuitBreakerState,
  failureCount: isNumber,
  failureThreshold: isNumber,
  openedAtMs: isNumber,
  cooldownMs: isNumber,
});

// ── Failover ────────────────────────────────────────────────────────

/**
 * FailoverConfig: configuration for failover behavior per connector type.
 *
 * AC2: Failover works for WS/REST/RPC; circuit breakers trigger.
 */
export interface FailoverConfig {
  /** Connector type this config applies to. */
  connectorType: ConnectorType;
  /** Ordered list of fallback component ids. */
  fallbacks: readonly string[];
  /** Maximum time (ms) to wait for a response before triggering failover. */
  requestTimeoutMs: number;
  /** Whether failover is enabled for this connector type. */
  enabled: boolean;
}

export const isFailoverConfig: Validator<FailoverConfig> = isObjectOf({
  connectorType: isConnectorType,
  fallbacks: isArrayOf(isString),
  requestTimeoutMs: isNumber,
  enabled: isBoolean,
});

// ── Secrets Management ──────────────────────────────────────────────

/**
 * SecretRecord: tracks the state of an API key or secret.
 *
 * AC3: Secrets are managed; keys rotate; state is backed up.
 */
export interface SecretRecord {
  /** Unique secret identifier. */
  secretId: string;
  /** Human-readable label (e.g. "bybit-trading-key"). */
  label: string;
  /** Reference to the secret store (never the actual value). */
  secretRef: string;
  /** Timestamp of last rotation (Unix ms). 0 if never rotated. */
  lastRotatedAtMs: number;
  /** Rotation interval (ms). Secrets older than this need rotation. */
  rotationIntervalMs: number;
  /** Timestamp when the secret expires (Unix ms). 0 if no expiry. */
  expiresAtMs: number;
  /** Whether the secret is currently active (usable). */
  active: boolean;
}

export const isSecretRecord: Validator<SecretRecord> = isObjectOf({
  secretId: isString,
  label: isString,
  secretRef: isString,
  lastRotatedAtMs: isNumber,
  rotationIntervalMs: isNumber,
  expiresAtMs: isNumber,
  active: isBoolean,
});

// ── State Backup ────────────────────────────────────────────────────

/**
 * BackupRecord: tracks a state backup.
 *
 * AC3: Secrets are managed; keys rotate; state is backed up.
 */
export interface BackupRecord {
  /** Unique backup identifier. */
  backupId: string;
  /** Timestamp when the backup was created (Unix ms). */
  createdAtMs: number;
  /** Size of the backup in bytes. */
  sizeBytes: number;
  /** Checksum of the backup (e.g. SHA-256 hex). */
  checksum: string;
  /** Whether the backup is verified (checksum validated). */
  verified: boolean;
}

export const isBackupRecord: Validator<BackupRecord> = isObjectOf({
  backupId: isString,
  createdAtMs: isNumber,
  sizeBytes: isNumber,
  checksum: isString,
  verified: isBoolean,
});

// ── Error Budget ────────────────────────────────────────────────────

/**
 * ErrorBudgetConfig: configuration for the error budget.
 */
export interface ErrorBudgetConfig {
  /** Allowed failure rate (0–1). E.g. 0.01 = 1% error budget. */
  allowedFailureRate: number;
  /** Evaluation window (ms). */
  windowMs: number;
  /** Minimum observations before budget evaluation is meaningful. */
  minObservations: number;
}

export const isErrorBudgetConfig: Validator<ErrorBudgetConfig> = isObjectOf({
  allowedFailureRate: isNumber,
  windowMs: isNumber,
  minObservations: isNumber,
});

/**
 * ErrorBudgetStatus: current error budget consumption.
 */
export interface ErrorBudgetStatus {
  /** Total observations in the current window. */
  totalObservations: number;
  /** Failed observations in the current window. */
  failedObservations: number;
  /** Actual failure rate (0–1). */
  actualFailureRate: number;
  /** Whether the error budget is exhausted. */
  budgetExhausted: boolean;
}

export const isErrorBudgetStatus: Validator<ErrorBudgetStatus> = isObjectOf({
  totalObservations: isNumber,
  failedObservations: isNumber,
  actualFailureRate: isNumber,
  budgetExhausted: isBoolean,
});

// ── Infrastructure Config ───────────────────────────────────────────

/**
 * InfrastructureConfig: the complete configuration for infrastructure
 * hardening. Covers health checks, circuit breakers, failover, secrets,
 * backups, and error budgets.
 */
export interface InfrastructureConfig {
  /** Unique config identifier. */
  configId: string;
  /** Health check defaults. */
  healthDefaults: {
    /** Default heartbeat timeout (ms) for components without explicit config. */
    heartbeatTimeoutMs: number;
    /** How often health is evaluated (ms). */
    evaluationIntervalMs: number;
  };
  /** Circuit breaker defaults. */
  circuitBreakerDefaults: {
    /** Failure count threshold to trip the breaker. */
    failureThreshold: number;
    /** Cooldown (ms) before half-open. */
    cooldownMs: number;
  };
  /** Failover configs per connector type. */
  failoverConfigs: readonly FailoverConfig[];
  /** Error budget configuration. */
  errorBudget: ErrorBudgetConfig;
  /** Backup interval (ms). 0 = no automatic backup. */
  backupIntervalMs: number;
  /** Minimum number of verified backups to retain. */
  minBackupRetention: number;
}

export const isInfrastructureConfig: Validator<InfrastructureConfig> = isObjectOf({
  configId: isString,
  healthDefaults: isObjectOf({
    heartbeatTimeoutMs: isNumber,
    evaluationIntervalMs: isNumber,
  }),
  circuitBreakerDefaults: isObjectOf({
    failureThreshold: isNumber,
    cooldownMs: isNumber,
  }),
  failoverConfigs: isArrayOf(isFailoverConfig),
  errorBudget: isErrorBudgetConfig,
  backupIntervalMs: isNumber,
  minBackupRetention: isNumber,
});

export function parseInfrastructureConfig(value: unknown): InfrastructureConfig {
  return parse(isInfrastructureConfig, value, "InfrastructureConfig");
}

// ── Degradation Result ──────────────────────────────────────────────

/**
 * DegradationResult: the outcome of evaluating the current infrastructure
 * state against degradation rules.
 *
 * AC4: A simulated partial failure degrades permissions/exposure,
 *      never increases risk.
 */
export interface DegradationResult {
  /** The resulting system mode. Must be ≤ the input mode on the safety ladder. */
  resultingMode: SystemMode;
  /** Whether the mode was downgraded from the input. */
  modeDowngraded: boolean;
  /** List of components that are unhealthy. */
  unhealthyComponents: readonly string[];
  /** List of circuit breakers that are open. */
  openBreakers: readonly string[];
  /** Whether the error budget is exhausted. */
  errorBudgetExhausted: boolean;
  /** Reason for the degraded mode, if applicable. */
  reason?: string;
}

export const isDegradationResult: Validator<DegradationResult> = isObjectOf({
  resultingMode: isSystemMode,
  modeDowngraded: isBoolean,
  unhealthyComponents: isArrayOf(isString),
  openBreakers: isArrayOf(isString),
  errorBudgetExhausted: isBoolean,
  reason: isOptional(isString),
});

// ── Infrastructure Status ───────────────────────────────────────────

/**
 * InfrastructureStatus: a complete snapshot of the infrastructure health.
 */
export interface InfrastructureStatus {
  /** Health status of all tracked components. */
  components: readonly ComponentHealth[];
  /** Circuit breaker status for all connectors. */
  breakers: readonly CircuitBreakerStatus[];
  /** Whether all secrets are current (not expired, not overdue for rotation). */
  secretsOk: boolean;
  /** Number of secrets that need rotation. */
  secretsNeedingRotation: number;
  /** Whether at least one verified backup exists. */
  backupsOk: boolean;
  /** Number of verified backups. */
  backupCount: number;
  /** Current error budget status. */
  errorBudget: ErrorBudgetStatus;
  /** Resulting degraded mode evaluation. */
  degradation: DegradationResult;
}

export const isInfrastructureStatus: Validator<InfrastructureStatus> = isObjectOf({
  components: isArrayOf(isComponentHealth),
  breakers: isArrayOf(isCircuitBreakerStatus),
  secretsOk: isBoolean,
  secretsNeedingRotation: isNumber,
  backupsOk: isBoolean,
  backupCount: isNumber,
  errorBudget: isErrorBudgetStatus,
  degradation: isDegradationResult,
});

// ── Default Config ──────────────────────────────────────────────────

/**
 * Conservative default infrastructure config.
 */
export const DEFAULT_INFRASTRUCTURE_CONFIG: InfrastructureConfig = {
  configId: "infra-default-1",
  healthDefaults: {
    heartbeatTimeoutMs: 30_000,
    evaluationIntervalMs: 10_000,
  },
  circuitBreakerDefaults: {
    failureThreshold: 5,
    cooldownMs: 60_000,
  },
  failoverConfigs: [
    {
      connectorType: "ws",
      fallbacks: [],
      requestTimeoutMs: 5_000,
      enabled: true,
    },
    {
      connectorType: "rest",
      fallbacks: [],
      requestTimeoutMs: 10_000,
      enabled: true,
    },
    {
      connectorType: "rpc",
      fallbacks: [],
      requestTimeoutMs: 15_000,
      enabled: true,
    },
  ],
  errorBudget: {
    allowedFailureRate: 0.01,
    windowMs: 3_600_000,
    minObservations: 10,
  },
  backupIntervalMs: 300_000,
  minBackupRetention: 3,
};
