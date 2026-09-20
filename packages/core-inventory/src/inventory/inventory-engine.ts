/**
 * InventoryEngine: balances across CEX/wallet/chain, stablecoin exposure,
 * gas reserves, free/locked/exposed capital, per-strategy allocation,
 * rebalance suggestions, and pre-positioned inventory modeling (issue #32).
 *
 * Acceptance criteria:
 *   AC1: System knows free, locked, and exposed capital at all times
 *   AC2: Gas reserves and stablecoin exposure are modeled
 *   AC3: Rebalance suggestions are produced (advisory)
 *   AC4: Incorrect inventory blocks execution
 *
 * The engine is deterministic — no LLM, no I/O. It only reads typed
 * inputs and produces typed outputs. Callers sync balances from external
 * sources (CEX APIs, wallet providers, chain RPCs) and pass them in.
 *
 * The engine requires a price map (asset ticker → USD price) so that all
 * comparisons happen in a common USD unit. Without prices the engine can
 * still compute raw amounts, but validation and gas-reserve sufficiency
 * will be inaccurate.
 */

// ── Balance ─────────────────────────────────────────────────────────

/** Where a balance lives: centralized exchange, on-chain wallet, or DEX pool. */
export const BALANCE_VENUE_TYPES = ["CEX", "WALLET", "DEX"] as const;
export type BalanceVenueType = (typeof BALANCE_VENUE_TYPES)[number];

/**
 * A single balance entry. The system maintains an array of these, one
 * per (venue, chain, asset) tuple. Callers update them via `syncBalances`.
 */
export interface BalanceEntry {
  /** Venue type: CEX, WALLET, or DEX. */
  venueType: BalanceVenueType;
  /** Venue identifier (e.g. "bybit", "ethereum-mainnet", "uniswap-v3"). */
  venue: string;
  /** Chain identifier (e.g. "ethereum", "arbitrum", "bsc"). Empty for CEX spot. */
  chain: string;
  /** Asset ticker (e.g. "BTC", "ETH", "USDT"). */
  asset: string;
  /** Available to trade or transfer (asset units). */
  available: number;
  /** In open orders, staked, or otherwise committed (asset units). */
  locked: number;
  /** In positions with market risk (asset units). */
  exposed: number;
  /** Last sync timestamp (Unix ms). */
  lastSyncAtMs: number;
}

// ── Capital State ───────────────────────────────────────────────────

/**
 * Aggregated capital breakdown for a single asset across all venues.
 * Satisfies AC1: free, locked, and exposed capital at all times.
 *
 * Contains both raw asset-unit amounts and their USD equivalents (derived
 * from the price map supplied at snapshot time).
 */
export interface CapitalStateEntry {
  asset: string;
  /** Sum of available across all venues (asset units). */
  free: number;
  /** Sum of locked across all venues (asset units). */
  locked: number;
  /** Sum of exposed across all venues (asset units). */
  exposed: number;
  /** Total = free + locked + exposed (asset units). */
  total: number;
  /** USD value of free capital. */
  freeUsd: number;
  /** USD value of locked capital. */
  lockedUsd: number;
  /** USD value of exposed capital. */
  exposedUsd: number;
  /** Total USD value. */
  totalUsd: number;
}

// ── Gas Reserves ────────────────────────────────────────────────────

/**
 * Per-chain gas reserve status. Satisfies AC2.
 */
export interface GasReserveEntry {
  chain: string;
  /** Native token used for gas (e.g. "ETH", "MATIC", "BNB"). */
  nativeAsset: string;
  /** Amount of native asset available for gas. */
  available: number;
  /** Amount reserved (not available for trading). */
  reserved: number;
  /** Estimated value of the available gas reserve (USD). */
  estimatedValueUsd: number;
  /** Whether the reserve meets the policy minimum. */
  sufficient: boolean;
}

// ── Stablecoin Exposure ─────────────────────────────────────────────

