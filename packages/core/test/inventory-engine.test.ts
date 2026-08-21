import { describe, expect, test } from "bun:test";
import {
  InventoryEngine,
  DEFAULT_INVENTORY_POLICY,
  DEFAULT_STABLECOIN_ASSETS,
  type BalanceEntry,
  type InventoryPolicy,
  type InventoryValidationInput,
  type PriceMap,
} from "../src/inventory/inventory-engine.ts";

// ── Helpers ─────────────────────────────────────────────────────────

function balance(overrides: Partial<BalanceEntry> = {}): BalanceEntry {
  return {
    venueType: "CEX",
    venue: "bybit",
    chain: "",
    asset: "BTC",
    available: 1,
    locked: 0,
    exposed: 0,
    lastSyncAtMs: 0,
    ...overrides,
  };
}

function validationInput(
  overrides: Partial<InventoryValidationInput> = {},
): InventoryValidationInput {
  return {
    asset: "BTC",
    venue: "bybit",
    side: "BUY",
    notionalUsd: 1_000,
    evaluatedAtMs: 0,
    ...overrides,
  };
}

/** Default test prices — BTC at $100, ETH at $50, stablecoins at $1. */
const TEST_PRICES: PriceMap = {
  BTC: 100,
  ETH: 50,
  USDT: 1,
  USDC: 1,
  BNB: 300,
  MATIC: 0.5,
};

// ── AC1: Free, locked, and exposed capital ──────────────────────────

describe("AC1: Free, locked, and exposed capital", () => {
  const engine = new InventoryEngine();

  test("computes capital states with raw amounts and USD values", () => {
    const balances = [
      balance({ asset: "BTC", available: 1, locked: 0.5, exposed: 0.3 }),
      balance({ asset: "BTC", venue: "binance", available: 0.5, locked: 0, exposed: 0.2 }),
      balance({ asset: "ETH", available: 10, locked: 2, exposed: 5 }),
    ];

    const states = engine.computeCapitalStates(balances, TEST_PRICES);

    expect(states).toHaveLength(2);

    const btc = states.find((s) => s.asset === "BTC")!;
    // Raw amounts
    expect(btc.free).toBe(1.5);
    expect(btc.locked).toBe(0.5);
    expect(btc.exposed).toBe(0.5);
    expect(btc.total).toBe(2.5);
    // USD values: BTC = $100/unit
    expect(btc.freeUsd).toBe(150);
    expect(btc.lockedUsd).toBe(50);
    expect(btc.exposedUsd).toBe(50);
    expect(btc.totalUsd).toBe(250);

    const eth = states.find((s) => s.asset === "ETH")!;
    expect(eth.free).toBe(10);
    expect(eth.locked).toBe(2);
    expect(eth.exposed).toBe(5);
    expect(eth.total).toBe(17);
    // USD values: ETH = $50/unit
    expect(eth.freeUsd).toBe(500);
    expect(eth.lockedUsd).toBe(100);
    expect(eth.exposedUsd).toBe(250);
    expect(eth.totalUsd).toBe(850);
  });

  test("handles empty balances", () => {
    const states = engine.computeCapitalStates([], TEST_PRICES);
    expect(states).toHaveLength(0);
  });

  test("aggregates same asset across venues and chains", () => {
    const balances = [
      balance({ asset: "USDT", venue: "bybit", venueType: "CEX", available: 5000 }),
      balance({ asset: "USDT", venue: "binance", venueType: "CEX", available: 3000 }),
      balance({ asset: "USDT", venue: "wallet", venueType: "WALLET", chain: "ethereum", available: 2000 }),
    ];

    const states = engine.computeCapitalStates(balances, TEST_PRICES);
    const usdt = states.find((s) => s.asset === "USDT")!;
    expect(usdt.free).toBe(10_000);
    expect(usdt.total).toBe(10_000);
    expect(usdt.freeUsd).toBe(10_000); // USDT = $1
    expect(usdt.totalUsd).toBe(10_000);
  });

  test("asset case is normalized", () => {
    const balances = [
      balance({ asset: "btc", available: 1 }),
      balance({ asset: "BTC", available: 2 }),
    ];

    const states = engine.computeCapitalStates(balances, TEST_PRICES);
    expect(states).toHaveLength(1);
    expect(states[0].asset).toBe("BTC");
    expect(states[0].free).toBe(3);
    expect(states[0].freeUsd).toBe(300);
  });

  test("unknown asset gets zero price", () => {
    const balances = [balance({ asset: "DOGE", available: 1000 })];
    const states = engine.computeCapitalStates(balances, TEST_PRICES);
    expect(states[0].freeUsd).toBe(0); // no price → $0
  });
});

