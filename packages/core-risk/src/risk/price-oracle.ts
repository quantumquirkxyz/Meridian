/**
 * Price Oracle: aggregates price data from multiple sources for validation.
 *
 * CONTEXT.md §14: "In DeFi, additional specific risks appear: ... oracle errors"
 *
 * This module provides:
 * - Multi-source price aggregation (Chainlink, Pyth, exchange APIs)
 * - Price deviation detection (oracle manipulation protection)
 * - Confidence scoring based on source agreement
 * - Fallback to secondary sources when primary is stale
 */

// ── Types ────────────────────────────────────────────────────────────

export interface OraclePrice {
  /** Asset symbol (e.g., "BTC/USDT"). */
  symbol: string;
  /** Price in USD. */
  priceUsd: number;
  /** Source of the price. */
  source: OracleSource;
  /** Timestamp of the price. */
  timestampMs: number;
  /** Confidence score (0-1). */
  confidence: number;
}

export type OracleSource =
  | "chainlink"
  | "pyth"
  | "binance"
  | "bybit"
  | "coingecko"
  | "uniswap-twap";

export interface OracleConfig {
  /** Maximum acceptable price deviation between sources (0-1, e.g., 0.01 = 1%). */
  maxDeviation: number;
  /** Maximum age of a price to be considered fresh (ms). */
  maxAgeMs: number;
  /** Minimum number of sources required for aggregation. */
  minSources: number;
  /** Whether to use median or weighted average. */
  aggregationMethod: "median" | "weighted";
}

export interface AggregatedPrice {
  /** Asset symbol. */
  symbol: string;
  /** Aggregated price in USD. */
  priceUsd: number;
  /** Confidence score (0-1). */
  confidence: number;
  /** Number of sources used. */
  sourceCount: number;
  /** Individual source prices. */
  sources: OraclePrice[];
  /** Whether the price is considered reliable. */
  isReliable: boolean;
  /** Warnings detected. */
  warnings: OracleWarning[];
}

export interface OracleWarning {
  type: "HIGH_DEVIATION" | "STALE_PRICE" | "LOW_SOURCES" | "SOURCE_FAILURE";
  severity: "LOW" | "MEDIUM" | "HIGH";
  message: string;
}

// ── Constants ────────────────────────────────────────────────────────

export const DEFAULT_ORACLE_CONFIG: OracleConfig = {
  maxDeviation: 0.02,
  maxAgeMs: 30_000,
  minSources: 2,
  aggregationMethod: "median",
};

// ── Price Oracle ─────────────────────────────────────────────────────

export class PriceOracle {
  private readonly config: OracleConfig;
  private readonly now: () => number;
  private readonly priceCache = new Map<string, OraclePrice[]>();

  constructor(config: Partial<OracleConfig> = {}, now?: () => number) {
    this.config = { ...DEFAULT_ORACLE_CONFIG, ...config };
    this.now = now ?? (() => Date.now());
  }

  /**
   * Add a price observation from a source.
   */
  addPrice(price: OraclePrice): void {
    const existing = this.priceCache.get(price.symbol) ?? [];
    // Replace existing price from same source or add new
    const filtered = existing.filter((p) => p.source !== price.source);
    filtered.push(price);
    this.priceCache.set(price.symbol, filtered);
  }

  /**
   * Add multiple price observations.
   */
  addPrices(prices: OraclePrice[]): void {
    for (const price of prices) {
      this.addPrice(price);
    }
  }