/**
 * Stablecoin exposure summary. Satisfies AC2.
 */
export interface StablecoinExposure {
  /** Total USD value held in stablecoins. */
  stablecoinValueUsd: number;
  /** Total portfolio value (all assets, USD). */
  totalValueUsd: number;
  /** Ratio of stablecoin value to total value [0, 1]. */
  ratio: number;
  /** Whether the ratio is within policy bounds. */
  withinPolicy: boolean;
}

// ── Strategy Allocation ─────────────────────────────────────────────

/**
 * Per-strategy capital allocation. Tracks how much capital each strategy
 * is permitted to use and how much it has actually deployed.
 */
export interface StrategyAllocation {
  /** Strategy identifier. */
  strategyId: string;
  /** Maximum capital (USD) this strategy may use. */
  maxAllocationUsd: number;
  /** Currently deployed capital (USD) by this strategy. */
  deployedUsd: number;
  /** Available remaining allocation (USD). */
  availableUsd: number;
  /** Capital utilization ratio [0, 1+]. */
  utilizationRatio: number;
}

// ── Rebalance Suggestions ───────────────────────────────────────────

export const REBALANCE_TYPES = [
  "GAS_REFUEL",
  "STABLECOIN_REBALANCE",
  "VENUE_REBALANCE",
  "STRATEGY_REBALANCE",
] as const;
export type RebalanceType = (typeof REBALANCE_TYPES)[number];

export const REBALANCE_SEVERITY = ["INFO", "WARNING", "CRITICAL"] as const;
export type RebalanceSeverity = (typeof REBALANCE_SEVERITY)[number];

/**
 * Advisory rebalance suggestion. Satisfies AC3: produced but not enforced.
 */
export interface RebalanceSuggestion {
  type: RebalanceType;
  severity: RebalanceSeverity;
  /** Human-readable description. */
  description: string;
  /** Source venue/chain/strategy. */
  from?: string;
  /** Target venue/chain/strategy. */
  to?: string;
  /** Asset involved. */
  asset?: string;
  /** Recommended transfer amount (USD). */
  amountUsd?: number;
}

// ── Inventory Policy ────────────────────────────────────────────────

/**
 * Policy thresholds for inventory management. All fields are optional —
 * only rules with a defined threshold are enforced; undefined means "no limit."
 */
export interface InventoryPolicy {
  /** Minimum gas reserve (native token units) per chain. */
  minGasReservePerChain?: number;
  /** Minimum gas reserve value (USD) per chain. */
  minGasReserveValueUsd?: number;

  /** Maximum stablecoin exposure ratio [0, 1]. */
  maxStablecoinRatio?: number;
  /** Minimum stablecoin exposure ratio [0, 1]. */
  minStablecoinRatio?: number;

  /** Maximum total exposure per chain (USD). */
  maxExposurePerChainUsd?: number;
  /** Maximum total exposure per venue (USD). */
  maxExposurePerVenueUsd?: number;

  /** Maximum staleness (ms) before a balance is considered stale. */
  maxBalanceStalenessMs?: number;

  /** Stablecoin asset tickers (used to classify stablecoins). */
  stablecoinAssets?: readonly string[];

  /**
   * Known native gas assets per chain. Used for accurate gas reserve
   * detection instead of the first-asset heuristic.
   * Example: { "ethereum": "ETH", "arbitrum": "ETH", "bsc": "BNB" }
   */
  nativeGasAssets?: Readonly<Record<string, string>>;
}

/** Default stablecoin list — covers the major USD-pegged tokens. */
export const DEFAULT_STABLECOIN_ASSETS: readonly string[] = [
  "USDT",
  "USDC",
  "BUSD",
  "DAI",
  "TUSD",
  "USDP",
  "FRAX",
  "LUSD",
  "GUSD",
];

