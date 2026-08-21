import { describe, expect, test } from "bun:test";
import {
  isCanaryConfig,
  parseCanaryConfig,
  DEFAULT_CANARY_CONFIG,
  type CanaryConfig,
  type OrderIntent,
  type RiskDecision,
  type GammaControlCommand,
} from "@agenttrading/contracts";
import { isGammaControlCommand, isGammaControlStatus } from "@agenttrading/contracts";
import { KillSwitch } from "../src/gamma/kill-switch.ts";
import { LiveExecutionEngine, type CanaryExecutionState } from "../src/gamma/live-execution-engine.ts";
import { CanarySession } from "../src/gamma/canary-session.ts";

// ── Helpers ─────────────────────────────────────────────────────────

function intent(overrides: Partial<OrderIntent> = {}): OrderIntent {
  return {
    idempotencyKey: "intent-1",
    opportunityId: "opp-1",
    venue: "bybit",
    symbol: "BTC",
    side: "BUY",
    quantity: 0.01,
    price: 100,
    quoteCurrency: "USDT",
    createdAtMs: 0,
    expiresAtMs: 60_000,
    limits: { maxSlippageBps: 20 },
    ...overrides,
  };
}

function approvedDecision(overrides: Partial<RiskDecision> = {}): RiskDecision {
  return {
    decision: "APPROVE",
    orderIntentIdempotencyKey: "intent-1",
    evaluatedAtMs: 0,
    approvedSize: 0.01,
    approvedLimits: { maxSlippageBps: 20 },
    expiresAtMs: 60_000,
    ...overrides,
  } as RiskDecision;
}

function emptyState(): CanaryExecutionState {
  return {
    ordersToday: [],
    ordersThisWeek: [],
    openOrders: [],
    exposurePerToken: {},
    exposurePerVenue: {},
    exposurePerChain: {},
    capitalDeployedUsd: 0,
    dailyPnlUsd: 0,
    weeklyPnlUsd: 0,
  };
}

function canaryConfig(overrides: Partial<CanaryConfig> = {}): CanaryConfig {
  return {
    ...DEFAULT_CANARY_CONFIG,
    ...overrides,
  };
}

const FIXED_TS = 1_700_000_000_000;

// ── Canary Config Contract ───────────────────────────────────────────

describe("CanaryConfig contract", () => {
  test("validates default config", () => {
    expect(isCanaryConfig(DEFAULT_CANARY_CONFIG)).toBe(true);
  });

  test("parses a valid config", () => {
    const parsed = parseCanaryConfig(DEFAULT_CANARY_CONFIG);
    expect(parsed.configId).toBe("canary-default-1");
    expect(parsed.capitalLimits.maxCapitalUsd).toBe(1_000);
    expect(parsed.apiKeys.withdrawalsDisabled).toBe(true);
    expect(parsed.noAutomaticScaling).toBe(true);
  });

  test("rejects invalid config", () => {
    expect(isCanaryConfig({})).toBe(false);
    expect(isCanaryConfig({ configId: 123 })).toBe(false);
  });

  test("default config enforces withdrawals disabled", () => {
    expect(DEFAULT_CANARY_CONFIG.apiKeys.withdrawalsDisabled).toBe(true);
  });

  test("default config has no automatic scaling", () => {
    expect(DEFAULT_CANARY_CONFIG.noAutomaticScaling).toBe(true);
  });

  test("default config has bounded capital", () => {
    expect(DEFAULT_CANARY_CONFIG.capitalLimits.maxCapitalUsd).toBeGreaterThan(0);
    expect(DEFAULT_CANARY_CONFIG.capitalLimits.maxRiskPerTradeUsd).toBeLessThan(
      DEFAULT_CANARY_CONFIG.capitalLimits.maxCapitalUsd,
    );
  });
});

// ── Gamma Control Commands ───────────────────────────────────────────

describe("GammaControl commands", () => {
  test("all expected commands are valid", () => {
    const commands: GammaControlCommand[] = [
      "start", "stop", "cancel-all", "cash-only", "reduce-only",
      "halt", "pause", "resume",
    ];
    for (const cmd of commands) {
      expect(isGammaControlCommand(cmd)).toBe(true);
    }
  });

  test("invalid command is rejected", () => {
    expect(isGammaControlCommand("unknown")).toBe(false);
  });
});

// ── Kill Switch ──────────────────────────────────────────────────────

