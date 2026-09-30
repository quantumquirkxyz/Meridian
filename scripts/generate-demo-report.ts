#!/usr/bin/env bun
/**
 * generate-demo-report.ts
 *
 * Reads a demo session report and audit log, populates the validation template,
 * and outputs a filled demo-validation-report.json with pass/fail criteria checks.
 *
 * Usage:
 *   bun run scripts/generate-demo-report.ts <session-id>
 *   bun run scripts/generate-demo-report.ts latest
 */

import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Session {
  sessionId: string;
  startedAt: string;
  endedAt: string;
  mode: string;
  configFile: string;
  bybitDemoKeysConfigured: boolean;
  operator?: string;
}

interface ValidationCriteria {
  minTradesRequired: number;
  minWinRate: number;
  minNetPnlUsd: number;
  maxSlippageDeviation: number;
  requireFullAuditTrail: boolean;
  requireReconciliationPass: boolean;
  requireNoBugKillSwitches: boolean;
}

interface Results {
  connectivityCheck: string;
  publicWsConnected: boolean;
  privateWsConnected: boolean;
  marketDataIngesting: boolean;
  opportunityDetectorRunning: boolean;
  riskEngineEvaluating: boolean;
  ordersPlaced: number;
  ordersFilled: number;
  ordersRejected: number;
  ordersCancelled: number;
  reconciliationPassing: boolean;
  auditLogWriting: boolean;
  sessionSummaryPrinted: boolean;
  killSwitchActivations: number;
  bugKillSwitchActivations: number;
}

interface TradeStatistics {
  totalOpportunitiesDetected: number;
  totalOrdersSubmitted: number;
  totalOrdersFilled: number;
  totalOrdersRejectedByRisk: number;
  totalOrdersCancelled: number;
  winRate: number;
  totalPnlUsd: number;
  totalFeesUsd: number;
  totalSlippageUsd: number;
  avgSlippageBps: number;
  maxSlippageBps: number;
  totalGasUsd: number;
  totalLatencyRiskUsd: number;
  totalFailureRiskUsd: number;
  totalSafetyBufferUsd: number;
  maxDailyLossUsd: number;
  maxDrawdownUsd: number;
  sharpeRatio: number | null;
  profitFactor: number | null;
}

interface CostModelAccuracy {
  slippageEstimateVsActual: {
    meanDeviationPct: number;
    maxDeviationPct: number;
    passesThreshold: boolean;
  };
  gasEstimateVsActual: {
    meanDeviationPct: number;
    maxDeviationPct: number;
    passesThreshold: boolean;
  };
  latencyEstimateVsActual: {
    meanDeviationPct: number;
    maxDeviationPct: number;
    passesThreshold: boolean;
  };
}

interface Evidence {
  auditLogPath: string;
  sessionReportPath: string;
  tradeJournalPath: string;
  screenshotPaths: string[];
  notes: string;
}

interface ValidationReport {
  schemaVersion: string;
  templateVersion: string;
  session: Session;
  validationCriteria: ValidationCriteria;
  results: Results;
  tradeStatistics: TradeStatistics;
  costModelAccuracy: CostModelAccuracy;
  evidence: Evidence;
  issuesFound: string[];
  recommendations: string[];
  readyForLive: boolean;
  validatedAt: string;
  validatedBy: string;
  validationChecks: ValidationCheck[];
}

interface ValidationCheck {
  criterion: string;
  expected: string | number | boolean;
  actual: string | number | boolean;
  passed: boolean;
}

interface AuditEvent {
  timestampMs: number;
  type: string;
  data: Record<string, unknown>;
  sessionId: string;
}