/** Default policy with reasonable production thresholds. */
export const DEFAULT_INVENTORY_POLICY: Required<
  Pick<
    InventoryPolicy,
    | "minGasReservePerChain"
    | "minGasReserveValueUsd"
    | "maxStablecoinRatio"
    | "minStablecoinRatio"
    | "maxBalanceStalenessMs"
    | "stablecoinAssets"
  >
> = {
  minGasReservePerChain: 0.01,
  minGasReserveValueUsd: 5,
  maxStablecoinRatio: 0.8,
  minStablecoinRatio: 0.1,
  maxBalanceStalenessMs: 300_000, // 5 minutes
  stablecoinAssets: [...DEFAULT_STABLECOIN_ASSETS],
};

// ── Price Map ───────────────────────────────────────────────────────

/**
 * Price map: asset ticker → USD price per unit. Used to convert raw asset
 * amounts into USD values for comparison and validation.
 */
export type PriceMap = Readonly<Record<string, number>>;

// ── Inventory Snapshot ──────────────────────────────────────────────

/**
 * Complete inventory snapshot — the output of a full inventory evaluation.
 */
export interface InventorySnapshot {
  /** Timestamp of the snapshot. */
  evaluatedAtMs: number;
  /** Raw balances as synced. */
  balances: readonly BalanceEntry[];
  /** Price map used for USD conversions. */
  prices: PriceMap;
  /** Aggregated capital state per asset (includes USD values). */
  capitalStates: readonly CapitalStateEntry[];
  /** Per-chain gas reserve status. */
  gasReserves: readonly GasReserveEntry[];
  /** Stablecoin exposure summary. */
  stablecoinExposure: StablecoinExposure;
  /** Per-strategy allocation status. */
  strategyAllocations: readonly StrategyAllocation[];
  /** Advisory rebalance suggestions. */
  rebalanceSuggestions: readonly RebalanceSuggestion[];
}

// ── Inventory Validation ────────────────────────────────────────────

/**
 * The result of an inventory validation check. Satisfies AC4: incorrect
 * inventory blocks execution.
 */
export interface InventoryValidation {
  /** Whether the inventory state permits execution. */
  blocked: boolean;
  /** Reasons why execution is blocked (empty when not blocked). */
  reasons: readonly string[];
  /** The snapshot used for this validation. */
  snapshot: InventorySnapshot;
}

/**
 * Input for validating whether a proposed order can proceed from an
 * inventory perspective. The engine checks that the required capital is
 * available and that no policy constraints are violated.
 */
export interface InventoryValidationInput {
  /** Proposed order asset. */
  asset: string;
  /** Proposed order venue. */
  venue: string;
  /** Proposed order side. */
  side: "BUY" | "SELL";
  /** Proposed order notional (quantity × price) in USD. */
  notionalUsd: number;
  /** Strategy that proposed this order. */
  strategyId?: string;
  /** Chain (for DEX orders). */
  chain?: string;
  /** Evaluation timestamp. */
  evaluatedAtMs: number;
}

// ── Helpers ─────────────────────────────────────────────────────────

function sumBy<T>(items: readonly T[], fn: (item: T) => number): number {
  return items.reduce((acc, item) => acc + fn(item), 0);
}

function assetPrice(asset: string, prices: PriceMap): number {
  return prices[asset.toUpperCase()] ?? 0;
}

function isStablecoin(
  asset: string,
  stablecoinAssets: readonly string[],
): boolean {
  return stablecoinAssets.includes(asset.toUpperCase());
}

/**
 * Compute the total USD exposure for balances matching a predicate.
 * Used for both venue and chain exposure checks.
 */
function computeExposureUsd(
  balances: readonly BalanceEntry[],
  matcher: (b: BalanceEntry) => boolean,
  prices: PriceMap,
): number {
  return sumBy(
    balances.filter(matcher),
    (b) => (b.available + b.locked + b.exposed) * assetPrice(b.asset, prices),
  );
}

/**
 * Build an exposure map from balances using a key extractor.
 * Used for venue and chain concentration suggestions.
 */
