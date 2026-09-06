import { describe, expect, test } from "bun:test";
import {
  DEFAULT_LEARNING_LOOP_CONFIG,
  type LearningLoopConfig,
  type TradeJournalEntry,
  PROMOTION_STAGES,
  nextStage,
  stageIndex,
} from "@agenttrading/contracts";
import { TradeJournal } from "../src/live/trade-journal.ts";
import { EdgeDecayDetector } from "../src/live/edge-decay-detector.ts";
import { PromotionPipeline } from "../src/live/promotion-pipeline.ts";
import { LearningEngine } from "../src/live/learning-engine.ts";

// ── Helpers ──────────────────────────────────────────────────────────

const FIXED_TS = 1_700_000_000_000;

function makeEntry(
  overrides: Partial<TradeJournalEntry> = {},
): TradeJournalEntry {
  return {
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
    exitedAtMs: FIXED_TS + 60_000,
    durationMs: 60_000,
    ...overrides,
  };
}

function makeLosingEntry(
  overrides: Partial<TradeJournalEntry> = {},
): TradeJournalEntry {
  return makeEntry({
    tradeId: "trade-loss-1",
    exitPrice: 95,
    pnlUsd: -5,
    feesUsd: 0.2,
    netPnlUsd: -5.2,
    outcome: "LOSS",
    ...overrides,
  });
}

function config(
  overrides: Partial<LearningLoopConfig> = {},
): LearningLoopConfig {
  return { ...DEFAULT_LEARNING_LOOP_CONFIG, ...overrides };
}

// ── Contract Tests ───────────────────────────────────────────────────

describe("Learning loop contracts", () => {
  test("PROMOTION_STAGES are ordered correctly", () => {
    expect(PROMOTION_STAGES).toEqual([
      "hypothesis",
      "backtest",
      "review",
      "canary",
      "scale",
    ]);
  });

  test("stageIndex returns correct indices", () => {
    expect(stageIndex("hypothesis")).toBe(0);
    expect(stageIndex("backtest")).toBe(1);
    expect(stageIndex("review")).toBe(2);
    expect(stageIndex("canary")).toBe(3);
    expect(stageIndex("scale")).toBe(4);
  });

  test("nextStage returns the next stage or null", () => {
    expect(nextStage("hypothesis")).toBe("backtest");
    expect(nextStage("backtest")).toBe("review");
    expect(nextStage("review")).toBe("canary");
    expect(nextStage("canary")).toBe("scale");
    expect(nextStage("scale")).toBeNull();
  });



  test("default config has sensible values", () => {
    const cfg = DEFAULT_LEARNING_LOOP_CONFIG;
    expect(cfg.configId).toBe("learning-loop-default-1");
    expect(cfg.decayWindowTrades).toBeGreaterThan(0);
    expect(cfg.promotionMinBacktestTrades).toBeGreaterThan(0);
    expect(cfg.promotionRequireHumanApproval).toBe(true);
  });
});

// ── TradeJournal ─────────────────────────────────────────────────────

