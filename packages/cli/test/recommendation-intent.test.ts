import { describe, expect, test } from "bun:test";
import type { GeneralAgentRecommendation } from "@agenttrading/contracts";
import { buildRecommendationIntent } from "../src/recommendation-intent.ts";

const FIXED_TS = 1_700_000_000_000;

function rec(overrides: Partial<GeneralAgentRecommendation> = {}): GeneralAgentRecommendation {
  return {
    scopeId: "bybit:BTC/USDT",
    agentId: "general-scope-bybit-btc",
    scope: { kind: "CEX", venue: "bybit", pair: "BTC/USDT" },
    regime: "trending",
    signal: "BUY",
    confidence: 0.8,
    reasoning: "tight spread",
    subAgentIds: ["agent-bull", "agent-skeptic"],
    subAgentOutputs: [],
    timestampMs: FIXED_TS,
    ...overrides,
  };
}

const market = { bid: 99.9, ask: 100.1, mid: 100, liquidityUsd: 50_000 };

describe("buildRecommendationIntent (ADR-0013)", () => {
  test("HOLD recommendations never produce an intent", () => {
    const recommendation = rec({ signal: "HOLD" });
    expect(buildRecommendationIntent(recommendation, market, { now: () => FIXED_TS })).toBeUndefined();
  });

  test("turns a BUY recommendation into a gated CEX intent at the scope mid", () => {
    const intent = buildRecommendationIntent(rec({ signal: "BUY" }), market, {
      now: () => FIXED_TS,
      maxSlippageBps: 5,
    });
    expect(intent).toBeDefined();
    expect(intent!.symbol).toBe("BTCUSDT");
    expect(intent!.venue).toBe("bybit");
    expect(intent!.side).toBe("BUY");
    expect(intent!.price).toBe(100);
    expect(intent!.quantity).toBe(0.001);
    expect(intent!.quoteCurrency).toBe("USDT");
    expect(intent!.limits.maxSlippageBps).toBe(5);
    expect(intent!.idempotencyKey).toContain("general:");
  });

  test("derives the CEX symbol by stripping the pair separator", () => {
    const recommendation = rec({ scope: { kind: "CEX", venue: "binance", pair: "ETH/BTC" } });
    const intent = buildRecommendationIntent(recommendation, market, { now: () => FIXED_TS });
    expect(intent!.symbol).toBe("ETHBTC");
    // "BTC" is the quote currency for the ETH/BTC scope.
    expect(intent!.quoteCurrency).toBe("BTC");
  });

  test("keeps the pool pair as symbol on a DEX scope", () => {
    const recommendation = rec({
      signal: "SELL",
      scope: { kind: "DEX", venue: "pancakeswap-v4", pool: "0xpool", pair: "WBNB/USDT" },
    });
    const intent = buildRecommendationIntent(recommendation, market, { now: () => FIXED_TS });
    expect(intent!.side).toBe("SELL");
    expect(intent!.symbol).toBe("WBNB/USDT");
    expect(intent!.quoteCurrency).toBe("USDT");
  });

  test("affects only the provided clock and expiry window", () => {
    const intent = buildRecommendationIntent(
      rec(),
      market,
      { now: () => FIXED_TS },
    )!;
    expect(intent.createdAtMs).toBe(FIXED_TS);
    expect(intent.expiresAtMs).toBe(FIXED_TS + 60_000);
  });
});