// ── AC2: Gas reserves and stablecoin exposure ───────────────────────

describe("AC2: Gas reserves", () => {
  const engine = new InventoryEngine();

  test("computes gas reserves per chain with USD values", () => {
    const balances = [
      balance({ asset: "ETH", venueType: "WALLET", venue: "wallet", chain: "ethereum", available: 0.5, locked: 0, exposed: 0 }),
      balance({ asset: "ETH", venueType: "WALLET", venue: "wallet", chain: "arbitrum", available: 0.1, locked: 0, exposed: 0 }),
    ];

    const reserves = engine.computeGasReserves(balances, TEST_PRICES);
    expect(reserves).toHaveLength(2);

    const ethMainnet = reserves.find((r) => r.chain === "ethereum")!;
    expect(ethMainnet.nativeAsset).toBe("ETH");
    expect(ethMainnet.available).toBe(0.5);
    // ETH = $50, so 0.5 ETH = $25 → sufficient (min $5)
    expect(ethMainnet.estimatedValueUsd).toBe(25);
    expect(ethMainnet.sufficient).toBe(true);

    const arb = reserves.find((r) => r.chain === "arbitrum")!;
    expect(arb.available).toBe(0.1);
    // 0.1 ETH = $5 → exactly at min $5
    expect(arb.estimatedValueUsd).toBe(5);
    expect(arb.sufficient).toBe(true);
  });

  test("marks reserve as insufficient when below minimum", () => {
    const engine2 = new InventoryEngine({
      ...DEFAULT_INVENTORY_POLICY,
      minGasReserveValueUsd: 50,
    });
    const balances = [
      balance({ asset: "ETH", venueType: "WALLET", venue: "wallet", chain: "ethereum", available: 0.5 }),
    ];

    const reserves = engine2.computeGasReserves(balances, TEST_PRICES);
    expect(reserves).toHaveLength(1);
    // 0.5 ETH = $25 < $50 → insufficient
    expect(reserves[0].sufficient).toBe(false);
  });

  test("skips CEX balances (no chain)", () => {
    const balances = [
      balance({ asset: "BTC", venueType: "CEX", chain: "", available: 1 }),
      balance({ asset: "ETH", venueType: "CEX", chain: "", available: 10 }),
    ];

    const reserves = engine.computeGasReserves(balances, TEST_PRICES);
    expect(reserves).toHaveLength(0);
  });

  test("uses configured nativeGasAssets", () => {
    const engine2 = new InventoryEngine({
      ...DEFAULT_INVENTORY_POLICY,
      nativeGasAssets: { ethereum: "ETH", bsc: "BNB" },
    });
    const balances = [
      balance({ asset: "ETH", venueType: "WALLET", venue: "wallet", chain: "ethereum", available: 1 }),
      balance({ asset: "USDC", venueType: "WALLET", venue: "wallet", chain: "ethereum", available: 5000 }),
      balance({ asset: "BNB", venueType: "WALLET", venue: "wallet", chain: "bsc", available: 2 }),
    ];

    const reserves = engine2.computeGasReserves(balances, TEST_PRICES);
    expect(reserves).toHaveLength(2);

    const eth = reserves.find((r) => r.chain === "ethereum")!;
    expect(eth.nativeAsset).toBe("ETH");
    expect(eth.available).toBe(1);
    // USDC on ethereum is skipped (not the native asset)
    expect(eth.estimatedValueUsd).toBe(50);

    const bnb = reserves.find((r) => r.chain === "bsc")!;
    expect(bnb.nativeAsset).toBe("BNB");
    expect(bnb.available).toBe(2);
  });
});

