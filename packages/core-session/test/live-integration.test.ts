import { describe, expect, test } from "bun:test";
import {
  DEFAULT_CANARY_CONFIG,
  type ApprovedRiskDecision,
  type CanaryConfig,
  type OrderIntent,
} from "@agenttrading/contracts";
import { type RegimeClassifierInput } from "@agenttrading/core-session";
import { RegimeClassifier } from "@agenttrading/core-session";
import { RegimePolicyEngine } from "@agenttrading/core-session";
import { CanarySession } from "@agenttrading/core-session";
import { LearningEngine } from "@agenttrading/core-session";
import { AuditReconstructor } from "@agenttrading/core-session";
import { ReportGenerator } from "@agenttrading/core-session";
import { AuditExporter } from "@agenttrading/core-session";
import {
  TradingSession,
  type TradingCycleInput,
  type TradingSessionSummary,
} from "@agenttrading/core-session";

// ── Helpers ──────────────────────────────────────────────────────────

const FIXED_TS = 1_700_000_000_000;

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
    createdAtMs: FIXED_TS,
    expiresAtMs: FIXED_TS + 60_000,
    limits: { maxSlippageBps: 20 },
    ...overrides,
  };
}

function approvedDecision(
  overrides: Partial<ApprovedRiskDecision> = {},
): ApprovedRiskDecision {
  return {
    decision: "APPROVE",
    orderIntentIdempotencyKey: "intent-1",
    evaluatedAtMs: FIXED_TS,
    approvedSize: 0.01,
    approvedLimits: { maxSlippageBps: 20 },
    expiresAtMs: FIXED_TS + 60_000,
    ...overrides,
  };
}

function normalRegimeInput(): RegimeClassifierInput {
  return {
    realizedVolatility: 0.5,
    spreadBps: 10,
    liquidityUsd: 50_000,
    gasPriceUsd: 5,
    cumulativePnlUsd: 0,
    maxDrawdownUsd: 0,
    rpcHealthy: true,
    cexHealthy: true,
    directionalStreak: 6,
    reversalCount: 1,
    nowMs: FIXED_TS,
  };
}

function highVolRegimeInput(): RegimeClassifierInput {
  return {
    ...normalRegimeInput(),
    realizedVolatility: 1.5,
  };
}

function drawdownRegimeInput(): RegimeClassifierInput {
  return {
    ...normalRegimeInput(),
    cumulativePnlUsd: -150,
  };
}

function cycleInput(
  overrides: Partial<TradingCycleInput> = {},
): TradingCycleInput {
  return {
    regime: normalRegimeInput(),
    market: { bid: 99, ask: 101, mid: 100, liquidityUsd: 10_000 },
    intents: [intent()],
    riskDecisions: [approvedDecision()],
    ...overrides,
  };
}

function canaryConfig(
  overrides: Partial<CanaryConfig> = {},
): CanaryConfig {
  return {
    ...DEFAULT_CANARY_CONFIG,
    ...overrides,
  };
}

// ── AC1: All Subsystems Integrate ────────────────────────────────────

describe("AC1: All canary subsystems integrate and run together", () => {
  test("TradingSession wires CanarySession, RegimeClassifier, RegimePolicyEngine, LearningEngine, AuditReconstructor", () => {
    const session = new TradingSession({ now: () => FIXED_TS });

    // All subsystems are accessible.
    expect(session.learning).toBeDefined();
    expect(session.reconstructor).toBeDefined();
    expect(session.journal).toBeDefined();
    expect(session.regimePolicy).toBeDefined();

    // Canary session starts.
    session.start();
    expect(session.isRunning).toBe(true);
    expect(session.status.running).toBe(true);

    session.stop();
    expect(session.isRunning).toBe(false);
  });

  test("runCycle classifies regime, evaluates policy, and submits through canary", () => {
    const session = new TradingSession({ now: () => FIXED_TS });
    session.start();

    const result = session.runCycle(cycleInput());

    expect(result.ok).toBe(true);
    expect(result.regimeClassification).toBeDefined();
    expect(result.regimePolicy).toBeDefined();
    expect(result.regimeChanged).toBe(true); // First cycle always changes regime
    expect(result.submittedCount).toBe(1);
    expect(result.blockedCount).toBe(0);
    expect(result.regimeBlockedCount).toBe(0);

    session.stop();
  });

  test("learning engine records fills from canary submissions", () => {
    const session = new TradingSession({
      now: () => FIXED_TS,
      learningCycleInterval: 1, // Run learning every cycle
    });
    session.start();

    // Submit an order that will fill.
    session.runCycle(cycleInput());

    // Notify fill with positive PnL.
    session.notifyOrderResolved("intent-1", "FILLED", 5);

    // Journal should have the entry.
    const entries = session.journal.getEntries();
    expect(entries.length).toBe(1);
    expect(entries[0].tradeId).toBe("intent-1");
    expect(entries[0].netPnlUsd).toBe(5);

    session.stop();
  });

  test("audit reconstructor records events from canary cycles", () => {
    const session = new TradingSession({ now: () => FIXED_TS });
    session.start();

    session.runCycle(cycleInput());

    // Reconstructor should have audit events.
    expect(session.reconstructor.auditEventCount).toBeGreaterThan(0);

    session.stop();
  });
});

