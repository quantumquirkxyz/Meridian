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
  /**
   * RPC endpoint for the BNB chain.
   *
   * SECURITY: For production, use authenticated RPC endpoints (QuickNode, Alchemy, Infura)
   * with API keys or JWT tokens. Public RPC endpoints are vulnerable to:
   * - Rate limiting and availability issues
   * - Malicious responses from compromised providers
   * - No integrity verification of responses
   *
   * Consider using multiple RPC providers with consensus checking for production.
   */
  rpcUrl: string;
  /**
   * Optional authentication header for RPC endpoint.
   * Format: "Bearer <token>" or "Basic <credentials>"
   *
   * SEC-006: Use authenticated RPC endpoints for production to prevent
   * unauthorized access and ensure response integrity.
   */
  rpcAuthHeader?: string;
  /**
   * Optional fallback RPC URLs for high availability and consensus checking.
   * If provided, the connector will query multiple providers and compare results.
   *
   * SEC-006: Multi-RPC consensus prevents malicious responses from a single
   * compromised provider. Recommended for production.
   */
  fallbackRpcUrls?: string[];
  /**
   * Minimum number of RPC providers that must agree on a result.
   * Only used when fallbackRpcUrls is provided.
   * Default: 1 (no consensus required)
   * Recommended for production: 2 (2/3 consensus)
   */
  minConsensus?: number;
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
async function evmCall(
  url: string,
  method: string,
  params: unknown[],
  authHeader?: string,
): Promise<unknown> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (authHeader) {
    headers["authorization"] = authHeader;
  }

  const res = await fetch(url, {
    method: "POST",
    headers,
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

/**
 * Query multiple RPC providers and return consensus result.
 * Returns the result that appears in at least minConsensus responses.
 * If no consensus, throws an error.
 */
async function evmCallWithConsensus(
  urls: string[],
  method: string,
  params: unknown[],
  authHeader?: string,
  minConsensus: number = 1,
): Promise<unknown> {
  const results = await Promise.allSettled(
    urls.map(url => evmCall(url, method, params, authHeader))
  );

  const successfulResults = results
    .filter((r): r is PromiseFulfilledResult<unknown> => r.status === "fulfilled")
    .map(r => JSON.stringify(r.value));

  if (successfulResults.length < minConsensus) {
    throw new Error(
      `RPC consensus failed: only ${successfulResults.length}/${urls.length} providers succeeded, required ${minConsensus}`
    );
  }

  // Count occurrences of each result
  const counts = new Map<string, number>();
  for (const result of successfulResults) {
    counts.set(result, (counts.get(result) || 0) + 1);
  }

  // Find the result with the highest count
  let bestResult: string | null = null;
  let bestCount = 0;
  for (const [result, count] of counts.entries()) {
    if (count > bestCount) {
      bestResult = result;
      bestCount = count;
    }
  }

  if (bestCount < minConsensus) {
    throw new Error(
      `RPC consensus failed: best result has ${bestCount} agreements, required ${minConsensus}`
    );
  }

  return JSON.parse(bestResult!);
}

export class PancakeSwapMarketDataConnector {
  private readonly rpcUrl: string;
  private readonly rpcAuthHeader?: string;
  private readonly fallbackRpcUrls: string[];
  private readonly minConsensus: number;
  private readonly pools: readonly PancakeSwapPoolSpec[];

  constructor(config: PancakeSwapMarketDataConfig) {
    this.rpcUrl = config.rpcUrl;
    this.rpcAuthHeader = config.rpcAuthHeader;
    this.fallbackRpcUrls = config.fallbackRpcUrls ?? [];
    this.minConsensus = config.minConsensus ?? 1;
    this.pools = config.pools;
  }

  /**
   * Get the list of RPC URLs to query (primary + fallbacks).
   */
  private getRpcUrls(): string[] {
    return [this.rpcUrl, ...this.fallbackRpcUrls];
  }

  /**
   * Read the current reserve state of all configured pools and map each to
   * a normalized `MarketDataSnapshot`.
   *
   * SECURITY: Uses authenticated RPC calls and consensus checking when configured (SEC-006)
   */
  async fetchSnapshots(): Promise<MarketDataSnapshot[]> {
    const snapshots: MarketDataSnapshot[] = [];
    const rpcTimestampMs = Date.now();

    const rpcUrls = this.getRpcUrls();
    const useConsensus = rpcUrls.length > 1 && this.minConsensus > 1;

    for (const pool of this.pools) {
      try {
        // Use consensus checking if multiple RPCs are configured
        const encoded = useConsensus
          ? await evmCallWithConsensus(
              rpcUrls,
              "eth_call",
              [
                {
                  to: pool.poolAddress,
                  data: "0x0902f1ac",
                },
                "latest",
              ],
              this.rpcAuthHeader,
              this.minConsensus,
            )
          : await evmCall(
              this.rpcUrl,
              "eth_call",
              [
                {
                  to: pool.poolAddress,
                  data: "0x0902f1ac",
                },
                "latest",
              ],
              this.rpcAuthHeader,
            );

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
            source: useConsensus ? "pancakeswap-v4-rpc-consensus" : "pancakeswap-v4-rpc-pool",
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