function buildExposureMap(
  balances: readonly BalanceEntry[],
  keyFn: (b: BalanceEntry) => string | null,
  prices: PriceMap,
): Map<string, number> {
  const exposureUsd = new Map<string, number>();
  for (const b of balances) {
    const key = keyFn(b);
    if (key === null) continue;
    const valueUsd = (b.available + b.locked + b.exposed) * assetPrice(b.asset, prices);
    exposureUsd.set(key, (exposureUsd.get(key) ?? 0) + valueUsd);
  }
  return exposureUsd;
}

/**
 * Generate rebalance suggestions for items exceeding an exposure limit.
 * Shared logic for venue and chain concentration checks.
 */
function pushExposureSuggestions(
  suggestions: RebalanceSuggestion[],
  exposureMap: Map<string, number>,
  maxExposure: number,
  label: string,
): void {
  for (const [item, exposureUsd] of exposureMap) {
    if (exposureUsd > maxExposure) {
      suggestions.push({
        type: "VENUE_REBALANCE",
        severity: "CRITICAL",
        description: `${label} ${item} exposure $${exposureUsd.toFixed(2)} exceeds limit $${maxExposure} USD`,
        from: item,
        amountUsd: exposureUsd - maxExposure,
      });
    }
  }
}

// ── Engine ──────────────────────────────────────────────────────────

/**
 * Deterministic InventoryEngine. Evaluates the full inventory state and
 * produces typed snapshots, validation results, and rebalance suggestions.
 *
 * The engine does not hold internal state beyond what is provided via
 * the balances and prices. Callers pass in the authoritative balance list
 * on every evaluation cycle (mirroring the reconciliation pattern).
 */
export class InventoryEngine {
  private readonly policy: InventoryPolicy;

  constructor(policy: InventoryPolicy = DEFAULT_INVENTORY_POLICY) {
    this.policy = { ...policy };
  }

  // ── AC1: Free, locked, and exposed capital ──────────────────────

  /**
   * Compute aggregated capital state per asset across all venues.
   * Includes both raw amounts and USD equivalents.
   */
  computeCapitalStates(
    balances: readonly BalanceEntry[],
    prices: PriceMap,
  ): readonly CapitalStateEntry[] {
    const byAsset = new Map<
      string,
      { free: number; locked: number; exposed: number }
    >();

    for (const b of balances) {
      const key = b.asset.toUpperCase();
      const existing = byAsset.get(key);
      if (existing !== undefined) {
        existing.free += b.available;
        existing.locked += b.locked;
        existing.exposed += b.exposed;
      } else {
        byAsset.set(key, {
          free: b.available,
          locked: b.locked,
          exposed: b.exposed,
        });
      }
    }

    const states: CapitalStateEntry[] = [];
    for (const [asset, { free, locked, exposed }] of byAsset) {
      const price = assetPrice(asset, prices);
      states.push({
        asset,
        free,
        locked,
        exposed,
        total: free + locked + exposed,
        freeUsd: free * price,
        lockedUsd: locked * price,
        exposedUsd: exposed * price,
        totalUsd: (free + locked + exposed) * price,
      });
    }
    return states;
  }

  // ── AC2: Gas reserves ──────────────────────────────────────────

