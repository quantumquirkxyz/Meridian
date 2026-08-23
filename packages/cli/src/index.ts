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

import { loadConfig, formatConfigErrors } from "./config.ts";
import type { AppConfig, LoadConfigResult } from "./config.ts";
import { parseCliArgs } from "./args.ts";
import type { PaperRunner } from "@agenttrading/core";

// ── Re-exports (keep backward-compatible library API) ─────────────────

export { loadConfig, formatConfigErrors } from "./config.ts";
export type { AppConfig, Mode, LoadConfigResult, ConfigError, LogLevel } from "./config.ts";
export { parseCliArgs, type CliArgs, type CliArgsError, type ParseCliArgsResult } from "./args.ts";

// ── RunOptions (S3: bundle data clumps) ───────────────────────────────

/** Shared options for session runners (S3). */
interface RunOptions {
  config: AppConfig;
  cycleIntervalMs: number;
  dryRun: boolean;
  label: string;
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
async function runPaperMode(opts: RunOptions): Promise<{ exitCode: number }> {
  const { PaperRunner } = await import("@agenttrading/core");

  const runner = new PaperRunner({
    symbols: ["BTCUSDT"],
    cycleIntervalMs: opts.cycleIntervalMs,
    canaryConfig: opts.config.canaryConfig,
    auditLogPath: `./reports/paper-session-${Date.now()}.jsonl`,
  });

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
      resolve();
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });

  return { exitCode: 0 };
}

/**
 * Run live mode. Placeholder — requires Bybit REST + WS connectors.
 */
async function runLiveMode(opts: RunOptions): Promise<{ exitCode: number }> {
  console.log("[live] Live mode is not yet fully operational.");
  console.log("[live] For live trading, ensure Bybit REST and WebSocket connectors are wired.\n");

  // Fallback to synthetic cycle for now
  const { GammaSession } = await import("@agenttrading/core");
  const session = new GammaSession({
    canaryConfig: opts.config.canaryConfig,
    learningCycleInterval: 10,
  });

  session.start();
  console.log(`[live] Session started. Cycle interval: ${opts.cycleIntervalMs}ms`);
  console.log("[live] Press Ctrl+C to stop.\n");

  const startTimeMs = Date.now();
  let cycleCount = 0;

  await new Promise<void>((resolve) => {
    let shutdownDone = false;
    const timer = setInterval(() => {
      cycleCount++;
      try {
        const result = session.runCycle({
          regime: {
            realizedVolatility: 0.5, spreadBps: 10, liquidityUsd: 50_000,
            gasPriceUsd: 5, cumulativePnlUsd: 0, maxDrawdownUsd: 0,
            rpcHealthy: true, cexHealthy: true, directionalStreak: 0,
            reversalCount: 0, nowMs: Date.now(),
          },
          market: { bid: 99, ask: 101, mid: 100, liquidityUsd: 10_000 },
          intents: [], riskDecisions: [],
        });
        console.log(
          `[live] Cycle ${cycleCount}: regime=${result.regimeClassification?.regime ?? "unknown"} submitted=${result.submittedCount} blocked=${result.blockedCount}`,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`\n[live] Cycle ${cycleCount} failed: ${message}`);
        clearInterval(timer);
        session.stop();
        printSessionSummary(startTimeMs, opts.config, `cycle error: ${message}`, false);
        console.log("[live] Session ended due to error. Goodbye.");
        if (!shutdownDone) { shutdownDone = true; resolve(); }
      }
    }, opts.cycleIntervalMs);

    const shutdown = () => {
      if (shutdownDone) return;
      shutdownDone = true;
      clearInterval(timer);
      process.removeListener("SIGINT", shutdown);
      process.removeListener("SIGTERM", shutdown);
      console.log("\n[live] Shutting down...");
      session.stop();
      printSessionSummary(startTimeMs, opts.config, "SIGINT/SIGTERM", true);
      console.log("[live] Session ended. Goodbye.");
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

  // ── Step 4: Print startup banner ─────────────────────────────────
  printBanner(config, cycleIntervalMs);

  // ── Step 5: Exchange connectivity check (SP2) ───────────────────
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

  // ── Step 6: Dispatch to mode ─────────────────────────────────────
  const runOpts: RunOptions = {
    config,
    cycleIntervalMs,
    dryRun: cliArgs.dryRun,
    label: config.mode,
  };

  let exitCode: number;
  if (config.mode === "paper") {
    exitCode = (await runPaperMode(runOpts)).exitCode;
  } else {
    exitCode = (await runLiveMode(runOpts)).exitCode;
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
