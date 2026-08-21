import {
  isArrayOf,
  isBoolean,
  isEnumOf,
  isNumber,
  isObjectOf,
  isOptional,
  isRecordOf,
  isString,
  parse,
  type Validator,
} from "./schema.ts";
import { isSystemMode, type SystemMode } from "./modes.ts";

/**
 * Regime adaptation contract (issue #35).
 *
 * A RegimeClassifier produces a RegimeClassification (regime + confidence)
 * from market signals. A RegimePolicyEngine maps each regime to a
 * deterministic RegimePolicy that defines permissions, limits, enabled
 * strategies, and emergency actions.
 *
 * Invariants:
 *   - Regime changes never increase permissions without deterministic
 *     validation (fail-closed).
 *   - Every regime change is audited (RegimeChange record).
 *   - Per-regime performance is tracked (RegimePerformanceRecord).
 */

// ── Regime Enum ──────────────────────────────────────────────────────

/**
 * MarketRegime: the set of deterministic regime classifications.
 * Each regime represents a distinct market condition that affects
 * trading permissions and risk parameters.
 */
export const MARKET_REGIMES = [
  "trend",
  "range",
  "chop",
  "high_volatility",
  "low_liquidity",
  "gas_spike",
  "degraded_rpc",
  "degraded_cex",
  "drawdown",
] as const;

export type MarketRegime = (typeof MARKET_REGIMES)[number];

export const isMarketRegime: Validator<MarketRegime> = isEnumOf(MARKET_REGIMES);

// ── Regime Classification ────────────────────────────────────────────

/**
 * RegimeClassification: the output of the regime classifier.
 * Contains the regime, a confidence score [0, 1], and the reason
 * for the classification.
 */
export interface RegimeClassification {
  /** The classified market regime. */
  regime: MarketRegime;
  /** Confidence score in [0, 1]. Higher = more certain. */
  confidence: number;
  /** Human-readable reason for this classification. */
  reason: string;
  /** Timestamp of classification (Unix ms). */
  classifiedAtMs: number;
}

export const isRegimeClassification: Validator<RegimeClassification> =
  isObjectOf({
    regime: isMarketRegime,
    confidence: isNumber,
    reason: isString,
    classifiedAtMs: isNumber,
  });

export function parseRegimeClassification(value: unknown): RegimeClassification {
  return parse(isRegimeClassification, value, "RegimeClassification");
}

// ── Emergency Action ─────────────────────────────────────────────────

/**
 * RegimeEmergencyAction: an emergency action triggered by a regime change.
 * The policy engine may emit these when the regime degrades.
 */
export const REGIME_EMERGENCY_ACTIONS = [
  "none",
  "reduce_only",
  "cash_only",
  "cancel_all",
  "halt",
] as const;

export type RegimeEmergencyAction =
  (typeof REGIME_EMERGENCY_ACTIONS)[number];

export const isRegimeEmergencyAction: Validator<RegimeEmergencyAction> =
  isEnumOf(REGIME_EMERGENCY_ACTIONS);

// ── Regime Policy ────────────────────────────────────────────────────

/**
 * RegimePolicy: the deterministic mapping from a regime to trading
 * permissions, limits, enabled strategies, and emergency actions.
 *
 * Every field in RegimePolicy is a constraint — the policy engine
 * applies the most restrictive policy across consecutive regimes.
 */
export interface RegimePolicy {
  /** Which regime this policy applies to. */
  regime: MarketRegime;

  /** Whether the system is allowed to execute new orders in this regime. */
  tradingEnabled: boolean;

  /** Maximum number of concurrent open orders. */
  maxOpenOrders: number;

  /** Maximum order notional (USD). */
  maxOrderNotionalUsd: number;

  /** Maximum daily notional (USD). */
  maxDailyNotionalUsd: number;

  /** Maximum slippage (basis points). */
  maxSlippageBps: number;

  /** Maximum gas cost (USD). */
  maxGasUsd: number;

  /** Strategy IDs enabled for this regime. */
  enabledStrategies: readonly string[];

  /** Emergency action to take when transitioning to this regime. */
  emergencyAction: RegimeEmergencyAction;

  /** System mode to enforce in this regime. */
  mode: SystemMode;
}