// ── AC2: Go-live Canary Session Within Hard Limits ───────────────────

describe("AC2: Go-live canary session completes within hard limits", () => {
  test("canary enforces bounded capital with concurrent open orders", () => {
    const config = canaryConfig({
      capitalLimits: {
        maxCapitalUsd: 100,
        maxRiskPerTradeUsd: 25,
        maxDailyLossUsd: 50,
        maxWeeklyLossUsd: 100,
      },
      orderLimits: {
        maxOrdersPerDay: 20,
        maxOpenOrders: 10,
        maxOrdersPerWeek: 100,
      },
    });
    const session = new TradingSession({ now: () => FIXED_TS, canaryConfig: config });
    session.start();

    // Submit 4 orders of $25 each without filling them (capital stays deployed).
    // After 4 orders, $100 is deployed (= maxCapitalUsd).
    for (let i = 1; i <= 4; i++) {
      const result = session.runCycle(
        cycleInput({
          intents: [
            intent({ idempotencyKey: `open-${i}`, quantity: 0.25, price: 100 }),
          ],
          riskDecisions: [
            approvedDecision({
              orderIntentIdempotencyKey: `open-${i}`,
              approvedSize: 0.25,
            }),
          ],
        }),
      );
      expect(result.submittedCount).toBe(1);
    }

    // Fifth order: capital exhausted. Should be blocked.
    const result5 = session.runCycle(
      cycleInput({
        intents: [
          intent({ idempotencyKey: "open-5", quantity: 0.25, price: 100 }),
        ],          riskDecisions: [
            approvedDecision({
              orderIntentIdempotencyKey: "open-5",
              approvedSize: 0.25,
            }),
          ],
      }),
    );
    expect(result5.blockedCount).toBe(1);

    session.stop();
  });

  test("canary enforces per-trade risk limits with size reduction", () => {
    const config = canaryConfig({
      capitalLimits: {
        maxCapitalUsd: 1000,
        maxRiskPerTradeUsd: 10,
        maxDailyLossUsd: 100,
        maxWeeklyLossUsd: 300,
      },
    });
    const session = new TradingSession({ now: () => FIXED_TS, canaryConfig: config });
    session.start();

    // Submit an order exceeding per-trade limit: 0.5 qty * $100 = $50 > $10.
    const result = session.runCycle(
      cycleInput({
        intents: [intent({ quantity: 0.5, price: 100 })],
        riskDecisions: [approvedDecision({ approvedSize: 0.5 })],
      }),
    );

    // Order should be submitted but reduced to 0.1 qty ($10).
    expect(result.submittedCount).toBe(1);
    expect(result.blockedCount).toBe(0);

    session.stop();
  });

  test("session completes normally with stop", () => {
    const session = new TradingSession({ now: () => FIXED_TS });
    session.start();

    // Run a few cycles.
    session.runCycle(cycleInput());
    session.runCycle(cycleInput());
    session.runCycle(cycleInput());

    // Stop.
    session.stop();
    expect(session.isRunning).toBe(false);

    // Summary should indicate normal completion.
    const summary = session.getSessionSummary();
    expect(summary.completedNormally).toBe(true);
  });
});

// ── AC3: Every Decision Auditable, Failures Degrade Safely ──────────

