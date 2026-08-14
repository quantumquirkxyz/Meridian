import { describe, expect, test } from "bun:test";
import { buildPancakeSwapSnapshot } from "../src/pancakeswap-v4.ts";
import { isMarketDataSnapshot } from "@agenttrading/contracts";

describe("PancakeSwap v4 connector normalization", () => {
  test("builds a normalized DEX snapshot with rpc metadata", () => {
    const snapshot = buildPancakeSwapSnapshot({
      chain: "bsc",
      poolAddress: "0xpool",
      token0Symbol: "wbnb",
      token1Symbol: "usdt",
      reserve0: 100,
      reserve1: 300,
      blockTimestampMs: 1_000,
      rpcTimestampMs: 1_014,
      rpcHealth: "healthy",
      gasEstimateUsd: 1.25,
      routerQuote: 299,
      source: "pancakeswap-v4-rpc-pool",
    });

    expect(snapshot.symbol).toBe("WBNB/USDT");
    expect(snapshot.latencyMs).toBe(14);
    expect(snapshot.depth).toBe(400);
    expect(snapshot.reserve0).toBe(100);
    expect(snapshot.reserve1).toBe(300);
    expect(snapshot.gasEstimateUsd).toBe(1.25);
    expect(snapshot.routerQuote).toBe(299);
    expect(isMarketDataSnapshot(snapshot)).toBe(true);
  });
});