describe("AC2: Stablecoin exposure", () => {
  const engine = new InventoryEngine();

  test("computes stablecoin ratio using USD values", () => {
    const balances = [
      balance({ asset: "USDT", available: 5000 }),
      balance({ asset: "USDC", available: 3000 }),
      balance({ asset: "BTC", available: 20 }), // 20 BTC × $100 = $2000
    ];

    const exposure = engine.computeStablecoinExposure(balances, TEST_PRICES);
    // Stablecoins: $5000 + $3000 = $8000
    // Total: $5000 + $3000 + $2000 = $10000
    expect(exposure.stablecoinValueUsd).toBe(8000);
    expect(exposure.totalValueUsd).toBe(10_000);
    expect(exposure.ratio).toBe(0.8);
  });

  test("withinPolicy is true when ratio is in bounds", () => {
    const engine2 = new InventoryEngine({
      ...DEFAULT_INVENTORY_POLICY,
      minStablecoinRatio: 0.1,
      maxStablecoinRatio: 0.9,
    });
    const balances = [
      balance({ asset: "USDT", available: 5000 }),
      balance({ asset: "BTC", available: 50 }), // 50 × $100 = $5000
    ];

    const exposure = engine2.computeStablecoinExposure(balances, TEST_PRICES);
    expect(exposure.ratio).toBe(0.5);
    expect(exposure.withinPolicy).toBe(true);
  });

  test("withinPolicy is false when ratio exceeds max", () => {
    const balances = [
      balance({ asset: "USDT", available: 9000 }),
      balance({ asset: "BTC", available: 10 }), // 10 × $100 = $1000
    ];

    const exposure = engine.computeStablecoinExposure(balances, TEST_PRICES);
    // $9000 / $10000 = 0.9, max is 0.8
    expect(exposure.ratio).toBe(0.9);
    expect(exposure.withinPolicy).toBe(false);
  });

  test("withinPolicy is false when ratio is below min", () => {
    const balances = [
      balance({ asset: "USDT", available: 500 }),
      balance({ asset: "BTC", available: 95 }), // 95 × $100 = $9500
    ];

    const exposure = engine.computeStablecoinExposure(balances, TEST_PRICES);
    // $500 / $10000 = 0.05, min is 0.1
    expect(exposure.ratio).toBe(0.05);
    expect(exposure.withinPolicy).toBe(false);
  });

  test("recognizes default stablecoin assets", () => {
    for (const asset of DEFAULT_STABLECOIN_ASSETS) {
      const balances = [balance({ asset, available: 1000 })];
      const exposure = engine.computeStablecoinExposure(balances, {
        [asset]: 1,
      });
      expect(exposure.stablecoinValueUsd).toBe(1000);
    }
  });

  test("handles empty balances", () => {
    const exposure = engine.computeStablecoinExposure([], TEST_PRICES);
    expect(exposure.ratio).toBe(0);
    expect(exposure.totalValueUsd).toBe(0);
  });
});

// ── AC3: Rebalance suggestions ──────────────────────────────────────

