import type { MarketDataSnapshot } from "@agenttrading/contracts";

export interface PancakeSwapV4PoolState {
  chain: "bsc";
  poolAddress: string;
  token0Symbol: string;
  token1Symbol: string;
  reserve0: number;
  reserve1: number;
  blockTimestampMs: number;
  rpcTimestampMs: number;
  rpcHealth: "healthy" | "degraded" | "unavailable";
  source?: string;
}

export interface PancakeSwapV4QuoteInput extends PancakeSwapV4PoolState {
  gasEstimateUsd?: number;
  routerQuote?: number;
}

function normalizeDexSymbol(token0Symbol: string, token1Symbol: string): string {
  return `${token0Symbol.toUpperCase()}/${token1Symbol.toUpperCase()}`;
}

export function buildPancakeSwapSnapshot(
  input: PancakeSwapV4QuoteInput,
): MarketDataSnapshot & { chain: "bsc"; poolAddress: string; gasEstimateUsd?: number; routerQuote?: number; rpcHealth: PancakeSwapV4PoolState["rpcHealth"] } {
  const mid = input.reserve0 > 0 && input.reserve1 > 0 ? input.reserve1 / input.reserve0 : null;

  return {
    venue: "pancakeswap-v4",
    chain: input.chain,
    poolAddress: input.poolAddress,
    symbol: normalizeDexSymbol(input.token0Symbol, input.token1Symbol),
    timestampMs: input.blockTimestampMs,
    bid: null,
    ask: null,
    mid,
    depth: input.reserve0 + input.reserve1,
    latencyMs: Math.max(0, input.rpcTimestampMs - input.blockTimestampMs),
    source: input.source ?? "pancakeswap-v4-rpc",
    gasEstimateUsd: input.gasEstimateUsd,
    routerQuote: input.routerQuote,
    rpcHealth: input.rpcHealth,
  };
}
