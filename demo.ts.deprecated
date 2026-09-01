/**
 * Meridian GammaSession Demo
 *
 * Exercises the full go-live canary lifecycle:
 *   1. Start session
 *   2. Run multiple trading cycles (normal regime)
 *   3. Simulate fill events
 *   4. Trigger regime adaptation (high volatility → reduce-only)
 *   5. Run learning cycles
 *   6. Trigger kill switch (drawdown regime)
 *   7. Stop session and produce full summary with audit trail + reports
 *
 * Run with: bun run demo.ts
 */

import {
  GammaSession,
  type GammaCycleInput,
  type GammaSessionSummary,
} from "./packages/core/src/index.ts";
import { DEFAULT_CANARY_CONFIG } from "./packages/contracts/src/index.ts";
import type { OrderIntent, ApprovedRiskDecision } from "./packages/contracts/src/index.ts";

// ── Fixed clock for deterministic output ──────────────────────────────
const TS = 1_700_000_000_000;
let tick = 0;
function now(): number {
  return TS + tick * 1000;
}
function advance(days: number): void {
  tick += days * 86_400;
}

// ── Helpers ───────────────────────────────────────────────────────────

function makeIntent(id: string, overrides: Partial<OrderIntent> = {}): OrderIntent {
  return {
    idempotencyKey: id,
    opportunityId: `opp-${id}`,
    venue: "bybit",
    symbol: "BTC",
    side: "BUY",
    quantity: 0.01,
    price: 100,
    quoteCurrency: "USDT",
    createdAtMs: now(),
    expiresAtMs: now() + 60_000,
    limits: { maxSlippageBps: 20 },
    ...overrides,
  };
}

function makeDecision(id: string, overrides: Partial<ApprovedRiskDecision> = {}): ApprovedRiskDecision {
  return {
    decision: "APPROVE",
    orderIntentIdempotencyKey: id,
    evaluatedAtMs: now(),
    approvedSize: 0.01,
    approvedLimits: { maxSlippageBps: 20 },
    expiresAtMs: now() + 60_000,
    ...overrides,
  };
}