describe("AC3: Rebalance suggestions", () => {
  const engine = new InventoryEngine();

  test("produces gas refuel suggestion when reserve is critical", () => {
    const balances = [
      balance({ asset: "ETH", venueType: "WALLET", venue: "wallet", chain: "ethereum", available: 0.001 }),
    ];
    const gasReserves = engine.computeGasReserves(balances, TEST_PRICES);
    const stablecoinExposure = engine.computeStablecoinExposure(balances, TEST_PRICES);

    const suggestions = engine.computeRebalanceSuggestions(
      balances,
      TEST_PRICES,
      gasReserves,
      stablecoinExposure,
      [],
    );

    const gasSuggestion = suggestions.find((s) => s.type === "GAS_REFUEL");
    expect(gasSuggestion).toBeDefined();
    expect(gasSuggestion!.severity).toBe("CRITICAL");
  });

  test("produces stablecoin rebalance when ratio exceeds max", () => {
    const balances = [
      balance({ asset: "USDT", available: 9000 }),
      balance({ asset: "BTC", available: 10 }), // 10 × $100 = $1000
    ];
    const gasReserves = engine.computeGasReserves(balances, TEST_PRICES);
    const stablecoinExposure = engine.computeStablecoinExposure(balances, TEST_PRICES);

    const suggestions = engine.computeRebalanceSuggestions(
      balances,
      TEST_PRICES,
      gasReserves,
      stablecoinExposure,
      [],
    );

    const stableSuggestion = suggestions.find(
      (s) => s.type === "STABLECOIN_REBALANCE",
    );
    expect(stableSuggestion).toBeDefined();
    expect(stableSuggestion!.severity).toBe("WARNING");
  });

  test("produces strategy rebalance when utilization is high", () => {
    const strategyAllocations = [
      { strategyId: "arb-1", maxAllocationUsd: 10_000, deployedUsd: 9_500 },
    ];
    const balances = [
      balance({ asset: "USDT", available: 20_000 }),
    ];
    const capitalStates = engine.computeCapitalStates(balances, TEST_PRICES);
    const totalFreeUsd = capitalStates.reduce((acc, s) => acc + s.freeUsd, 0);
    const allocStatus = engine.computeStrategyAllocations(
      strategyAllocations,
      totalFreeUsd,
    );
    const gasReserves = engine.computeGasReserves(balances, TEST_PRICES);
    const stablecoinExposure = engine.computeStablecoinExposure(balances, TEST_PRICES);

    const suggestions = engine.computeRebalanceSuggestions(
      balances,
      TEST_PRICES,
      gasReserves,
      stablecoinExposure,
      allocStatus,
    );

    const strategySuggestion = suggestions.find(
      (s) => s.type === "STRATEGY_REBALANCE",
    );
    expect(strategySuggestion).toBeDefined();
    expect(strategySuggestion!.severity).toBe("WARNING");
  });

  test("produces venue rebalance when venue exposure exceeds limit", () => {
    const policy: InventoryPolicy = {
      ...DEFAULT_INVENTORY_POLICY,
      maxExposurePerVenueUsd: 5000,
    };
    const engine2 = new InventoryEngine(policy);
    // bybit total: 3000 BTC ($300k) + 1000 ETH ($50k) = $350k → exceeds $5000
    const balances = [
      balance({ asset: "BTC", venue: "bybit", available: 3000, locked: 1000, exposed: 2000 }),
      balance({ asset: "ETH", venue: "bybit", available: 1000 }),
    ];
    const gasReserves = engine2.computeGasReserves(balances, TEST_PRICES);
    const stablecoinExposure = engine2.computeStablecoinExposure(balances, TEST_PRICES);

    const suggestions = engine2.computeRebalanceSuggestions(
      balances,
      TEST_PRICES,
      gasReserves,
      stablecoinExposure,
      [],
    );

    const venueSuggestion = suggestions.find(
      (s) => s.type === "VENUE_REBALANCE" && s.severity === "CRITICAL",
    );
    expect(venueSuggestion).toBeDefined();
    expect(venueSuggestion!.from).toBe("CEX:bybit");
  });

  test("produces strategy info when allocation has zero deployment", () => {
    const strategyAllocations = [
      { strategyId: "new-strategy", maxAllocationUsd: 5000, deployedUsd: 0 },
    ];
    const balances = [balance({ asset: "USDT", available: 10_000 })];
    const capitalStates = engine.computeCapitalStates(balances, TEST_PRICES);
    const totalFreeUsd = capitalStates.reduce((acc, s) => acc + s.freeUsd, 0);
    const allocStatus = engine.computeStrategyAllocations(
      strategyAllocations,
      totalFreeUsd,
    );
    const gasReserves = engine.computeGasReserves(balances, TEST_PRICES);
    const stablecoinExposure = engine.computeStablecoinExposure(balances, TEST_PRICES);

    const suggestions = engine.computeRebalanceSuggestions(
      balances,
      TEST_PRICES,
      gasReserves,
      stablecoinExposure,
      allocStatus,
    );

    const infoSuggestion = suggestions.find(
      (s) =>
        s.type === "STRATEGY_REBALANCE" &&
        s.severity === "INFO" &&
        s.to === "new-strategy",
    );
    expect(infoSuggestion).toBeDefined();
  });

  test("no CRITICAL suggestions when inventory is healthy", () => {
    // A healthy inventory: enough gas, balanced stablecoins, no strategy issues.
    const balances = [
      balance({ asset: "USDT", available: 4000 }),    // $4000 stablecoin
      balance({ asset: "BTC", available: 30 }),        // 30 × $100 = $3000
      balance({ asset: "ETH", venueType: "WALLET", venue: "wallet", chain: "ethereum", available: 10 }), // 10 × $50 = $500
    ];
    const gasReserves = engine.computeGasReserves(balances, TEST_PRICES);
    const stablecoinExposure = engine.computeStablecoinExposure(balances, TEST_PRICES);

    const suggestions = engine.computeRebalanceSuggestions(
      balances,
      TEST_PRICES,
      gasReserves,
      stablecoinExposure,
      [],
    );

    // No CRITICAL suggestions — stablecoin ratio is 4000/7500 ≈ 53%, within [10%, 80%]
    const critical = suggestions.filter((s) => s.severity === "CRITICAL");
    expect(critical).toHaveLength(0);
  });
});