describe("TradeJournal", () => {
  test("records entries and respects max retention", () => {
    const journal = new TradeJournal(
      config({ maxJournalEntries: 5 }),
      () => FIXED_TS,
    );

    for (let i = 0; i < 10; i++) {
      journal.record(makeEntry({ tradeId: `trade-${i}` }));
    }

    expect(journal.size).toBe(5);
    // Should have the last 5 entries.
    const entries = journal.getEntries();
    expect(entries[0].tradeId).toBe("trade-5");
    expect(entries[4].tradeId).toBe("trade-9");
  });

  test("recordFill computes PnL correctly for BUY", () => {
    const journal = new TradeJournal(config(), () => FIXED_TS);
    const entry = journal.recordFill({
      tradeId: "fill-1",
      strategyId: "strategy-a",
      regime: "trend",
      venue: "bybit",
      symbol: "BTC",
      side: "BUY",
      entryPrice: 100,
      exitPrice: 110,
      filledQuantity: 2,
      feesUsd: 1,
      enteredAtMs: FIXED_TS,
      exitedAtMs: FIXED_TS + 60_000,
    });

    expect(entry.pnlUsd).toBe(20); // (110 - 100) * 2
    expect(entry.netPnlUsd).toBe(19); // 20 - 1
    expect(entry.outcome).toBe("WIN");
    expect(entry.durationMs).toBe(60_000);
  });

  test("recordFill computes PnL correctly for SELL", () => {
    const journal = new TradeJournal(config(), () => FIXED_TS);
    const entry = journal.recordFill({
      tradeId: "fill-sell-1",
      strategyId: "strategy-a",
      regime: "trend",
      venue: "bybit",
      symbol: "ETH",
      side: "SELL",
      entryPrice: 2000,
      exitPrice: 1900,
      filledQuantity: 1,
      feesUsd: 2,
      enteredAtMs: FIXED_TS,
      exitedAtMs: FIXED_TS + 120_000,
    });

    expect(entry.pnlUsd).toBe(100); // (2000 - 1900) * 1
    expect(entry.netPnlUsd).toBe(98); // 100 - 2
    expect(entry.outcome).toBe("WIN");
  });

  test("classify outcome as LOSS", () => {
    const journal = new TradeJournal(config(), () => FIXED_TS);
    const entry = journal.recordFill({
      tradeId: "loss-1",
      strategyId: "strategy-a",
      regime: "range",
      venue: "bybit",
      symbol: "BTC",
      side: "BUY",
      entryPrice: 100,
      exitPrice: 90,
      filledQuantity: 1,
      feesUsd: 0.5,
      enteredAtMs: FIXED_TS,
      exitedAtMs: FIXED_TS + 30_000,
    });

    expect(entry.pnlUsd).toBe(-10);
    expect(entry.netPnlUsd).toBe(-10.5);
    expect(entry.outcome).toBe("LOSS");
  });

  test("classify outcome as BREAKEVEN", () => {
    const journal = new TradeJournal(config(), () => FIXED_TS);
    const entry = journal.recordFill({
      tradeId: "be-1",
      strategyId: "strategy-a",
      regime: "trend",
      venue: "bybit",
      symbol: "BTC",
      side: "BUY",
      entryPrice: 100,
      exitPrice: 100,
      filledQuantity: 1,
      feesUsd: 0,
      enteredAtMs: FIXED_TS,
      exitedAtMs: FIXED_TS + 10_000,
    });

    expect(entry.netPnlUsd).toBe(0);
    expect(entry.outcome).toBe("BREAKEVEN");
  });

  test("filters entries by strategy, regime, venue", () => {
    const journal = new TradeJournal(config(), () => FIXED_TS);
    journal.record(makeEntry({ strategyId: "strategy-a", regime: "trend", venue: "bybit" }));
    journal.record(makeEntry({ strategyId: "strategy-b", regime: "trend", venue: "bybit" }));
    journal.record(makeEntry({ strategyId: "strategy-a", regime: "range", venue: "bybit" }));
    journal.record(makeEntry({ strategyId: "strategy-a", regime: "trend", venue: "binance" }));

    expect(journal.getEntries({ strategyId: "strategy-a" }).length).toBe(3);
    expect(journal.getEntries({ regime: "range" }).length).toBe(1);
    expect(journal.getEntries({ venue: "binance" }).length).toBe(1);
    expect(
      journal.getEntries({ strategyId: "strategy-a", regime: "trend" }).length,
    ).toBe(2);
  });

  test("computePerformance computes correct metrics", () => {
    const journal = new TradeJournal(config(), () => FIXED_TS);

    // Generate 10 winning trades.
    for (let i = 0; i < 10; i++) {
      journal.recordFill({
        tradeId: `win-${i}`,
        strategyId: "strategy-a",
        regime: "trend",
        venue: "bybit",
        symbol: "BTC",
        side: "BUY",
        entryPrice: 100,
        exitPrice: 105,
        filledQuantity: 1,
        feesUsd: 0.1,
        enteredAtMs: FIXED_TS + i * 60_000,
        exitedAtMs: FIXED_TS + i * 60_000 + 30_000,
      });
    }

    const perf = journal.computePerformance("strategy-a", 600_000, FIXED_TS + 600_000);
    expect(perf).not.toBeNull();
    expect(perf!.tradeCount).toBe(10);
    expect(perf!.winCount).toBe(10);
    expect(perf!.winRate).toBe(1.0);
    expect(perf!.totalPnlUsd).toBeGreaterThan(0);
    expect(perf!.sharpeRatio).toBeGreaterThan(0);
  });

  test("computePerformance returns null for insufficient data", () => {
    const journal = new TradeJournal(config(), () => FIXED_TS);
    journal.record(makeEntry());

    const perf = journal.computePerformance("strategy-a", 600_000, FIXED_TS);
    expect(perf).toBeNull(); // Only 1 trade
  });

  test("computePerformanceByCount works correctly", () => {
    const journal = new TradeJournal(config(), () => FIXED_TS);
    for (let i = 0; i < 20; i++) {
      const isWin = i % 3 !== 0; // ~66% win rate
      journal.recordFill({
        tradeId: `count-${i}`,
        strategyId: "strategy-b",
        regime: "range",
        venue: "bybit",
        symbol: "ETH",
        side: "BUY",
        entryPrice: 100,
        exitPrice: isWin ? 105 : 95,
        filledQuantity: 1,
        feesUsd: 0.1,
        enteredAtMs: FIXED_TS + i * 60_000,
        exitedAtMs: FIXED_TS + i * 60_000 + 30_000,
      });
    }

    const perf = journal.computePerformanceByCount("strategy-b", 10);
    expect(perf).not.toBeNull();
    expect(perf!.tradeCount).toBe(10);
  });

  test("distinctStrategyIds and distinctRegimes", () => {
    const journal = new TradeJournal(config(), () => FIXED_TS);
    journal.record(makeEntry({ strategyId: "strategy-a", regime: "trend" }));
    journal.record(makeEntry({ strategyId: "strategy-b", regime: "range" }));
    journal.record(makeEntry({ strategyId: "strategy-a", regime: "trend" }));

    expect(journal.distinctStrategyIds()).toEqual(["strategy-a", "strategy-b"]);
    expect(journal.distinctRegimes()).toEqual(["trend", "range"]);
  });
});