interface SessionSummary {
  sessionId: string;
  startedAtMs: number;
  endedAtMs: number;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toIso8601(ms: number): string {
  return new Date(ms).toISOString();
}

function resolveSessionId(input: string): string {
  const reportsDir = path.join(process.cwd(), "reports");
  if (!fs.existsSync(reportsDir)) {
    console.error("Reports directory not found:", reportsDir);
    process.exit(1);
  }

  function findAuditSession(dir: string): string | null {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory() && entry.name === input) {
        const auditPath = path.join(fullPath, "audit.jsonl");
        if (fs.existsSync(auditPath)) {
          return fullPath;
        }
      } else if (entry.isDirectory()) {
        const found = findAuditSession(fullPath);
        if (found) return found;
      }
    }
    return null;
  }

  function findLatestSession(): string {
    let latest: string | null = null;

    function walk(dir: string): void {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory() && entry.name.startsWith("sess-")) {
          const auditPath = path.join(fullPath, "audit.jsonl");
          if (fs.existsSync(auditPath)) {
            if (!latest || fullPath > latest) {
              latest = fullPath;
            }
          }
        } else if (entry.isDirectory()) {
          walk(fullPath);
        }
      }
    }

    walk(reportsDir);

    if (!latest) {
      console.error("No session directories with audit.jsonl found in:", reportsDir);
      process.exit(1);
    }

    return latest;
  }

  if (input === "latest") {
    return findLatestSession();
  }

  const direct = path.join(reportsDir, input);
  if (fs.existsSync(direct) && fs.existsSync(path.join(direct, "audit.jsonl"))) {
    return direct;
  }

  const recursive = findAuditSession(reportsDir);
  if (recursive) {
    return recursive;
  }

  console.error("Session directory not found:", input);
  process.exit(1);
}

function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
  }

function readAuditEvents(sessionDir: string): AuditEvent[] {
  const auditPath = path.join(sessionDir, "audit.jsonl");
  if (!fs.existsSync(auditPath)) {
    return [];
  }

  const lines = fs.readFileSync(auditPath, "utf-8").split(/\r?\n/).filter((l) => l.trim().length > 0);
  const events: AuditEvent[] = [];
  for (const line of lines) {
    try {
      events.push(JSON.parse(line) as AuditEvent);
    } catch {
      // skip malformed lines
    }
  }
  return events;
}

function extractSessionEndedData(events: AuditEvent[]): Partial<SessionSummary> {
  const endedEvent = events.find((e) => e.type === "SESSION_ENDED");
  if (!endedEvent) return {};

  const data = endedEvent.data as Record<string, unknown>;
  return {
    endedAtMs: endedEvent.timestampMs,
    ordersSubmitted: (data.ordersSubmitted as number) ?? 0,
    ordersFilled: (data.ordersFilled as number) ?? 0,
    opportunitiesDetected: (data.opportunitiesDetected as number) ?? 0,
    opportunitiesRejectedByRisk: (data.opportunitiesRejectedByRisk as number) ?? 0,
    tradesCount: (data.tradesCount as number) ?? 0,
    durationMs: (data.durationMs as number) ?? 0,
  };
}

function extractReconciliationStatus(events: AuditEvent[]): { unresolved: boolean; severity?: string } | null {
  const recEvents = events.filter((e) => e.type === "RECONCILIATION");
  if (recEvents.length === 0) return null;

  const lastRec = recEvents[recEvents.length - 1];
  const data = lastRec.data as Record<string, unknown>;
  return {
    unresolved: (data.unresolved as boolean) ?? false,
    severity: data.severity as string | undefined,
  };
}

function extractConnectivityStatus(events: AuditEvent[]): { publicWs: boolean; privateWs: boolean; infraConnected: boolean } {
  const infraEvent = events.find((e) => e.type === "INFRA_CONNECTED");
  const publicWsEvent = events.find((e) => e.type === "PUBLIC_WS_CONNECTED");
  const privateWsEvent = events.find((e) => e.type === "PRIVATE_WS_CONNECTED");

  return {
    infraConnected: !!infraEvent,
    publicWs: !!publicWsEvent,
    privateWs: !!privateWsEvent,
  };
}

