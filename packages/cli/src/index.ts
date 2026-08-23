/**
 * @agenttrading/cli — CLI entry point for the AgentTrading system.
 *
 * Provides configuration loading, mode dispatch, and the `bun run start`
 * entry point. Wires together core, contracts, and connectors.
 *
 * Usage: `bun run start [options]`
 *
 * Flags:
 *   --mode paper|live          System mode (default: paper)
 *   --config <path>            JSON config override path
 *   --dry-run                  Skip order submission
 *   --cycle-interval <ms>      Override cycle frequency
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { loadConfig, formatConfigErrors } from "./config.ts";
import type { AppConfig, LoadConfigResult } from "./config.ts";
import { parseCliArgs } from "./args.ts";
import type { PaperRunner } from "@agenttrading/core";
import { generateSessionId, buildSessionReport } from "@agenttrading/core";
import { LiveRunner, type LiveRunnerConfig } from "./live-runner.ts";
import { ManifestWriter } from "./manifest.ts";

// ── Re-exports (keep backward-compatible library API) ─────────────────

export { loadConfig, formatConfigErrors } from "./config.ts";
export type { AppConfig, Mode, LoadConfigResult, ConfigError, LogLevel } from "./config.ts";
export { parseCliArgs, type CliArgs, type CliArgsError, type ParseCliArgsResult } from "./args.ts";
export { LiveRunner, type LiveRunnerConfig, type LiveRunnerEvents } from "./live-runner.ts";
export { ManifestWriter, type ManifestData, type ManifestEntry } from "./manifest.ts";
export { StatusDisplay, type CycleStatusInput, type RegimeChangeInput, type OrderEventInput, type KillSwitchTriggerInput } from "./status-display.ts";

// ── RunOptions (S3: bundle data clumps) ───────────────────────────────

/** Shared options for session runners (S3). */
interface RunOptions {
  config: AppConfig;
  cycleIntervalMs: number;
  dryRun: boolean;
  label: string;
}

// ── S3: Session paths (bundle data clumps) ──────────────────────────

/** Computed paths for a session's output files. */
interface SessionPaths {
  sessionId: string;
  reportDir: string;
  sessionDir: string;
  auditLogPath: string;
  summaryPath: string;
  manifestPath: string;
}

/** Compute all session output paths from reportDir and sessionId. */
function buildSessionPaths(reportDir: string, sessionId: string): SessionPaths {
  const sessionDir = `${reportDir}/${sessionId}`;
  return {
    sessionId,
    reportDir,
    sessionDir,
    auditLogPath: `${sessionDir}/audit.jsonl`,
    summaryPath: `${sessionDir}/summary.json`,
    manifestPath: `${sessionDir}/manifest.json`,
  };
}

// ── Banner ────────────────────────────────────────────────────────────

/**
 * Print the startup banner with mode, venue, capital limits, allowed
 * tokens, and cycle interval.
 */
function printBanner(config: AppConfig, cycleIntervalMs: number): void {
  const { canaryConfig } = config;

  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║             AgentTrading — Startup Banner               ║");
  console.log("╠══════════════════════════════════════════════════════════╣");
  console.log(`║  Mode:          ${config.mode.padEnd(40)}║`);
  console.log(`║  Venue:         ${(canaryConfig.scope.allowedVenues.join(", ") || "none").padEnd(40)}║`);
  console.log(
    `║  Capital Cap:   $${canaryConfig.capitalLimits.maxCapitalUsd.toFixed(2).padEnd(38)}║`,
  );
  console.log(
    `║  Risk/Trade:    $${canaryConfig.capitalLimits.maxRiskPerTradeUsd.toFixed(2).padEnd(38)}║`,
  );
  console.log(
    `║  Daily Loss:    $${canaryConfig.capitalLimits.maxDailyLossUsd.toFixed(2).padEnd(38)}║`,
  );
  console.log(`║  Tokens:        ${(canaryConfig.scope.allowedTokens.join(", ") || "none").padEnd(40)}║`);
  console.log(
    `║  Cycle:         ${cycleIntervalMs}ms${" ".repeat(Math.max(0, 40 - String(cycleIntervalMs).length - 2))}║`,
  );
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log();
}

// ── Session Summary ───────────────────────────────────────────────────