export const isRegimePolicy: Validator<RegimePolicy> = isObjectOf({
  regime: isMarketRegime,
  tradingEnabled: isBoolean,
  maxOpenOrders: isNumber,
  maxOrderNotionalUsd: isNumber,
  maxDailyNotionalUsd: isNumber,
  maxSlippageBps: isNumber,
  maxGasUsd: isNumber,
  enabledStrategies: isArrayOf(isString),
  emergencyAction: isRegimeEmergencyAction,
  mode: isSystemMode,
});

export function parseRegimePolicy(value: unknown): RegimePolicy {
  return parse(isRegimePolicy, value, "RegimePolicy");
}

// ── Regime Policy Config ─────────────────────────────────────────────

/**
 * RegimePolicyConfig: the complete set of per-regime policies that the
 * RegimePolicyEngine uses. Each market regime maps to exactly one policy.
 */
export interface RegimePolicyConfig {
  /** Unique identifier for this policy configuration. */
  configId: string;
  /** Human-readable name. */
  name: string;
  /** Per-regime policies. Every MarketRegime must have a policy. */
  policies: Record<MarketRegime, RegimePolicy>;
}

export const isRegimePolicyConfig: Validator<RegimePolicyConfig> = isObjectOf({
  configId: isString,
  name: isString,
  policies: isRecordOf(isRegimePolicy) as Validator<Record<MarketRegime, RegimePolicy>>,
});

export function parseRegimePolicyConfig(value: unknown): RegimePolicyConfig {
  return parse(isRegimePolicyConfig, value, "RegimePolicyConfig");
}

// ── Regime Change (Audit Record) ─────────────────────────────────────

/**
 * RegimeChange: an immutable audit record of every regime transition.
 * Emitted by the policy engine on every regime change.
 */
export interface RegimeChange {
  /** Unique ID for this regime change event. */
  eventId: string;
  /** Timestamp of the regime change (Unix ms). */
  timestampMs: number;
  /** The regime before this change (null if this is the initial regime). */
  previousRegime: MarketRegime | null;
  /** The new regime. */
  newRegime: MarketRegime;
  /** Confidence of the new regime classification. */
  confidence: number;
  /** Why the regime changed. */
  reason: string;
  /** Whether permissions were reduced (never increases without validation). */
  permissionsReduced: boolean;
  /** The policy applied after this change. */
  appliedPolicy: RegimePolicy;
}

export const isRegimeChange: Validator<RegimeChange> = isObjectOf({
  eventId: isString,
  timestampMs: isNumber,
  previousRegime: isNullable(isMarketRegime),
  newRegime: isMarketRegime,
  confidence: isNumber,
  reason: isString,
  permissionsReduced: isBoolean,
  appliedPolicy: isRegimePolicy,
});

function isNullable<T>(inner: Validator<T>): Validator<T | null> {
  return (value): value is T | null => value === null || inner(value);
}

export function parseRegimeChange(value: unknown): RegimeChange {
  return parse(isRegimeChange, value, "RegimeChange");
}

// ── Regime Performance Record ────────────────────────────────────────

/**
 * RegimePerformanceRecord: per-regime performance tracking.
 * Accumulates trade outcomes under each regime for analysis.
 */
export interface RegimePerformanceRecord {
  /** The regime this performance is tracked under. */
  regime: MarketRegime;
  /** Number of trades executed under this regime. */
  tradeCount: number;
  /** Total PnL (USD) under this regime. Negative = loss. */
  totalPnlUsd: number;
  /** Number of winning trades. */
  winCount: number;
  /** Number of losing trades. */
  lossCount: number;
  /** Maximum drawdown (USD) under this regime. */
  maxDrawdownUsd: number;
  /** Average confidence of classifications under this regime. */
  avgConfidence: number;
  /** Number of confidence samples used for averaging. */
  confidenceSamples: number;
  /** Total time (ms) spent in this regime. */
  totalTimeMs: number;
}

export const isRegimePerformanceRecord: Validator<RegimePerformanceRecord> =
  isObjectOf({
    regime: isMarketRegime,
    tradeCount: isNumber,
    totalPnlUsd: isNumber,
    winCount: isNumber,
    lossCount: isNumber,
    maxDrawdownUsd: isNumber,
    avgConfidence: isNumber,
    confidenceSamples: isNumber,
    totalTimeMs: isNumber,
  });