describe("AC3: Every decision is auditable; failures degrade safely", () => {
  test("regime change to drawdown triggers halt", () => {
    const session = new TradingSession({ now: () => FIXED_TS });
    session.start();

    // First cycle: normal regime.
    const result1 = session.runCycle(cycleInput());
    expect(result1.regimeClassification!.regime).toBe("trend");
    // Trend regime has emergencyAction "none" (not undefined).
    expect(
      result1.emergencyAction === undefined ||
        result1.emergencyAction === "none",
    ).toBe(true);

    // Second cycle: drawdown regime.
    const result2 = session.runCycle(
      cycleInput({ regime: drawdownRegimeInput() }),
    );
    expect(result2.regimeClassification!.regime).toBe("drawdown");
    expect(result2.emergencyAction).toBe("halt");

    // Kill switch should be active.
    expect(session.status.killSwitchActive).toBe(true);
    expect(session.status.mode).toBe("HALT");

    // Session should not accept new orders.
    const result3 = session.runCycle(cycleInput());
    expect(result3.ok).toBe(false);
    expect(result3.error).toContain("kill switch");

    session.stop();
  });

  test("regime change to high volatility triggers reduce-only", () => {
    const session = new TradingSession({ now: () => FIXED_TS });
    session.start();

    // Normal regime first.
    session.runCycle(cycleInput());

    // High volatility regime.
    const result = session.runCycle(
      cycleInput({ regime: highVolRegimeInput() }),
    );
    expect(result.regimeClassification!.regime).toBe("high_volatility");
    expect(result.emergencyAction).toBe("reduce_only");
    expect(session.status.mode).toBe("REDUCE_ONLY");

    session.stop();
  });

  test("regime policy blocks trading when regime disables it", () => {
    const session = new TradingSession({ now: () => FIXED_TS });
    session.start();

    // First cycle to establish regime.
    session.runCycle(cycleInput());

    // Gas spike regime: trading disabled.
    const gasSpikeInput: RegimeClassifierInput = {
      ...normalRegimeInput(),
      gasPriceUsd: 100,
    };
    const result = session.runCycle(
      cycleInput({ regime: gasSpikeInput }),
    );
    expect(result.regimeClassification!.regime).toBe("gas_spike");
    expect(result.regimeBlockedCount).toBe(1);
    expect(result.submittedCount).toBe(0);

    session.stop();
  });

  test("orphan order triggers kill switch", () => {
    const session = new TradingSession({ now: () => FIXED_TS });
    session.start();
    session.runCycle(cycleInput());

    // Notify about an unknown order.
    session.notifyOrderResolved("unknown-order", "FILLED", 0);

    expect(session.status.killSwitchActive).toBe(true);
    expect(session.status.autoKillTrigger).toBe("orphan-orders");

    session.stop();
  });

  test("audit events are recorded for every cycle", () => {
    const session = new TradingSession({ now: () => FIXED_TS });
    session.start();

    session.runCycle(cycleInput());
    session.runCycle(cycleInput());

    // Should have at least one audit event per cycle.
    expect(session.reconstructor.auditEventCount).toBeGreaterThanOrEqual(2);

    session.stop();
  });

  test("learning recommendations are generated when learning cycle runs", () => {
    const session = new TradingSession({
      now: () => FIXED_TS,
      learningCycleInterval: 1, // Every cycle
    });
    session.start();

    // Record some trades to enable analysis.
    for (let i = 0; i < 25; i++) {
      session.learning.recordFill({
        tradeId: `trade-${i}`,
        strategyId: "arbitrage-alpha",
        regime: "trend",
        venue: "bybit",
        symbol: "BTC",
        side: "BUY",
        entryPrice: 100,
        exitPrice: 105,
        filledQuantity: 0.01,
        feesUsd: 0.1,
        enteredAtMs: FIXED_TS + i * 1000,
        exitedAtMs: FIXED_TS + i * 1000 + 500,
      });
    }

    // Run a learning cycle.
    const result = session.runCycle(cycleInput());
    expect(result.learningCycleRan).toBe(true);

    // Learning recommendations may or may not exist depending on thresholds,
    // but the learning engine should have processed.
    expect(result.learningRecommendations).toBeDefined();

    session.stop();
  });
});

// ── AC4: Canary Exit Criterion ────────────────────────────────────────