// ── EdgeDecayDetector ────────────────────────────────────────────────

describe("EdgeDecayDetector", () => {
  test("returns null for insufficient data", () => {
    const journal = new TradeJournal(config(), () => FIXED_TS);
    const detector = new EdgeDecayDetector(journal, config(), () => FIXED_TS);

    // Only a few trades — not enough for detection.
    for (let i = 0; i < 5; i++) {
      journal.recordFill({
        tradeId: `few-${i}`,
        strategyId: "strategy-a",
        regime: "trend",
        venue: "bybit",
        symbol: "BTC",
        side: "BUY",
        entryPrice: 100,
        exitPrice: 105,
        filledQuantity: 1,
        feesUsd: 0.1,
        enteredAtMs: FIXED_TS + i * 60_000,
        exitedAtMs: FIXED_TS + i * 60_000 + 30_000,
      });
    }

    const signal = detector.detect("strategy-a");
    expect(signal).toBeNull();
  });

  test("detects no decay for consistently profitable strategy", () => {
    const cfg = config({
      minTradesForAnalysis: 10,
      decayWindowTrades: 15,
      decayPreviousWindowTrades: 15,
    });
    const journal = new TradeJournal(cfg, () => FIXED_TS);
    const detector = new EdgeDecayDetector(journal, cfg, () => FIXED_TS);

    // Generate 40 consistent winning trades.
    for (let i = 0; i < 40; i++) {
      journal.recordFill({
        tradeId: `consistent-${i}`,
        strategyId: "strategy-a",
        regime: "trend",
        venue: "bybit",
        symbol: "BTC",
        side: "BUY",
        entryPrice: 100,
        exitPrice: 103,
        filledQuantity: 1,
        feesUsd: 0.1,
        enteredAtMs: FIXED_TS + i * 60_000,
        exitedAtMs: FIXED_TS + i * 60_000 + 30_000,
      });
    }

    const signal = detector.detect("strategy-a");
    expect(signal).toBeNull(); // No decay
  });

  test("detects decay when strategy starts losing", () => {
    const cfg = config({
      minTradesForAnalysis: 5,
      decayWindowTrades: 10,
      decayPreviousWindowTrades: 10,
      decaySharpeLowThreshold: 0.5,
    });
    const journal = new TradeJournal(cfg, () => FIXED_TS);
    const detector = new EdgeDecayDetector(journal, cfg, () => FIXED_TS);

    // First 15 trades: all winning (strong edge).
    for (let i = 0; i < 15; i++) {
      journal.recordFill({
        tradeId: `good-${i}`,
        strategyId: "strategy-a",
        regime: "trend",
        venue: "bybit",
        symbol: "BTC",
        side: "BUY",
        entryPrice: 100,
        exitPrice: 105,
        filledQuantity: 1,
        feesUsd: 0.1,
        enteredAtMs: FIXED_TS + i * 60_000,
        exitedAtMs: FIXED_TS + i * 60_000 + 30_000,
      });
    }

    // Next 10 trades: all losing (edge decayed).
    for (let i = 0; i < 10; i++) {
      journal.recordFill({
        tradeId: `bad-${i}`,
        strategyId: "strategy-a",
        regime: "trend",
        venue: "bybit",
        symbol: "BTC",
        side: "BUY",
        entryPrice: 100,
        exitPrice: 95,
        filledQuantity: 1,
        feesUsd: 0.5,
        enteredAtMs: FIXED_TS + (15 + i) * 60_000,
        exitedAtMs: FIXED_TS + (15 + i) * 60_000 + 30_000,
      });
    }

    const signal = detector.detect("strategy-a");
    expect(signal).not.toBeNull();
    expect(signal!.strategyId).toBe("strategy-a");
    expect(signal!.severity).toBeDefined();
    expect(signal!.recommendation).toBeDefined();
    expect(signal!.currentSharpe).toBeLessThan(signal!.previousSharpe);
  });

  test("detectAll finds decay across multiple strategies", () => {
    const cfg = config({
      minTradesForAnalysis: 5,
      decayWindowTrades: 10,
      decayPreviousWindowTrades: 10,
    });
    const journal = new TradeJournal(cfg, () => FIXED_TS);
    const detector = new EdgeDecayDetector(journal, cfg, () => FIXED_TS);

    // Scenario: consistent wins (no decay).
    for (let i = 0; i < 30; i++) {
      journal.recordFill({
        tradeId: `strategy-a-${i}`,
        strategyId: "strategy-a",
        regime: "trend",
        venue: "bybit",
        symbol: "BTC",
        side: "BUY",
        entryPrice: 100,
        exitPrice: 105,
        filledQuantity: 1,
        feesUsd: 0.1,
        enteredAtMs: FIXED_TS + i * 60_000,
        exitedAtMs: FIXED_TS + i * 60_000 + 30_000,
      });
    }

    // Scenario: wins then losses (decay).
    for (let i = 0; i < 15; i++) {
      journal.recordFill({
        tradeId: `strategy-b-good-${i}`,
        strategyId: "strategy-b",
        regime: "trend",
        venue: "bybit",
        symbol: "ETH",
        side: "BUY",
        entryPrice: 100,
        exitPrice: 105,
        filledQuantity: 1,
        feesUsd: 0.1,
        enteredAtMs: FIXED_TS + i * 60_000,
        exitedAtMs: FIXED_TS + i * 60_000 + 30_000,
      });
    }
    for (let i = 0; i < 10; i++) {
      journal.recordFill({
        tradeId: `strategy-b-bad-${i}`,
        strategyId: "strategy-b",
        regime: "trend",
        venue: "bybit",
        symbol: "ETH",
        side: "BUY",
        entryPrice: 100,
        exitPrice: 95,
        filledQuantity: 1,
        feesUsd: 0.5,
        enteredAtMs: FIXED_TS + (15 + i) * 60_000,
        exitedAtMs: FIXED_TS + (15 + i) * 60_000 + 30_000,
      });
    }

    const signals = detector.detectAll();
    // a decay signal should exist a decay signal.
    const betaSignal = signals.find((s) => s.strategyId === "strategy-b");
    expect(betaSignal).toBeDefined();
  });
});