// ── AC4: Incorrect inventory blocks execution ───────────────────────

describe("AC4: Incorrect inventory blocks execution", () => {
  const engine = new InventoryEngine();

  test("blocks BUY when insufficient free capital", () => {
    const balances = [
      balance({ asset: "BTC", available: 5, locked: 0, exposed: 0 }),
    ];
    // 5 BTC × $100 = $500 free. Trying to buy $1000 → blocked.
    const snapshot = engine.snapshot({
      balances,
      prices: TEST_PRICES,
      evaluatedAtMs: 0,
    });

    const result = engine.validate(
      validationInput({ asset: "BTC", side: "BUY", notionalUsd: 1000 }),
      snapshot,
    );

    expect(result.blocked).toBe(true);
    expect(result.reasons.some((r) => r.includes("INSUFFICIENT_FREE_CAPITAL"))).toBe(true);
  });

  test("allows BUY when sufficient free capital", () => {
    const balances = [
      balance({ asset: "BTC", available: 20, locked: 0, exposed: 0 }),
    ];
    // 20 BTC × $100 = $2000 free. Trying to buy $1000 → allowed.
    const snapshot = engine.snapshot({
      balances,
      prices: TEST_PRICES,
      evaluatedAtMs: 0,
    });

    const result = engine.validate(
      validationInput({ asset: "BTC", side: "BUY", notionalUsd: 1000 }),
      snapshot,
    );

    expect(result.blocked).toBe(false);
    expect(result.reasons).toHaveLength(0);
  });

  test("blocks SELL when insufficient exposed capital", () => {
    const balances = [
      balance({ asset: "BTC", available: 0, locked: 0, exposed: 2 }),
    ];
    // 2 BTC × $100 = $200 exposed. Trying to sell $1000 → blocked.
    const snapshot = engine.snapshot({
      balances,
      prices: TEST_PRICES,
      evaluatedAtMs: 0,
    });

    const result = engine.validate(
      validationInput({ asset: "BTC", side: "SELL", notionalUsd: 1000 }),
      snapshot,
    );

    expect(result.blocked).toBe(true);
    expect(result.reasons.some((r) => r.includes("INSUFFICIENT_EXPOSED_CAPITAL"))).toBe(true);
  });

  test("allows SELL when sufficient exposed capital", () => {
    const balances = [
      balance({ asset: "BTC", available: 0, locked: 0, exposed: 20 }),
    ];
    // 20 BTC × $100 = $2000 exposed. Trying to sell $1000 → allowed.
    const snapshot = engine.snapshot({
      balances,
      prices: TEST_PRICES,
      evaluatedAtMs: 0,
    });

    const result = engine.validate(
      validationInput({ asset: "BTC", side: "SELL", notionalUsd: 1000 }),
      snapshot,
    );

    expect(result.blocked).toBe(false);
  });

  test("blocks when strategy allocation exceeded", () => {
    const balances = [
      balance({ asset: "USDT", available: 50_000 }),
    ];
    const snapshot = engine.snapshot({
      balances,
      prices: TEST_PRICES,
      strategyAllocations: [
        { strategyId: "arb-1", maxAllocationUsd: 5000, deployedUsd: 4900 },
      ],
      evaluatedAtMs: 0,
    });

    const result = engine.validate(
      validationInput({
        asset: "USDT",
        side: "BUY",
        notionalUsd: 1000,
        strategyId: "arb-1",
      }),
      snapshot,
    );

    expect(result.blocked).toBe(true);
    expect(result.reasons.some((r) => r.includes("STRATEGY_ALLOCATION_EXCEEDED"))).toBe(true);
  });

  test("blocks when gas reserve is insufficient for DEX order", () => {
    const policy: InventoryPolicy = {
      ...DEFAULT_INVENTORY_POLICY,
      minGasReserveValueUsd: 100,
    };
    const engine2 = new InventoryEngine(policy);
    const balances = [
      balance({
        asset: "ETH",
        venueType: "WALLET",
        venue: "wallet",
        chain: "ethereum",
        available: 0.5, // 0.5 ETH × $50 = $25 < $100
      }),
      balance({
        asset: "USDC",
        venueType: "WALLET",
        venue: "wallet",
        chain: "ethereum",
        available: 10_000,
      }),
    ];
    const snapshot = engine2.snapshot({
      balances,
      prices: TEST_PRICES,
      evaluatedAtMs: 0,
    });

    const result = engine2.validate(
      validationInput({
        asset: "USDC",
        venue: "uniswap",
        side: "BUY",
        notionalUsd: 1000,
        chain: "ethereum",
      }),
      snapshot,
    );

    expect(result.blocked).toBe(true);
    expect(result.reasons.some((r) => r.includes("INSUFFICIENT_GAS_RESERVE"))).toBe(true);
  });

  test("blocks when balance is stale", () => {
    const policy: InventoryPolicy = {
      ...DEFAULT_INVENTORY_POLICY,
      maxBalanceStalenessMs: 60_000,
    };
    const engine2 = new InventoryEngine(policy);
    const balances = [
      balance({
        asset: "BTC",
        available: 100, // 100 BTC × $100 = $10k free
        lastSyncAtMs: 0,
      }),
    ];
    const snapshot = engine2.snapshot({
      balances,
      prices: TEST_PRICES,
      evaluatedAtMs: 120_000, // 120s after last sync, max is 60s
    });

    const result = engine2.validate(
      validationInput({ asset: "BTC", side: "BUY", notionalUsd: 1000, evaluatedAtMs: 120_000 }),
      snapshot,
    );

    expect(result.blocked).toBe(true);
    expect(result.reasons.some((r) => r.includes("STALE_BALANCE"))).toBe(true);
  });

  test("blocks when venue exposure would exceed limit", () => {
    const policy: InventoryPolicy = {
      ...DEFAULT_INVENTORY_POLICY,
      maxExposurePerVenueUsd: 5000,
    };
    const engine2 = new InventoryEngine(policy);
    const balances = [
      balance({
        asset: "BTC",
        venue: "bybit",
        available: 40, // 40 × $100 = $4000
        locked: 5,     // 5 × $100 = $500
        exposed: 2,    // 2 × $100 = $200 → total $4700
      }),
    ];
    const snapshot = engine2.snapshot({
      balances,
      prices: TEST_PRICES,
      evaluatedAtMs: 0,
    });

    // Current $4700 + order $1000 = $5700 > $5000 → blocked
    const result = engine2.validate(
      validationInput({
        asset: "BTC",
        venue: "bybit",
        side: "BUY",
        notionalUsd: 1000,
      }),
      snapshot,
    );

    expect(result.blocked).toBe(true);
    expect(result.reasons.some((r) => r.includes("VENUE_EXPOSURE_EXCEEDED"))).toBe(true);
  });

  test("blocks when chain exposure would exceed limit", () => {
    const policy: InventoryPolicy = {
      ...DEFAULT_INVENTORY_POLICY,
      maxExposurePerChainUsd: 10_000,
    };
    const engine2 = new InventoryEngine(policy);
    const balances = [
      balance({
        asset: "ETH",
        venueType: "WALLET",
        venue: "wallet",
        chain: "ethereum",
        available: 150, // 150 × $50 = $7500
        locked: 20,     // 20 × $50 = $1000
        exposed: 10,    // 10 × $50 = $500 → total $9000
      }),
    ];
    const snapshot = engine2.snapshot({
      balances,
      prices: TEST_PRICES,
      evaluatedAtMs: 0,
    });

    // Current $9000 + order $2000 = $11000 > $10000 → blocked
    const result = engine2.validate(
      validationInput({
        asset: "ETH",
        venue: "uniswap",
        side: "BUY",
        notionalUsd: 2000,
        chain: "ethereum",
      }),
      snapshot,
    );

    expect(result.blocked).toBe(true);
    expect(result.reasons.some((r) => r.includes("CHAIN_EXPOSURE_EXCEEDED"))).toBe(true);
  });

  test("multiple blocking reasons can appear simultaneously", () => {
    const policy: InventoryPolicy = {
      ...DEFAULT_INVENTORY_POLICY,
      maxBalanceStalenessMs: 60_000,
      maxExposurePerVenueUsd: 1000,
    };
    const engine2 = new InventoryEngine(policy);
    const balances = [
      balance({
        asset: "BTC",
        venue: "bybit",
        available: 0,  // 0 free → blocks BUY
        locked: 50,    // 50 × $100 = $5000
        exposed: 20,   // 20 × $100 = $2000
        lastSyncAtMs: 0,
      }),
    ];
    const snapshot = engine2.snapshot({
      balances,
      prices: TEST_PRICES,
      evaluatedAtMs: 120_000,
    });

    const result = engine2.validate(
      validationInput({
        asset: "BTC",
        venue: "bybit",
        side: "BUY",
        notionalUsd: 2000,
        evaluatedAtMs: 120_000,
      }),
      snapshot,
    );

    expect(result.blocked).toBe(true);
    // Should have at least 2 blocking reasons: INSUFFICIENT_FREE_CAPITAL, STALE_BALANCE, VENUE_EXPOSURE_EXCEEDED
    expect(result.reasons.length).toBeGreaterThanOrEqual(2);
  });

  test("not blocked when all capital is sufficient and no policy limits", () => {
    const engine2 = new InventoryEngine({});
    const balances = [
      balance({ asset: "BTC", available: 100, exposed: 50 }),
    ];
    const snapshot = engine2.snapshot({
      balances,
      prices: TEST_PRICES,
      evaluatedAtMs: 0,
    });

    // 100 BTC × $100 = $10k free → $1000 buy is fine
    const result = engine2.validate(
      validationInput({ asset: "BTC", side: "BUY", notionalUsd: 1000 }),
      snapshot,
    );

    expect(result.blocked).toBe(false);
    expect(result.reasons).toHaveLength(0);
  });
});