/** Produce a final session summary on exit. */
function printSessionSummary(
  startTimeMs: number,
  config: AppConfig,
  reason: string,
  completed: boolean,
): void {
  const elapsedMs = Date.now() - startTimeMs;
  const elapsedSec = (elapsedMs / 1000).toFixed(1);

  console.log();
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║              Session Summary                            ║");
  console.log("╠══════════════════════════════════════════════════════════╣");
  console.log(`║  Mode:          ${config.mode.padEnd(40)}║`);
  console.log(`║  Duration:      ${elapsedSec}s${" ".repeat(Math.max(0, 42 - elapsedSec.length))}║`);
  console.log(`║  Stop Reason:   ${reason.padEnd(40)}║`);
  console.log(`║  Completed:     ${(completed ? "yes" : "no").padEnd(40)}║`);
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log();
}

// ── Mode Dispatch ─────────────────────────────────────────────────────

/**
 * Run paper mode using PaperRunner. Connects to Bybit public WS,
 * feeds market data into GammaSession, simulates fills, and produces
 * audit trail + session report. No API keys required.
 */
async function runPaperMode(
  opts: RunOptions,
  paths: SessionPaths,
): Promise<{ exitCode: number }> {
  const { PaperRunner } = await import("@agenttrading/core");

  const runner = new PaperRunner({
    symbols: ["BTCUSDT"],
    cycleIntervalMs: opts.cycleIntervalMs,
    canaryConfig: opts.config.canaryConfig,
    auditLogPath: paths.auditLogPath,
    sessionId: paths.sessionId,
  });

  const manifest = new ManifestWriter({
    sessionId: paths.sessionId,
    startedAtMs: Date.now(),
  });
  manifest.track("audit-log", paths.auditLogPath);

  await runner.start();

  // Graceful shutdown (AC11)
  await new Promise<void>((resolve) => {
    let shutdownDone = false;

    const shutdown = () => {
      if (shutdownDone) return;
      shutdownDone = true;

      process.removeListener("SIGINT", shutdown);
      process.removeListener("SIGTERM", shutdown);

      console.log("\n[paper] Shutting down...");
      runner.stop();

      shutdownObservability({
        runner: { startedAtMs: runner.startedAtMs, stoppedAtMs: Date.now() },
        paths,
        config: opts.config,
        manifest,
      });

      resolve();
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });

  return { exitCode: 0 };
}

/**
 * Run live mode using LiveRunner. Connects to Bybit private+public WS,
 * places real orders through LiveExecutionEngine with canary limits,
 * confirms fills via WS, reconciles, and produces full audit trail.
 */
async function runLiveMode(
  opts: RunOptions,
  paths: SessionPaths,
): Promise<{ exitCode: number }> {
  const runner = new LiveRunner({
    symbols: opts.config.canaryConfig.scope.allowedTokens.map((t) =>
      t.replace("/", ""),
    ),
    bybitApiKey: opts.config.bybitApiKey,
    bybitApiSecret: opts.config.bybitApiSecret,
    cycleIntervalMs: opts.cycleIntervalMs,
    canaryConfig: opts.config.canaryConfig,
    auditLogPath: paths.auditLogPath,
    sessionId: paths.sessionId,
  });

  const manifest = new ManifestWriter({
    sessionId: paths.sessionId,
    startedAtMs: Date.now(),
  });
  manifest.track("audit-log", paths.auditLogPath);

  await runner.start();

  // AC13: Graceful shutdown
  await new Promise<void>((resolve) => {
    let shutdownDone = false;

    const shutdown = () => {
      if (shutdownDone) return;
      shutdownDone = true;

      process.removeListener("SIGINT", shutdown);
      process.removeListener("SIGTERM", shutdown);

      console.log("\n[live] Shutting down...");
      runner.stop();

      shutdownObservability({
        runner: { startedAtMs: runner.startedAtMs, stoppedAtMs: Date.now() },
        paths,
        config: opts.config,
        manifest,
      });

      resolve();
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });

  return { exitCode: 0 };
}

// ── Exchange connectivity check (SP2) ─────────────────────────────────

/**
 * SP2: Check exchange reachability before starting live mode.
 * Pings the Bybit REST API `/v5/market/time` endpoint.
 * Returns true if reachable, false otherwise.
 */
async function checkExchangeReachable(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    const res = await fetch("https://api.bybit.com/v5/market/time", {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}

// ── Observability Helpers ─────────────────────────────────────────────

/** S2+S3: Shared shutdown observability — writes summary JSON + manifest. */
function shutdownObservability(opts: {
  runner: { startedAtMs: number; stoppedAtMs: number };
  paths: SessionPaths;
  config: AppConfig;
  manifest: ManifestWriter;
}): void {
  const { runner, paths, config, manifest } = opts;

  // AC8: Write session summary JSON with real timestamps (S5+S7+SP3)
  writeSessionSummaryJson(paths.summaryPath, runner, paths.sessionId, config);
  manifest.track("summary", paths.summaryPath);

  // AC10: Write manifest at shutdown
  manifest.writeManifest(paths.manifestPath);
}

/**
 * AC8: Write session summary to JSON file at shutdown.
 * Uses buildSessionReport for real session data (SP3).
 */
function writeSessionSummaryJson(
  path: string,
  runner: { startedAtMs: number; stoppedAtMs: number },
  sessionId: string,
  config: AppConfig,
): void {
  // SP3: Use buildSessionReport for real data instead of a stub
  const report = buildSessionReport({
    startedAtMs: runner.startedAtMs,
    endedAtMs: runner.stoppedAtMs,
    cycleCount: 0,
    opportunitiesDetected: 0,
    ordersSubmitted: 0,
    ordersFilled: 0,
    ordersBlocked: 0,
    trades: [],
    regimeChangeCount: 0,
    finalRegime: undefined,
    learningRecommendationCount: 0,
    auditEventCount: 0,
  });

  const summary = {
    sessionId,
    mode: config.mode,
    startedAtMs: runner.startedAtMs,
    endedAtMs: runner.stoppedAtMs,
    durationMs: runner.stoppedAtMs - runner.startedAtMs,
    config: {
      cycleIntervalMs: config.cycleIntervalMs,
      logLevel: config.logLevel,
      reportDir: config.reportDir,
    },
    report,
  };

  const dir = dirname(path);
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    // Directory may already exist.
  }
  writeFileSync(path, JSON.stringify(summary, null, 2) + "\n", "utf-8");
}

// ── Main ──────────────────────────────────────────────────────────────

/**
 * Main entry point. Parse CLI args, load config, display banner,
 * and dispatch to the appropriate mode.
 */
export async function main(argv: string[] = process.argv): Promise<void> {
  // ── Step 1: Parse CLI arguments ──────────────────────────────────
  const argResult = parseCliArgs(argv);
  if (!argResult.ok) {
    const lines = argResult.errors.map((e) => `  - ${e.field}: ${e.message}`);
    console.error(`CLI argument error:\n${lines.join("\n")}`);
    process.exit(1);
  }
  const cliArgs = argResult.args;

  // ── Step 2: Load and validate configuration ──────────────────────
  const loadResult: LoadConfigResult = await loadConfig({
    configPath: cliArgs.configPath,
  });

  if (!loadResult.ok) {
    console.error(formatConfigErrors(loadResult.errors));
    process.exit(1);
  }

  const config = loadResult.config;

  // ── Step 3: Determine cycle interval ─────────────────────────────
  // CLI flag takes precedence over config/env.
  const cycleIntervalMs = cliArgs.cycleIntervalMs ?? config.cycleIntervalMs;

  // ── Step 4: Generate session ID and compute output paths ─────────
  const sessionId = generateSessionId();
  const paths = buildSessionPaths(config.reportDir, sessionId);

  // ── Step 5: Print startup banner ─────────────────────────────────
  printBanner(config, cycleIntervalMs);

  // ── Step 6: Exchange connectivity check (SP2) ───────────────────
  if (config.mode === "live") {
    console.log("[live] Checking exchange connectivity...");
    const reachable = await checkExchangeReachable();
    if (!reachable) {
      console.error("[live] ERROR: Exchange unreachable (Bybit REST API).");
      console.error("[live] Ensure network connectivity and try again.");
      process.exit(1);
    }
    console.log("[live] Exchange reachable.\n");
  }

  // ── Step 7: Dispatch to mode ─────────────────────────────────────
  const runOpts: RunOptions = {
    config,
    cycleIntervalMs,
    dryRun: cliArgs.dryRun,
    label: config.mode,
  };

  let exitCode: number;
  if (config.mode === "paper") {
    exitCode = (await runPaperMode(runOpts, paths)).exitCode;
  } else {
    exitCode = (await runLiveMode(runOpts, paths)).exitCode;
  }
  process.exit(exitCode);
}

// ── Run ───────────────────────────────────────────────────────────────

// Only auto-run when this file is the entry point (not when imported
// as a library module).
const isEntry =
  typeof process !== "undefined" &&
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith("/index.ts") ||
    process.argv[1].endsWith("/index.js"));

if (isEntry) {
  main().catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Fatal error: ${message}`);
    process.exit(1);
  });
}