export function parseRegimePerformanceRecord(
  value: unknown,
): RegimePerformanceRecord {
  return parse(isRegimePerformanceRecord, value, "RegimePerformanceRecord");
}

// ── Default Regime Policy Config ─────────────────────────────────────

/**
 * A conservative default regime policy configuration.
 * Every regime is defined; restrictive regimes disable trading
 * or enforce tighter limits.
 */
export const DEFAULT_REGIME_POLICY_CONFIG: RegimePolicyConfig = {
  configId: "regime-policy-default-1",
  name: "Default Regime Policy",
  policies: {
    trend: {
      regime: "trend",
      tradingEnabled: true,
      maxOpenOrders: 5,
      maxOrderNotionalUsd: 500,
      maxDailyNotionalUsd: 2_000,
      maxSlippageBps: 25,
      maxGasUsd: 10,
      enabledStrategies: ["arbitrage-alpha", "momentum-follow"],
      emergencyAction: "none",
      mode: "NORMAL",
    },
    range: {
      regime: "range",
      tradingEnabled: true,
      maxOpenOrders: 4,
      maxOrderNotionalUsd: 400,
      maxDailyNotionalUsd: 1_500,
      maxSlippageBps: 20,
      maxGasUsd: 10,
      enabledStrategies: ["arbitrage-alpha", "mean-reversion"],
      emergencyAction: "none",
      mode: "NORMAL",
    },
    chop: {
      regime: "chop",
      tradingEnabled: true,
      maxOpenOrders: 2,
      maxOrderNotionalUsd: 200,
      maxDailyNotionalUsd: 800,
      maxSlippageBps: 15,
      maxGasUsd: 8,
      enabledStrategies: ["arbitrage-alpha"],
      emergencyAction: "none",
      mode: "REDUCE_ONLY",
    },
    high_volatility: {
      regime: "high_volatility",
      tradingEnabled: true,
      maxOpenOrders: 2,
      maxOrderNotionalUsd: 150,
      maxDailyNotionalUsd: 600,
      maxSlippageBps: 10,
      maxGasUsd: 5,
      enabledStrategies: ["arbitrage-alpha"],
      emergencyAction: "reduce_only",
      mode: "REDUCE_ONLY",
    },
    low_liquidity: {
      regime: "low_liquidity",
      tradingEnabled: true,
      maxOpenOrders: 1,
      maxOrderNotionalUsd: 100,
      maxDailyNotionalUsd: 400,
      maxSlippageBps: 30,
      maxGasUsd: 5,
      enabledStrategies: ["arbitrage-alpha"],
      emergencyAction: "reduce_only",
      mode: "REDUCE_ONLY",
    },
    gas_spike: {
      regime: "gas_spike",
      tradingEnabled: false,
      maxOpenOrders: 0,
      maxOrderNotionalUsd: 0,
      maxDailyNotionalUsd: 0,
      maxSlippageBps: 0,
      maxGasUsd: 0,
      enabledStrategies: [],
      emergencyAction: "cancel_all",
      mode: "CASH_ONLY",
    },
    degraded_rpc: {
      regime: "degraded_rpc",
      tradingEnabled: false,
      maxOpenOrders: 0,
      maxOrderNotionalUsd: 0,
      maxDailyNotionalUsd: 0,
      maxSlippageBps: 0,
      maxGasUsd: 0,
      enabledStrategies: [],
      emergencyAction: "cancel_all",
      mode: "CASH_ONLY",
    },
    degraded_cex: {
      regime: "degraded_cex",
      tradingEnabled: false,
      maxOpenOrders: 0,
      maxOrderNotionalUsd: 0,
      maxDailyNotionalUsd: 0,
      maxSlippageBps: 0,
      maxGasUsd: 0,
      enabledStrategies: [],
      emergencyAction: "cancel_all",
      mode: "CASH_ONLY",
    },
    drawdown: {
      regime: "drawdown",
      tradingEnabled: false,
      maxOpenOrders: 0,
      maxOrderNotionalUsd: 0,
      maxDailyNotionalUsd: 0,
      maxSlippageBps: 0,
      maxGasUsd: 0,
      enabledStrategies: [],
      emergencyAction: "halt",
      mode: "HALT",
    },
  },
};
