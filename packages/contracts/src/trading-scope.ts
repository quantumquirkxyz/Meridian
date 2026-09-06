/**
 * TradingScope and GeneralAgentRecommendation types (ADR-0013).
 *
 * A trading scope is the pair's liquidity context at a venue:
 * - CEX: (venue, pair) — the order book is the pool
 * - DEX: (venue, pool, pair) — a pool is smart-contract liquidity
 *
 * Each general agent owns exactly one scope and emits a recommendation
 * per cycle that enters the Risk Engine gate.
 */

import {
  isArrayOf,
  isEnumOf,
  isNumber,
  isObjectOf,
  isOptional,
  isString,
  parse,
  type Validator,
} from "./schema.ts";
import { isAgentOutput, type AgentOutput } from "./agent.ts";
import { isOrderIntent, type OrderIntent } from "./order.ts";

// ── Trading Scope ────────────────────────────────────────────────────

export const TRADING_SCOPE_KINDS = ["CEX", "DEX"] as const;
export type TradingScopeKind = (typeof TRADING_SCOPE_KINDS)[number];

export interface TradingScope {
  /** "CEX" for order-book venues, "DEX" for on-chain pools. */
  kind: TradingScopeKind;
  /** Venue identifier, e.g. "bybit", "binance", "pancakeswap-v4". */
  venue: string;
  /** Trading pair, e.g. "BTC/USDT", "BNB/USDT". */
  pair: string;
  /** DEX-only: pool identifier (contract address or name). */
  pool?: string;
  /** DEX-only: chain identifier, e.g. "bsc", "ethereum". */
  chain?: string;
}

const isTradingScopeKind: Validator<TradingScopeKind> = isEnumOf(TRADING_SCOPE_KINDS);

export const isTradingScope: Validator<TradingScope> = isObjectOf({
  kind: isTradingScopeKind,
  venue: isString,
  pair: isString,
  pool: isOptional(isString),
  chain: isOptional(isString),
});

export function parseTradingScope(value: unknown): TradingScope {
  return parse(isTradingScope, value, "TradingScope");
}

/**
 * Derive a stable, unique identifier for a trading scope.
 * CEX: "bybit:BTC/USDT"
 * DEX: "pancakeswap-v4:0xpool:BNB/USDT"
 */
export function scopeIdOf(scope: TradingScope): string {
  if (scope.kind === "DEX") {
    return `${scope.venue}:${scope.pool ?? "?"}:${scope.pair}`;
  }
  return `${scope.venue}:${scope.pair}`;
}

// ── General Agent Recommendation ─────────────────────────────────────

export const GENERAL_AGENT_SIGNALS = ["BUY", "SELL", "HOLD"] as const;
export type GeneralAgentSignal = (typeof GENERAL_AGENT_SIGNALS)[number];

/**
 * GeneralAgentRecommendation: the single output of a general agent per
 * trading scope per cycle. Emitted into the Risk Engine gate (ADR-0003:
 * no agent executes, approves risk, or moves funds).
 */
export interface GeneralAgentRecommendation {
  /** Stable scope identifier from scopeIdOf(). */
  scopeId: string;
  /** Agent ID of the general agent that produced this recommendation. */
  agentId: string;
  /** Trading scope this recommendation applies to. */
  scope: TradingScope;
  /** Regime classification observed for this scope's market data. */
  regime: string;
  /** Signal: BUY, SELL, or HOLD. HOLD means no action. */
  signal: GeneralAgentSignal;
  /** Confidence in the recommendation (0..1). */
  confidence: number;
  /** Human-readable reasoning for the recommendation. */
  reasoning: string;
  /** Catalog agent IDs that were consulted for this recommendation. */
  subAgentIds: string[];
  /** Structured outputs from consulted sub-agents. */
  subAgentOutputs: AgentOutput[];
  /** Optional order intent to submit if signal is BUY or SELL. */
  suggestedIntent?: OrderIntent;
  /** Timestamp of this recommendation (Unix ms). */
  timestampMs: number;
}

const isGeneralAgentSignal: Validator<GeneralAgentSignal> = isEnumOf(GENERAL_AGENT_SIGNALS);

export const isGeneralAgentRecommendation: Validator<GeneralAgentRecommendation> = isObjectOf({
  scopeId: isString,
  agentId: isString,
  scope: isTradingScope,
  regime: isString,
  signal: isGeneralAgentSignal,
  confidence: isNumber,
  reasoning: isString,
  subAgentIds: isArrayOf(isString),
  subAgentOutputs: isArrayOf(isAgentOutput),
  suggestedIntent: isOptional(isOrderIntent),
  timestampMs: isNumber,
});

export function parseGeneralAgentRecommendation(value: unknown): GeneralAgentRecommendation {
  return parse(isGeneralAgentRecommendation, value, "GeneralAgentRecommendation");
}
