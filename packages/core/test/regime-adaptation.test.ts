import { describe, expect, test } from "bun:test";
import {
  isMarketRegime,
  isRegimeClassification,
  isRegimeChange,
  isRegimePerformanceRecord,
  isRegimePolicy,
  isRegimePolicyConfig,
  parseRegimeClassification,
  parseRegimePolicy,
  DEFAULT_REGIME_POLICY_CONFIG,
  type MarketRegime,
  type RegimeClassification,
  type RegimePolicy,
} from "@agenttrading/contracts";
import {
  RegimeClassifier,
  DEFAULT_REGIME_THRESHOLDS,
  type RegimeClassifierInput,
} from "../src/gamma/regime-classifier.ts";
import {
  RegimePolicyEngine,
  RegimePerformanceTracker,
  validatePermissionReduction,
} from "../src/gamma/regime-policy-engine.ts";

// ── Helpers ──────────────────────────────────────────────────────────

const FIXED_TS = 1_700_000_000_000;

function baseInput(overrides: Partial<RegimeClassifierInput> = {}): RegimeClassifierInput {
  return {
    realizedVolatility: 0.3,
    spreadBps: 10,
    liquidityUsd: 50_000,
    gasPriceUsd: 5,
    cumulativePnlUsd: 0,
    maxDrawdownUsd: 0,
    rpcHealthy: true,
    cexHealthy: true,
    directionalStreak: 0,
    reversalCount: 0,
    nowMs: FIXED_TS,
    ...overrides,
  };
}

// ── Contract Tests ───────────────────────────────────────────────────

describe("Regime contracts", () => {
  test("isMarketRegime validates all regimes", () => {
    const regimes: MarketRegime[] = [
      "trend", "range", "chop", "high_volatility", "low_liquidity",
      "gas_spike", "degraded_rpc", "degraded_cex", "drawdown",
    ];
    for (const r of regimes) {
      expect(isMarketRegime(r)).toBe(true);
    }
  });

  test("isMarketRegime rejects invalid regime", () => {
    expect(isMarketRegime("invalid")).toBe(false);
  });

  test("isRegimeClassification validates a classification", () => {
    expect(
      isRegimeClassification({
        regime: "trend",
        confidence: 0.8,
        reason: "directional streak",
        classifiedAtMs: FIXED_TS,
      }),
    ).toBe(true);
  });

  test("isRegimeClassification rejects incomplete", () => {
    expect(isRegimeClassification({ regime: "trend" })).toBe(false);
  });

  test("isRegimePolicy validates a policy", () => {
    expect(isRegimePolicy(DEFAULT_REGIME_POLICY_CONFIG.policies.trend)).toBe(true);
  });

  test("isRegimePolicyConfig validates default config", () => {
    expect(isRegimePolicyConfig(DEFAULT_REGIME_POLICY_CONFIG)).toBe(true);
  });

  test("isRegimeChange validates a change record", () => {
    expect(
      isRegimeChange({
        eventId: "evt-1",
        timestampMs: FIXED_TS,
        previousRegime: null,
        newRegime: "trend",
        confidence: 0.8,
        reason: "test",
        permissionsReduced: false,
        appliedPolicy: DEFAULT_REGIME_POLICY_CONFIG.policies.trend,
      }),
    ).toBe(true);
  });

  test("isRegimePerformanceRecord validates", () => {
    expect(
      isRegimePerformanceRecord({
        regime: "trend",
        tradeCount: 0,
        totalPnlUsd: 0,
        winCount: 0,
        lossCount: 0,
        maxDrawdownUsd: 0,
        avgConfidence: 0,
        confidenceSamples: 0,
        totalTimeMs: 0,
      }),
    ).toBe(true);
  });

  test("parseRegimeClassification works", () => {
    const c = parseRegimeClassification({
      regime: "range",
      confidence: 0.7,
      reason: "low volatility",
      classifiedAtMs: FIXED_TS,
    });
    expect(c.regime).toBe("range");
    expect(c.confidence).toBe(0.7);
  });

  test("parseRegimePolicy works", () => {
    const p = parseRegimePolicy(DEFAULT_REGIME_POLICY_CONFIG.policies.drawdown);
    expect(p.tradingEnabled).toBe(false);
  });

  test("default config has all regimes", () => {
    const regimes: MarketRegime[] = [
      "trend", "range", "chop", "high_volatility", "low_liquidity",
      "gas_spike", "degraded_rpc", "degraded_cex", "drawdown",
    ];
    for (const r of regimes) {
      expect(DEFAULT_REGIME_POLICY_CONFIG.policies[r]).toBeDefined();
      expect(isRegimePolicy(DEFAULT_REGIME_POLICY_CONFIG.policies[r])).toBe(true);
    }
  });

  test("drawdown regime has halt mode", () => {
    const drawdownPolicy = DEFAULT_REGIME_POLICY_CONFIG.policies.drawdown;
    expect(drawdownPolicy.mode).toBe("HALT");
    expect(drawdownPolicy.tradingEnabled).toBe(false);
    expect(drawdownPolicy.emergencyAction).toBe("halt");
  });

  test("gas_spike regime disables trading", () => {
    const gasPolicy = DEFAULT_REGIME_POLICY_CONFIG.policies.gas_spike;
    expect(gasPolicy.tradingEnabled).toBe(false);
    expect(gasPolicy.emergencyAction).toBe("cancel_all");
  });
});

