/**
 * Cross-Chain Bridge: manages asset transfers between blockchains.
 *
 * CONTEXT.md §6: "In cross-chain arbitrage, the risk of bridges and the
 * latency of transfers between networks also appear."
 * CONTEXT.md §18: "pre-positioned inventory is key because relying on
 * real-time bridges introduces latencies that can destroy the opportunity."
 *
 * This module provides:
 * - Bridge route discovery and comparison
 * - Transfer latency estimation
 * - Bridge risk scoring
 * - Pre-positioned inventory tracking
 * - Transfer status monitoring
 */

// ── Types ────────────────────────────────────────────────────────────

export interface BridgeRoute {
  /** Bridge identifier (e.g., "stargate", "hop", "across"). */
  bridgeId: string;
  /** Source chain. */
  fromChain: string;
  /** Destination chain. */
  toChain: string;
  /** Asset symbol. */
  asset: string;
  /** Estimated transfer time (seconds). */
  estimatedTimeSeconds: number;
  /** Bridge fee in USD. */
  feeUsd: number;
  /** Maximum transfer amount (USD). */
  maxAmountUsd: number;
  /** Minimum transfer amount (USD). */
  minAmountUsd: number;
  /** Bridge security score (0-1). */
  securityScore: number;
  /** Whether the bridge is currently operational. */
  isOperational: boolean;
}

export interface BridgeTransfer {
  /** Transfer identifier. */
  transferId: string;
  /** Bridge route used. */
  route: BridgeRoute;
  /** Amount being transferred (USD). */
  amountUsd: number;
  /** Source transaction hash. */
  sourceTxHash?: string;
  /** Destination transaction hash. */
  destinationTxHash?: string;
  /** Transfer status. */
  status: BridgeTransferStatus;
  /** Timestamp when transfer was initiated. */
  initiatedAtMs: number;
  /** Timestamp when transfer was completed. */
  completedAtMs?: number;
}

export type BridgeTransferStatus =
  | "PENDING"
  | "INITIATED"
  | "IN_TRANSIT"
  | "COMPLETED"
  | "FAILED"
  | "STALE";

export interface BridgeConfig {
  /** Maximum acceptable transfer time (seconds). */
  maxTransferTimeSeconds: number;
  /** Maximum acceptable bridge fee (USD). */
  maxFeeUsd: number;
  /** Minimum bridge security score (0-1). */
  minSecurityScore: number;
  /** Whether to allow transfers above security threshold. */
  allowUnverifiedBridges: boolean;
}

export interface BridgeRecommendation {
  /** Recommended bridge route. */
  route: BridgeRoute;
  /** Whether the transfer is recommended. */
  isRecommended: boolean;
  /** Risk score (0-1, lower is better). */
  riskScore: number;
  /** Warnings. */
  warnings: BridgeWarning[];
}

export interface BridgeWarning {
  type: "HIGH_LATENCY" | "HIGH_FEE" | "LOW_SECURITY" | "BRIDGE_DOWN" | "AMOUNT_TOO_LARGE";
  severity: "LOW" | "MEDIUM" | "HIGH";
  message: string;
}

// ── Constants ────────────────────────────────────────────────────────

export const DEFAULT_BRIDGE_CONFIG: BridgeConfig = {
  maxTransferTimeSeconds: 600,
  maxFeeUsd: 50,
  minSecurityScore: 0.7,
  allowUnverifiedBridges: false,
};

// ── Known Bridge Routes ──────────────────────────────────────────────

const KNOWN_BRIDGES: BridgeRoute[] = [
  {
    bridgeId: "stargate",
    fromChain: "ethereum",
    toChain: "arbitrum",
    asset: "USDC",
    estimatedTimeSeconds: 120,
    feeUsd: 5,
    maxAmountUsd: 10_000_000,
    minAmountUsd: 100,
    securityScore: 0.95,
    isOperational: true,
  },
  {
    bridgeId: "stargate",
    fromChain: "arbitrum",
    toChain: "ethereum",
    asset: "USDC",
    estimatedTimeSeconds: 120,
    feeUsd: 5,
    maxAmountUsd: 10_000_000,
    minAmountUsd: 100,
    securityScore: 0.95,
    isOperational: true,
  },
  {
    bridgeId: "hop",
    fromChain: "ethereum",
    toChain: "arbitrum",
    asset: "USDC",
    estimatedTimeSeconds: 300,
    feeUsd: 2,
    maxAmountUsd: 1_000_000,
    minAmountUsd: 50,
    securityScore: 0.85,
    isOperational: true,
  },
  {
    bridgeId: "across",
    fromChain: "ethereum",
    toChain: "arbitrum",
    asset: "USDC",
    estimatedTimeSeconds: 60,
    feeUsd: 3,
    maxAmountUsd: 5_000_000,
    minAmountUsd: 100,
    securityScore: 0.88,
    isOperational: true,
  },
  {
    bridgeId: "wormhole",
    fromChain: "ethereum",
    toChain: "solana",
    asset: "USDC",
    estimatedTimeSeconds: 900,
    feeUsd: 10,
    maxAmountUsd: 10_000_000,
    minAmountUsd: 100,
    securityScore: 0.75,
    isOperational: true,
  },
];

// ── Bridge Manager ───────────────────────────────────────────────────

export class BridgeManager {
  private readonly config: BridgeConfig;
  private readonly now: () => number;
  private readonly routes: BridgeRoute[] = [...KNOWN_BRIDGES];
  private readonly transfers = new Map<string, BridgeTransfer>();