describe("KillSwitch", () => {
  test("manual halt succeeds when not active", () => {
    const ks = new KillSwitch(DEFAULT_CANARY_CONFIG.killSwitch);
    const result = ks.manualHalt(false);
    expect(result.shouldHalt).toBe(true);
    expect(result.trigger).toBe("manual");
    expect(result.manual).toBe(true);
  });

  test("manual halt is no-op when already active", () => {
    const ks = new KillSwitch(DEFAULT_CANARY_CONFIG.killSwitch);
    const result = ks.manualHalt(true);
    expect(result.shouldHalt).toBe(false);
    expect(result.reason).toContain("already active");
  });

  test("automatic halt on daily loss", () => {
    const ks = new KillSwitch({
      autoHaltDailyLossUsd: 80,
      autoHaltOnOrphans: true,
      autoHaltOnReconciliationMismatch: true,
    });
    const result = ks.evaluate({
      alreadyActive: false,
      dailyLossUsd: 85,
      weeklyLossUsd: 0,
      ordersToday: 0,
      orphanOrderCount: 0,
      reconciliationUnresolved: false,
      nowMs: FIXED_TS,
    });
    expect(result.shouldHalt).toBe(true);
    expect(result.trigger).toBe("daily-loss");
  });

  test("automatic halt on orphan orders", () => {
    const ks = new KillSwitch({
      autoHaltOnOrphans: true,
      autoHaltOnReconciliationMismatch: true,
    });
    const result = ks.evaluate({
      alreadyActive: false,
      dailyLossUsd: 0,
      weeklyLossUsd: 0,
      ordersToday: 0,
      orphanOrderCount: 2,
      reconciliationUnresolved: false,
      nowMs: FIXED_TS,
    });
    expect(result.shouldHalt).toBe(true);
    expect(result.trigger).toBe("orphan-orders");
  });

  test("automatic halt on reconciliation mismatch", () => {
    const ks = new KillSwitch({
      autoHaltOnOrphans: true,
      autoHaltOnReconciliationMismatch: true,
    });
    const result = ks.evaluate({
      alreadyActive: false,
      dailyLossUsd: 0,
      weeklyLossUsd: 0,
      ordersToday: 0,
      orphanOrderCount: 0,
      reconciliationUnresolved: true,
      nowMs: FIXED_TS,
    });
    expect(result.shouldHalt).toBe(true);
    expect(result.trigger).toBe("reconciliation-mismatch");
  });

  test("no halt when all thresholds within bounds", () => {
    const ks = new KillSwitch({
      autoHaltDailyLossUsd: 80,
      autoHaltWeeklyLossUsd: 250,
      autoHaltOrdersPerDay: 15,
      autoHaltOnOrphans: true,
      autoHaltOnReconciliationMismatch: true,
    });
    const result = ks.evaluate({
      alreadyActive: false,
      dailyLossUsd: 10,
      weeklyLossUsd: 50,
      ordersToday: 5,
      orphanOrderCount: 0,
      reconciliationUnresolved: false,
      nowMs: FIXED_TS,
    });
    expect(result.shouldHalt).toBe(false);
  });

  test("cooldown prevents rapid automatic halts", () => {
    const ks = new KillSwitch({
      autoHaltOnOrphans: true,
      autoHaltOnReconciliationMismatch: true,
      cooldownMs: 60_000,
    });
    const result = ks.evaluate({
      alreadyActive: false,
      dailyLossUsd: 0,
      weeklyLossUsd: 0,
      ordersToday: 0,
      orphanOrderCount: 1,
      reconciliationUnresolved: false,
      nowMs: FIXED_TS,
      lastAutoKillAtMs: FIXED_TS - 30_000, // 30s ago, cooldown is 60s
    });
    expect(result.shouldHalt).toBe(false);
    expect(result.reason).toContain("cooldown");
  });

  test("no halt when already active", () => {
    const ks = new KillSwitch({
      autoHaltOnOrphans: true,
      autoHaltOnReconciliationMismatch: true,
    });
    const result = ks.evaluate({
      alreadyActive: true,
      dailyLossUsd: 1000,
      weeklyLossUsd: 1000,
      ordersToday: 100,
      orphanOrderCount: 50,
      reconciliationUnresolved: true,
      nowMs: FIXED_TS,
    });
    expect(result.shouldHalt).toBe(false);
  });

  test("reconciliation mismatch takes priority over daily loss", () => {
    const ks = new KillSwitch({
      autoHaltDailyLossUsd: 80,
      autoHaltOnOrphans: true,
      autoHaltOnReconciliationMismatch: true,
    });
    const result = ks.evaluate({
      alreadyActive: false,
      dailyLossUsd: 200,
      weeklyLossUsd: 0,
      ordersToday: 0,
      orphanOrderCount: 0,
      reconciliationUnresolved: true,
      nowMs: FIXED_TS,
    });
    expect(result.trigger).toBe("reconciliation-mismatch");
  });
});