// ── RegimeClassifier Tests ───────────────────────────────────────────

describe("RegimeClassifier", () => {
  test("classifies drawdown when cumulative loss exceeds threshold", () => {
    const classifier = new RegimeClassifier();
    const result = classifier.classify(
      baseInput({ cumulativePnlUsd: -150 }),
    );
    expect(result.regime).toBe("drawdown");
    expect(result.confidence).toBe(DEFAULT_REGIME_THRESHOLDS.singleSignalConfidence);
    expect(result.reason).toContain("cumulative PnL");
  });

  test("classifies drawdown when max drawdown exceeds threshold", () => {
    const classifier = new RegimeClassifier();
    const result = classifier.classify(
      baseInput({ maxDrawdownUsd: 250 }),
    );
    expect(result.regime).toBe("drawdown");
    expect(result.reason).toContain("max drawdown");
  });

  test("classifies degraded_rpc when RPC is unhealthy", () => {
    const classifier = new RegimeClassifier();
    const result = classifier.classify(
      baseInput({ rpcHealthy: false }),
    );
    expect(result.regime).toBe("degraded_rpc");
    expect(result.reason).toContain("RPC");
  });

  test("classifies degraded_cex when CEX is unhealthy", () => {
    const classifier = new RegimeClassifier();
    const result = classifier.classify(
      baseInput({ cexHealthy: false }),
    );
    expect(result.regime).toBe("degraded_cex");
    expect(result.reason).toContain("CEX");
  });

  test("drawdown takes priority over degraded RPC", () => {
    const classifier = new RegimeClassifier();
    const result = classifier.classify(
      baseInput({ cumulativePnlUsd: -150, rpcHealthy: false }),
    );
    expect(result.regime).toBe("drawdown");
  });

  test("classifies gas_spike when gas exceeds threshold", () => {
    const classifier = new RegimeClassifier();
    const result = classifier.classify(
      baseInput({ gasPriceUsd: 60 }),
    );
    expect(result.regime).toBe("gas_spike");
    expect(result.reason).toContain("gas price");
  });

  test("classifies high_volatility when volatility exceeds threshold", () => {
    const classifier = new RegimeClassifier();
    const result = classifier.classify(
      baseInput({ realizedVolatility: 0.9 }),
    );
    expect(result.regime).toBe("high_volatility");
    expect(result.reason).toContain("realized volatility");
  });

  test("classifies low_liquidity when liquidity is below threshold", () => {
    const classifier = new RegimeClassifier();
    const result = classifier.classify(
      baseInput({ liquidityUsd: 3_000 }),
    );
    expect(result.regime).toBe("low_liquidity");
    expect(result.reason).toContain("liquidity");
  });

  test("classifies low_liquidity when spread is too high", () => {
    const classifier = new RegimeClassifier();
    const result = classifier.classify(
      baseInput({ spreadBps: 150 }),
    );
    expect(result.regime).toBe("low_liquidity");
    expect(result.reason).toContain("spread");
  });

  test("classifies chop when oscillation + moderate volatility", () => {
    const classifier = new RegimeClassifier();
    const result = classifier.classify(
      baseInput({ reversalCount: 6, realizedVolatility: 0.4 }),
    );
    expect(result.regime).toBe("chop");
    expect(result.confidence).toBe(DEFAULT_REGIME_THRESHOLDS.dualSignalConfidence);
  });

  test("classifies range when volatility is low", () => {
    const classifier = new RegimeClassifier();
    const result = classifier.classify(
      baseInput({ realizedVolatility: 0.2 }),
    );
    expect(result.regime).toBe("range");
  });

  test("classifies trend when directional streak is strong", () => {
    const classifier = new RegimeClassifier();
    const result = classifier.classify(
      baseInput({
        realizedVolatility: 0.4,
        directionalStreak: 7,
        reversalCount: 1,
      }),
    );
    expect(result.regime).toBe("trend");
    expect(result.confidence).toBe(DEFAULT_REGIME_THRESHOLDS.directionalConfidence);
  });

  test("fallback to range when no dominant signal", () => {
    const classifier = new RegimeClassifier();
    const result = classifier.classify(
      baseInput({
        realizedVolatility: 0.35,
        directionalStreak: 2,
        reversalCount: 2,
      }),
    );
    expect(result.regime).toBe("range");
    expect(result.confidence).toBe(0.5);
  });

  test("custom thresholds override defaults", () => {
    const classifier = new RegimeClassifier({
      ...DEFAULT_REGIME_THRESHOLDS,
      gasSpikeThresholdUsd: 10,
    });
    const result = classifier.classify(
      baseInput({ gasPriceUsd: 15 }),
    );
    expect(result.regime).toBe("gas_spike");
  });

  test("classification includes timestamp", () => {
    const classifier = new RegimeClassifier();
    const result = classifier.classify(baseInput({ nowMs: 999_999 }));
    expect(result.classifiedAtMs).toBe(999_999);
  });
});