// ── Strategy Allocations ────────────────────────────────────────────

describe("Strategy Allocations", () => {
  const engine = new InventoryEngine();

  test("computes utilization ratio correctly", () => {
    const allocs = engine.computeStrategyAllocations(
      [{ strategyId: "arb-1", maxAllocationUsd: 10_000, deployedUsd: 3_000 }],
      50_000, // totalFreeUsd
    );

    expect(allocs).toHaveLength(1);
    expect(allocs[0].utilizationRatio).toBe(0.3);
    expect(allocs[0].availableUsd).toBe(7000);
  });

  test("availableUsd is capped by free capital", () => {
    const allocs = engine.computeStrategyAllocations(
      [{ strategyId: "arb-1", maxAllocationUsd: 100_000, deployedUsd: 0 }],
      5000, // totalFreeUsd
    );

    // maxAllocation - deployed = 100_000, but free = 5000
    expect(allocs[0].availableUsd).toBe(5000);
  });

  test("availableUsd is non-negative", () => {
    const allocs = engine.computeStrategyAllocations(
      [{ strategyId: "arb-1", maxAllocationUsd: 5000, deployedUsd: 6000 }],
      1000,
    );

    expect(allocs[0].availableUsd).toBe(0);
    expect(allocs[0].utilizationRatio).toBeGreaterThan(1);
  });
});