function printHeader(title: string): void {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  ${title}`);
  console.log(`${"═".repeat(60)}`);
}

function printStatus(session: GammaSession): void {
  const s = session.status;
  console.log(`  running: ${s.running}  |  mode: ${s.mode}  |  state: ${s.state}`);
  console.log(`  kill switch: ${s.killSwitchActive ? "ACTIVE" : "inactive"}  |  auto-kill: ${s.autoKillTrigger ?? "none"}`);
  console.log(`  open orders: ${s.openOrders}  |  today: ${s.ordersToday}  |  week: ${s.ordersThisWeek}`);
  console.log(`  capital deployed: $${s.capitalDeployedUsd.toFixed(2)}  |  remaining: $${s.capitalRemainingUsd.toFixed(2)}`);
  console.log(`  PnL today: $${s.dailyPnlUsd.toFixed(2)}  |  PnL week: $${s.weeklyPnlUsd.toFixed(2)}`);
  console.log(`  orphans: ${s.orphanOrderCount}  |  reconciliation: ${s.reconciliationUnresolved ? "UNRESOLVED" : "ok"}`);
}

// ── Main Demo ─────────────────────────────────────────────────────────

function runDemo(): void {
  const session = new GammaSession({
    now,
    canaryConfig: {
      ...DEFAULT_CANARY_CONFIG,
      capitalLimits: {
        maxCapitalUsd: 500,
        maxRiskPerTradeUsd: 25,
        maxDailyLossUsd: 100,
        maxWeeklyLossUsd: 200,
      },
    },
    learningCycleInterval: 3, // Run learning every 3 cycles
  });

  // ── Phase 1: Start ────────────────────────────────────────────────
  printHeader("PHASE 1 — Start Canary Session");
  session.start();
  printStatus(session);

  // ── Phase 2: Normal Trading Cycles ────────────────────────────────
  printHeader("PHASE 2 — Normal Trading (trend regime)");
  const normalRegimeInput = {
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
    nowMs: now(),
  };

  for (let i = 1; i <= 5; i++) {
    advance(1);
    const intentId = `trade-${i}`;
    const result = session.runCycle({
      regime: { ...normalRegimeInput, nowMs: now() },
      market: { bid: 99, ask: 101, mid: 100, liquidityUsd: 10_000 },
      intents: [makeIntent(intentId)],
      riskDecisions: [makeDecision(intentId)],
    });

    console.log(`\n  Cycle ${i}: regime=${result.regimeClassification?.regime} confidence=${result.regimeClassification?.confidence.toFixed(2)}`);
    console.log(`    submitted: ${result.submittedCount}  blocked: ${result.blockedCount}  regimeBlocked: ${result.regimeBlockedCount}`);
    if (result.learningCycleRan) {
      console.log(`    learning: ran — ${result.learningRecommendations.length} recommendations`);
    }

    // Simulate fills with random PnL
    const pnl = (Math.random() - 0.4) * 10; // slight positive bias
    session.notifyOrderResolved(intentId, "FILLED", parseFloat(pnl.toFixed(2)));
  }

  printStatus(session);

  // ── Phase 3: High Volatility Regime ───────────────────────────────
  printHeader("PHASE 3 — High Volatility Regime → reduce-only");
  advance(1);
  const highVolRegime = {
    ...normalRegimeInput,
    realizedVolatility: 1.5,
    nowMs: now(),
  };
  const hvResult = session.runCycle({
    regime: highVolRegime,
    market: { bid: 95, ask: 105, mid: 100, liquidityUsd: 5_000 },
    intents: [makeIntent("hv-1")],
    riskDecisions: [makeDecision("hv-1")],
  });

  console.log(`  regime: ${hvResult.regimeClassification?.regime} → mode: ${session.status.mode}`);
  console.log(`  emergency action: ${hvResult.emergencyAction ?? "none"}`);
  printStatus(session);

  // ── Phase 4: Gas Spike → Trading Disabled ─────────────────────────
  printHeader("PHASE 4 — Gas Spike Regime → trading blocked");
  advance(1);
  const gasSpikeRegime = {
    ...normalRegimeInput,
    gasPriceUsd: 100,
    nowMs: now(),
  };
  const gsResult = session.runCycle({
    regime: gasSpikeRegime,
    market: { bid: 99, ask: 101, mid: 100, liquidityUsd: 10_000 },
    intents: [makeIntent("gas-1")],
    riskDecisions: [makeDecision("gas-1")],
  });

  console.log(`  regime: ${gsResult.regimeClassification?.regime}`);
  console.log(`  regime blocked: ${gsResult.regimeBlockedCount} orders`);

  // ── Phase 5: Resume Normal + Learning ─────────────────────────────
  printHeader("PHASE 5 — Resume Normal + Learning Cycles");
  for (let i = 6; i <= 8; i++) {
    advance(1);
    const intentId = `trade-${i}`;
    const result = session.runCycle({
      regime: { ...normalRegimeInput, nowMs: now() },
      market: { bid: 99, ask: 101, mid: 100, liquidityUsd: 10_000 },
      intents: [makeIntent(intentId)],
      riskDecisions: [makeDecision(intentId)],
    });
    const pnl = (Math.random() - 0.4) * 8;
    session.notifyOrderResolved(intentId, "FILLED", parseFloat(pnl.toFixed(2)));

    if (result.learningCycleRan) {
      console.log(`  Cycle ${i}: learning ran — ${result.learningRecommendations.length} recommendations`);
    }
  }

  // ── Phase 6: Drawdown → Kill Switch ───────────────────────────────
  printHeader("PHASE 6 — Drawdown Regime → Kill Switch Activated");
  advance(1);
  const drawdownRegime = {
    ...normalRegimeInput,
    cumulativePnlUsd: -150,
    nowMs: now(),
  };
  const ddResult = session.runCycle({
    regime: drawdownRegime,
    market: { bid: 99, ask: 101, mid: 100, liquidityUsd: 10_000 },
    intents: [makeIntent("dd-1")],
    riskDecisions: [makeDecision("dd-1")],
  });

  console.log(`  regime: ${ddResult.regimeClassification?.regime}`);
  console.log(`  emergency action: ${ddResult.emergencyAction}`);
  console.log(`  kill switch active: ${session.status.killSwitchActive}`);

  // Attempt to trade while halted
  console.log(`\n  Attempting trade while halted...`);
  const haltedResult = session.runCycle({
    regime: { ...normalRegimeInput, nowMs: now() },
    market: { bid: 99, ask: 101, mid: 100, liquidityUsd: 10_000 },
    intents: [makeIntent("blocked-1")],
    riskDecisions: [makeDecision("blocked-1")],
  });
  console.log(`  Result: ok=${haltedResult.ok} error="${haltedResult.error ?? "none"}"`);

  // ── Phase 7: Stop & Summary ───────────────────────────────────────
  printHeader("PHASE 7 — Stop Session & Generate Report");
  session.stop();

  const summary: GammaSessionSummary = session.getSessionSummary();

  console.log(`  completedNormally: ${summary.completedNormally}`);
  console.log(`  journal entries: ${summary.journalEntryCount}`);
  console.log(`  audit events: ${summary.auditEventCount}`);
  console.log(`  regime changes: ${summary.regimeChangeHistory.length}`);
  console.log(`  learning recommendations: ${summary.learningRecommendations.length}`);
  console.log(`  active promotions: ${summary.activePromotions.length}`);

  console.log(`\n  Daily Report:`);
  if (summary.dailyReport) {
    const r = summary.dailyReport;
    console.log(`    trades: ${r.totalTrades}  win rate: ${(r.winRate * 100).toFixed(0)}%`);
    console.log(`    net PnL: $${r.totalNetPnlUsd.toFixed(2)}  fees: $${r.totalFeesUsd.toFixed(2)}`);
  }

  console.log(`\n  Exported Reports:`);
  if (summary.exportedReports.dailyJson) {
    console.log(`    JSON: ${summary.exportedReports.dailyJson.length} chars`);
  }
  if (summary.exportedReports.dailyCsv) {
    console.log(`    CSV: ${summary.exportedReports.dailyCsv.length} chars`);
  }
  if (summary.exportedReports.dailyTxt) {
    console.log(`    TXT preview:`);
    const lines = summary.exportedReports.dailyTxt.split("\n").slice(0, 8);
    lines.forEach((l) => console.log(`      ${l}`));
  }

  printHeader("DEMO COMPLETE");
}

runDemo();
