/**
 * Build an OrderIntent from a per-scope general agent recommendation
 * (ADR-0013), for the Risk Engine gate.
 *
 * A directional (BUY/SELL) recommendation becomes an intent whose price is
 * the scope's current mid market and whose size is derived from the
 * maxTradeSizeUsd option (defaulting to 25 USD). HOLD never produces an
 * intent. The intent still requires Risk Engine approval before execution.
 */

import type {
  GeneralAgentRecommendation,
  OrderIntent,
} from "@agenttrading/contracts";

export interface RecommendationMarketState {
  bid: number;
  ask: number;
  mid: number;
  liquidityUsd: number;
}

export interface RecommendationIntentOptions {
  /** Injectable clock; defaults to Date.now. */
  now?: () => number;
  /** Max slippage in bps applied to the intent limits. */
  maxSlippageBps?: number;
  /** Max trade size in USD used to compute quantity from market mid. */
  maxTradeSizeUsd?: number;
}

/**
 * Convert a directional general agent recommendation into an OrderIntent.
 * Returns undefined for HOLD (no action).
 */
export function buildRecommendationIntent(
  rec: GeneralAgentRecommendation,
  market: RecommendationMarketState,
  options: RecommendationIntentOptions = {},
): OrderIntent | undefined {
  if (rec.signal !== "BUY" && rec.signal !== "SELL") {
    return undefined;
  }

  const now = options.now ?? (() => Date.now());
  const createdAtMs = now();
  const pairParts = rec.scope.pair.split("/");
  const quoteCurrency = pairParts.length === 2 ? pairParts[1] : "USDT";
  const symbol =
    rec.scope.kind === "CEX" ? rec.scope.pair.replace("/", "") : rec.scope.pair;

  const maxTradeUsd = options.maxTradeSizeUsd ?? 25;
  const quantity = market.mid > 0 ? maxTradeUsd / market.mid : 0.001;

  return {
    idempotencyKey: `general:${createdAtMs}:${rec.scopeId}`,
    opportunityId: `general:${rec.scopeId}`,
    venue: rec.scope.venue,
    symbol,
    side: rec.signal,
    quantity,
    price: market.mid,
    quoteCurrency,
    createdAtMs,
    expiresAtMs: createdAtMs + 60_000,
    limits: { maxSlippageBps: options.maxSlippageBps ?? 25 },
  };
}