  /**
   * Compute per-chain gas reserve status using the price map for
   * accurate USD estimation.
   */
  computeGasReserves(
    balances: readonly BalanceEntry[],
    prices: PriceMap,
  ): readonly GasReserveEntry[] {
    const nativeGasAssets = this.policy.nativeGasAssets ?? {};
    const byChain = new Map<
      string,
      { nativeAsset: string; available: number; reserved: number }
    >();

    for (const b of balances) {
      if (b.chain === "") continue; // CEX spot has no chain

      const configuredNative = nativeGasAssets[b.chain];
      if (configuredNative !== undefined) {
        // Use configured native asset for this chain.
        if (b.asset.toUpperCase() !== configuredNative.toUpperCase()) continue;
        const existing = byChain.get(b.chain);
        if (existing !== undefined) {
          existing.available += b.available;
          existing.reserved += b.locked;
        } else {
          byChain.set(b.chain, {
            nativeAsset: configuredNative,
            available: b.available,
            reserved: b.locked,
          });
        }
      } else {
        // Heuristic: first asset on a chain is treated as the native gas asset.
        const existing = byChain.get(b.chain);
        if (existing !== undefined) {
          if (b.asset.toUpperCase() === existing.nativeAsset.toUpperCase()) {
            existing.available += b.available;
            existing.reserved += b.locked;
          }
        } else {
          byChain.set(b.chain, {
            nativeAsset: b.asset,
            available: b.available,
            reserved: b.locked,
          });
        }
      }
    }

    const reserves: GasReserveEntry[] = [];
    const minReserve = this.policy.minGasReservePerChain ?? 0;
    const minValueUsd = this.policy.minGasReserveValueUsd ?? 0;

    for (const [chain, { nativeAsset, available, reserved }] of byChain) {
      const price = assetPrice(nativeAsset, prices);
      const estimatedValueUsd = available * price;
      const sufficient =
        available >= minReserve && estimatedValueUsd >= minValueUsd;

      reserves.push({
        chain,
        nativeAsset,
        available,
        reserved,
        estimatedValueUsd,
        sufficient,
      });
    }

    return reserves;
  }

  /**
   * Compute stablecoin exposure using the price map. Satisfies AC2.
   */
  computeStablecoinExposure(
    balances: readonly BalanceEntry[],
    prices: PriceMap,
  ): StablecoinExposure {
    const stablecoinAssets =
      this.policy.stablecoinAssets ?? DEFAULT_STABLECOIN_ASSETS;
    let stablecoinValueUsd = 0;
    let totalValueUsd = 0;

    for (const b of balances) {
      const price = assetPrice(b.asset, prices);
      const rawValue = b.available + b.locked + b.exposed;
      const valueUsd = rawValue * price;
      totalValueUsd += valueUsd;
      if (isStablecoin(b.asset, stablecoinAssets)) {
        stablecoinValueUsd += valueUsd;
      }
    }

    const ratio = totalValueUsd > 0 ? stablecoinValueUsd / totalValueUsd : 0;
    const maxRatio = this.policy.maxStablecoinRatio;
    const minRatio = this.policy.minStablecoinRatio;
    let withinPolicy = true;
    if (maxRatio !== undefined && ratio > maxRatio) withinPolicy = false;
    if (minRatio !== undefined && ratio < minRatio) withinPolicy = false;

    return {
      stablecoinValueUsd,
      totalValueUsd,
      ratio,
      withinPolicy,
    };
  }

  // ── AC3: Rebalance suggestions ─────────────────────────────────

  /**
   * Produce gas reserve rebalance suggestions.
   */
  private suggestGasReserves(
    suggestions: RebalanceSuggestion[],
    gasReserves: readonly GasReserveEntry[],
  ): void {
    for (const reserve of gasReserves) {
      if (!reserve.sufficient) {
        suggestions.push({
          type: "GAS_REFUEL",
          severity: "CRITICAL",
          description: `Gas reserve on ${reserve.chain} is below minimum (${reserve.available.toFixed(4)} ${reserve.nativeAsset} available, ~$${reserve.estimatedValueUsd.toFixed(2)} USD)`,
          to: reserve.chain,
          asset: reserve.nativeAsset,
          amountUsd: Math.max(
            0,
            (this.policy.minGasReserveValueUsd ?? 5) - reserve.estimatedValueUsd,
          ),
        });
      } else if (
        reserve.available <
        (this.policy.minGasReservePerChain ?? 0) * 2
      ) {
        suggestions.push({
          type: "GAS_REFUEL",
          severity: "WARNING",
          description: `Gas reserve on ${reserve.chain} is low (${reserve.available.toFixed(4)} ${reserve.nativeAsset} available)`,
          to: reserve.chain,
          asset: reserve.nativeAsset,
        });
      }
    }
  }