// ── PromotionPipeline ────────────────────────────────────────────────

describe("PromotionPipeline", () => {
  test("creates a promotion at hypothesis stage", () => {
    const journal = new TradeJournal(config(), () => FIXED_TS);
    const pipeline = new PromotionPipeline(journal, config(), () => FIXED_TS);

    const record = pipeline.createPromotion("strategy-a", "Improve mean reversion");
    expect(record.currentStage).toBe("hypothesis");
    expect(record.active).toBe(true);
    expect(record.humanApproved).toBe(false);
    expect(record.stageOutcomes.hypothesis).toBe("pass");
    expect(record.stageOutcomes.backtest).toBe("pending");
  });

  test("advanceStage moves to next stage on gate pass", () => {
    const cfg = config({
      promotionMinBacktestTrades: 5,
      promotionBacktestMinWinRate: 0.5,
      promotionBacktestMinSharpe: 0.0,
    });
    const journal = new TradeJournal(cfg, () => FIXED_TS);
    const pipeline = new PromotionPipeline(journal, cfg, () => FIXED_TS);

    const record = pipeline.createPromotion("strategy-a", "Test promotion");

    // Advance from hypothesis to backtest (hypothesis always passes).
    const updated = pipeline.advanceStage(record.promotionId);
    expect(updated.currentStage).toBe("backtest");

    // Advance from backtest to review (with passing performance).
    const updated2 = pipeline.advanceStage(record.promotionId, {
      performance: {
        strategyId: "strategy-a",
        tradeCount: 100,
        winCount: 60,
        lossCount: 40,
        winRate: 0.6,
        totalPnlUsd: 500,
        avgPnlUsd: 5,
        sharpeRatio: 1.0,
        maxDrawdownUsd: 50,
        profitFactor: 1.5,
        avgDurationMs: 30_000,
        windowStartMs: FIXED_TS,
        windowEndMs: FIXED_TS + 3_600_000,
      },
    });
    expect(updated2.currentStage).toBe("review");
  });

  test("advanceStage rejects when gate criteria fail", () => {
    const cfg = config({
      promotionMinBacktestTrades: 100,
    });
    const journal = new TradeJournal(cfg, () => FIXED_TS);
    const pipeline = new PromotionPipeline(journal, cfg, () => FIXED_TS);

    const record = pipeline.createPromotion("strategy-a", "Test promotion");
    pipeline.advanceStage(record.promotionId); // hypothesis → backtest

    // Try to advance to review with insufficient data.
    const updated = pipeline.advanceStage(record.promotionId);
    expect(updated.currentStage).toBe("backtest"); // Still at backtest
    expect(updated.active).toBe(false); // Rejected
    expect(updated.stageOutcomes.backtest).toBe("fail");
  });

  test("review gate requires human approval", () => {
    const cfg = config({
      promotionRequireHumanApproval: true,
      promotionMinBacktestTrades: 1,
      promotionBacktestMinWinRate: 0.0,
      promotionBacktestMinSharpe: 0.0,
      promotionMinCanaryTrades: 1,
    });
    const journal = new TradeJournal(cfg, () => FIXED_TS);
    const pipeline = new PromotionPipeline(journal, cfg, () => FIXED_TS);

    const passingPerf = {
      strategyId: "strategy-a",
      tradeCount: 10,
      winCount: 6,
      lossCount: 4,
      winRate: 0.6,
      totalPnlUsd: 50,
      avgPnlUsd: 5,
      sharpeRatio: 1.0,
      maxDrawdownUsd: 5,
      profitFactor: 1.5,
      avgDurationMs: 30_000,
      windowStartMs: FIXED_TS,
      windowEndMs: FIXED_TS + 3_600_000,
    };

    const record = pipeline.createPromotion("strategy-a", "Test");
    pipeline.advanceStage(record.promotionId); // hypothesis -> backtest
    pipeline.advanceStage(record.promotionId, { performance: passingPerf }); // backtest -> review

    // Try to advance without approval.
    const updated = pipeline.advanceStage(record.promotionId);
    expect(updated.currentStage).toBe("review");
    expect(updated.active).toBe(false);
    expect(updated.stageOutcomes.review).toBe("fail");
  });

  test("review gate passes with human approval", () => {
    const cfg = config({
      promotionRequireHumanApproval: true,
      promotionMinBacktestTrades: 1,
      promotionBacktestMinWinRate: 0.0,
      promotionBacktestMinSharpe: 0.0,
      promotionMinCanaryTrades: 1,
    });
    const journal = new TradeJournal(cfg, () => FIXED_TS);
    const pipeline = new PromotionPipeline(journal, cfg, () => FIXED_TS);

    const passingPerf = {
      strategyId: "strategy-a",
      tradeCount: 10,
      winCount: 6,
      lossCount: 4,
      winRate: 0.6,
      totalPnlUsd: 50,
      avgPnlUsd: 5,
      sharpeRatio: 1.0,
      maxDrawdownUsd: 5,
      profitFactor: 1.5,
      avgDurationMs: 30_000,
      windowStartMs: FIXED_TS,
      windowEndMs: FIXED_TS + 3_600_000,
    };

    const record = pipeline.createPromotion("strategy-a", "Test");
    pipeline.advanceStage(record.promotionId); // hypothesis -> backtest
    pipeline.advanceStage(record.promotionId, { performance: passingPerf }); // backtest -> review
    pipeline.approveReview(record.promotionId, true, "LGTM");

    const updated = pipeline.advanceStage(record.promotionId, {
      humanApproved: true,
    });
    expect(updated.currentStage).toBe("canary");
    expect(updated.active).toBe(true);
  });

  test("full pipeline from hypothesis to live", () => {
    const cfg = config({
      promotionRequireHumanApproval: true,
      promotionMinBacktestTrades: 5,
      promotionBacktestMinWinRate: 0.5,
      promotionBacktestMinSharpe: 0.0,
      promotionMinCanaryTrades: 5,
      promotionCanaryMinWinRate: 0.5,
    });
    const journal = new TradeJournal(cfg, () => FIXED_TS);
    const pipeline = new PromotionPipeline(journal, cfg, () => FIXED_TS);

    const passingPerf = {
      strategyId: "strategy-a",
      tradeCount: 100,
      winCount: 60,
      lossCount: 40,
      winRate: 0.6,
      totalPnlUsd: 500,
      avgPnlUsd: 5,
      sharpeRatio: 1.0,
      maxDrawdownUsd: 50,
      profitFactor: 1.5,
      avgDurationMs: 30_000,
      windowStartMs: FIXED_TS,
      windowEndMs: FIXED_TS + 3_600_000,
    };

    const record = pipeline.createPromotion("strategy-a", "Full pipeline test");

    // hypothesis → backtest
    pipeline.advanceStage(record.promotionId);
    expect(record.currentStage).toBe("backtest");

    // backtest → review
    pipeline.advanceStage(record.promotionId, { performance: passingPerf });
    expect(record.currentStage).toBe("review");

    // review → canary (with approval)
    pipeline.approveReview(record.promotionId, true);
    pipeline.advanceStage(record.promotionId, { humanApproved: true });
    expect(record.currentStage).toBe("canary");

    // canary → scale
    pipeline.advanceStage(record.promotionId, { performance: passingPerf });
    expect(record.currentStage).toBe("scale");
    expect(record.active).toBe(false);
    expect(record.completedAtMs).not.toBeNull();
  });

  test("validateNoSkippedStages detects skipped stages", () => {
    const journal = new TradeJournal(config(), () => FIXED_TS);
    const pipeline = new PromotionPipeline(journal, config(), () => FIXED_TS);

    const record = pipeline.createPromotion("strategy-a", "Test");
    // Manually skip a stage.
    record.stageOutcomes.backtest = "skipped";

    const result = pipeline.validateNoSkippedStages(record.promotionId);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toContain("skipped");
    }
  });

  test("reject terminates a promotion", () => {
    const journal = new TradeJournal(config(), () => FIXED_TS);
    const pipeline = new PromotionPipeline(journal, config(), () => FIXED_TS);

    const record = pipeline.createPromotion("strategy-a", "Test");
    const rejected = pipeline.reject(record.promotionId, "Failed risk review");
    expect(rejected.active).toBe(false);
    expect(rejected.stageOutcomes.hypothesis).toBe("fail");
    expect(rejected.completedAtMs).not.toBeNull();
  });

  test("getActivePromotions returns only active", () => {
    const journal = new TradeJournal(config(), () => FIXED_TS);
    const pipeline = new PromotionPipeline(journal, config(), () => FIXED_TS);

    pipeline.createPromotion("strategy-a", "Active one");
    const rejected = pipeline.createPromotion("strategy-b", "Rejected one");
    pipeline.reject(rejected.promotionId, "Nope");

    const active = pipeline.getActivePromotions();
    expect(active.length).toBe(1);
    expect(active[0].strategyId).toBe("strategy-a");
  });
});