// ── Live Execution Engine Pre-checks ─────────────────────────────────

describe("LiveExecutionEngine pre-checks", () => {
  test("approves order within all canary limits", () => {
    const engine = new LiveExecutionEngine(DEFAULT_CANARY_CONFIG);
    const check = engine.preCheck(intent(), emptyState());
    expect(check.allowed).toBe(true);
  });

  test("blocks when capital exhausted", () => {
    const engine = new LiveExecutionEngine(DEFAULT_CANARY_CONFIG);
    const state: CanaryExecutionState = {
      ...emptyState(),
      capitalDeployedUsd: 1_000, // exactly at max
    };
    const check = engine.preCheck(intent(), state);
    expect(check.allowed).toBe(false);
    expect(check.blockReason).toBe("CAPITAL_EXHAUSTED");
  });

  test("blocks when daily loss limit exceeded", () => {
    const engine = new LiveExecutionEngine(DEFAULT_CANARY_CONFIG);
    const state: CanaryExecutionState = {
      ...emptyState(),
      dailyPnlUsd: -100, // at limit
    };
    const check = engine.preCheck(intent(), state);
    expect(check.allowed).toBe(false);
    expect(check.blockReason).toBe("DAILY_LOSS_LIMIT");
  });

  test("blocks when weekly loss limit exceeded", () => {
    const engine = new LiveExecutionEngine(DEFAULT_CANARY_CONFIG);
    const state: CanaryExecutionState = {
      ...emptyState(),
      weeklyPnlUsd: -300, // at limit
    };
    const check = engine.preCheck(intent(), state);
    expect(check.allowed).toBe(false);
    expect(check.blockReason).toBe("WEEKLY_LOSS_LIMIT");
  });

  test("blocks when open orders limit exceeded", () => {
    const engine = new LiveExecutionEngine(DEFAULT_CANARY_CONFIG);
    const state: CanaryExecutionState = {
      ...emptyState(),
      openOrders: Array.from({ length: 5 }, (_, i) => ({
        orderId: `o${i}`,
        symbol: "BTC",
        venue: "bybit",
        chain: "ethereum",
        notionalUsd: 10,
        side: "BUY" as const,
        submittedAtMs: 0,
        state: "OPEN",
      })),
    };
    const check = engine.preCheck(intent(), state);
    expect(check.allowed).toBe(false);
    expect(check.blockReason).toBe("EXCEEDS_OPEN_ORDERS");
  });

  test("blocks when orders per day limit exceeded", () => {
    const engine = new LiveExecutionEngine(DEFAULT_CANARY_CONFIG);
    const state: CanaryExecutionState = {
      ...emptyState(),
      ordersToday: Array.from({ length: 20 }, (_, i) => ({
        orderId: `o${i}`,
        symbol: "BTC",
        venue: "bybit",
        chain: "ethereum",
        notionalUsd: 10,
        side: "BUY" as const,
        submittedAtMs: 0,
        state: "FILLED",
      })),
    };
    const check = engine.preCheck(intent(), state);
    expect(check.allowed).toBe(false);
    expect(check.blockReason).toBe("EXCEEDS_ORDERS_PER_DAY");
  });

  test("blocks when orders per week limit exceeded", () => {
    const engine = new LiveExecutionEngine(DEFAULT_CANARY_CONFIG);
    const state: CanaryExecutionState = {
      ...emptyState(),
      ordersThisWeek: Array.from({ length: 100 }, (_, i) => ({
        orderId: `o${i}`,
        symbol: "BTC",
        venue: "bybit",
        chain: "ethereum",
        notionalUsd: 10,
        side: "BUY" as const,
        submittedAtMs: 0,
        state: "FILLED",
      })),
    };
    const check = engine.preCheck(intent(), state);
    expect(check.allowed).toBe(false);
    expect(check.blockReason).toBe("EXCEEDS_ORDERS_PER_WEEK");
  });

  test("blocks when token exposure exceeded", () => {
    const engine = new LiveExecutionEngine(DEFAULT_CANARY_CONFIG);
    const state: CanaryExecutionState = {
      ...emptyState(),
      exposurePerToken: { BTC: 200 }, // at max
    };
    const check = engine.preCheck(intent(), state);
    expect(check.allowed).toBe(false);
    expect(check.blockReason).toBe("EXCEEDS_EXPOSURE_PER_TOKEN");
  });

  test("blocks when venue exposure exceeded", () => {
    const engine = new LiveExecutionEngine(DEFAULT_CANARY_CONFIG);
    const state: CanaryExecutionState = {
      ...emptyState(),
      exposurePerVenue: { bybit: 500 }, // at max
    };
    const check = engine.preCheck(intent(), state);
    expect(check.allowed).toBe(false);
    expect(check.blockReason).toBe("EXCEEDS_EXPOSURE_PER_VENUE");
  });

  test("reduces size when risk per trade exceeded", () => {
    const engine = new LiveExecutionEngine(
      canaryConfig({
        capitalLimits: {
          ...DEFAULT_CANARY_CONFIG.capitalLimits,
          maxRiskPerTradeUsd: 50,
        },
      }),
    );
    const bigIntent = intent({ quantity: 1, price: 100 }); // notional = 100 > 50
    const check = engine.preCheck(bigIntent, emptyState());
    expect(check.allowed).toBe(true); // reduced, not blocked
    expect(check.approvedQuantity).toBe(0.5); // 50/100
  });

  test("blocks when order notional exceeded", () => {
    const engine = new LiveExecutionEngine(DEFAULT_CANARY_CONFIG);
    const bigIntent = intent({ quantity: 10, price: 100 }); // 1000 > 500
    const check = engine.preCheck(bigIntent, emptyState());
    expect(check.allowed).toBe(false);
    expect(check.blockReason).toBe("EXCEEDS_ORDER_NOTIONAL");
  });
});