// ── Full snapshot ───────────────────────────────────────────────────

describe("Full snapshot", () => {
  const engine = new InventoryEngine();

  test("produces a complete snapshot with all fields", () => {
    const balances = [
      balance({ asset: "BTC", available: 2, locked: 0.5, exposed: 1 }),
      balance({ asset: "ETH", venueType: "WALLET", venue: "wallet", chain: "ethereum", available: 5, locked: 0, exposed: 2 }),
      balance({ asset: "USDT", available: 10_000 }),
      balance({ asset: "USDC", available: 5000 }),
    ];

    const snap = engine.snapshot({
      balances,
      prices: TEST_PRICES,
      strategyAllocations: [
        { strategyId: "arb-1", maxAllocationUsd: 20_000, deployedUsd: 5000 },
      ],
      evaluatedAtMs: 1_000_000,
    });

    expect(snap.evaluatedAtMs).toBe(1_000_000);
    expect(snap.balances).toHaveLength(4);
    expect(snap.capitalStates.length).toBeGreaterThan(0);

    // Verify USD values are present
    const btc = snap.capitalStates.find((s) => s.asset === "BTC");
    expect(btc).toBeDefined();
    expect(btc!.freeUsd).toBe(200); // 2 × $100

    expect(snap.gasReserves.length).toBeGreaterThan(0);
    expect(snap.stablecoinExposure.totalValueUsd).toBeGreaterThan(0);
    expect(snap.strategyAllocations).toHaveLength(1);
    expect(Array.isArray(snap.rebalanceSuggestions)).toBe(true);
  });
});