  /**
   * Produce stablecoin rebalance suggestions.
   */
  private suggestStablecoinRebalance(
    suggestions: RebalanceSuggestion[],
    stablecoinExposure: StablecoinExposure,
  ): void {
    if (!stablecoinExposure.withinPolicy) {
      const maxRatio = this.policy.maxStablecoinRatio ?? 1;
      const minRatio = this.policy.minStablecoinRatio ?? 0;
      if (stablecoinExposure.ratio > maxRatio) {
        suggestions.push({
          type: "STABLECOIN_REBALANCE",
          severity: "WARNING",
          description: `Stablecoin exposure ${(stablecoinExposure.ratio * 100).toFixed(1)}% exceeds max ${(maxRatio * 100).toFixed(1)}%`,
          asset: "STABLECOINS",
          amountUsd:
            stablecoinExposure.stablecoinValueUsd -
            stablecoinExposure.totalValueUsd * maxRatio,
        });
      } else if (stablecoinExposure.ratio < minRatio) {
        suggestions.push({
          type: "STABLECOIN_REBALANCE",
          severity: "WARNING",
          description: `Stablecoin exposure ${(stablecoinExposure.ratio * 100).toFixed(1)}% is below min ${(minRatio * 100).toFixed(1)}%`,
          asset: "STABLECOINS",
          amountUsd:
            stablecoinExposure.totalValueUsd * minRatio -
            stablecoinExposure.stablecoinValueUsd,
        });
      }
    }
  }

  /**
   * Produce strategy allocation rebalance suggestions.
   */
  private suggestStrategyRebalance(
    suggestions: RebalanceSuggestion[],
    strategyAllocations: readonly StrategyAllocation[],
  ): void {
    for (const alloc of strategyAllocations) {
      if (alloc.utilizationRatio > 0.9) {
        suggestions.push({
          type: "STRATEGY_REBALANCE",
          severity: "WARNING",
          description: `Strategy "${alloc.strategyId}" utilization at ${(alloc.utilizationRatio * 100).toFixed(1)}% (${alloc.deployedUsd.toFixed(2)}/${alloc.maxAllocationUsd.toFixed(2)} USD)`,
          from: alloc.strategyId,
          asset: "CAPITAL",
        });
      }
      if (alloc.utilizationRatio === 0 && alloc.maxAllocationUsd > 0) {
        suggestions.push({
          type: "STRATEGY_REBALANCE",
          severity: "INFO",
          description: `Strategy "${alloc.strategyId}" has zero deployment despite ${alloc.maxAllocationUsd} USD allocation`,
          to: alloc.strategyId,
          asset: "CAPITAL",
        });
      }
    }
  }

  /**
   * Produce advisory rebalance suggestions based on the current inventory
   * state. Suggestions are never enforced — the caller decides whether
   * to act on them.
   */
  computeRebalanceSuggestions(
    balances: readonly BalanceEntry[],
    prices: PriceMap,
    gasReserves: readonly GasReserveEntry[],
    stablecoinExposure: StablecoinExposure,
    strategyAllocations: readonly StrategyAllocation[],
  ): readonly RebalanceSuggestion[] {
    const suggestions: RebalanceSuggestion[] = [];

    this.suggestGasReserves(suggestions, gasReserves);
    this.suggestStablecoinRebalance(suggestions, stablecoinExposure);
    this.suggestStrategyRebalance(suggestions, strategyAllocations);

    // Venue concentration suggestions (USD-denominated)
    const venueExposureUsd = buildExposureMap(
      balances,
      (b) => `${b.venueType}:${b.venue}`,
      prices,
    );
    const maxVenueExposure = this.policy.maxExposurePerVenueUsd;
    if (maxVenueExposure !== undefined) {
      pushExposureSuggestions(suggestions, venueExposureUsd, maxVenueExposure, "Venue");
    }

    // Chain concentration suggestions (USD-denominated)
    const chainExposureUsd = buildExposureMap(
      balances,
      (b) => b.chain === "" ? null : b.chain,
      prices,
    );
    const maxChainExposure = this.policy.maxExposurePerChainUsd;
    if (maxChainExposure !== undefined) {
      pushExposureSuggestions(suggestions, chainExposureUsd, maxChainExposure, "Chain");
    }

    return suggestions;
  }

