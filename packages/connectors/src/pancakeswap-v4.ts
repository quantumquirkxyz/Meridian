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
): MarketDataSnapshot {
  const mid = input.reserve0 > 0 && input.reserve1 > 0 ? input.reserve1 / input.reserve0 : null;

  return {
    venue: "pancakeswap-v4",
    symbol: normalizeDexSymbol(input.token0Symbol, input.token1Symbol),
    timestampMs: input.blockTimestampMs,
    bid: null,
    ask: null,
    mid,
    depth: input.reserve0 + input.reserve1,
    latencyMs: Math.max(0, input.rpcTimestampMs - input.blockTimestampMs),
    source: input.source ?? "pancakeswap-v4-rpc",
    reserve0: input.reserve0,
    reserve1: input.reserve1,
    gasEstimateUsd: input.gasEstimateUsd,
    routerQuote: input.routerQuote,
    chain: input.chain,
    poolAddress: input.poolAddress,
    rpcHealth: input.rpcHealth,
  };
}

// ── Market data connector ────────────────────────────────────────────
// Uses a plain JSON-RPC fetch (no web3 dependency) so `connectors` keeps its
// "depends only on contracts" boundary (ARCHITECTURE.md). On-chain *execution*
// lives in @agenttrading/chain (viem).

export interface PancakeSwapPoolSpec {
  /** On-chain pool address. */
  poolAddress: `0x${string}`;
  /** Base token symbol (e.g. "WBNB"). */
  token0Symbol: string;
  /** Quote token symbol (e.g. "USDT"). */
  token1Symbol: string;
}

export interface PancakeSwapMarketDataConfig {
  /** RPC endpoint for the BNB chain. */
  rpcUrl: string;
  /** Pools to observe for market data. */
  pools: readonly PancakeSwapPoolSpec[];
}

interface JsonRpcResponse {
  jsonrpc: string;
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

/** Minimal JSON-RPC call via fetch (no external web3 dependency). */
async function evmCall(url: string, method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params,
    }),
  });
  if (!res.ok) {
    throw new Error(`RPC HTTP ${res.status}`);
  }
  const body = (await res.json()) as JsonRpcResponse;
  if (body.error) {
    throw new Error(`RPC error: ${body.error.message}`);
  }
  return body.result;
}

export class PancakeSwapMarketDataConnector {
  private readonly rpcUrl: string;
  private readonly pools: readonly PancakeSwapPoolSpec[];

  constructor(config: PancakeSwapMarketDataConfig) {
    this.rpcUrl = config.rpcUrl;
    this.pools = config.pools;
  }

  /**
   * Read the current reserve state of all configured pools and map each to
   * a normalized `MarketDataSnapshot`.
   */
  async fetchSnapshots(): Promise<MarketDataSnapshot[]> {
    const snapshots: MarketDataSnapshot[] = [];
    const rpcTimestampMs = Date.now();

    for (const pool of this.pools) {
      try {
        const encoded = await evmCall(this.rpcUrl, "eth_call", [
          {
            to: pool.poolAddress,
            data: "0x0902f1ac",
          },
          "latest",
        ]);
        const hex = String(encoded ?? "0x");
        if (!hex.startsWith("0x")) throw new Error("bad result");
        const words = hex.slice(2).match(/.{1,64}/g);
        if (!words || words.length < 3 || words[1] === undefined || words[2] === undefined) {
          throw new Error("malformed reserves");
        }
        const reserve0 = Number(BigInt(`0x${words[1]}`));
        const reserve1 = Number(BigInt(`0x${words[2]}`));
        const blockTimestampLast = Number(BigInt(`0x${words[3] ?? "0"}`));

        snapshots.push(
          buildPancakeSwapSnapshot({
            chain: "bsc",
            poolAddress: pool.poolAddress,
            token0Symbol: pool.token0Symbol,
            token1Symbol: pool.token1Symbol,
            reserve0,
            reserve1,
            blockTimestampMs: blockTimestampLast * 1000,
            rpcTimestampMs,
            rpcHealth: "healthy",
            source: "pancakeswap-v4-rpc-pool",
          }),
        );
      } catch {
        // Skip unavailable pools; downstream quality tracking will flag them.
        snapshots.push(
          buildPancakeSwapSnapshot({
            chain: "bsc",
            poolAddress: pool.poolAddress,
            token0Symbol: pool.token0Symbol,
            token1Symbol: pool.token1Symbol,
            reserve0: 0,
            reserve1: 0,
            blockTimestampMs: 0,
            rpcTimestampMs,
            rpcHealth: "unavailable",
            source: "pancakeswap-v4-rpc-pool",
          }),
        );
      }
    }

    return snapshots;
  }
}