  constructor(config: Partial<BridgeConfig> = {}, now?: () => number) {
    this.config = { ...DEFAULT_BRIDGE_CONFIG, ...config };
    this.now = now ?? (() => Date.now());
  }

  /**
   * Find available bridge routes between chains.
   */
  findRoutes(fromChain: string, toChain: string, asset?: string): BridgeRoute[] {
    return this.routes.filter((route) => {
      if (route.fromChain !== fromChain || route.toChain !== toChain) return false;
      if (asset && route.asset !== asset) return false;
      return true;
    });
  }

  /**
   * Get the best bridge route for a transfer.
   */
  getBestRoute(
    fromChain: string,
    toChain: string,
    amountUsd: number,
    asset?: string,
  ): BridgeRecommendation | null {
    const routes = this.findRoutes(fromChain, toChain, asset);
    if (routes.length === 0) return null;

    const recommendations: BridgeRecommendation[] = [];

    for (const route of routes) {
      const warnings: BridgeWarning[] = [];
      let riskScore = 0;

      // Check operational status
      if (!route.isOperational) {
        warnings.push({
          type: "BRIDGE_DOWN",
          severity: "HIGH",
          message: `Bridge ${route.bridgeId} is not operational`,
        });
        riskScore += 1;
      }

      // Check transfer time
      if (route.estimatedTimeSeconds > this.config.maxTransferTimeSeconds) {
        warnings.push({
          type: "HIGH_LATENCY",
          severity: "MEDIUM",
          message: `Transfer time ${route.estimatedTimeSeconds}s exceeds max ${this.config.maxTransferTimeSeconds}s`,
        });
        riskScore += 0.3;
      }

      // Check fee
      if (route.feeUsd > this.config.maxFeeUsd) {
        warnings.push({
          type: "HIGH_FEE",
          severity: "MEDIUM",
          message: `Bridge fee $${route.feeUsd} exceeds max $${this.config.maxFeeUsd}`,
        });
        riskScore += 0.2;
      }

      // Check security score
      if (route.securityScore < this.config.minSecurityScore) {
        warnings.push({
          type: "LOW_SECURITY",
          severity: "HIGH",
          message: `Security score ${route.securityScore} below minimum ${this.config.minSecurityScore}`,
        });
        riskScore += 0.5;
      }

      // Check amount limits
      if (amountUsd > route.maxAmountUsd) {
        warnings.push({
          type: "AMOUNT_TOO_LARGE",
          severity: "HIGH",
          message: `Amount $${amountUsd} exceeds bridge max $${route.maxAmountUsd}`,
        });
        riskScore += 1;
      }

      // Calculate risk score (0-1)
      riskScore = Math.min(1, riskScore + (1 - route.securityScore) * 0.3);

      const isRecommended = warnings.filter((w) => w.severity === "HIGH").length === 0
        && riskScore < 0.5;

      recommendations.push({
        route,
        isRecommended,
        riskScore,
        warnings,
      });
    }

    // Sort by risk score (lowest first)
    recommendations.sort((a, b) => a.riskScore - b.riskScore);

    return recommendations[0] ?? null;
  }

  /**
   * Estimate the total cost of a cross-chain transfer.
   */
  estimateTransferCost(input: {
    route: BridgeRoute;
    amountUsd: number;
    gasPriceUsd: number;
  }): {
    bridgeFeeUsd: number;
    gasCostUsd: number;
    totalCostUsd: number;
    estimatedTimeSeconds: number;
  } {
    const bridgeFeeUsd = input.route.feeUsd;
    const gasCostUsd = input.gasPriceUsd * 2; // Source + destination gas
    const totalCostUsd = bridgeFeeUsd + gasCostUsd;

    return {
      bridgeFeeUsd,
      gasCostUsd,
      totalCostUsd,
      estimatedTimeSeconds: input.route.estimatedTimeSeconds,
    };
  }

  /**
   * Track a new bridge transfer.
   */
  trackTransfer(input: {
    route: BridgeRoute;
    amountUsd: number;
    sourceTxHash?: string;
  }): BridgeTransfer {
    const transfer: BridgeTransfer = {
      transferId: `bridge:${input.route.bridgeId}:${this.now()}`,
      route: input.route,
      amountUsd: input.amountUsd,
      sourceTxHash: input.sourceTxHash,
      status: "PENDING",
      initiatedAtMs: this.now(),
    };

    this.transfers.set(transfer.transferId, transfer);
    return transfer;
  }

  /**
   * Update transfer status.
   */
  updateTransferStatus(transferId: string, status: BridgeTransferStatus, destinationTxHash?: string): boolean {
    const transfer = this.transfers.get(transferId);
    if (!transfer) return false;

    transfer.status = status;
    if (destinationTxHash) {
      transfer.destinationTxHash = destinationTxHash;
    }
    if (status === "COMPLETED" || status === "FAILED") {
      transfer.completedAtMs = this.now();
    }

    return true;
  }

  /**
   * Get all active transfers.
   */
  getActiveTransfers(): BridgeTransfer[] {
    return [...this.transfers.values()].filter(
      (t) => t.status !== "COMPLETED" && t.status !== "FAILED",
    );
  }

  /**
   * Add a custom bridge route.
   */
  addRoute(route: BridgeRoute): void {
    this.routes.push(route);
  }
}