  /**
   * Get aggregated price for a symbol.
   */
  getAggregatedPrice(symbol: string): AggregatedPrice | null {
    const prices = this.priceCache.get(symbol) ?? [];
    const timestamp = this.now();
    const warnings: OracleWarning[] = [];

    // Filter out stale prices
    const freshPrices = prices.filter((p) => {
      const age = timestamp - p.timestampMs;
      if (age > this.config.maxAgeMs) {
        warnings.push({
          type: "STALE_PRICE",
          severity: "MEDIUM",
          message: `Stale price from ${p.source}: ${age}ms old`,
        });
        return false;
      }
      return true;
    });

    if (freshPrices.length === 0) {
      return null;
    }

    // Check for high deviation
    if (freshPrices.length >= 2) {
      const deviation = this.calculateDeviation(freshPrices);
      if (deviation > this.config.maxDeviation) {
        warnings.push({
          type: "HIGH_DEVIATION",
          severity: "HIGH",
          message: `High price deviation: ${(deviation * 100).toFixed(2)}% across sources`,
        });
      }
    }

    // Check minimum sources
    if (freshPrices.length < this.config.minSources) {
      warnings.push({
        type: "LOW_SOURCES",
        severity: "MEDIUM",
        message: `Only ${freshPrices.length} source(s), minimum ${this.config.minSources} required`,
      });
    }

    // Calculate aggregated price
    const aggregatedPrice = this.config.aggregationMethod === "median"
      ? this.calculateMedian(freshPrices)
      : this.calculateWeightedAverage(freshPrices);

    // Calculate confidence based on source count and deviation
    const confidence = this.calculateConfidence(freshPrices);

    const isReliable = warnings.filter((w) => w.severity === "HIGH").length === 0
      && freshPrices.length >= this.config.minSources;

    return {
      symbol,
      priceUsd: aggregatedPrice,
      confidence,
      sourceCount: freshPrices.length,
      sources: freshPrices,
      isReliable,
      warnings,
    };
  }

  /**
   * Validate a price against oracle data.
   */
  validatePrice(symbol: string, priceUsd: number): { valid: boolean; deviation: number; reason?: string } {
    const aggregated = this.getAggregatedPrice(symbol);
    if (!aggregated) {
      return { valid: true, deviation: 0 };
    }

    const deviation = Math.abs(priceUsd - aggregated.priceUsd) / aggregated.priceUsd;
    if (deviation > this.config.maxDeviation) {
      return {
        valid: false,
        deviation,
        reason: `Price deviation ${(deviation * 100).toFixed(2)}% exceeds max ${(this.config.maxDeviation * 100).toFixed(2)}%`,
      };
    }

    return { valid: true, deviation };
  }

  /**
   * Get all cached symbols.
   */
  getCachedSymbols(): string[] {
    return [...this.priceCache.keys()];
  }

  /**
   * Clear stale prices from cache.
   */
  clearStale(maxAgeMs?: number): void {
    const maxAge = maxAgeMs ?? this.config.maxAgeMs;
    const timestamp = this.now();

    for (const [symbol, prices] of this.priceCache) {
      const fresh = prices.filter((p) => timestamp - p.timestampMs < maxAge);
      if (fresh.length === 0) {
        this.priceCache.delete(symbol);
      } else {
        this.priceCache.set(symbol, fresh);
      }
    }
  }

  // ── Private helpers ───────────────────────────────────────────────

  private calculateMedian(prices: OraclePrice[]): number {
    const sorted = [...prices].sort((a, b) => a.priceUsd - b.priceUsd);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) {
      return (sorted[mid - 1].priceUsd + sorted[mid].priceUsd) / 2;
    }
    return sorted[mid].priceUsd;
  }

  private calculateWeightedAverage(prices: OraclePrice[]): number {
    let totalWeight = 0;
    let weightedSum = 0;

    for (const price of prices) {
      const weight = price.confidence;
      weightedSum += price.priceUsd * weight;
      totalWeight += weight;
    }

    return totalWeight > 0 ? weightedSum / totalWeight : 0;
  }

  private calculateDeviation(prices: OraclePrice[]): number {
    if (prices.length < 2) return 0;

    const mean = prices.reduce((sum, p) => sum + p.priceUsd, 0) / prices.length;
    const maxDeviation = Math.max(
      ...prices.map((p) => Math.abs(p.priceUsd - mean) / mean),
    );
    return maxDeviation;
  }

  private calculateConfidence(prices: OraclePrice[]): number {
    // Confidence based on source count and agreement
    const sourceCountFactor = Math.min(1, prices.length / this.config.minSources);
    const deviation = this.calculateDeviation(prices);
    const agreementFactor = Math.max(0, 1 - deviation / this.config.maxDeviation);

    return sourceCountFactor * 0.5 + agreementFactor * 0.5;
  }
}
