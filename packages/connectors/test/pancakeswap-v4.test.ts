import { describe, expect, test } from "bun:test";
import {
  buildPancakeSwapSnapshot,
  PancakeSwapMarketDataConnector,
} from "../src/pancakeswap-v4.ts";
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

describe("PancakeSwapMarketDataConnector", () => {
  test("returns unavailable snapshots when RPC is unreachable", async () => {
    const connector = new PancakeSwapMarketDataConnector({
      rpcUrl: "http://127.0.0.1:1",
      pools: [
        {
          poolAddress: "0x0000000000000000000000000000000000000001",
          token0Symbol: "WBNB",
          token1Symbol: "USDT",
        },
      ],
    });

    const snapshots = await connector.fetchSnapshots();
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].venue).toBe("pancakeswap-v4");
    expect(snapshots[0].symbol).toBe("WBNB/USDT");
    expect(snapshots[0].rpcHealth).toBe("unavailable");
    expect(snapshots[0].reserve0).toBe(0);
    expect(isMarketDataSnapshot(snapshots[0])).toBe(true);
  });
});
