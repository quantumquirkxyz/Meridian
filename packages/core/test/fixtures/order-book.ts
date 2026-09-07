import type { EdgeWeights, MarketEdgeType } from "@agenttrading/contracts";

/** Two-hop ORDER_BOOK route used as the canonical cost fixture (issue #134). */
export const ORDER_BOOK_ROUTE = ["asset:BTC", "venue:bybit", "asset:ETH"] as const;

/** Profitable-variant prices; gross spread = 150 + 120. */
export const ORDER_BOOK_PRICE_1 = 150;
export const ORDER_BOOK_PRICE_2 = 120;
export const ORDER_BOOK_GROSS_SPREAD_USD = ORDER_BOOK_PRICE_1 + ORDER_BOOK_PRICE_2;

/**
 * Canonical cost stack for the fixture (issue #134):
 *   fees 0.4+0.3 = 0.7, slippage 0.1+0.15 = 0.25, gas 0.2+0.15 = 0.35,
 *   latency (50+40)*0.001 = 0.09, failure 60_000 * (1 - .999*.998) = 179.88,
 *   safety buffer 1.0 → totalCost = 182.27.
 */
export const ORDER_BOOK_TOTAL_COST_USD = 182.27;

/** Net profit on the profitable variant: 270 − 182.27. */
export const ORDER_BOOK_NET_PROFIT_USD =
  ORDER_BOOK_GROSS_SPREAD_USD - ORDER_BOOK_TOTAL_COST_USD;

export interface OrderBookEdgeDefinition {
  from: string;
  to: string;
  type: Extract<MarketEdgeType, "ORDER_BOOK">;
  weights: EdgeWeights;
}

/**
 * Canonical ORDER_BOOK edge weights at the given prices. The defaults are the
 * profitable variant (150 / 120) so totalCost stays 182.27 and net stays 87.73
 * when the prices are left at their defaults.
 */
export function orderBookEdges(
  price1: number = ORDER_BOOK_PRICE_1,
  price2: number = ORDER_BOOK_PRICE_2,
): OrderBookEdgeDefinition[] {
  return [
    {
      from: "asset:BTC",
      to: "venue:bybit",
      type: "ORDER_BOOK",
      weights: {
        price: price1,
        fee: 0.4,
        expectedSlippage: 0.1,
        gasCost: 0.2,
        latencyMs: 50,
        liquidityUsd: 80_000,
        confidence: 0.92,
        riskScore: 0.05,
        failureProbability: 0.001,
      },
    },
    {
      from: "venue:bybit",
      to: "asset:ETH",
      type: "ORDER_BOOK",
      weights: {
        price: price2,
        fee: 0.3,
        expectedSlippage: 0.15,
        gasCost: 0.15,
        latencyMs: 40,
        liquidityUsd: 60_000,
        confidence: 0.88,
        riskScore: 0.06,
        failureProbability: 0.002,
      },
    },
  ];
}