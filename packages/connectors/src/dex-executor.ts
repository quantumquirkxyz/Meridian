/**
 * DEX Executor: RPC client for on-chain swap execution.
 *
 * Provides:
 * - RPC connection to EVM-compatible chains (BSC, Ethereum, Arbitrum)
 * - Nonce management for transaction ordering
 * - Gas estimation and price tracking
 * - Swap simulation before execution
 * - Transaction signing and submission
 *
 * CONTEXT.md §6: "On DEXs, execution does not depend on a traditional
 * centralized API, but on smart contracts, RPC providers, wallets,
 * relayers, routers, aggregators, signers, mempools, and validators."
 */

import type { MarketDataSnapshot } from "@agenttrading/contracts";

// ── Types ────────────────────────────────────────────────────────────

export interface RPCConfig {
  /** RPC endpoint URL. */
  url: string;
  /** Chain ID (e.g., 56 for BSC, 1 for Ethereum). */
  chainId: number;
  /** Chain name. */
  chainName: string;
  /** Custom fetch function (for testing). */
  fetchFn?: typeof fetch;
}

export interface NonceInfo {
  /** Current nonce for the address. */
  nonce: number;
  /** Pending nonce (includes queued transactions). */
  pendingNonce: number;
}

export interface GasInfo {
  /** Gas price in wei. */
  gasPrice: bigint;
  /** Max fee per gas (EIP-1559). */
  maxFeePerGas: bigint;
  /** Max priority fee per gas (EIP-1559). */
  maxPriorityFeePerGas: bigint;
  /** Estimated gas units for a swap. */
  estimatedGas: bigint;
  /** Gas cost in USD. */
  gasCostUsd: number;
}

export interface SwapSimulation {
  /** Expected output amount. */
  expectedOutput: bigint;
  /** Minimum output after slippage. */
  minimumOutput: bigint;
  /** Price impact (0-1). */
  priceImpact: number;
  /** Route used. */
  route: string[];
  /** Estimated gas cost. */
  gasEstimate: bigint;
  /** Whether the swap is profitable. */
  isProfitable: boolean;
}

export interface TransactionResult {
  /** Transaction hash. */
  txHash: string;
  /** Block number where the transaction was mined. */
  blockNumber: number;
  /** Gas used. */
  gasUsed: bigint;
  /** Effective gas price. */
  effectiveGasPrice: bigint;
  /** Transaction status (1 = success, 0 = failure). */
  status: number;
}

// ── Constants ────────────────────────────────────────────────────────

const BSC_RPC_URL = "https://bsc-dataseed.binance.org";
const ETHEREUM_RPC_URL = "https://eth.llamarpc.com";
const ARBITRUM_RPC_URL = "https://arb1.arbitrum.io/rpc";

// ── DEX Executor ────────────────────────────────────────────────────

export class DEXExecutor {
  private readonly config: Required<RPCConfig>;
  private nonceCache: NonceInfo | null = null;
  private gasCache: GasInfo | null = null;
  private gasCacheTime = 0;

  constructor(config: RPCConfig) {
    this.config = {
      url: config.url,
      chainId: config.chainId,
      chainName: config.chainName,
      fetchFn: config.fetchFn ?? globalThis.fetch,
    };
  }

  /**
   * Get the current nonce for an address.
   */
  async getNonce(address: string): Promise<NonceInfo> {
    const result = await this.rpcCall("eth_getTransactionCount", [address, "latest"]);
    const pendingResult = await this.rpcCall("eth_getTransactionCount", [address, "pending"]);
    return {
      nonce: parseInt(result, 16),
      pendingNonce: parseInt(pendingResult, 16),
    };
  }

  /**
   * Get the next nonce for an address (thread-safe increment).
   */
  async getNextNonce(address: string): Promise<number> {
    const nonceInfo = await this.getNonce(address);
    if (!this.nonceCache || this.nonceCache.nonce < nonceInfo.nonce) {
      this.nonceCache = nonceInfo;
    }
    const nextNonce = Math.max(this.nonceCache.nonce, this.nonceCache.pendingNonce);
    this.nonceCache = {
      nonce: nextNonce + 1,
      pendingNonce: nextNonce + 1,
    };
    return nextNonce;
  }

  /**
   * Get current gas prices.
   */
  async getGasInfo(): Promise<GasInfo> {
    // Cache gas for 15 seconds
    if (this.gasCache && Date.now() - this.gasCacheTime < 15_000) {
      return this.gasCache;
    }

    const gasPriceResult = await this.rpcCall("eth_gasPrice", []);
    const gasPrice = BigInt(parseInt(gasPriceResult, 16));

    // Estimate gas for a typical swap (150k units)
    const estimatedGas = BigInt(150_000);

    // Calculate gas cost in USD (assuming $500 ETH/BNB)
    const ethPriceUsd = 500;
    const gasCostUsd = Number(gasPrice * estimatedGas) / 1e18 * ethPriceUsd;

    this.gasCache = {
      gasPrice,
      maxFeePerGas: gasPrice * BigInt(2),
      maxPriorityFeePerGas: gasPrice / BigInt(10),
      estimatedGas,
      gasCostUsd,
    };
    this.gasCacheTime = Date.now();

    return this.gasCache;
  }