  // ── Strategy Allocations ───────────────────────────────────────

  /**
   * Compute per-strategy allocation status.
   */
  computeStrategyAllocations(
    allocations: readonly {
      strategyId: string;
      maxAllocationUsd: number;
      deployedUsd: number;
    }[],
    totalFreeUsd: number,
  ): readonly StrategyAllocation[] {
    return allocations.map((a) => {
      const availableUsd = Math.max(
        0,
        Math.min(a.maxAllocationUsd - a.deployedUsd, totalFreeUsd),
      );
      const utilizationRatio =
        a.maxAllocationUsd > 0 ? a.deployedUsd / a.maxAllocationUsd : 0;

      return {
        strategyId: a.strategyId,
        maxAllocationUsd: a.maxAllocationUsd,
        deployedUsd: a.deployedUsd,
        availableUsd,
        utilizationRatio,
      };
    });
  }

  // ── AC4: Inventory validation blocks execution ──────────────────

  /**
   * Validate whether a proposed order can proceed from an inventory
   * perspective. Returns a blocking decision when:
   *   - Insufficient free capital for a BUY
   *   - Insufficient exposed capital for a SELL
   *   - Strategy allocation exceeded
   *   - Gas reserves insufficient (for DEX orders)
   *   - Balance staleness exceeds policy
   *   - Venue or chain exposure limits exceeded
   */
  validate(
    input: InventoryValidationInput,
    snapshot: InventorySnapshot,
  ): InventoryValidation {
    const reasons: string[] = [];

    // Find the capital state for the target asset.
    const assetState = snapshot.capitalStates.find(
      (s) => s.asset.toUpperCase() === input.asset.toUpperCase(),
    );

    if (input.side === "BUY") {
      // Need free capital (in USD) to buy.
      const freeUsd = assetState?.freeUsd ?? 0;
      if (assetState === undefined || freeUsd < input.notionalUsd) {
        reasons.push(
          `INSUFFICIENT_FREE_CAPITAL: need $${input.notionalUsd.toFixed(2)} USD for ${input.asset} BUY but only $${freeUsd.toFixed(2)} USD free`,
        );
      }
    } else {
      // SELL: need exposed (held) capital (in USD) to sell.
      const exposedUsd = assetState?.exposedUsd ?? 0;
      if (assetState === undefined || exposedUsd < input.notionalUsd) {
        reasons.push(
          `INSUFFICIENT_EXPOSED_CAPITAL: need $${input.notionalUsd.toFixed(2)} USD for ${input.asset} SELL but only $${exposedUsd.toFixed(2)} USD exposed`,
        );
      }
    }

    // Strategy allocation check
    if (input.strategyId !== undefined) {
      const alloc = snapshot.strategyAllocations.find(
        (a) => a.strategyId === input.strategyId,
      );
      if (alloc !== undefined && alloc.availableUsd < input.notionalUsd) {
        reasons.push(
          `STRATEGY_ALLOCATION_EXCEEDED: strategy "${input.strategyId}" has $${alloc.availableUsd.toFixed(2)} USD available but needs $${input.notionalUsd.toFixed(2)} USD`,
        );
      }
    }

    // Gas reserve check for DEX orders
    if (input.chain !== undefined && input.chain !== "") {
      const gasReserve = snapshot.gasReserves.find(
        (r) => r.chain === input.chain,
      );
      if (gasReserve !== undefined && !gasReserve.sufficient) {
        reasons.push(
          `INSUFFICIENT_GAS_RESERVE: chain ${input.chain} gas reserve is below minimum`,
        );
      }
    }

    // Balance staleness check
    const maxStaleness = this.policy.maxBalanceStalenessMs;
    if (maxStaleness !== undefined) {
      const now = input.evaluatedAtMs;
      const staleBalances = snapshot.balances.filter(
        (b) =>
          b.asset.toUpperCase() === input.asset.toUpperCase() &&
          now - b.lastSyncAtMs > maxStaleness,
      );
      if (staleBalances.length > 0) {
        reasons.push(
          `STALE_BALANCE: ${staleBalances.length} balance entry(ies) for ${input.asset} are stale (last sync > ${maxStaleness}ms ago)`,
        );
      }
    }

    // Venue exposure check (USD-denominated)
    const maxVenueExposure = this.policy.maxExposurePerVenueUsd;
    if (maxVenueExposure !== undefined) {
      const venueExposureUsd = computeExposureUsd(
        snapshot.balances,
        (b) => b.venue === input.venue && b.asset.toUpperCase() === input.asset.toUpperCase(),
        snapshot.prices,
      );
      if (venueExposureUsd + input.notionalUsd > maxVenueExposure) {
        reasons.push(
          `VENUE_EXPOSURE_EXCEEDED: venue ${input.venue} exposure would reach $${(venueExposureUsd + input.notionalUsd).toFixed(2)} USD, exceeding limit $${maxVenueExposure} USD`,
        );
      }
    }

    // Chain exposure check (USD-denominated)
    const maxChainExposure = this.policy.maxExposurePerChainUsd;
    if (
      maxChainExposure !== undefined &&
      input.chain !== undefined &&
      input.chain !== ""
    ) {
      const chainExposureUsd = computeExposureUsd(
        snapshot.balances,
        (b) => b.chain === input.chain && b.asset.toUpperCase() === input.asset.toUpperCase(),
        snapshot.prices,
      );
      if (chainExposureUsd + input.notionalUsd > maxChainExposure) {
        reasons.push(
          `CHAIN_EXPOSURE_EXCEEDED: chain ${input.chain} exposure would reach $${(chainExposureUsd + input.notionalUsd).toFixed(2)} USD, exceeding limit $${maxChainExposure} USD`,
        );
      }
    }

    return {
      blocked: reasons.length > 0,
      reasons,
      snapshot,
    };
  }

