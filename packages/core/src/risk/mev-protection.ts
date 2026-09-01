/**
 * MEV Protection: strategies to protect against Miner Extractable Value.
 *
 * CONTEXT.md §14: "In DeFi, additional specific risks appear: MEV, contract
 * vulnerabilities, liquidity concentration, oracle errors, governance attacks,
 * and dependence on external infrastructure."
 *
 * This module provides:
 * - Slippage protection (max slippage tolerance)
 * - Deadline protection (transaction expiry)
 * - Front-running detection (sandwich attack prevention)
 * - Private mempool submission (Flashbots support structure)
 * - Gas price strategies to avoid front-running
 */

// ── Types ────────────────────────────────────────────────────────────

export interface MEVProtectionConfig {
  /** Maximum slippage tolerance (basis points, e.g., 50 = 0.5%). */
  maxSlippageBps: number;
  /** Transaction deadline in seconds from now. */
  deadlineSeconds: number;
  /** Whether to use private mempool (Flashbots). */
  usePrivateMempool: boolean;
  /** Max gas price multiplier to avoid front-running (e.g., 1.1 = 10% above base). */
  maxGasMultiplier: number;
  /** Whether to enable sandwich attack detection. */
  sandwichDetection: boolean;
}

export interface MEVProtectionResult {
  /** Whether the transaction is safe to submit. */
  isSafe: boolean;
  /** Recommended slippage for this transaction. */
  recommendedSlippageBps: number;
  /** Recommended gas price (wei). */
  recommendedGasPrice: bigint;
  /** Transaction deadline timestamp. */
  deadlineTimestampMs: number;
  /** Warnings detected. */
  warnings: MEVWarning[];
  /** Whether to use private mempool. */
  usePrivateMempool: boolean;
}

export interface MEVWarning {
  type: "HIGH_SLIPPAGE" | "FRONT_RUN_RISK" | "SANDWICH_RISK" | "GAS_SPIKE" | "STALE_PRICE";
  severity: "LOW" | "MEDIUM" | "HIGH";
  message: string;
}

export interface SandwichDetectionResult {
  /** Whether a sandwich attack is detected. */
  isSandwiched: boolean;
  /** Estimated loss from sandwich attack (USD). */
  estimatedLossUsd: number;
  /** Recommended action. */
  recommendation: "PROCEED" | "INCREASE_SLIPPAGE" | "USE_PRIVATE_MEMPOOL" | "ABORT";
}

// ── Constants ────────────────────────────────────────────────────────

export const DEFAULT_MEV_CONFIG: MEVProtectionConfig = {
  maxSlippageBps: 50,
  deadlineSeconds: 120,
  usePrivateMempool: false,
  maxGasMultiplier: 1.2,
  sandwichDetection: true,
};

// ── MEV Protection Engine ────────────────────────────────────────────

export class MEVProtectionEngine {
  private readonly config: MEVProtectionConfig;
  private readonly now: () => number;

  constructor(config: Partial<MEVProtectionConfig> = {}, now?: () => number) {
    this.config = { ...DEFAULT_MEV_CONFIG, ...config };
    this.now = now ?? (() => Date.now());
  }