// ── Permission Validation Tests ──────────────────────────────────────

describe("validatePermissionReduction", () => {
  const trendPolicy = DEFAULT_REGIME_POLICY_CONFIG.policies.trend;
  const chopPolicy = DEFAULT_REGIME_POLICY_CONFIG.policies.chop;
  const drawdownPolicy = DEFAULT_REGIME_POLICY_CONFIG.policies.drawdown;
  const gasPolicy = DEFAULT_REGIME_POLICY_CONFIG.policies.gas_spike;

  test("same policy is valid (no change)", () => {
    const result = validatePermissionReduction(trendPolicy, trendPolicy);
    expect(result.valid).toBe(true);
  });

  test("reducing maxOpenOrders is valid", () => {
    const result = validatePermissionReduction(trendPolicy, chopPolicy);
    expect(result.valid).toBe(true);
  });

  test("increasing maxOpenOrders is invalid", () => {
    const result = validatePermissionReduction(chopPolicy, trendPolicy);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toContain("maxOpenOrders");
    }
  });

  test("disabling trading is always valid", () => {
    const result = validatePermissionReduction(trendPolicy, drawdownPolicy);
    expect(result.valid).toBe(true);
  });

  test("enabling trading when disabled is invalid", () => {
    const result = validatePermissionReduction(drawdownPolicy, trendPolicy);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toContain("cannot enable trading");
    }
  });

  test("increasing maxOrderNotionalUsd is invalid", () => {
    // Use identical base policies so only maxOrderNotionalUsd differs.
    const base = { ...trendPolicy, maxOpenOrders: 5 };
    const restrictive = { ...base, maxOrderNotionalUsd: 100 };
    const lessRestrictive = { ...base, maxOrderNotionalUsd: 600 };
    const result = validatePermissionReduction(restrictive, lessRestrictive);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toContain("maxOrderNotionalUsd");
    }
  });

  test("adding a new strategy is invalid", () => {
    // Use policies that only differ in enabledStrategies.
    const base = { ...chopPolicy, enabledStrategies: ["arbitrage-alpha"] };
    const withExtra = { ...base, enabledStrategies: ["arbitrage-alpha", "momentum-follow"] };
    const result = validatePermissionReduction(base, withExtra);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toContain("strategy");
    }
  });

  test("trading disabled to trading disabled is valid", () => {
    const result = validatePermissionReduction(gasPolicy, drawdownPolicy);
    expect(result.valid).toBe(true);
  });
});

// ── RegimePolicyEngine Tests ─────────────────────────────────────────

