import { describe, expect, test } from "bun:test";
import { BacktestRunner, type BacktestResult } from "../src/backtest.ts";
import { createSeededRng } from "../src/seed.ts";

// ── Helpers ────────────────────────────────────────────────────────

function makeEvent(
  overrides: { type?: string; symbol?: string; venue?: string; mid?: number } = {},
) {
  const symbol = overrides.symbol ?? "BTC/USDT";
  const venue = overrides.venue ?? "bybit";
  return {
    eventId: `evt:${venue}:${symbol}:${Date.now()}:${Math.random()}`,
    sequence: 0,
    type: (overrides.type ?? "MARKET_TICK") as any,
    kind: "normalized" as const,
    timestampMs: 1_700_000_000_000,
    source: `${venue}-ws`,
    payload: {
      venue,
      symbol,
      timestampMs: 1_700_000_000_000,
      bid: (overrides.mid ?? 42_000) - 5,
      ask: (overrides.mid ?? 42_000) + 5,
      mid: overrides.mid ?? 42_000,
      depth: 100_000,
      latencyMs: 50,
      source: `${venue}-ws`,
    },
  };
}

function makeOrderBookEvent(overrides: { symbol?: string; venue?: string } = {}) {
  const symbol = overrides.symbol ?? "BTC/USDT";
  const venue = overrides.venue ?? "bybit";
  return {
    eventId: `evt:book:${venue}:${symbol}:${Date.now()}:${Math.random()}`,
    sequence: 0,
    type: "ORDERBOOK_SNAPSHOT" as any,
    kind: "normalized" as const,
    timestampMs: 1_700_000_000_000,
    source: `${venue}-ws`,
    payload: {
      venue,
      symbol,
      timestampMs: 1_700_000_000_000,
      bids: [
        { price: 42_000, size: 1.5 },
        { price: 41_990, size: 2.0 },
      ],
      asks: [
        { price: 42_010, size: 1.2 },
        { price: 42_020, size: 3.0 },
      ],
    },
  };
}

// ── Tests ──────────────────────────────────────────────────────────

describe("BacktestRunner", () => {
  test("same seed produces identical results (bit-exact reproducibility)", () => {
    const events = [
      makeEvent({ venue: "bybit", symbol: "BTC/USDT", mid: 42_000 }),
      makeEvent({ venue: "pancakeswap", symbol: "ETH/USDC", mid: 2_500 }),
      makeOrderBookEvent({ venue: "bybit", symbol: "BTC/USDT" }),
    ];

    const runner1 = new BacktestRunner();
    const runner2 = new BacktestRunner();

    const result1 = runner1.run({
      seed: 42,
      events,
      strategy: "cycle",
      grossSpreadUsd: 100,
    });
    const result2 = runner2.run({
      seed: 42,
      events,
      strategy: "cycle",
      grossSpreadUsd: 100,
    });

    expect(result1.seed).toBe(result2.seed);
    expect(result1.totalTrades).toBe(result2.totalTrades);
    expect(result1.netPnlUsd).toBe(result2.netPnlUsd);
    expect(result1.finalCapitalUsd).toBe(result2.finalCapitalUsd);
    expect(result1.finalRngState).toBe(result2.finalRngState);
  });

  test("different seeds produce different results", () => {
    const events = [
      makeEvent({ venue: "bybit", symbol: "BTC/USDT" }),
    ];

    const runner1 = new BacktestRunner();
    const runner2 = new BacktestRunner();

    const result1 = runner1.run({ seed: 1, events, strategy: "cycle" });
    const result2 = runner2.run({ seed: 2, events, strategy: "cycle" });

    // At least some aspect should differ.
    const identical =
      result1.netPnlUsd === result2.netPnlUsd &&
      result1.totalTrades === result2.totalTrades &&
      result1.finalRngState === result2.finalRngState;
    expect(identical).toBe(false);
  });

  test("result contains graphSnapshot from folded events", () => {
    const events = [
      makeEvent({ venue: "bybit", symbol: "BTC/USDT" }),
      makeEvent({ venue: "pancakeswap", symbol: "ETH/USDC" }),
    ];

    const runner = new BacktestRunner();
    const result = runner.run({ seed: 42, events, strategy: "cycle" });

    expect(result.graphSnapshot).toBeDefined();
    expect(result.graphSnapshot.nodes.length).toBeGreaterThan(0);
    expect(result.graphSnapshot.edges.length).toBeGreaterThan(0);
  });

  test("trades array contains fill, gas, and latency data", () => {
    const events = [
      makeEvent({ venue: "bybit", symbol: "BTC/USDT" }),
    ];

    const runner = new BacktestRunner();
    const result = runner.run({ seed: 42, events, strategy: "cycle" });

    for (const trade of result.trades) {
      expect(trade.fill).toBeDefined();
      expect(trade.gas).toBeDefined();
      expect(trade.latency).toBeDefined();
      expect(trade.intent).toBeDefined();
    }
  });

  test("fillRatio is between 0 and 1", () => {
    const events = [
      makeEvent({ venue: "bybit", symbol: "BTC/USDT" }),
    ];

    const runner = new BacktestRunner();
    const result = runner.run({ seed: 42, events, strategy: "cycle" });

    expect(result.fillRatio).toBeGreaterThanOrEqual(0);
    expect(result.fillRatio).toBeLessThanOrEqual(1);
  });

  test("capital tracks through trades", () => {
    const events = [
      makeEvent({ venue: "bybit", symbol: "BTC/USDT" }),
    ];

    const runner = new BacktestRunner();
    const result = runner.run({
      seed: 42,
      events,
      strategy: "cycle",
      initialCapitalUsd: 10_000,
    });

    // finalCapitalUsd should be initial + netPnlUsd.
    expect(result.finalCapitalUsd).toBeCloseTo(
      10_000 + result.netPnlUsd,
      2,
    );
  });

  test("maxTrades limits number of trades", () => {
    const events = [
      makeEvent({ venue: "bybit", symbol: "BTC/USDT" }),
      makeEvent({ venue: "pancakeswap", symbol: "ETH/USDC" }),
    ];

    const runner = new BacktestRunner();
    const result = runner.run({
      seed: 42,
      events,
      strategy: "cycle",
      maxTrades: 5,
    });

    expect(result.trades.length).toBeLessThanOrEqual(5);
  });

  test("empty events produce empty result", () => {
    const runner = new BacktestRunner();
    const result = runner.run({
      seed: 42,
      events: [],
      strategy: "cycle",
    });

    expect(result.totalTrades).toBe(0);
    expect(result.filledTrades).toBe(0);
    expect(result.netPnlUsd).toBe(0);
    expect(result.finalCapitalUsd).toBe(10_000);
  });
});