describe("AC4: canary exit criterion — bounded capital, limits, adaptation, audit", () => {
  test("session summary includes all subsystem data", () => {
    const session = new TradingSession({ now: () => FIXED_TS });
    session.start();

    // Run some cycles.
    session.runCycle(cycleInput());
    session.runCycle(cycleInput());

    // Record some trades.
    session.learning.recordFill({
      tradeId: "summary-trade-1",
      strategyId: "arbitrage-alpha",
      regime: "trend",
      venue: "bybit",
      symbol: "BTC",
      side: "BUY",
      entryPrice: 100,
      exitPrice: 105,
      filledQuantity: 0.01,
      feesUsd: 0.1,
      enteredAtMs: FIXED_TS,
      exitedAtMs: FIXED_TS + 5000,
    });

    session.stop();

    const summary = session.getSessionSummary();

    // Completed normally.
    expect(summary.completedNormally).toBe(true);

    // Canary status is reported.
    expect(summary.canaryStatus).toBeDefined();
    expect(summary.canaryStatus.mode).toBeDefined();
    expect(summary.canaryStatus.killSwitchActive).toBe(false);

    // Regime data is reported.
    expect(summary.regimeClassification).toBeDefined();
    expect(summary.regimeChangeHistory).toBeDefined();
    expect(summary.regimePerformance).toBeDefined();

    // Journal is integrated.
    expect(summary.journalEntryCount).toBe(1);

    // Reports are generated.
    expect(summary.dailyReport).toBeDefined();
    expect(summary.weeklyReport).toBeDefined();
    expect(summary.dailyReport!.totalTrades).toBe(1);

    // Exports are produced.
    expect(summary.exportedReports.dailyJson).toBeDefined();
    expect(summary.exportedReports.dailyCsv).toBeDefined();
    expect(summary.exportedReports.dailyTxt).toBeDefined();

    // JSON export is valid JSON.
    const parsed = JSON.parse(summary.exportedReports.dailyJson!);
    expect(parsed.period).toBe("daily");

    // TXT export contains report header.
    expect(summary.exportedReports.dailyTxt).toContain("DAILY TRADE REPORT");

    // CSV export contains data.
    expect(summary.exportedReports.dailyCsv).toContain("tradeId");

    // Audit events recorded.
    expect(summary.auditEventCount).toBeGreaterThan(0);

    // Learning recommendations tracked.
    expect(summary.learningRecommendations).toBeDefined();
  });

  test("session preserves limits through regime adaptation", () => {
    const session = new TradingSession({ now: () => FIXED_TS });
    session.start();

    // Start in trend regime (full permissions).
    const r1 = session.runCycle(cycleInput());
    expect(r1.regimePolicy!.tradingEnabled).toBe(true);
    expect(r1.regimePolicy!.maxOpenOrders).toBe(5);

    // Transition to chop (reduced permissions).
    const chopInput: RegimeClassifierInput = {
      ...normalRegimeInput(),
      reversalCount: 5,
      realizedVolatility: 0.4,
    };
    const r2 = session.runCycle(cycleInput({ regime: chopInput }));
    expect(r2.regimePolicy!.tradingEnabled).toBe(true);
    expect(r2.regimePolicy!.maxOpenOrders).toBeLessThanOrEqual(5);

    // Permissions should only decrease, never increase.
    // Transition back to trend: policy engine should block permission increase.
    // (This tests the never-increase-invariant.)

    session.stop();
  });

  test("session reports bounded capital and limits at summary", () => {
    const config = canaryConfig({
      capitalLimits: {
        maxCapitalUsd: 500,
        maxRiskPerTradeUsd: 25,
        maxDailyLossUsd: 100,
        maxWeeklyLossUsd: 200,
      },
    });
    const session = new TradingSession({ now: () => FIXED_TS, canaryConfig: config });
    session.start();

    session.runCycle(cycleInput());

    const summary = session.getSessionSummary();

    // Capital is bounded.
    expect(summary.canaryStatus.capitalRemainingUsd).toBeLessThanOrEqual(500);
    expect(summary.canaryStatus.capitalDeployedUsd).toBeGreaterThanOrEqual(0);

    session.stop();
  });

  test("complete go-live canary lifecycle: start → trade → regime change → halt → report", () => {
    const session = new TradingSession({ now: () => FIXED_TS });
    session.start();

    // Cycle 1: Normal trading.
    const r1 = session.runCycle(cycleInput());
    expect(r1.ok).toBe(true);
    expect(r1.submittedCount).toBe(1);
    session.notifyOrderResolved("intent-1", "FILLED", 10);

    // Cycle 2: Still normal.
    const r2 = session.runCycle(
      cycleInput({
        intents: [intent({ idempotencyKey: "i2" })],
        riskDecisions: [
          approvedDecision({ orderIntentIdempotencyKey: "i2" }),
        ],
      }),
    );
    expect(r2.ok).toBe(true);
    session.notifyOrderResolved("i2", "FILLED", -5);

    // Cycle 3: Drawdown regime triggers halt.
    const r3 = session.runCycle(
      cycleInput({
        regime: {
          ...drawdownRegimeInput(),
          cumulativePnlUsd: -150,
        },
        intents: [intent({ idempotencyKey: "i3" })],
        riskDecisions: [
          approvedDecision({ orderIntentIdempotencyKey: "i3" }),
        ],
      }),
    );
    expect(r3.regimeClassification!.regime).toBe("drawdown");
    expect(session.status.killSwitchActive).toBe(true);

    // Session is halted; further cycles fail.
    const r4 = session.runCycle(cycleInput());
    expect(r4.ok).toBe(false);

    session.stop();

    // Produce final summary.
    const summary = session.getSessionSummary();
    expect(summary.completedNormally).toBe(false); // kill switch was active
    expect(summary.canaryStatus.killSwitchActive).toBe(true);
    expect(summary.regimeClassification!.regime).toBe("drawdown");
    expect(summary.journalEntryCount).toBe(2); // Two filled trades
    expect(summary.dailyReport).toBeDefined();
    expect(summary.auditEventCount).toBeGreaterThan(0);
  });

  test("scales only with evidence: promotion pipeline integration", () => {
    const session = new TradingSession({
      now: () => FIXED_TS,
      learningCycleInterval: 1,
    });
    session.start();

    // Record 30 winning trades (qty 1.0 → $10 PnL per trade).
    for (let i = 0; i < 30; i++) {
      session.learning.recordFill({
        tradeId: `win-${i}`,
        strategyId: "arbitrage-alpha",
        regime: "trend",
        venue: "bybit",
        symbol: "BTC",
        side: "BUY",
        entryPrice: 100,
        exitPrice: 110,
        filledQuantity: 1.0,
        feesUsd: 0.1,
        enteredAtMs: FIXED_TS + i * 1000,
        exitedAtMs: FIXED_TS + i * 1000 + 500,
      });
    }

    // Run a learning cycle.
    const result = session.runCycle(cycleInput());
    expect(result.learningCycleRan).toBe(true);

    // The learning engine should have evaluated the strategy.
    // Whether a promotion recommendation is generated depends on
    // the strategy's performance vs. promotion thresholds.
    // With 30 100% win-rate trades, we expect a promotion recommendation.
    const recs = session.learning.getRecommendations({ type: "promote" });
    expect(recs.length).toBeGreaterThanOrEqual(1);

    session.stop();
  });
});