describe("RegimePolicyEngine", () => {
  test("starts with null regime and default policy", () => {
    const engine = new RegimePolicyEngine({ now: () => FIXED_TS });
    expect(engine.regime).toBeNull();
    expect(engine.policy.tradingEnabled).toBe(true); // default is range
  });

  test("first classification sets the regime without change event", () => {
    const engine = new RegimePolicyEngine({ now: () => FIXED_TS });
    const result = engine.evaluate({
      regime: "trend",
      confidence: 0.8,
      reason: "test",
      classifiedAtMs: FIXED_TS,
    });
    expect(result.changed).toBe(true);
    expect(result.policy.regime).toBe("trend");
    expect(result.change).toBeDefined();
    expect(result.change!.previousRegime).toBeNull();
    expect(engine.regime).toBe("trend");
  });

  test("same regime does not emit a change", () => {
    const engine = new RegimePolicyEngine({ now: () => FIXED_TS });
    engine.evaluate({
      regime: "trend",
      confidence: 0.8,
      reason: "test",
      classifiedAtMs: FIXED_TS,
    });
    const result = engine.evaluate({
      regime: "trend",
      confidence: 0.9,
      reason: "still trend",
      classifiedAtMs: FIXED_TS + 1000,
    });
    expect(result.changed).toBe(false);
    expect(result.change).toBeUndefined();
  });

  test("regime change from trend to chop is allowed (reduction)", () => {
    const engine = new RegimePolicyEngine({ now: () => FIXED_TS });
    engine.evaluate({
      regime: "trend",
      confidence: 0.8,
      reason: "test",
      classifiedAtMs: FIXED_TS,
    });
    const result = engine.evaluate({
      regime: "chop",
      confidence: 0.75,
      reason: "oscillation",
      classifiedAtMs: FIXED_TS + 1000,
    });
    expect(result.changed).toBe(true);
    expect(result.policy.regime).toBe("chop");
    expect(result.change!.permissionsReduced).toBe(true);
  });

  test("regime change from chop to trend is blocked (increase)", () => {
    const engine = new RegimePolicyEngine({ now: () => FIXED_TS });
    engine.evaluate({
      regime: "chop",
      confidence: 0.75,
      reason: "oscillation",
      classifiedAtMs: FIXED_TS,
    });
    const result = engine.evaluate({
      regime: "trend",
      confidence: 0.8,
      reason: "directional",
      classifiedAtMs: FIXED_TS + 1000,
    });
    expect(result.changed).toBe(false);
    expect(result.blocked).toBe(true);
    expect(result.blockReason).toContain("maxOpenOrders");
    expect(engine.regime).toBe("chop"); // unchanged
  });

  test("regime change from trend to drawdown is allowed", () => {
    const engine = new RegimePolicyEngine({ now: () => FIXED_TS });
    engine.evaluate({
      regime: "trend",
      confidence: 0.8,
      reason: "test",
      classifiedAtMs: FIXED_TS,
    });
    const result = engine.evaluate({
      regime: "drawdown",
      confidence: 0.9,
      reason: "loss exceeded",
      classifiedAtMs: FIXED_TS + 1000,
    });
    expect(result.changed).toBe(true);
    expect(result.policy.mode).toBe("HALT");
  });

  test("regime change from drawdown to trend is blocked (trading re-enabled)", () => {
    const engine = new RegimePolicyEngine({ now: () => FIXED_TS });
    engine.evaluate({
      regime: "drawdown",
      confidence: 0.9,
      reason: "loss exceeded",
      classifiedAtMs: FIXED_TS,
    });
    const result = engine.evaluate({
      regime: "trend",
      confidence: 0.8,
      reason: "recovered",
      classifiedAtMs: FIXED_TS + 1000,
    });
    expect(result.changed).toBe(false);
    expect(result.blocked).toBe(true);
    expect(result.blockReason).toContain("cannot enable trading");
  });

  test("change history is accumulated", () => {
    const engine = new RegimePolicyEngine({ now: () => FIXED_TS });
    engine.evaluate({
      regime: "trend",
      confidence: 0.8,
      reason: "test",
      classifiedAtMs: FIXED_TS,
    });
    engine.evaluate({
      regime: "chop",
      confidence: 0.75,
      reason: "oscillation",
      classifiedAtMs: FIXED_TS + 1000,
    });
    // Third evaluation is blocked, so only 2 changes.
    engine.evaluate({
      regime: "trend",
      confidence: 0.8,
      reason: "attempted increase",
      classifiedAtMs: FIXED_TS + 2000,
    });
    expect(engine.history.length).toBe(2);
    expect(engine.history[0].newRegime).toBe("trend");
    expect(engine.history[1].newRegime).toBe("chop");
  });

  test("audit record includes correct fields", () => {
    const engine = new RegimePolicyEngine({ now: () => FIXED_TS });
    const result = engine.evaluate({
      regime: "high_volatility",
      confidence: 0.9,
      reason: "vol spike",
      classifiedAtMs: FIXED_TS,
    });
    expect(result.change).toBeDefined();
    const c = result.change!;
    expect(c.eventId).toContain("regime-change");
    expect(c.timestampMs).toBe(FIXED_TS);
    expect(c.previousRegime).toBeNull();
    expect(c.newRegime).toBe("high_volatility");
    expect(c.confidence).toBe(0.9);
    expect(c.reason).toBe("vol spike");
    expect(c.permissionsReduced).toBe(false);
    expect(c.appliedPolicy.regime).toBe("high_volatility");
  });

  test("finalize records time in current regime", () => {
    let ts = FIXED_TS;
    const engine = new RegimePolicyEngine({ now: () => ts });
    engine.evaluate({
      regime: "trend",
      confidence: 0.8,
      reason: "test",
      classifiedAtMs: ts,
    });
    ts += 5000;
    engine.finalize();
    const perf = engine.performanceTracker.get("trend");
    expect(perf.totalTimeMs).toBe(5000);
  });
});

