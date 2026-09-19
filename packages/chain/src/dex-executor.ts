/**
 * DEXExecutor: on-chain execution for DEX venues using viem.
 *
 * Provides:
 * - RPC connection to EVM-compatible chains (BSC) via viem public client
 * - Reading real AMM pool reserves (getReserves)
 * - Swap simulation with price impact and gas estimation
 * - On-chain swap execution via a private-key wallet client
 *
 * CONTEXT.md §6: "On DEXs, execution does not depend on a traditional
 * centralized API, but on smart contracts, RPC providers, wallets,
 * relayers, routers, aggregators, signers, mempools, and validators."
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  type Chain,
  type PublicClient,
  type WalletClient,
} from "viem";
import { bsc } from "viem/chains";
import type { MarketDataSnapshot } from "@agenttrading/contracts";

// ── ABI fragments ────────────────────────────────────────────────────

/** Minimal ABI needed to read AMM pool reserves. */
const GET_RESERVES_ABI = [
  {
    inputs: [],
    name: "getReserves",
    outputs: [
      { name: "reserve0", type: "uint112" },
      { name: "reserve1", type: "uint112" },
      { name: "blockTimestampLast", type: "uint32" },
    ],
    stateMutability: "view",
    type: "function",
  },
] as const;

/** Minimal ABI for the PancakeSwap router swapExactTokensForTokens. */
const SWAP_ABI = [
  {
    inputs: [
      { name: "amountIn", type: "uint256" },
      { name: "amountOutMin", type: "uint256" },
      { name: "path", type: "address[]" },
      { name: "to", type: "address" },
      { name: "deadline", type: "uint256" },
    ],
    name: "swapExactTokensForTokens",
    outputs: [{ name: "amounts", type: "uint256[]" }],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

// ── Types ────────────────────────────────────────────────────────────

export interface RPCConfig {
  /** RPC endpoint URL. */
  url: string;
  /** Chain ID (e.g., 56 for BSC). */
  chainId: number;
  /** Chain name. */
  chainName: string;
  /**
   * Private key for signing on-chain transactions.
   *
   * SECURITY WARNING: For production use, consider using:
   * - Hardware wallet (Ledger, Trezor) via viem's Ledger transport
   * - AWS KMS, GCP KMS, or HashiCorp Vault for signing
   * - A dedicated signer process with proper key isolation
   *
   * Private keys in memory are vulnerable to memory dumps and debugging.
   * This is acceptable for demo/testing but not for production with real capital.
   */
  privateKey?: `0x${string}`;
  /** Default swap router address (e.g. PancakeSwap router). */
  routerAddress?: `0x${string}`;
  /**
   * Use hardware wallet for signing (production recommended).
   * When true, privateKey should be omitted and a hardware wallet transport will be used.
   */
  useHardwareWallet?: boolean;
  /**
   * Approximate native token price in USD, used only for best-effort gas
   * cost estimation when no live price oracle is configured.
   *
   * If omitted, the executor falls back to a chain-id default:
   * BSC (56) → 500, ETH (1) → 3000, all others → 3000.
   */
  nativePriceUsd?: number;
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
  route: readonly `0x${string}`[];
  /** Estimated gas cost. */
  gasEstimate: bigint;
  /** Whether the swap is profitable. */
  isProfitable: boolean;
}

export interface TransactionResult {
  /** Transaction hash. */
  txHash: `0x${string}`;
}

export interface PoolReserves {
  reserve0: bigint;
  reserve1: bigint;
  blockTimestampLast: number;
}

// ── DEX Executor ────────────────────────────────────────────────────

export class DEXExecutor {
  private readonly chain: Chain;
  private readonly url: string;
  private readonly privateKey?: `0x${string}`;
  private readonly routerAddress?: `0x${string}`;
  private readonly nativePriceUsd: number;

  private readonly publicClient: PublicClient;
  private readonly walletClient?: WalletClient;

  constructor(config: RPCConfig) {
    this.chain = this.resolveChain(config.chainId) ?? bsc;
    this.url = config.url;
    this.privateKey = config.privateKey;
    this.routerAddress = config.routerAddress;
    this.nativePriceUsd = config.nativePriceUsd ?? (config.chainId === 56 ? 500 : 3_000);

    this.publicClient = createPublicClient({
      chain: this.chain,
      transport: http(this.url),
    });

    // SECURITY: Hardware wallet support for production (SEC-002)
    // For now, we only support private key in memory.
    // TODO: Implement hardware wallet transport (Ledger, Trezor) via viem
    // TODO: Implement KMS signing (AWS KMS, GCP KMS) for production
    if (config.useHardwareWallet) {
      throw new DEXRPCError(
        "Hardware wallet support not yet implemented. For production, " +
        "please implement hardware wallet transport or KMS signing. " +
        "See SEC-002 in SECURITY_AUDIT_REPORT.md for details.",
        501,
      );
    }

    if (this.privateKey) {
      // SECURITY WARNING: Private key stored in memory (SEC-002)
      // This is acceptable for demo/testing but not for production.
      // Consider using hardware wallet or KMS for production deployment.
      this.walletClient = createWalletClient({
        chain: this.chain,
        transport: http(this.url),
        account: this.privateKey,
      });
    }
  }

  /**
   * The account address derived from the configured private key.
   * Throws if no private key was configured.
   */
  get account(): `0x${string}` {
    if (!this.walletClient?.account) {
      throw new DEXRPCError(
        "No private key configured; cannot derive account address.",
        400,
      );
    }
    return this.walletClient.account.address;
  }

  /**
   * Get the current nonce for the derived account.
   */
  async getNonce(): Promise<NonceInfo> {
    const address = this.account;
    const [nonce, pendingNonce] = await Promise.all([
      this.publicClient.getTransactionCount({ address }),
      this.publicClient.getTransactionCount({ address, blockTag: "pending" }),
    ]);
    return { nonce, pendingNonce };
  }

  /**
   * Get current gas prices.
   */
  async getGasInfo(): Promise<GasInfo> {
    const gasPrice = await this.publicClient.getGasPrice();
    const estimatedGas = BigInt(150_000);
    /**
     * Best-effort USD gas cost; uses the configured native token price
     * approximation. For production, inject a live price oracle via
     * `RPCConfig.nativePriceUsd`.
     */
    const decimals = this.chain.nativeCurrency?.decimals ?? 18;
    const gasCostUsd =
      Number((gasPrice * estimatedGas) / BigInt(10 ** decimals)) * this.nativePriceUsd;

    return {
      gasPrice,
      maxFeePerGas: gasPrice * BigInt(2),
      maxPriorityFeePerGas: gasPrice / BigInt(10),
      estimatedGas,
      gasCostUsd,
    };
  }

  /**
   * Read the real reserves of an AMM pool.
   */
  async getPoolReserves(poolAddress: `0x${string}`): Promise<PoolReserves> {
    try {
      const result = await this.publicClient.readContract({
        address: poolAddress,
        abi: GET_RESERVES_ABI,
        functionName: "getReserves",
      });
      const reserved = result as readonly [bigint, bigint, number];
      return {
        reserve0: reserved[0],
        reserve1: reserved[1],
        blockTimestampLast: reserved[2],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new DEXRPCError(`Failed to read pool reserves: ${msg}`, 0);
    }
  }

  /**
   * Simulate a swap to estimate output and price impact from real reserves.
   */
  async simulateSwap(input: {
    poolAddress: `0x${string}`;
    tokenIn: `0x${string}`;
    tokenOut: `0x${string}`;
    amountIn: bigint;
    slippageTolerance: number;
  }): Promise<SwapSimulation> {
    const reserves = await this.getPoolReserves(input.poolAddress);
    const reserveIn =
      input.tokenIn.toLowerCase() < input.tokenOut.toLowerCase()
        ? reserves.reserve0
        : reserves.reserve1;
    const reserveOut =
      input.tokenIn.toLowerCase() < input.tokenOut.toLowerCase()
        ? reserves.reserve1
        : reserves.reserve0;

    if (reserveIn <= 0n || reserveOut <= 0n) {
      throw new DEXRPCError("Pool has zero reserves; cannot simulate swap.", 0);
    }

    const amountInWithFee = (input.amountIn * BigInt(997)) / BigInt(1000);
    const numerator = amountInWithFee * reserveOut;
    const denominator = reserveIn + amountInWithFee;
    const expectedOutput = denominator > 0n ? numerator / denominator : 0n;

    const spotPrice = Number(reserveOut) / Number(reserveIn);
    const executionPrice =
      expectedOutput > 0n ? Number(expectedOutput) / Number(input.amountIn) : 0;
    const priceImpact = Math.abs(1 - executionPrice / spotPrice);

    const minimumOutput =
      (expectedOutput *
        BigInt(Math.floor(Math.max(0, 1 - input.slippageTolerance) * 10_000))) /
      BigInt(10_000);

    const gasInfo = await this.getGasInfo();

    return {
      expectedOutput,
      minimumOutput,
      priceImpact,
      route: [input.tokenIn, input.tokenOut],
      gasEstimate: gasInfo.estimatedGas,
      isProfitable: priceImpact < 0.05,
    };
  }

  /**
   * Execute a swap on-chain via the configured router and private key.
   */
  async executeSwap(input: {
    routerAddress?: `0x${string}`;
    path: readonly `0x${string}`[];
    amountIn: bigint;
    amountOutMin: bigint;
    to: `0x${string}`;
    deadlineMs?: number;
  }): Promise<TransactionResult> {
    const router = input.routerAddress ?? this.routerAddress;
    if (!router) {
      throw new DEXRPCError(
        "No router address configured; cannot execute swap.",
        400,
      );
    }
    if (!this.walletClient) {
      throw new DEXRPCError(
        "No private key configured; cannot sign or execute swap.",
        400,
      );
    }

    const deadline =
      input.deadlineMs ?? Math.floor(Date.now() / 1000) + 300;

    const account = this.walletClient.account;
    if (!account) {
      throw new DEXRPCError(
        "No private key configured; cannot sign or execute swap.",
        400,
      );
    }

    const txHash = await this.walletClient.writeContract({
      chain: this.chain,
      account,
      address: router,
      abi: SWAP_ABI,
      functionName: "swapExactTokensForTokens",
      args: [
        input.amountIn,
        input.amountOutMin,
        [...input.path],
        input.to,
        BigInt(deadline),
      ],
    });

    return { txHash };
  }

  /**
   * Wait for a transaction to be confirmed on-chain.
   */
  async waitForTransaction(txHash: `0x${string}`): Promise<{ status: "success" | "reverted" }> {
    const receipt = await this.publicClient.waitForTransactionReceipt({
      hash: txHash,
    });
    return { status: receipt.status === "success" ? "success" : "reverted" };
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
    timestampMs?: number;
  }): MarketDataSnapshot {
    const mid =
      input.reserve0 > 0 && input.reserve1 > 0
        ? input.reserve1 / input.reserve0
        : null;

    return {
      venue: "pancakeswap-v4",
      symbol: `${input.token0Symbol}/${input.token1Symbol}`,
      timestampMs: input.timestampMs ?? Date.now(),
      bid: null,
      ask: null,
      mid,
      depth: input.reserve0 + input.reserve1,
      latencyMs: 0,
      source: `pancakeswap-aware-pool-${input.poolAddress}`,
      reserve0: input.reserve0,
      reserve1: input.reserve1,
      chain: this.chain.name.toLowerCase(),
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
      const blockNumber = await this.publicClient.getBlockNumber();
      return {
        healthy: true,
        latencyMs: Date.now() - start,
        blockNumber: Number(blockNumber),
      };
    } catch {
      return {
        healthy: false,
        latencyMs: Date.now() - start,
        blockNumber: 0,
      };
    }
  }

  // ── Private helpers ───────────────────────────────────────────────

  private resolveChain(chainId: number): Chain | undefined {
    if (chainId === bsc.id) return bsc;
    return undefined;
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

// ── Factories ─────────────────────────────────────────────────────────

export function createBSCExecutor(
  url?: string,
  privateKey?: `0x${string}`,
  routerAddress?: `0x${string}`,
): DEXExecutor {
  return new DEXExecutor({
    url: url ?? "https://bsc-dataseed.binance.org",
    chainId: 56,
    chainName: "bsc",
    privateKey,
    routerAddress,
  });
}