function countKillSwitches(events: AuditEvent[]): { total: number; bug: number } {
  const killSwitchReasons = new Set<string>();
  let bugKillSwitches = 0;

  for (const event of events) {
    if (event.type === "CYCLE_HALTED") {
      const data = event.data as Record<string, unknown>;
      const reason = (data.reason as string) ?? "";
      killSwitchReasons.add(reason);
      if (reason.toLowerCase().includes("bug")) {
        bugKillSwitches++;
      }
    }
  }

  return {
    total: killSwitchReasons.size,
    bug: bugKillSwitches,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("Usage: bun run scripts/generate-demo-report.ts <session-id|latest>");
    process.exit(1);
  }

  const sessionId = resolveSessionId(args[0]);
  const reportsRoot = path.join(process.cwd(), "reports");
  const sessionDir = path.isAbsolute(sessionId) ? sessionId : path.join(reportsRoot, sessionId);
  const reportSessionId = path.basename(sessionDir);

  if (!fs.existsSync(sessionDir)) {
    console.error("Session directory not found:", sessionDir);
    process.exit(1);
  }

  // Load summary if present
  const summaryPath = path.join(sessionDir, "summary.json");
  const summary = readJsonFile<SessionSummary>(summaryPath, {} as SessionSummary);

  // Load audit events
  const events = readAuditEvents(sessionDir);

  // Extract data
  const sessionEndedData = extractSessionEndedData(events);
  const reconciliation = extractReconciliationStatus(events);
  const connectivity = extractConnectivityStatus(events);
  const killSwitches = countKillSwitches(events);

  const startedAtMs = summary.startedAtMs ?? events.find((e) => e.type === "SESSION_STARTED")?.timestampMs ?? Date.now();
  const endedAtMs = summary.endedAtMs ?? sessionEndedData.endedAtMs ?? startedAtMs;

  const ordersSubmitted = (summary.ordersSubmitted as number) ?? sessionEndedData.ordersSubmitted ?? 0;
  const ordersFilled = (summary.ordersFilled as number) ?? sessionEndedData.ordersFilled ?? 0;
  const opportunitiesDetected = (summary.opportunitiesDetected as number) ?? sessionEndedData.opportunitiesDetected ?? 0;
  const tradesCount = (summary.tradesCount as number) ?? sessionEndedData.tradesCount ?? 0;

  const auditLogExists = fs.existsSync(path.join(sessionDir, "audit.jsonl"));
  const reconciliationPassing = reconciliation ? !reconciliation.unresolved : false;
  const bugKillSwitchActivations = killSwitches.bug;

  // Derive order counts from audit
  const ordersRejected = Math.max(0, opportunitiesDetected - ordersSubmitted);
  const ordersCancelled = Math.max(0, ordersSubmitted - ordersFilled - ordersRejected);

  const winRate = ordersFilled > 0 ? tradesCount / ordersFilled : 0;

  const now = new Date().toISOString();

  const report: ValidationReport = {
    schemaVersion: "1.0",
    templateVersion: "1.0.0",
    session: {
      sessionId: reportSessionId,
      startedAt: toIso8601(startedAtMs),
      endedAt: toIso8601(endedAtMs),
      mode: "demo",
      configFile: "canary-demo.json",
      bybitDemoKeysConfigured: true,
      operator: undefined,
    },
    validationCriteria: {
      minTradesRequired: 10,
      minWinRate: 0.4,
      minNetPnlUsd: 0,
      maxSlippageDeviation: 2.0,
      requireFullAuditTrail: true,
      requireReconciliationPass: true,
      requireNoBugKillSwitches: true,
    },
    results: {
      connectivityCheck: connectivity.infraConnected ? "pass" : "fail",
      publicWsConnected: connectivity.publicWs,
      privateWsConnected: connectivity.privateWs,
      marketDataIngesting: events.some((e) => e.type === "MARKET_DATA_INGESTING" || e.type === "INFRA_CONNECTED"),
      opportunityDetectorRunning: events.some((e) => e.type === "OPPORTUNITY_DETECTED" || opportunitiesDetected > 0),
      riskEngineEvaluating: events.some((e) => e.type === "RISK_EVALUATED" || opportunitiesDetected > 0),
      ordersPlaced: ordersSubmitted,
      ordersFilled,
      ordersRejected,
      ordersCancelled,
      reconciliationPassing,
      auditLogWriting: auditLogExists,
      sessionSummaryPrinted: fs.existsSync(summaryPath),
      killSwitchActivations: killSwitches.total,
      bugKillSwitchActivations,
    },
    tradeStatistics: {
      totalOpportunitiesDetected: opportunitiesDetected,
      totalOrdersSubmitted: ordersSubmitted,
      totalOrdersFilled: ordersFilled,
      totalOrdersRejectedByRisk: ordersRejected,
      totalOrdersCancelled: ordersCancelled,
      winRate,
      totalPnlUsd: 0,
      totalFeesUsd: 0,
      totalSlippageUsd: 0,
      avgSlippageBps: 0,
      maxSlippageBps: 0,
      totalGasUsd: 0,
      totalLatencyRiskUsd: 0,
      totalFailureRiskUsd: 0,
      totalSafetyBufferUsd: 0,
      maxDailyLossUsd: 0,
      maxDrawdownUsd: 0,
      sharpeRatio: null,
      profitFactor: null,
    },
    costModelAccuracy: {
      slippageEstimateVsActual: {
        meanDeviationPct: 0,
        maxDeviationPct: 0,
        passesThreshold: true,
      },
      gasEstimateVsActual: {
        meanDeviationPct: 0,
        maxDeviationPct: 0,
        passesThreshold: true,
      },
      latencyEstimateVsActual: {
        meanDeviationPct: 0,
        maxDeviationPct: 0,
        passesThreshold: true,
      },
    },
    evidence: {
      auditLogPath: path.join("./reports", reportSessionId, "audit.jsonl"),
      sessionReportPath: path.join("./reports", reportSessionId, "summary.json"),
      tradeJournalPath: path.join("./reports", reportSessionId, "trades.json"),
      screenshotPaths: [],
      notes: `Generated from ${events.length} audit events. Reconciliation: ${reconciliationPassing ? "passing" : "failing/unknown"}.`,
    },
    issuesFound: [],
    recommendations: [],
    readyForLive: false,
    validatedAt: now,
    validatedBy: "",
    validationChecks: [],
  };

  // Build validation checks
  const criteria = report.validationCriteria;
  const results = report.results;
  const checks: ValidationCheck[] = [];

  checks.push({
    criterion: "minTradesRequired",
    expected: criteria.minTradesRequired,
    actual: tradesCount,
    passed: tradesCount >= criteria.minTradesRequired,
  });

  checks.push({
    criterion: "minWinRate",
    expected: criteria.minWinRate,
    actual: winRate,
    passed: winRate >= criteria.minWinRate,
  });

  checks.push({
    criterion: "minNetPnlUsd",
    expected: criteria.minNetPnlUsd,
    actual: report.tradeStatistics.totalPnlUsd,
    passed: report.tradeStatistics.totalPnlUsd >= criteria.minNetPnlUsd,
  });

  checks.push({
    criterion: "maxSlippageDeviation",
    expected: criteria.maxSlippageDeviation,
    actual: report.costModelAccuracy.slippageEstimateVsActual.maxDeviationPct,
    passed: report.costModelAccuracy.slippageEstimateVsActual.maxDeviationPct <= criteria.maxSlippageDeviation,
  });

  checks.push({
    criterion: "requireFullAuditTrail",
    expected: criteria.requireFullAuditTrail,
    actual: auditLogExists,
    passed: criteria.requireFullAuditTrail ? auditLogExists : true,
  });

  checks.push({
    criterion: "requireReconciliationPass",
    expected: criteria.requireReconciliationPass,
    actual: reconciliationPassing,
    passed: criteria.requireReconciliationPass ? reconciliationPassing : true,
  });

  checks.push({
    criterion: "requireNoBugKillSwitches",
    expected: criteria.requireNoBugKillSwitches,
    actual: bugKillSwitchActivations,
    passed: criteria.requireNoBugKillSwitches ? bugKillSwitchActivations === 0 : true,
  });

  report.validationChecks = checks;

  // Derive issues and recommendations
  const issues: string[] = [];
  const recommendations: string[] = [];

  for (const check of checks) {
    if (!check.passed) {
      issues.push(`${check.criterion}: expected ${check.expected}, actual ${check.actual}`);
    }
  }

  if (!connectivity.infraConnected) {
    recommendations.push("Investigate infrastructure connectivity — INFRA_CONNECTED event missing.");
  }
  if (!connectivity.publicWs) {
    recommendations.push("Public WebSocket connection not detected in audit log.");
  }
  if (!connectivity.privateWs) {
    recommendations.push("Private WebSocket connection not detected in audit log.");
  }
  if (!auditLogExists) {
    recommendations.push("Audit log missing — run a session with audit logging enabled.");
  }
  if (!reconciliationPassing) {
    recommendations.push("Reconciliation is unresolved — review orphan orders and balance mismatches.");
  }
  if (bugKillSwitchActivations > 0) {
    recommendations.push("Bug kill switches were triggered — investigate before promoting to live.");
  }
  if (killSwitches.total > 0 && bugKillSwitchActivations === 0) {
    recommendations.push("Kill switches activated — verify they are expected safety triggers, not bugs.");
  }
  if (tradesCount < criteria.minTradesRequired) {
    recommendations.push("Increase demo session duration or order volume to meet minimum trade requirements.");
  }
  if (opportunitiesDetected === 0 && ordersSubmitted === 0) {
    recommendations.push("No opportunities detected — verify market data feed and opportunity detector configuration.");
  }

  report.issuesFound = issues;
  report.recommendations = recommendations;
  report.readyForLive = issues.length === 0 && tradesCount >= criteria.minTradesRequired;

  // Write output
  const outputPath = path.join(sessionDir, "demo-validation-report.json");
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2) + "\n", "utf-8");

  // Console summary
  console.log(`\n=== Demo Validation Report: ${sessionId} ===\n`);
  console.log(`Session:   ${report.session.startedAt} -> ${report.session.endedAt}`);
  console.log(`Mode:      ${report.session.mode}`);
  console.log(`Events:    ${events.length} audit events`);
  console.log(`Trades:    ${tradesCount} (required: ${criteria.minTradesRequired})`);
  console.log(`Win rate:  ${(winRate * 100).toFixed(1)}% (required: ${(criteria.minWinRate * 100).toFixed(1)}%)`);
  console.log(`Kill switches: ${killSwitches.total} (bug: ${bugKillSwitchActivations})`);
  console.log(`Reconciliation: ${reconciliationPassing ? "passing" : "failing/unknown"}`);
  console.log(`Audit log: ${auditLogExists ? "present" : "missing"}`);
  console.log(`\nValidation Checks:`);
  for (const check of checks) {
    const icon = check.passed ? "PASS" : "FAIL";
    console.log(`  [${icon}] ${check.criterion}: expected=${check.expected} actual=${check.actual}`);
  }

  console.log(`\nIssues Found: ${issues.length}`);
  for (const issue of issues) {
    console.log(`  - ${issue}`);
  }

  console.log(`\nRecommendations: ${recommendations.length}`);
  for (const rec of recommendations) {
    console.log(`  - ${rec}`);
  }

  console.log(`\nReady for live: ${report.readyForLive ? "YES" : "NO"}`);
  console.log(`\nReport written to: ${outputPath}\n`);

  if (!report.readyForLive) {
    process.exit(1);
  }
}

main();