// ── RegimePerformanceTracker Tests ───────────────────────────────────

describe("RegimePerformanceTracker", () => {
  test("initializes all regimes with zeroed records", () => {
    const tracker = new RegimePerformanceTracker();
    const all = tracker.getAll();
    const regimes: MarketRegime[] = [
      "trend", "range", "chop", "high_volatility", "low_liquidity",
      "gas_spike", "degraded_rpc", "degraded_cex", "drawdown",
    ];
    for (const r of regimes) {
      expect(all[r]).toBeDefined();
      expect(all[r].tradeCount).toBe(0);
      expect(all[r].totalPnlUsd).toBe(0);
    }
  });

  test("records a winning trade", () => {
    const tracker = new RegimePerformanceTracker();
    tracker.recordTrade("trend", 50, FIXED_TS);
    const rec = tracker.get("trend");
    expect(rec.tradeCount).toBe(1);
    expect(rec.totalPnlUsd).toBe(50);
    expect(rec.winCount).toBe(1);
    expect(rec.lossCount).toBe(0);
  });

  test("records a losing trade", () => {
    const tracker = new RegimePerformanceTracker();
    tracker.recordTrade("trend", -30, FIXED_TS);
    const rec = tracker.get("trend");
    expect(rec.tradeCount).toBe(1);
    expect(rec.totalPnlUsd).toBe(-30);
    expect(rec.winCount).toBe(0);
    expect(rec.lossCount).toBe(1);
  });

  test("accumulates multiple trades", () => {
    const tracker = new RegimePerformanceTracker();
    tracker.recordTrade("trend", 50, FIXED_TS);
    tracker.recordTrade("trend", -20, FIXED_TS + 1000);
    tracker.recordTrade("trend", 30, FIXED_TS + 2000);
    const rec = tracker.get("trend");
    expect(rec.tradeCount).toBe(3);
    expect(rec.totalPnlUsd).toBe(60);
    expect(rec.winCount).toBe(2);
    expect(rec.lossCount).toBe(1);
  });

  test("tracks max drawdown per regime", () => {
    const tracker = new RegimePerformanceTracker();
    tracker.recordTrade("chop", -100, FIXED_TS);
    tracker.recordTrade("chop", 50, FIXED_TS + 1000);
    tracker.recordTrade("chop", -80, FIXED_TS + 2000);
    const rec = tracker.get("chop");
    // Cumulative: -100, -50, -130 → maxDrawdown = 130
    expect(rec.maxDrawdownUsd).toBe(130);
  });

  test("updates average confidence", () => {
    const tracker = new RegimePerformanceTracker();
    tracker.updateConfidence("trend", 0.8);
    tracker.updateConfidence("trend", 0.6);
    const rec = tracker.get("trend");
    expect(rec.avgConfidence).toBeCloseTo(0.7);
  });

  test("accumulates time", () => {
    const tracker = new RegimePerformanceTracker();
    tracker.addTime("range", 5000);
    tracker.addTime("range", 3000);
    const rec = tracker.get("range");
    expect(rec.totalTimeMs).toBe(8000);
  });

  test("get returns a copy", () => {
    const tracker = new RegimePerformanceTracker();
    const rec = tracker.get("trend");
    rec.tradeCount = 999;
    expect(tracker.get("trend").tradeCount).toBe(0);
  });
});