  // ── Full snapshot ──────────────────────────────────────────────

  /**
   * Produce a complete inventory snapshot from raw balances, prices,
   * and strategy allocation inputs.
   */
  snapshot(options: {
    balances: readonly BalanceEntry[];
    prices: PriceMap;
    strategyAllocations?: readonly {
      strategyId: string;
      maxAllocationUsd: number;
      deployedUsd: number;
    }[];
    evaluatedAtMs: number;
  }): InventorySnapshot {
    const {
      balances,
      prices,
      strategyAllocations = [],
      evaluatedAtMs,
    } = options;

    const capitalStates = this.computeCapitalStates(balances, prices);
    const gasReserves = this.computeGasReserves(balances, prices);
    const stablecoinExposure = this.computeStablecoinExposure(
      balances,
      prices,
    );
    const totalFreeUsd = sumBy(capitalStates, (s) => s.freeUsd);
    const strategyAllocStatus = this.computeStrategyAllocations(
      strategyAllocations,
      totalFreeUsd,
    );
    const rebalanceSuggestions = this.computeRebalanceSuggestions(
      balances,
      prices,
      gasReserves,
      stablecoinExposure,
      strategyAllocStatus,
    );

    return {
      evaluatedAtMs,
      balances,
      prices,
      capitalStates,
      gasReserves,
      stablecoinExposure,
      strategyAllocations: strategyAllocStatus,
      rebalanceSuggestions,
    };
  }
}