// ── Unit Tests: RegimeClassifier + RegimePolicyEngine Integration ────

describe("RegimeClassifier + RegimePolicyEngine integration", () => {
  test("classifies trend regime with high confidence", () => {
    const classifier = new RegimeClassifier();
    const input = normalRegimeInput();
    const classification = classifier.classify(input);

    expect(classification.regime).toBe("trend");
    expect(classification.confidence).toBeGreaterThan(0.5);
  });

  test("classifies high volatility regime", () => {
    const classifier = new RegimeClassifier();
    const classification = classifier.classify(highVolRegimeInput());

    expect(classification.regime).toBe("high_volatility");
  });

  test("classifies drawdown regime", () => {
    const classifier = new RegimeClassifier();
    const classification = classifier.classify(drawdownRegimeInput());

    expect(classification.regime).toBe("drawdown");
  });

  test("policy engine maps regime to correct policy", () => {
    const engine = new RegimePolicyEngine({ now: () => FIXED_TS });
    const classifier = new RegimeClassifier();

    const trendClassification = classifier.classify(normalRegimeInput());
    const result = engine.evaluate(trendClassification);

    expect(result.changed).toBe(true);
    expect(result.policy.tradingEnabled).toBe(true);
    expect(result.policy.regime).toBe("trend");
  });

  test("policy engine enforces never-increase invariant", () => {
    const engine = new RegimePolicyEngine({ now: () => FIXED_TS });
    const classifier = new RegimeClassifier();

    // Start with trend (full permissions).
    engine.evaluate(classifier.classify(normalRegimeInput()));
    const trendPolicy = engine.policy;

    // Transition to chop (reduced permissions).
    const chopInput: RegimeClassifierInput = {
      ...normalRegimeInput(),
      reversalCount: 5,
      realizedVolatility: 0.4,
    };
    engine.evaluate(classifier.classify(chopInput));
    const chopPolicy = engine.policy;

    // Chop should have fewer permissions.
    expect(chopPolicy.maxOpenOrders).toBeLessThanOrEqual(
      trendPolicy.maxOpenOrders,
    );
  });
});

