import {
  isArrayOf,
  isBoolean,
  isNumber,
  isObjectOf,
  isOptional,
  isString,
  parse,
  type Validator,
} from "./schema.ts";

/**
 * CanaryConfig: the complete configuration for a Live Canary session
 * (Gamma.1, issue #34). Enforces bounded capital, hard limits, and
 * safety constraints that prevent unbounded risk during live operation.
 *
 * The canary is deliberately conservative: few strategies, few venues,
 * small sizes, no automatic scaling, and a manual+automatic kill switch.
 *
 * Acceptance criteria (AC1):
 *   - Canary config enforces bounded capital and hard limits per
 *     trade/day/venue/token/chain.
 */

// ── Capital Limits ───────────────────────────────────────────────────

/**
 * Hard capital limits for the canary session. These are absolute bounds
 * that cannot be exceeded.
 */
export interface CanaryCapitalLimits {
  /** Total capital bucket (USD) the canary may deploy. Hard cap. */
  maxCapitalUsd: number;
  /** Maximum risk per single trade (USD). */
  maxRiskPerTradeUsd: number;
  /** Maximum cumulative loss per calendar day (USD). */
  maxDailyLossUsd: number;
  /** Maximum cumulative loss per calendar week (USD). */
  maxWeeklyLossUsd: number;
}

// ── Exposure Limits ──────────────────────────────────────────────────

/**
 * Per-dimension exposure limits. Each is a hard cap on the notional
 * (USD) exposure in that dimension.
 */
export interface CanaryExposureLimits {
  /** Maximum net exposure per token across all venues (USD). */
  maxExposurePerTokenUsd: number;
  /** Maximum net exposure per venue (USD). */
  maxExposurePerVenueUsd: number;
  /** Maximum net exposure per chain (USD). */
  maxExposurePerChainUsd: number;
}

// ── Order Limits ─────────────────────────────────────────────────────

/**
 * Operational order limits for the canary session.
 */
export interface CanaryOrderLimits {
  /** Maximum number of orders per calendar day. */
  maxOrdersPerDay: number;
  /** Maximum concurrent open orders. */
  maxOpenOrders: number;
  /** Maximum orders per calendar week. */
  maxOrdersPerWeek: number;
}

// ── Strategy and Venue Constraints ───────────────────────────────────

/**
 * Allowed strategies and venues. The canary operates with a deliberately
 * narrow scope to minimize risk during live testing.
 */
export interface CanaryScope {
  /** Strategy IDs allowed to operate in this canary. */
  allowedStrategyIds: readonly string[];
  /** Venue IDs allowed for live execution. */
  allowedVenues: readonly string[];
  /** Chain IDs allowed for live execution. */
  allowedChains: readonly string[];
  /** Token tickers allowed for live execution. */
  allowedTokens: readonly string[];
}

// ── API Key Configuration ────────────────────────────────────────────

/**
 * API key configuration with read/trading separation.
 * Acceptance criteria (AC2):
 *   - Read and trading keys are separate; withdrawals disabled.
 */
export interface CanaryApiKeyConfig {
  /** Read-only API key (market data, account info). */
  readApiKey: {
    keyId: string;
    /** Never stored in code; reference to secret store. */
    secretRef: string;
  };
  /** Trading API key (order placement, cancellation). */
  tradingApiKey: {
    keyId: string;
    /** Never stored in code; reference to secret store. */
    secretRef: string;
  };
  /** Withdrawals must be disabled on the trading key. */
  withdrawalsDisabled: boolean;
}

// ── Kill Switch Configuration ────────────────────────────────────────

/**
 * Automatic kill switch triggers. The canary can be halted automatically
 * when any of these conditions are met.
 */
export interface CanaryKillSwitchConfig {
  /** Automatic halt when daily loss exceeds this threshold (USD). */
  autoHaltDailyLossUsd?: number;
  /** Automatic halt when weekly loss exceeds this threshold (USD). */
  autoHaltWeeklyLossUsd?: number;
  /** Automatic halt when order count per day exceeds this threshold. */
  autoHaltOrdersPerDay?: number;
  /** Automatic halt when orphan orders are detected. */
  autoHaltOnOrphans: boolean;
  /** Automatic halt when reconciliation is unresolved. */
  autoHaltOnReconciliationMismatch: boolean;
  /** Cooldown (ms) between automatic kill switch activations. */
  cooldownMs?: number;
}

// ── Canary Config (complete) ─────────────────────────────────────────

/**
 * Complete CanaryConfig: the full configuration for a Live Canary session.
 * Combines all limit types, scope, API keys, kill switch config, and
 * behavioral flags.
 */
export interface CanaryConfig {
  /** Unique identifier for this canary configuration. */
  configId: string;
  /** Human-readable name. */
  name: string;

  /** Hard capital limits. */
  capitalLimits: CanaryCapitalLimits;
  /** Per-dimension exposure limits. */
  exposureLimits: CanaryExposureLimits;
  /** Order count limits. */
  orderLimits: CanaryOrderLimits;
  /** Allowed strategies, venues, chains, and tokens. */
  scope: CanaryScope;
  /** API key configuration with read/trading separation. */
  apiKeys: CanaryApiKeyConfig;
  /** Automatic kill switch triggers. */
  killSwitch: CanaryKillSwitchConfig;