// ── Canary Session ───────────────────────────────────────────────────

describe("CanarySession (issue #34)", () => {
  test("starts and reports correct initial status", () => {
    const session = new CanarySession({
      now: () => FIXED_TS,
      config: DEFAULT_CANARY_CONFIG,
    });

    expect(session.status.running).toBe(false);
    expect(session.status.killSwitchActive).toBe(false);

    const result = session.control("start");
    expect(result.ok).toBe(true);
    expect(session.status.running).toBe(true);
    expect(session.status.mode).toBe("NORMAL");
  });

  test("stops the canary and cancels open orders", () => {
    const session = new CanarySession({
      now: () => FIXED_TS,
      config: DEFAULT_CANARY_CONFIG,
    });
    session.control("start");
    const result = session.control("stop");
    expect(result.ok).toBe(true);
    expect(session.status.running).toBe(false);
  });

  test("halt activates kill switch and cancels all orders", () => {
    const session = new CanarySession({
      now: () => FIXED_TS,
      config: DEFAULT_CANARY_CONFIG,
    });
    session.control("start");
    const result = session.control("halt");
    expect(result.ok).toBe(true);
    expect(session.status.killSwitchActive).toBe(true);
    expect(session.status.mode).toBe("HALT");
  });

  test("cannot start after kill switch is active", () => {
    const session = new CanarySession({
      now: () => FIXED_TS,
      config: DEFAULT_CANARY_CONFIG,
    });
    session.control("halt");
    const result = session.control("start");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("kill switch is active");
  });

  test("pause and resume work correctly", () => {
    const session = new CanarySession({
      now: () => FIXED_TS,
      config: DEFAULT_CANARY_CONFIG,
    });
    session.control("start");

    const pauseResult = session.control("pause");
    expect(pauseResult.ok).toBe(true);
    expect(session.status.paused).toBe(true);
    expect(session.status.mode).toBe("OBSERVE_ONLY");

    const resumeResult = session.control("resume");
    expect(resumeResult.ok).toBe(true);
    expect(session.status.paused).toBe(false);
    expect(session.status.mode).toBe("NORMAL");
  });

  test("cannot pause when not running", () => {
    const session = new CanarySession({
      now: () => FIXED_TS,
      config: DEFAULT_CANARY_CONFIG,
    });
    const result = session.control("pause");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("not running");
  });

  test("cancel-all clears open orders", () => {
    const session = new CanarySession({
      now: () => FIXED_TS,
      config: DEFAULT_CANARY_CONFIG,
    });
    session.control("start");
    const result = session.control("cancel-all");
    expect(result.ok).toBe(true);
    expect(session.status.openOrders).toBe(0);
  });

  test("cash-only and reduce-only change mode", () => {
    const session = new CanarySession({
      now: () => FIXED_TS,
      config: DEFAULT_CANARY_CONFIG,
    });
    session.control("start");

    const cashResult = session.control("cash-only");
    expect(cashResult.ok).toBe(true);
    expect(session.status.mode).toBe("CASH_ONLY");

    const reduceResult = session.control("reduce-only");
    expect(reduceResult.ok).toBe(true);
    expect(session.status.mode).toBe("REDUCE_ONLY");
  });

  test("submitOrder pre-checks against canary limits", () => {
    const session = new CanarySession({
      now: () => FIXED_TS,
      config: DEFAULT_CANARY_CONFIG,
    });
    session.control("start");

    const { preCheck } = session.submitOrder(
      intent(),
      approvedDecision(),
      { bid: 99, ask: 101, mid: 100, liquidityUsd: 10_000 },
    );
    expect(preCheck.allowed).toBe(true);
  });

  test("submitOrder blocks when kill switch is active", () => {
    const session = new CanarySession({
      now: () => FIXED_TS,
      config: DEFAULT_CANARY_CONFIG,
    });
    session.control("halt");

    const { preCheck } = session.submitOrder(
      intent(),
      approvedDecision(),
      { bid: 99, ask: 101, mid: 100, liquidityUsd: 10_000 },
    );
    expect(preCheck.allowed).toBe(false);
    expect(preCheck.reason).toContain("kill switch");
  });

  test("submitOrder blocks when paused", () => {
    const session = new CanarySession({
      now: () => FIXED_TS,
      config: DEFAULT_CANARY_CONFIG,
    });
    session.control("start");
    session.control("pause");

    const { preCheck } = session.submitOrder(
      intent(),
      approvedDecision(),
      { bid: 99, ask: 101, mid: 100, liquidityUsd: 10_000 },
    );
    expect(preCheck.allowed).toBe(false);
    expect(preCheck.reason).toContain("paused");
  });

  test("submitOrder blocks non-allowed venue", () => {
    const session = new CanarySession({
      now: () => FIXED_TS,
      config: DEFAULT_CANARY_CONFIG,
    });
    session.control("start");

    const { preCheck } = session.submitOrder(
      intent({ venue: "binance" }),
      approvedDecision(),
      { bid: 99, ask: 101, mid: 100, liquidityUsd: 10_000 },
    );
    expect(preCheck.allowed).toBe(false);
    expect(preCheck.reason).toContain("not in allowed venues");
  });

  test("submitOrder blocks non-allowed token", () => {
    const session = new CanarySession({
      now: () => FIXED_TS,
      config: DEFAULT_CANARY_CONFIG,
    });
    session.control("start");

    const { preCheck } = session.submitOrder(
      intent({ symbol: "DOGE" }),
      approvedDecision(),
      { bid: 99, ask: 101, mid: 100, liquidityUsd: 10_000 },
    );
    expect(preCheck.allowed).toBe(false);
    expect(preCheck.reason).toContain("not in allowed tokens");
  });

  test("submitOrder blocks when withdrawals not disabled", () => {
    const session = new CanarySession({
      now: () => FIXED_TS,
      config: canaryConfig({
        apiKeys: {
          ...DEFAULT_CANARY_CONFIG.apiKeys,
          withdrawalsDisabled: false,
        },
      }),
    });
    session.control("start");

    const { preCheck } = session.submitOrder(
      intent(),
      approvedDecision(),
      { bid: 99, ask: 101, mid: 100, liquidityUsd: 10_000 },
    );
    expect(preCheck.allowed).toBe(false);
    expect(preCheck.reason).toContain("withdrawals not disabled");
  });

  test("automatic kill switch triggers on daily loss", () => {
    const session = new CanarySession({
      now: () => FIXED_TS,
      config: canaryConfig({
        killSwitch: {
          autoHaltDailyLossUsd: 50,
          autoHaltOnOrphans: true,
          autoHaltOnReconciliationMismatch: true,
        },
      }),
    });
    session.control("start");

    // Submit an order so we have a tracked order to resolve.
    session.submitOrder(
      intent({ idempotencyKey: "loss-order" }),
      approvedDecision({ orderIntentIdempotencyKey: "loss-order" }),
      { bid: 99, ask: 101, mid: 100, liquidityUsd: 10_000 },
    );

    // Resolve with a loss that exceeds the auto-halt threshold.
    session.notifyOrderResolved("loss-order", "FILLED", -60);

    expect(session.status.killSwitchActive).toBe(true);
    expect(session.status.autoKillTrigger).toBe("daily-loss");
  });

  test("automatic kill switch triggers on orphan orders", () => {
    const session = new CanarySession({
      now: () => FIXED_TS,
      config: canaryConfig({
        killSwitch: {
          autoHaltOnOrphans: true,
          autoHaltOnReconciliationMismatch: true,
        },
      }),
    });
    session.control("start");

    // Notify about an order we don't track -> orphan.
    session.notifyOrderResolved("unknown-order", "FILLED");

    expect(session.status.killSwitchActive).toBe(true);
    expect(session.status.autoKillTrigger).toBe("orphan-orders");
  });

  test("automatic kill switch triggers on reconciliation mismatch", () => {
    const session = new CanarySession({
      now: () => FIXED_TS,
      config: canaryConfig({
        killSwitch: {
          autoHaltOnOrphans: true,
          autoHaltOnReconciliationMismatch: true,
        },
      }),
    });
    session.control("start");

    session.setReconciliationStatus(true);

    expect(session.status.killSwitchActive).toBe(true);
    expect(session.status.autoKillTrigger).toBe("reconciliation-mismatch");
  });

  test("no orphan orders and no limit violations in a session", () => {
    const session = new CanarySession({
      now: () => FIXED_TS,
      config: DEFAULT_CANARY_CONFIG,
    });
    session.control("start");

    // Submit an order within limits.
    const { preCheck } = session.submitOrder(
      intent({ quantity: 0.01, price: 100 }),
      approvedDecision(),
      { bid: 99, ask: 101, mid: 100, liquidityUsd: 10_000 },
    );
    expect(preCheck.allowed).toBe(true);

    // Resolve the order normally.
    session.notifyOrderResolved("intent-1", "FILLED", 5);

    // No orphans, no limit violations.
    expect(session.status.orphanOrderCount).toBe(0);
    expect(session.status.killSwitchActive).toBe(false);
  });

  test("capital tracking updates correctly", () => {
    const session = new CanarySession({
      now: () => FIXED_TS,
      config: DEFAULT_CANARY_CONFIG,
    });
    session.control("start");

    session.submitOrder(
      intent({ quantity: 0.01, price: 100 }),
      approvedDecision(),
      { bid: 99, ask: 101, mid: 100, liquidityUsd: 10_000 },
    );
    expect(session.status.capitalDeployedUsd).toBe(1);

    session.notifyOrderResolved("intent-1", "FILLED", 0);
    expect(session.status.capitalDeployedUsd).toBe(0);
  });

  test("orders are tracked per day and per week", () => {
    const session = new CanarySession({
      now: () => FIXED_TS,
      config: DEFAULT_CANARY_CONFIG,
    });
    session.control("start");

    session.submitOrder(
      intent({ idempotencyKey: "i1" }),
      approvedDecision({ orderIntentIdempotencyKey: "i1" }),
      { bid: 99, ask: 101, mid: 100, liquidityUsd: 10_000 },
    );
    session.submitOrder(
      intent({ idempotencyKey: "i2" }),
      approvedDecision({ orderIntentIdempotencyKey: "i2" }),
      { bid: 99, ask: 101, mid: 100, liquidityUsd: 10_000 },
    );

    expect(session.status.ordersToday).toBe(2);
    expect(session.status.ordersThisWeek).toBe(2);
  });
});

// ── GammaControlStatus validator ─────────────────────────────────────

describe("GammaControlStatus contract", () => {
  test("validates a complete status", () => {
    expect(
      isGammaControlStatus({
        running: false,
        mode: "NORMAL",
        state: "IDLE",
        killSwitchActive: false,
        openOrders: 0,
        ordersToday: 0,
        ordersThisWeek: 0,
        capitalDeployedUsd: 0,
        capitalRemainingUsd: 1000,
        dailyPnlUsd: 0,
        weeklyPnlUsd: 0,
        orphanOrderCount: 0,
        reconciliationUnresolved: false,
        paused: false,
      }),
    ).toBe(true);
  });

  test("rejects incomplete status", () => {
    expect(isGammaControlStatus({ running: false })).toBe(false);
  });
});