  /**
   * Calculate MEV protection parameters for a swap.
   */
  calculateProtection(input: {
    expectedOutput: bigint;
    poolLiquidityUsd: number;
    tradeSizeUsd: number;
    currentGasPrice: bigint;
    priceImpact: number;
  }): MEVProtectionResult {
    const warnings: MEVWarning[] = [];
    const timestamp = this.now();

    // Calculate recommended slippage based on trade size vs liquidity
    const liquidityRatio = input.tradeSizeUsd / input.poolLiquidityUsd;
    const baseSlippage = Math.min(
      this.config.maxSlippageBps,
      Math.floor(liquidityRatio * 10_000),
    );

    // Detect sandwich attack risk
    let recommendedSlippage = baseSlippage;
    let usePrivateMempool = this.config.usePrivateMempool;

    if (this.config.sandwichDetection && input.priceImpact > 0.01) {
      const sandwichResult = this.detectSandwichAttack(input);
      if (sandwichResult.isSandwiched) {
        warnings.push({
          type: "SANDWICH_RISK",
          severity: "HIGH",
          message: `Sandwich attack detected. Estimated loss: $${sandwichResult.estimatedLossUsd.toFixed(2)}`,
        });
        if (sandwichResult.recommendation === "USE_PRIVATE_MEMPOOL") {
          usePrivateMempool = true;
        } else if (sandwichResult.recommendation === "ABORT") {
          return {
            isSafe: false,
            recommendedSlippageBps: 0,
            recommendedGasPrice: BigInt(0),
            deadlineTimestampMs: timestamp,
            warnings,
            usePrivateMempool: false,
          };
        }
      }
    }

    // Calculate gas price with multiplier
    const gasMultiplier = BigInt(Math.floor(this.config.maxGasMultiplier * 100));
    const recommendedGasPrice = (input.currentGasPrice * gasMultiplier) / BigInt(100);

    // Check for front-running risk
    if (liquidityRatio > 0.05) {
      warnings.push({
        type: "FRONT_RUN_RISK",
        severity: "MEDIUM",
        message: `Large trade relative to pool (${(liquidityRatio * 100).toFixed(1)}% of liquidity)`,
      });
    }

    // Check for gas spike
    if (this.config.maxGasMultiplier > 1.5) {
      warnings.push({
        type: "GAS_SPIKE",
        severity: "MEDIUM",
        message: `Gas price multiplier is high: ${this.config.maxGasMultiplier}x`,
      });
    }

    const isSafe = warnings.filter((w) => w.severity === "HIGH").length === 0;

    return {
      isSafe,
      recommendedSlippageBps: recommendedSlippage,
      recommendedGasPrice,
      deadlineTimestampMs: timestamp + this.config.deadlineSeconds * 1000,
      warnings,
      usePrivateMempool,
    };
  }

  /**
   * Detect potential sandwich attack conditions.
   */
  detectSandwichAttack(input: {
    tradeSizeUsd: number;
    poolLiquidityUsd: number;
    priceImpact: number;
  }): SandwichDetectionResult {
    // Sandwich attacks are profitable when:
    // 1. Trade size is significant relative to pool
    // 2. Price impact is high enough to be profitable for attacker
    // 3. Slippage tolerance allows room for manipulation

    const liquidityRatio = input.tradeSizeUsd / input.poolLiquidityUsd;

    // Estimated attacker profit from sandwiching
    const estimatedProfit = input.tradeSizeUsd * input.priceImpact * 0.5;
    const estimatedLossUsd = input.tradeSizeUsd * input.priceImpact;

    // Sandwich is likely if profit > gas cost (~$5-10 on most chains)
    const sandwichThreshold = 10; // USD
    const isSandwiched = estimatedProfit > sandwichThreshold && liquidityRatio > 0.02;

    let recommendation: SandwichDetectionResult["recommendation"] = "PROCEED";
    if (isSandwiched) {
      if (liquidityRatio > 0.1) {
        recommendation = "ABORT";
      } else if (estimatedLossUsd > 50) {
        recommendation = "USE_PRIVATE_MEMPOOL";
      } else {
        recommendation = "INCREASE_SLIPPAGE";
      }
    }

    return {
      isSandwiched,
      estimatedLossUsd,
      recommendation,
    };
  }

  /**
   * Validate a transaction against MEV protection rules.
   */
  validateTransaction(input: {
    slippageBps: number;
    gasPrice: bigint;
    deadlineMs: number;
    priceImpact: number;
  }): { valid: boolean; reason?: string } {
    const timestamp = this.now();

    // Check deadline
    if (input.deadlineMs < timestamp) {
      return { valid: false, reason: "Transaction deadline expired" };
    }

    // Check slippage
    if (input.slippageBps > this.config.maxSlippageBps) {
      return { valid: false, reason: `Slippage ${input.slippageBps}bps exceeds max ${this.config.maxSlippageBps}bps` };
    }

    // Check price impact
    if (input.priceImpact > 0.05) {
      return { valid: false, reason: `Price impact ${(input.priceImpact * 100).toFixed(1)}% too high` };
    }

    return { valid: true };
  }
}