  /**
   * No automatic scaling. When true, the system will never increase
   * position sizes, order counts, or capital deployment beyond the
   * configured limits — even if conditions appear favorable.
   */
  noAutomaticScaling: boolean;

  /**
   * Maximum notional (USD) per single order. Hard cap regardless of
   * other limits.
   */
  maxOrderNotionalUsd: number;

  /**
   * Maximum slippage (basis points) tolerated for any live order.
   */
  maxSlippageBps: number;

  /**
   * Maximum gas cost (USD) tolerated for any live order.
   */
  maxGasUsd: number;
}

// ── Validators ───────────────────────────────────────────────────────

const isCanaryCapitalLimits: Validator<CanaryCapitalLimits> = isObjectOf({
  maxCapitalUsd: isNumber,
  maxRiskPerTradeUsd: isNumber,
  maxDailyLossUsd: isNumber,
  maxWeeklyLossUsd: isNumber,
});

const isCanaryExposureLimits: Validator<CanaryExposureLimits> = isObjectOf({
  maxExposurePerTokenUsd: isNumber,
  maxExposurePerVenueUsd: isNumber,
  maxExposurePerChainUsd: isNumber,
});

const isCanaryOrderLimits: Validator<CanaryOrderLimits> = isObjectOf({
  maxOrdersPerDay: isNumber,
  maxOpenOrders: isNumber,
  maxOrdersPerWeek: isNumber,
});

const isCanaryScope: Validator<CanaryScope> = isObjectOf({
  allowedStrategyIds: isArrayOf(isString),
  allowedVenues: isArrayOf(isString),
  allowedChains: isArrayOf(isString),
  allowedTokens: isArrayOf(isString),
});

const isCanaryApiKeyConfig: Validator<CanaryApiKeyConfig> = isObjectOf({
  readApiKey: isObjectOf({
    keyId: isString,
    secretRef: isString,
  }),
  tradingApiKey: isObjectOf({
    keyId: isString,
    secretRef: isString,
  }),
  withdrawalsDisabled: isBoolean,
});

const isCanaryKillSwitchConfig: Validator<CanaryKillSwitchConfig> = isObjectOf({
  autoHaltDailyLossUsd: isOptional(isNumber),
  autoHaltWeeklyLossUsd: isOptional(isNumber),
  autoHaltOrdersPerDay: isOptional(isNumber),
  autoHaltOnOrphans: isBoolean,
  autoHaltOnReconciliationMismatch: isBoolean,
  cooldownMs: isOptional(isNumber),
});

export const isCanaryConfig: Validator<CanaryConfig> = isObjectOf({
  configId: isString,
  name: isString,
  capitalLimits: isCanaryCapitalLimits,
  exposureLimits: isCanaryExposureLimits,
  orderLimits: isCanaryOrderLimits,
  scope: isCanaryScope,
  apiKeys: isCanaryApiKeyConfig,
  killSwitch: isCanaryKillSwitchConfig,
  noAutomaticScaling: isBoolean,
  maxOrderNotionalUsd: isNumber,
  maxSlippageBps: isNumber,
  maxGasUsd: isNumber,
});

export function parseCanaryConfig(value: unknown): CanaryConfig {
  return parse(isCanaryConfig, value, "CanaryConfig");
}

// ── Default Canary Config ────────────────────────────────────────────

/**
 * A conservative default canary configuration suitable for initial
 * live testing. All values are intentionally small.
 */
export const DEFAULT_CANARY_CONFIG: CanaryConfig = {
  configId: "canary-default-1",
  name: "Default Live Canary",
  capitalLimits: {
    maxCapitalUsd: 1_000,
    maxRiskPerTradeUsd: 50,
    maxDailyLossUsd: 100,
    maxWeeklyLossUsd: 300,
  },
  exposureLimits: {
    maxExposurePerTokenUsd: 200,
    maxExposurePerVenueUsd: 500,
    maxExposurePerChainUsd: 500,
  },
  orderLimits: {
    maxOrdersPerDay: 20,
    maxOpenOrders: 5,
    maxOrdersPerWeek: 100,
  },
  scope: {
    allowedStrategyIds: ["arbitrage-alpha"],
    allowedVenues: ["bybit"],
    allowedChains: ["ethereum"],
    allowedTokens: ["BTC", "ETH", "USDT"],
  },
  apiKeys: {
    readApiKey: { keyId: "", secretRef: "" },
    tradingApiKey: { keyId: "", secretRef: "" },
    withdrawalsDisabled: true,
  },
  killSwitch: {
    autoHaltDailyLossUsd: 80,
    autoHaltWeeklyLossUsd: 250,
    autoHaltOrdersPerDay: 15,
    autoHaltOnOrphans: true,
    autoHaltOnReconciliationMismatch: true,
    cooldownMs: 60_000,
  },
  noAutomaticScaling: true,
  maxOrderNotionalUsd: 500,
  maxSlippageBps: 25,
  maxGasUsd: 10,
};