// ── Default policy ──────────────────────────────────────────────────

describe("Default policy", () => {
  test("has reasonable defaults", () => {
    expect(DEFAULT_INVENTORY_POLICY.minGasReservePerChain).toBeGreaterThan(0);
    expect(DEFAULT_INVENTORY_POLICY.minGasReserveValueUsd).toBeGreaterThan(0);
    expect(DEFAULT_INVENTORY_POLICY.maxStablecoinRatio).toBeGreaterThan(0);
    expect(DEFAULT_INVENTORY_POLICY.minStablecoinRatio).toBeGreaterThanOrEqual(0);
    expect(DEFAULT_INVENTORY_POLICY.maxStablecoinRatio).toBeGreaterThan(
      DEFAULT_INVENTORY_POLICY.minStablecoinRatio,
    );
    expect(DEFAULT_INVENTORY_POLICY.maxBalanceStalenessMs).toBeGreaterThan(0);
    expect(DEFAULT_INVENTORY_POLICY.stablecoinAssets.length).toBeGreaterThan(0);
  });
});

// ── Engine construction ─────────────────────────────────────────────

describe("Engine construction", () => {
  test("constructs with default policy", () => {
    const engine = new InventoryEngine();
    expect(engine).toBeDefined();
  });

  test("constructs with custom policy", () => {
    const engine = new InventoryEngine({
      minGasReservePerChain: 0.1,
      minGasReserveValueUsd: 50,
    });
    expect(engine).toBeDefined();
  });
});
