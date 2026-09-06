import { describe, expect, test } from "bun:test";
import {
  GENERAL_AGENT_SIGNALS,
  isGeneralAgentRecommendation,
  isTradingScope,
  parseGeneralAgentRecommendation,
  parseTradingScope,
  scopeIdOf,
} from "../src/index.ts";

describe("TradingScope (ADR-0013)", () => {
  test("isTradingScope validates CEX scopes", () => {
    expect(isTradingScope({ kind: "CEX", venue: "bybit", pair: "BTC/USDT" })).toBe(true);
  });

  test("isTradingScope validates DEX scopes with pool + chain", () => {
    expect(
      isTradingScope({
        kind: "DEX",
        venue: "pancakeswap-v4",
        pool: "0xpool",
        pair: "BNB/USDT",
        chain: "bsc",
      }),
    ).toBe(true);
  });

  test("isTradingScope rejects unknown kinds, missing pair, and numbers", () => {
    expect(isTradingScope({ kind: "OTC", venue: "bybit", pair: "BTC/USDT" })).toBe(false);
    expect(isTradingScope({ kind: "CEX", venue: "bybit" })).toBe(false);
    expect(isTradingScope({ kind: "CEX", venue: "bybit", pair: 42 })).toBe(false);
    expect(isTradingScope(null)).toBe(false);
  });

  test("parseTradingScope throws on invalid input", () => {
    expect(() => parseTradingScope({ kind: "CEX", venue: "bybit" })).toThrow("TradingScope");
  });

  test("scopeIdOf derivation is stable and distinguishes CEX from DEX", () => {
    expect(scopeIdOf({ kind: "CEX", venue: "bybit", pair: "BTC/USDT" })).toBe("bybit:BTC/USDT");
    expect(
      scopeIdOf({
        kind: "DEX",
        venue: "pancakeswap-v4",
        pool: "0xpool",
        pair: "BNB/USDT",
      }),
    ).toBe("pancakeswap-v4:0xpool:BNB/USDT");
  });
});

describe("GeneralAgentRecommendation", () => {
  const recommendation = {
    scopeId: "bybit:BTC/USDT",
    agentId: "general-scope-bybit-BTC-USDT",
    scope: { kind: "CEX" as const, venue: "bybit", pair: "BTC/USDT" },
    regime: "trending",
    signal: "BUY" as const,
    confidence: 0.8,
    reasoning: "market geometry supports the constructive case",
    subAgentIds: ["agent-market-regime"],
    subAgentOutputs: [],
    timestampMs: 1_700_000_000_000,
  };

  test("isGeneralAgentRecommendation validates a full recommendation", () => {
    expect(isGeneralAgentRecommendation(recommendation)).toBe(true);
  });

  test("rejects unknown signals and out-of-range confidences", () => {
    expect(isGeneralAgentRecommendation({ ...recommendation, signal: "HODL" })).toBe(false);
    expect(isGeneralAgentRecommendation({ ...recommendation, confidence: -0.2 })).toBe(true);
  });

  test("parseGeneralAgentRecommendation round-trips", () => {
    const parsed = parseGeneralAgentRecommendation(recommendation);
    expect(parsed.scopeId).toBe("bybit:BTC/USDT");
    expect(parsed.signal).toBe("BUY");
    expect(GENERAL_AGENT_SIGNALS).toContain(parsed.signal);
  });
});