// ── Integration: Classifier → Policy Engine ──────────────────────────

describe("Integration: Classifier → Policy Engine", () => {
  test("classifier output feeds directly into policy engine", () => {
    const classifier = new RegimeClassifier();
    const engine = new RegimePolicyEngine({ now: () => FIXED_TS });

    // Start with normal conditions → range.
    const c1 = classifier.classify(baseInput());
    const r1 = engine.evaluate(c1);
    expect(r1.changed).toBe(true);
    expect(r1.policy.regime).toBe("range");

    // Volatility spikes → high_volatility.
    const c2 = classifier.classify(baseInput({ realizedVolatility: 0.9 }));
    const r2 = engine.evaluate(c2);
    expect(r2.changed).toBe(true);
    expect(r2.policy.regime).toBe("high_volatility");
    expect(r2.policy.tradingEnabled).toBe(true);
    expect(r2.policy.mode).toBe("REDUCE_ONLY");

    // Now drawdown → drawdown (allowed, further restriction).
    const c3 = classifier.classify(
      baseInput({ realizedVolatility: 0.9, cumulativePnlUsd: -150 }),
    );
    const r3 = engine.evaluate(c3);
    expect(r3.changed).toBe(true);
    expect(r3.policy.mode).toBe("HALT");
    expect(r3.policy.tradingEnabled).toBe(false);

    // Attempt to go back to trend → blocked (trading was disabled).
    const c4 = classifier.classify(baseInput());
    const r4 = engine.evaluate(c4);
    expect(r4.changed).toBe(false);
    expect(r4.blocked).toBe(true);
  });

  test("full lifecycle: classify → evaluate → trade → finalize", () => {
    let ts = FIXED_TS;
    const classifier = new RegimeClassifier();
    const engine = new RegimePolicyEngine({ now: () => ts });

    // Classify and evaluate — use low volatility so trend check is reached.
    const c1 = classifier.classify(baseInput({ realizedVolatility: 0.5, directionalStreak: 7, reversalCount: 1 }));
    engine.evaluate(c1);
    expect(engine.regime).toBe("trend");

    // Record some trades.
    engine.recordTrade(50);
    engine.recordTrade(-20);

    // Time passes.
    ts += 10_000;

    // Classify again — chop.
    const c2 = classifier.classify(baseInput({ reversalCount: 6, realizedVolatility: 0.4 }));
    engine.evaluate(c2);
    expect(engine.regime).toBe("chop");

    // Finalize.
    engine.finalize();

    // Check performance records.
    const trendPerf = engine.performanceTracker.get("trend");
    expect(trendPerf.tradeCount).toBe(2);
    expect(trendPerf.totalPnlUsd).toBe(30);
    expect(trendPerf.totalTimeMs).toBe(10_000);

    const chopPerf = engine.performanceTracker.get("chop");
    expect(chopPerf.totalTimeMs).toBe(0); // just transitioned, finalize not called after
  });

  test("audit trail captures all regime transitions", () => {
    let ts = FIXED_TS;
    const classifier = new RegimeClassifier();
    const engine = new RegimePolicyEngine({ now: () => ts });

    const transitions: MarketRegime[] = ["trend", "high_volatility", "drawdown"];
    for (const regime of transitions) {
      const input = regime === "drawdown"
        ? baseInput({ cumulativePnlUsd: -150 })
        : regime === "high_volatility"
          ? baseInput({ realizedVolatility: 0.9 })
          : baseInput({ realizedVolatility: 0.5, directionalStreak: 7, reversalCount: 1 });
      engine.evaluate(classifier.classify(input));
      ts += 1000;
    }

    const history = engine.history;
    expect(history.length).toBe(3);
    expect(history.map((h) => h.newRegime)).toEqual(transitions);
    // All should be permission reductions.
    expect(history.every((h) => h.permissionsReduced || h.previousRegime === null)).toBe(true);
  });
});