// ── LearningEngine ───────────────────────────────────────────────────

describe("LearningEngine", () => {
  test("records trades and passes to journal", () => {
    const engine = new LearningEngine(config(), () => FIXED_TS);

    engine.recordTrade(makeEntry({ strategyId: "strategy-a" }));
    engine.recordTrade(makeEntry({ strategyId: "strategy-b" }));

    expect(engine.journal.size).toBe(2);
  });

  test("runCycle produces no recommendations with insufficient data", () => {
    const engine = new LearningEngine(config(), () => FIXED_TS);

    // Only a few trades — not enough for analysis.
    for (let i = 0; i < 5; i++) {
      engine.recordFill({
        tradeId: `few-${i}`,
        strategyId: "strategy-a",
        regime: "trend",
        venue: "bybit",
        symbol: "BTC",
        side: "BUY",
        entryPrice: 100,
        exitPrice: 105,
        filledQuantity: 1,
        feesUsd: 0.1,
        enteredAtMs: FIXED_TS + i * 60_000,
        exitedAtMs: FIXED_TS + i * 60_000 + 30_000,
      });
    }

    const recs = engine.runCycle();
    // Should have at most a promotion suggestion (which needs more trades).
    // With only 5 trades, no decay or promotion recs.
    expect(recs.length).toBe(0);
  });

  test("runCycle generates decay recommendation for decaying strategy", () => {
    const cfg = config({
      minTradesForAnalysis: 5,
      decayWindowTrades: 10,
      decayPreviousWindowTrades: 10,
    });
    const engine = new LearningEngine(cfg, () => FIXED_TS);

    // Generate winning trades first.
    for (let i = 0; i < 15; i++) {
      engine.recordFill({
        tradeId: `good-${i}`,
        strategyId: "strategy-a",
        regime: "trend",
        venue: "bybit",
        symbol: "BTC",
        side: "BUY",
        entryPrice: 100,
        exitPrice: 105,
        filledQuantity: 1,
        feesUsd: 0.1,
        enteredAtMs: FIXED_TS + i * 60_000,
        exitedAtMs: FIXED_TS + i * 60_000 + 30_000,
      });
    }

    // Generate losing trades (edge decay).
    for (let i = 0; i < 10; i++) {
      engine.recordFill({
        tradeId: `bad-${i}`,
        strategyId: "strategy-a",
        regime: "trend",
        venue: "bybit",
        symbol: "BTC",
        side: "BUY",
        entryPrice: 100,
        exitPrice: 95,
        filledQuantity: 1,
        feesUsd: 0.5,
        enteredAtMs: FIXED_TS + (15 + i) * 60_000,
        exitedAtMs: FIXED_TS + (15 + i) * 60_000 + 30_000,
      });
    }

    const recs = engine.runCycle();
    const decayRecs = recs.filter(
      (r) => r.type === "demote" || r.type === "pause" || r.type === "adjust_parameters",
    );
    expect(decayRecs.length).toBeGreaterThan(0);
    expect(decayRecs[0].strategyId).toBe("strategy-a");
    expect(decayRecs[0].requiresApproval).toBe(true);
  });

  test("learning never mutates production directly", () => {
    const engine = new LearningEngine(config(), () => FIXED_TS);

    // Record trades and run cycles.
    for (let i = 0; i < 30; i++) {
      engine.recordFill({
        tradeId: `trade-${i}`,
        strategyId: "strategy-a",
        regime: "trend",
        venue: "bybit",
        symbol: "BTC",
        side: "BUY",
        entryPrice: 100,
        exitPrice: i % 3 === 0 ? 95 : 105,
        filledQuantity: 1,
        feesUsd: 0.1,
        enteredAtMs: FIXED_TS + i * 60_000,
        exitedAtMs: FIXED_TS + i * 60_000 + 30_000,
      });
    }

    const recs = engine.runCycle();

    // All recommendations should require approval.
    for (const rec of recs) {
      expect(rec.requiresApproval).toBe(true);
    }

    // No promotions should have been automatically created.
    const activePromos = engine.promotionPipeline.getActivePromotions();
    expect(activePromos.length).toBe(0);
  });

  test("acknowledgeRecommendation marks as acted upon", () => {
    const cfg = config({
      minTradesForAnalysis: 5,
      decayWindowTrades: 10,
      decayPreviousWindowTrades: 10,
    });
    const engine = new LearningEngine(cfg, () => FIXED_TS);

    for (let i = 0; i < 15; i++) {
      engine.recordFill({
        tradeId: `good-${i}`,
        strategyId: "strategy-a",
        regime: "trend",
        venue: "bybit",
        symbol: "BTC",
        side: "BUY",
        entryPrice: 100,
        exitPrice: 105,
        filledQuantity: 1,
        feesUsd: 0.1,
        enteredAtMs: FIXED_TS + i * 60_000,
        exitedAtMs: FIXED_TS + i * 60_000 + 30_000,
      });
    }
    for (let i = 0; i < 10; i++) {
      engine.recordFill({
        tradeId: `bad-${i}`,
        strategyId: "strategy-a",
        regime: "trend",
        venue: "bybit",
        symbol: "BTC",
        side: "BUY",
        entryPrice: 100,
        exitPrice: 95,
        filledQuantity: 1,
        feesUsd: 0.5,
        enteredAtMs: FIXED_TS + (15 + i) * 60_000,
        exitedAtMs: FIXED_TS + (15 + i) * 60_000 + 30_000,
      });
    }

    const recs = engine.runCycle();
    expect(recs.length).toBeGreaterThan(0);

    const rec = recs[0];
    expect(rec.actedUpon).toBe(false);

    const acked = engine.acknowledgeRecommendation(rec.recommendationId);
    expect(acked).toBe(true);
    expect(rec.actedUpon).toBe(true);

    // Should not appear in unacknowledged list.
    const unacked = engine.getRecommendations({ acknowledged: false });
    expect(unacked.find((r) => r.recommendationId === rec.recommendationId)).toBeUndefined();
  });

  test("initiatePromotion creates a promotion from a promote recommendation", () => {
    const cfg = config({
      minTradesForAnalysis: 5,
      decayWindowTrades: 10,
      decayPreviousWindowTrades: 10,
      promotionMinBacktestTrades: 5,
      promotionBacktestMinWinRate: 0.5,
      promotionBacktestMinSharpe: 0.0,
    });
    const engine = new LearningEngine(cfg, () => FIXED_TS);

    // Generate enough strong trades to trigger a promotion suggestion.
    for (let i = 0; i < 50; i++) {
      engine.recordFill({
        tradeId: `strong-${i}`,
        strategyId: "strategy-a",
        regime: "trend",
        venue: "bybit",
        symbol: "BTC",
        side: "BUY",
        entryPrice: 100,
        exitPrice: 105,
        filledQuantity: 1,
        feesUsd: 0.1,
        enteredAtMs: FIXED_TS + i * 60_000,
        exitedAtMs: FIXED_TS + i * 60_000 + 30_000,
      });
    }

    const recs = engine.runCycle();
    const promoteRec = recs.find((r) => r.type === "promote");

    if (promoteRec !== undefined) {
      const promo = engine.initiatePromotion(promoteRec.recommendationId);
      expect(promo).not.toBeNull();
      expect(promo!.currentStage).toBe("hypothesis");
      expect(promo!.active).toBe(true);
    }
  });

  test("getRecommendations filters correctly", () => {
    const engine = new LearningEngine(config(), () => FIXED_TS);

    // Manually add recommendations for testing filters.
    engine["recommendations"].push({
      recommendationId: "rec-1",
      type: "promote",
      strategyId: "strategy-a",
      summary: "Promote alpha",
      evidence: {},
      confidence: 0.8,
      requiresApproval: true,
      createdAtMs: FIXED_TS,
      actedUpon: false,
    });
    engine["recommendations"].push({
      recommendationId: "rec-2",
      type: "demote",
      strategyId: "strategy-b",
      summary: "Demote strategy-b",
      evidence: {},
      confidence: 0.9,
      requiresApproval: true,
      createdAtMs: FIXED_TS,
      actedUpon: false,
    });

    expect(engine.getRecommendations({ strategyId: "strategy-a" }).length).toBe(1);
    expect(engine.getRecommendations({ type: "demote" }).length).toBe(1);
    expect(engine.getRecommendations({ acknowledged: false }).length).toBe(2);

    engine.acknowledgeRecommendation("rec-1");
    expect(engine.getRecommendations({ acknowledged: false }).length).toBe(1);
    expect(engine.getRecommendations({ acknowledged: true }).length).toBe(1);
  });
});