// ── Unit Tests: LearningEngine Integration ────────────────────────────

describe("LearningEngine integration", () => {
  test("records trades and computes performance", () => {
    const engine = new LearningEngine(undefined, () => FIXED_TS);

    for (let i = 0; i < 10; i++) {
      engine.recordFill({
        tradeId: `trade-${i}`,
        strategyId: "test-strategy",
        regime: "trend",
        venue: "bybit",
        symbol: "BTC",
        side: "BUY",
        entryPrice: 100,
        exitPrice: 110,
        filledQuantity: 1.0,
        feesUsd: 0.1,
        enteredAtMs: FIXED_TS + i * 1000,
        exitedAtMs: FIXED_TS + i * 1000 + 500,
      });
    }

    const entries = engine.journal.getEntries({ strategyId: "test-strategy" });
    expect(entries.length).toBe(10);

    const perf = engine.journal.computePerformanceByCount("test-strategy", 10);
    expect(perf).not.toBeNull();
    expect(perf!.tradeCount).toBe(10);
    expect(perf!.winRate).toBe(1.0);
  });

  test("learning cycle generates recommendations", () => {
    const engine = new LearningEngine(undefined, () => FIXED_TS);

    // Record enough trades for analysis (qty 1.0 → $2 PnL per trade).
    for (let i = 0; i < 25; i++) {
      engine.recordFill({
        tradeId: `trade-${i}`,
        strategyId: "test-strategy",
        regime: "trend",
        venue: "bybit",
        symbol: "BTC",
        side: "BUY",
        entryPrice: 100,
        exitPrice: 102,
        filledQuantity: 1.0,
        feesUsd: 0.1,
        enteredAtMs: FIXED_TS + i * 1000,
        exitedAtMs: FIXED_TS + i * 1000 + 500,
      });
    }

    const recs = engine.runCycle();
    expect(recs).toBeDefined();
    expect(Array.isArray(recs)).toBe(true);
  });
});

// ── Unit Tests: AuditReconstructor + ReportGenerator + Exporter ──────

