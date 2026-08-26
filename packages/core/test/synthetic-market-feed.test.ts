import { describe, expect, test } from "bun:test";
import { SyntheticMarketFeed } from "../src/paper/synthetic-market-feed.ts";

function collectSamples(seed: number, count: number, symbols = ["BTCUSDT"]): ReturnType<SyntheticMarketFeed["next"]>[] {
  const feed = new SyntheticMarketFeed({ symbols, seed });
  return Array.from({ length: count }, () => feed.next());
}

describe("SyntheticMarketFeed", () => {
  test("alternates regimes over time", () => {
    const samples = collectSamples(7_531, 80);
    const regimes = new Set(samples.map((sample) => sample.regime));

    expect(regimes.has("range")).toBe(true);
    expect(regimes.has("trend")).toBe(true);
    expect(regimes.has("stress")).toBe(true);
  });

  test("produces volatility clustering and shocks", () => {
    const samples = collectSamples(19_991, 120);
    const shockCount = samples.filter((sample) => sample.shock).length;
    const avgSpread = samples.reduce((sum, sample) => sum + (sample.ask - sample.bid), 0) / samples.length;
    const highSpreadCount = samples.filter((sample) => (sample.ask - sample.bid) > avgSpread * 1.6).length;

    expect(shockCount).toBeGreaterThan(0);
    expect(highSpreadCount).toBeGreaterThan(0);
  });

  test("varies spread and liquidity over time", () => {
    const samples = collectSamples(42, 60, ["BTCUSDT", "ETHUSDT"]);
    const spreads = samples.map((sample) => sample.ask - sample.bid);
    const liquidities = samples.map((sample) => sample.liquidityUsd);

    expect(new Set(spreads.map((spread) => spread.toFixed(4))).size).toBeGreaterThan(1);
    expect(new Set(liquidities.map((liquidity) => Math.round(liquidity))).size).toBeGreaterThan(1);
  });

  test("stays generic across symbol sets", () => {
    const btcFeed = collectSamples(9_123, 3, ["BTCUSDT"]);
    const ethFeed = collectSamples(9_123, 3, ["ETHUSDT"]);

    expect(btcFeed[0].mid).not.toBe(ethFeed[0].mid);
    expect(btcFeed[0].regime).toBe(ethFeed[0].regime);
  });
});