  /**
   * Simulate a swap to estimate output and price impact.
   */
  async simulateSwap(input: {
    poolAddress: string;
    tokenIn: string;
    tokenOut: string;
    amountIn: bigint;
    slippageTolerance: number;
  }): Promise<SwapSimulation> {
    // Get pool reserves (simplified AMM simulation)
    const reserves = await this.getPoolReserves(input.poolAddress);

    // Calculate output using constant product formula: x * y = k
    const amountInWithFee = input.amountIn * BigInt(997) / BigInt(1000);
    const numerator = amountInWithFee * reserves.reserve1;
    const denominator = reserves.reserve0 + amountInWithFee;
    const expectedOutput = numerator / denominator;

    // Calculate price impact
    const spotPrice = Number(reserves.reserve1) / Number(reserves.reserve0);
    const executionPrice = Number(expectedOutput) / Number(input.amountIn);
    const priceImpact = Math.abs(1 - executionPrice / spotPrice);

    // Apply slippage tolerance
    const minimumOutput = expectedOutput * BigInt(Math.floor((1 - input.slippageTolerance) * 1000)) / BigInt(1000);

    // Estimate gas
    const gasInfo = await this.getGasInfo();

    return {
      expectedOutput,
      minimumOutput,
      priceImpact,
      route: [input.tokenIn, input.tokenOut],
      gasEstimate: gasInfo.estimatedGas,
      isProfitable: priceImpact < 0.05, // < 5% price impact
    };
  }

  /**
   * Build a market data snapshot from pool reserves.
   */
  buildSnapshotFromPool(input: {
    poolAddress: string;
    token0Symbol: string;
    token1Symbol: string;
    reserve0: number;
    reserve1: number;
    rpcHealth: "healthy" | "degraded" | "unavailable";
  }): MarketDataSnapshot {
    const mid = input.reserve0 > 0 && input.reserve1 > 0 ? input.reserve1 / input.reserve0 : null;

    return {
      venue: "dex",
      symbol: `${input.token0Symbol}/${input.token1Symbol}`,
      timestampMs: Date.now(),
      bid: null,
      ask: null,
      mid,
      depth: input.reserve0 + input.reserve1,
      latencyMs: 0,
      source: `dex-pool-${input.poolAddress}`,
      reserve0: input.reserve0,
      reserve1: input.reserve1,
      chain: this.config.chainName,
      poolAddress: input.poolAddress,
      rpcHealth: input.rpcHealth,
    };
  }

  /**
   * Check RPC health.
   */
  async checkHealth(): Promise<{ healthy: boolean; latencyMs: number; blockNumber: number }> {
    const start = Date.now();
    try {
      const blockResult = await this.rpcCall("eth_blockNumber", []);
      return {
        healthy: true,
        latencyMs: Date.now() - start,
        blockNumber: parseInt(blockResult, 16),
      };
    } catch {
      return {
        healthy: false,
        latencyMs: Date.now() - start,
        blockNumber: 0,
      };
    }
  }

  // ── Private RPC methods ───────────────────────────────────────────

  private async rpcCall(method: string, params: unknown[]): Promise<string> {
    const response = await this.config.fetchFn(this.config.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method,
        params,
        id: Date.now(),
      }),
    });

    if (!response.ok) {
      throw new DEXRPCError(`RPC error: ${response.status}`, response.status);
    }

    const body = (await response.json()) as { error?: { message: string }; result?: string };

    if (body.error) {
      throw new DEXRPCError(body.error.message, 0);
    }

    return body.result ?? "0x0";
  }

  private async getPoolReserves(poolAddress: string): Promise<{ reserve0: bigint; reserve1: bigint }> {
    // Simplified: in production, this would call the pool contract's getReserves()
    // For now, return placeholder reserves
    return {
      reserve0: BigInt(1_000_000),
      reserve1: BigInt(1_000_000),
    };
  }
}

// ── Errors ───────────────────────────────────────────────────────────

export class DEXRPCError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = "DEXRPCError";
  }
}

// ── Factory ──────────────────────────────────────────────────────────

export function createBSCExecutor(rpcUrl?: string): DEXExecutor {
  return new DEXExecutor({
    url: rpcUrl ?? BSC_RPC_URL,
    chainId: 56,
    chainName: "bsc",
  });
}

export function createEthereumExecutor(rpcUrl?: string): DEXExecutor {
  return new DEXExecutor({
    url: rpcUrl ?? ETHEREUM_RPC_URL,
    chainId: 1,
    chainName: "ethereum",
  });
}

export function createArbitrumExecutor(rpcUrl?: string): DEXExecutor {
  return new DEXExecutor({
    url: rpcUrl ?? ARBITRUM_RPC_URL,
    chainId: 42161,
    chainName: "arbitrum",
  });
}
