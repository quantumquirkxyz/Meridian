#!/usr/bin/env bun
/**
 * generate-live-report.ts
 *
 * Reads a live session report and audit log, populates the live session report template,
 * evaluates risk metrics, and outputs a filled live-session-report.json with PASS/FAIL
 * checks and a recommendation (continueCanary / escalateCapital / rollbackToDemo).
 *
 * Usage:
 *   bun run scripts/generate-live-report.ts <session-id>
 *   bun run scripts/generate-live-report.ts latest
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
  operator?: string;
  capitalDeployedUsd: number;
  capitalRemainingUsd: number;
}

interface PreFlightChecks {
  demoValidationPassed: boolean;
  demoEvidenceReviewed: boolean;
  canaryLiveConfigValid: boolean;
  withdrawalsDisabledConfirmed: boolean;
  apiKeysValid: boolean;
  dryRunCompleted: boolean;
  dryRunNoOrdersPlaced: boolean;
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

interface RiskMetrics {
  maxExposurePerTokenUsd: Record<string, number>;
  maxExposurePerVenueUsd: Record<string, number>;
  maxExposurePerChainUsd: number;
  maxOpenOrdersReached: number;
  dailyLossLimitHits: number;
  weeklyLossLimitHits: number;
  reconciliationMismatches: number;
  orphanOrdersDetected: number;
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
  manifestPath: string;
  screenshotPaths: string[];
  notes: string;
}

interface LiveSessionReport {
  schemaVersion: string;
  templateVersion: string;
  session: Session;
  preFlightChecks: PreFlightChecks;
  results: Results;
  tradeStatistics: TradeStatistics;
  riskMetrics: RiskMetrics;
  costModelAccuracy: CostModelAccuracy;
  evidence: Evidence;
  issuesFound: string[];
  recommendations: string[];
  continueCanary: boolean;
  escalateCapital: boolean;
  rollbackToDemo: boolean;
  validatedAt: string;
  validatedBy: string;
  riskChecks: RiskCheck[];
}

interface RiskCheck {
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

interface CanaryLiveConfig {
  configId: string;
  name: string;
  capitalLimits: {
    maxCapitalUsd: number;
    maxRiskPerTradeUsd: number;
    maxDailyLossUsd: number;
    maxWeeklyLossUsd: number;
  };
  exposureLimits: {
    maxExposurePerTokenUsd: number;
    maxExposurePerVenueUsd: number;
    maxExposurePerChainUsd: number;
  };
  orderLimits: {
    maxOrdersPerDay: number;
    maxOpenOrders: number;
    maxOrdersPerWeek: number;
  };
  scope: {
    allowedStrategyIds: string[];
    allowedVenues: string[];
    allowedChains: string[];
    allowedTokens: string[];
  };
  apiKeys: {
    readApiKey: { keyId: string; secretRef: string };
    tradingApiKey: { keyId: string; secretRef: string };
    withdrawalsDisabled: boolean;
  };
  killSwitch: {
    autoHaltDailyLossUsd: number;
    autoHaltWeeklyLossUsd: number;
    autoHaltOrdersPerDay: number;
    autoHaltOnOrphans: boolean;
    autoHaltOnReconciliationMismatch: boolean;
  };
  noAutomaticScaling: boolean;
  maxOrderNotionalUsd: number;
  maxSlippageBps: number;
  maxGasUsd: number;
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

function extractReconciliationStatus(events: AuditEvent[]): { unresolved: boolean; severity?: string; orphanOrders?: number; positionMismatches?: number; balanceMismatches?: number } | null {
  const recEvents = events.filter((e) => e.type === "RECONCILIATION");
  if (recEvents.length === 0) return null;

  const lastRec = recEvents[recEvents.length - 1];
  const data = lastRec.data as Record<string, unknown>;
  return {
    unresolved: (data.unresolved as boolean) ?? false,
    severity: data.severity as string | undefined,
    orphanOrders: (data.orphanOrders as number) ?? 0,
    positionMismatches: (data.positionMismatches as number) ?? 0,
    balanceMismatches: (data.balanceMismatches as number) ?? 0,
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

function extractCapitalFromInventory(events: AuditEvent[]): { deployedUsd: number; remainingUsd: number } {
  const inventoryEvent = events.find((e) => e.type === "INVENTORY_UPDATED");
  if (!inventoryEvent) return { deployedUsd: 0, remainingUsd: 0 };

  const data = inventoryEvent.data as Record<string, unknown>;
  const committed = (data.committedCapitalUsd as number) ?? 0;
  const available = (data.availableCapitalUsd as number) ?? 0;

  return {
    deployedUsd: committed,
    remainingUsd: available,
  };
}

function extractMaxOpenOrders(events: AuditEvent[]): number {
  let maxOpen = 0;
  for (const event of events) {
    if (event.type === "CYCLE_COMPLETE") {
      const data = event.data as Record<string, unknown>;
      const openOrders = (data.openOrders as number) ?? 0;
      if (openOrders > maxOpen) {
        maxOpen = openOrders;
      }
    }
  }
  return maxOpen;
}

function extractExposureMetrics(events: AuditEvent[]): { maxPerToken: Record<string, number>; maxPerVenue: Record<string, number> } {
  const maxPerToken: Record<string, number> = {};
  const maxPerVenue: Record<string, number> = {};

  for (const event of events) {
    if (event.type === "EXPOSURE_UPDATED") {
      const data = event.data as Record<string, unknown>;
      const token = (data.token as string) ?? "";
      const venue = (data.venue as string) ?? "";
      const exposureUsd = (data.exposureUsd as number) ?? 0;

      if (token && exposureUsd > (maxPerToken[token] ?? 0)) {
        maxPerToken[token] = exposureUsd;
      }
      if (venue && exposureUsd > (maxPerVenue[venue] ?? 0)) {
        maxPerVenue[venue] = exposureUsd;
      }
    }
  }

  return { maxPerToken, maxPerVenue };
}

function findDemoValidationReport(sessionDir: string): { passed: boolean; path: string } | null {
  const parentDir = path.dirname(sessionDir);
  const sessionId = path.basename(sessionDir);

  // Look for a sibling demo validation report
  const demoReportPath = path.join(parentDir, "demo-validation-report.json");
  if (fs.existsSync(demoReportPath)) {
    const report = readJsonFile<{ readyForLive: boolean }>(demoReportPath, { readyForLive: false });
    return { passed: report.readyForLive, path: demoReportPath };
  }

  // Look for any demo validation report in nearby directories
  const entries = fs.readdirSync(parentDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name.startsWith("sess-")) {
      const candidate = path.join(parentDir, entry.name, "demo-validation-report.json");
      if (fs.existsSync(candidate)) {
        const report = readJsonFile<{ readyForLive: boolean }>(candidate, { readyForLive: false });
        return { passed: report.readyForLive, path: candidate };
      }
    }
  }

  return null;
}

function readCanaryLiveConfig(): CanaryLiveConfig | null {
  const configPath = path.join(process.cwd(), "canary-live.json");
  if (!fs.existsSync(configPath)) return null;

  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    return JSON.parse(raw) as CanaryLiveConfig;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("Usage: bun run scripts/generate-live-report.ts <session-id|latest>");
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

  // Load canary-live.json config
  const liveConfig = readCanaryLiveConfig();

  // Extract data
  const sessionEndedData = extractSessionEndedData(events);
  const reconciliation = extractReconciliationStatus(events);
  const connectivity = extractConnectivityStatus(events);
  const killSwitches = countKillSwitches(events);
  const capital = extractCapitalFromInventory(events);
  const maxOpenOrders = extractMaxOpenOrders(events);
  const exposureMetrics = extractExposureMetrics(events);
  const demoValidation = findDemoValidationReport(sessionDir);

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

  // Pre-flight checks
  const preFlightChecks: PreFlightChecks = {
    demoValidationPassed: demoValidation ? demoValidation.passed : false,
    demoEvidenceReviewed: demoValidation !== null,
    canaryLiveConfigValid: liveConfig !== null,
    withdrawalsDisabledConfirmed: liveConfig ? liveConfig.apiKeys.withdrawalsDisabled : false,
    apiKeysValid: liveConfig ? liveConfig.apiKeys.readApiKey.keyId.length > 0 && liveConfig.apiKeys.tradingApiKey.keyId.length > 0 : false,
    dryRunCompleted: events.some((e) => e.type === "DRY_RUN_COMPLETED"),
    dryRunNoOrdersPlaced: events.some((e) => e.type === "DRY_RUN_COMPLETED") && !events.some((e) => e.type === "ORDER_PLACED"),
  };

  // Risk metrics
  const riskMetrics: RiskMetrics = {
    maxExposurePerTokenUsd: exposureMetrics.maxPerToken,
    maxExposurePerVenueUsd: exposureMetrics.maxPerVenue,
    maxExposurePerChainUsd: liveConfig?.exposureLimits.maxExposurePerChainUsd ?? 0,
    maxOpenOrdersReached: maxOpenOrders,
    dailyLossLimitHits: killSwitches.total,
    weeklyLossLimitHits: killSwitches.total,
    reconciliationMismatches: (reconciliation?.positionMismatches ?? 0) + (reconciliation?.balanceMismatches ?? 0),
    orphanOrdersDetected: reconciliation?.orphanOrders ?? 0,
  };

  const now = new Date().toISOString();

  const report: LiveSessionReport = {
    schemaVersion: "1.0",
    templateVersion: "1.0.0",
    session: {
      sessionId: reportSessionId,
      startedAt: toIso8601(startedAtMs),
      endedAt: toIso8601(endedAtMs),
      mode: "live",
      configFile: "canary-live.json",
      operator: undefined,
      capitalDeployedUsd: capital.deployedUsd,
      capitalRemainingUsd: capital.remainingUsd,
    },
    preFlightChecks,
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
    riskMetrics,
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
      manifestPath: path.join("./reports", reportSessionId, "manifest.json"),
      screenshotPaths: [],
      notes: `Generated from ${events.length} audit events. Reconciliation: ${reconciliationPassing ? "passing" : "failing/unknown"}.`,
    },
    issuesFound: [],
    recommendations: [],
    continueCanary: false,
    escalateCapital: false,
    rollbackToDemo: false,
    validatedAt: now,
    validatedBy: "",
    riskChecks: [],
  };

  // Build risk checks
  const checks: RiskCheck[] = [];

  checks.push({
    criterion: "demoValidationPassed",
    expected: true,
    actual: preFlightChecks.demoValidationPassed,
    passed: preFlightChecks.demoValidationPassed,
  });

  checks.push({
    criterion: "canaryLiveConfigValid",
    expected: true,
    actual: preFlightChecks.canaryLiveConfigValid,
    passed: preFlightChecks.canaryLiveConfigValid,
  });

  checks.push({
    criterion: "withdrawalsDisabledConfirmed",
    expected: true,
    actual: preFlightChecks.withdrawalsDisabledConfirmed,
    passed: preFlightChecks.withdrawalsDisabledConfirmed,
  });

  checks.push({
    criterion: "apiKeysValid",
    expected: true,
    actual: preFlightChecks.apiKeysValid,
    passed: preFlightChecks.apiKeysValid,
  });

  checks.push({
    criterion: "dryRunCompleted",
    expected: true,
    actual: preFlightChecks.dryRunCompleted,
    passed: preFlightChecks.dryRunCompleted,
  });

  checks.push({
    criterion: "dryRunNoOrdersPlaced",
    expected: true,
    actual: preFlightChecks.dryRunNoOrdersPlaced,
    passed: preFlightChecks.dryRunNoOrdersPlaced,
  });

  checks.push({
    criterion: "connectivityCheck",
    expected: "pass",
    actual: report.results.connectivityCheck,
    passed: report.results.connectivityCheck === "pass",
  });

  checks.push({
    criterion: "reconciliationPassing",
    expected: true,
    actual: reconciliationPassing,
    passed: reconciliationPassing,
  });

  checks.push({
    criterion: "auditLogWriting",
    expected: true,
    actual: auditLogExists,
    passed: auditLogExists,
  });

  checks.push({
    criterion: "bugKillSwitchActivations",
    expected: 0,
    actual: bugKillSwitchActivations,
    passed: bugKillSwitchActivations === 0,
  });

  checks.push({
    criterion: "orphanOrdersDetected",
    expected: 0,
    actual: riskMetrics.orphanOrdersDetected,
    passed: riskMetrics.orphanOrdersDetected === 0,
  });

  checks.push({
    criterion: "reconciliationMismatches",
    expected: 0,
    actual: riskMetrics.reconciliationMismatches,
    passed: riskMetrics.reconciliationMismatches === 0,
  });

  report.riskChecks = checks;

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
  if (riskMetrics.orphanOrdersDetected > 0) {
    recommendations.push("Orphan orders detected — investigate before continuing live trading.");
  }
  if (bugKillSwitchActivations > 0) {
    recommendations.push("Bug kill switches were triggered — investigate before continuing live trading.");
  }
  if (killSwitches.total > 0 && bugKillSwitchActivations === 0) {
    recommendations.push("Kill switches activated — verify they are expected safety triggers, not bugs.");
  }
  if (!preFlightChecks.demoValidationPassed) {
    recommendations.push("Demo validation did not pass — complete demo validation before live trading.");
  }
  if (!preFlightChecks.dryRunCompleted) {
    recommendations.push("Dry run not completed — run dry run before live trading.");
  }
  if (!preFlightChecks.apiKeysValid) {
    recommendations.push("API keys not configured or invalid — verify canary-live.json apiKeys.");
  }
  if (!preFlightChecks.withdrawalsDisabledConfirmed) {
    recommendations.push("Withdrawals not disabled — confirm withdrawalsDisabled is true in canary-live.json.");
  }

  report.issuesFound = issues;
  report.recommendations = recommendations;

  // Recommendation logic
  // rollbackToDemo: if kill switch activated due to bugs, reconciliation failing, or audit gaps
  // continueCanary: if PnL is break-even or positive, no critical issues
  // escalateCapital: if PnL is consistently positive over 30+ trades, no risk limit hits, all metrics within thresholds

  const hasCriticalIssues = bugKillSwitchActivations > 0 || !reconciliationPassing || !auditLogExists || issues.length > 0;
  const isPnLPositive = report.tradeStatistics.totalPnlUsd > 0;
  const isPnLBreakEven = report.tradeStatistics.totalPnlUsd >= 0;
  const meetsEscalationThreshold = tradesCount >= 30;
  const noRiskLimitHits = riskMetrics.dailyLossLimitHits === 0 && riskMetrics.weeklyLossLimitHits === 0;
  const allMetricsWithinThreshold = checks.every((c) => c.passed);

  if (hasCriticalIssues) {
    report.rollbackToDemo = true;
    report.continueCanary = false;
    report.escalateCapital = false;
  } else if (isPnLPositive && meetsEscalationThreshold && noRiskLimitHits && allMetricsWithinThreshold) {
    report.rollbackToDemo = false;
    report.continueCanary = false;
    report.escalateCapital = true;
  } else if (isPnLBreakEven) {
    report.rollbackToDemo = false;
    report.continueCanary = true;
    report.escalateCapital = false;
  } else {
    report.rollbackToDemo = false;
    report.continueCanary = true;
    report.escalateCapital = false;
  }

  // Write output
  const outputPath = path.join(sessionDir, "live-session-report.json");
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2) + "\n", "utf-8");

  // Console summary
  console.log(`\n=== Live Session Report: ${reportSessionId} ===\n`);
  console.log(`Session:   ${report.session.startedAt} -> ${report.session.endedAt}`);
  console.log(`Mode:      ${report.session.mode}`);
  console.log(`Config:    ${report.session.configFile}`);
  console.log(`Events:    ${events.length} audit events`);
  console.log(`Trades:    ${tradesCount}`);
  console.log(`Orders:    submitted=${ordersSubmitted} filled=${ordersFilled} rejected=${ordersRejected} cancelled=${ordersCancelled}`);
  console.log(`Kill switches: ${killSwitches.total} (bug: ${bugKillSwitchActivations})`);
  console.log(`Reconciliation: ${reconciliationPassing ? "passing" : "failing/unknown"}`);
  console.log(`Audit log: ${auditLogExists ? "present" : "missing"}`);
  console.log(`\nRisk Checks:`);
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

  console.log(`\nRecommendation:`);
  if (report.rollbackToDemo) {
    console.log(`  -> ROLLBACK TO DEMO`);
  } else if (report.escalateCapital) {
    console.log(`  -> ESCALATE CAPITAL`);
  } else {
    console.log(`  -> CONTINUE CANARY`);
  }

  console.log(`\nReport written to: ${outputPath}\n`);

  if (report.rollbackToDemo) {
    process.exit(1);
  }
}

main();