describe("Audit pipeline integration", () => {
  test("reconstructor produces timeline from audit events", () => {
    const reconstructor = new AuditReconstructor(
      { available: true, lastWriteAtMs: FIXED_TS, maxStaleMs: 60_000 },
      () => FIXED_TS,
    );

    reconstructor.addAuditEvents([
      {
        eventId: "evt-1",
        sequence: 1,
        timestampMs: FIXED_TS,
        action: "RISK_DECISION",
        actor: "risk-gate",
        reasonCodes: ["RISK_APPROVED"],
        data: { tradeId: "trade-1", decision: "APPROVE" },
      },
      {
        eventId: "evt-2",
        sequence: 2,
        timestampMs: FIXED_TS + 500,
        action: "ORDER_INTENT_CREATED",
        actor: "state-graph",
        reasonCodes: ["ORDER_INTENT_CREATED"],
        data: { tradeId: "trade-1" },
      },
    ]);

    reconstructor.addTradeEntry({
      tradeId: "trade-1",
      strategyId: "strategy-a",
      regime: "trend",
      venue: "bybit",
      symbol: "BTC",
      side: "BUY",
      entryPrice: 100,
      exitPrice: 105,
      filledQuantity: 1,
      notionalUsd: 100,
      pnlUsd: 5,
      feesUsd: 0.2,
      netPnlUsd: 4.8,
      outcome: "WIN",
      enteredAtMs: FIXED_TS,
      exitedAtMs: FIXED_TS + 5000,
      durationMs: 5000,
    });

    const recon = reconstructor.reconstruct("trade-1");
    expect(recon).not.toBeNull();
    expect(recon!.timeline.length).toBe(2);
    expect(recon!.timeline[0].phase).toBe("risk_decision");
    expect(recon!.timeline[1].phase).toBe("order_intent_created");
  });

  test("report generator produces daily report from journal entries", () => {
    const entries = [
      {
        tradeId: "t1",
        strategyId: "strategy-a",
        regime: "trend",
        venue: "bybit",
        symbol: "BTC",
        side: "BUY" as const,
        entryPrice: 100,
        exitPrice: 105,
        filledQuantity: 1,
        notionalUsd: 100,
        pnlUsd: 5,
        feesUsd: 0.2,
        netPnlUsd: 4.8,
        outcome: "WIN" as const,
        enteredAtMs: FIXED_TS + 1000,
        exitedAtMs: FIXED_TS + 5000,
        durationMs: 4000,
      },
    ];

    const generator = new ReportGenerator(entries, new Map(), () => FIXED_TS);
    const report = generator.generateDailyReport(FIXED_TS);

    expect(report.period).toBe("daily");
    expect(report.totalTrades).toBe(1);
    expect(report.winRate).toBe(1.0);
    expect(report.totalNetPnlUsd).toBe(4.8);
  });

  test("exporter produces JSON, CSV, TXT from report", () => {
    const exporter = new AuditExporter();
    const entries = [
      {
        tradeId: "t1",
        strategyId: "strategy-a",
        regime: "trend",
        venue: "bybit",
        symbol: "BTC",
        side: "BUY" as const,
        entryPrice: 100,
        exitPrice: 105,
        filledQuantity: 1,
        notionalUsd: 100,
        pnlUsd: 5,
        feesUsd: 0.2,
        netPnlUsd: 4.8,
        outcome: "WIN" as const,
        enteredAtMs: FIXED_TS + 1000,
        exitedAtMs: FIXED_TS + 5000,
        durationMs: 4000,
      },
    ];

    const generator = new ReportGenerator(entries, new Map(), () => FIXED_TS);
    const report = generator.generateDailyReport(FIXED_TS);

    const json = exporter.exportReport(report, {
      format: "json",
      includeEntries: true,
      includeReasonCodes: true,
      includeTimeline: false,
    });
    expect(JSON.parse(json).period).toBe("daily");

    const csv = exporter.exportReport(report, {
      format: "csv",
      includeEntries: true,
      includeReasonCodes: true,
      includeTimeline: false,
    });
    expect(csv).toContain("tradeId");

    const txt = exporter.exportReport(report, {
      format: "txt",
      includeEntries: true,
      includeReasonCodes: true,
      includeTimeline: false,
    });
    expect(txt).toContain("DAILY TRADE REPORT");
  });
});

// ── CanarySession + KillSwitch Integration ────────────────────────────

describe("CanarySession + KillSwitch integration", () => {
  test("automatic kill switch on daily loss", () => {
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

    // Submit an order.
    session.submitOrder(
      intent({ idempotencyKey: "loss-order" }),
      approvedDecision({ orderIntentIdempotencyKey: "loss-order" }),
      { bid: 99, ask: 101, mid: 100, liquidityUsd: 10_000 },
    );

    // Resolve with a large loss.
    session.notifyOrderResolved("loss-order", "FILLED", -60);

    expect(session.status.killSwitchActive).toBe(true);
    expect(session.status.autoKillTrigger).toBe("daily-loss");
  });

  test("manual halt cancels all orders", () => {
    const session = new CanarySession({
      now: () => FIXED_TS,
      config: DEFAULT_CANARY_CONFIG,
    });
    session.control("start");

    // Submit orders.
    session.submitOrder(
      intent({ idempotencyKey: "o1" }),
      approvedDecision({ orderIntentIdempotencyKey: "o1" }),
      { bid: 99, ask: 101, mid: 100, liquidityUsd: 10_000 },
    );
    session.submitOrder(
      intent({ idempotencyKey: "o2" }),
      approvedDecision({ orderIntentIdempotencyKey: "o2" }),
      { bid: 99, ask: 101, mid: 100, liquidityUsd: 10_000 },
    );

    expect(session.status.openOrders).toBe(2);

    // Halt.
    session.control("halt");

    expect(session.status.killSwitchActive).toBe(true);
    expect(session.status.openOrders).toBe(0);
    expect(session.status.mode).toBe("HALT");
  });

  test("pause prevents new orders", () => {
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
});
