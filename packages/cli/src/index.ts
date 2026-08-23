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
import type { AppConfig, Mode, LoadConfigResult, ConfigError, LogLevel } from "./config.ts";
import { parseCliArgs, type CliArgs } from "./args.ts";
import { DEFAULT_CANARY_CONFIG } from "@agenttrading/contracts";

// ── Re-exports (keep backward-compatible library API) ─────────────────

export { loadConfig, formatConfigErrors } from "./config.ts";
export type { AppConfig, Mode, LoadConfigResult, ConfigError, LogLevel } from "./config.ts";
export { parseCliArgs, type CliArgs, type CliArgsError, type ParseCliArgsResult } from "./args.ts";

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
  console.log(`║  Completed:     ${"yes".padEnd(40)}║`);
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log();
}

// ── Mode Dispatch ─────────────────────────────────────────────────────

/**
 * Run paper mode. Creates a GammaSession, starts it, and runs cycles
 * at the configured interval. Each cycle is a no-op tick until the
 * data pipelines (market data, opportunity scanner) are wired.
 */
async function runPaperMode(
  config: AppConfig,
  cycleIntervalMs: number,
  dryRun: boolean,
): Promise<{ exitCode: number }> {
  const startTimeMs = Date.now();

  // Dynamically import GammaSession to avoid pulling it into the
  // paper-only path when it's not needed.
  const { GammaSession } = await import("@agenttrading/core");
  const session = new GammaSession({
    canaryConfig: config.canaryConfig,
    learningCycleInterval: 10,
  });

  session.start();

  console.log(`[paper] Session started. Cycle interval: ${cycleIntervalMs}ms`);
  if (dryRun) {
    console.log("[paper] DRY-RUN mode active — order submission will be skipped.");
  }
  console.log("[paper] Press Ctrl+C to stop.\n");

  // Start the cycle loop
  let cycleCount = 0;
  const timer = setInterval(() => {
    cycleCount++;

    if (dryRun) {
      // In dry-run mode, run the cycle but log that submission is skipped.
      console.log(`[paper] Cycle ${cycleCount}: dry-run — submission skipped.`);
      return;
    }

    // Run a minimal cycle with synthetic data.
    // TODO(wire-up): Replace with real market data + opportunity scanner
    // once the data pipeline is connected.
    const result = session.runCycle({
      regime: {
        realizedVolatility: 0.5,
        spreadBps: 10,
        liquidityUsd: 50_000,
        gasPriceUsd: 5,
        cumulativePnlUsd: 0,
        maxDrawdownUsd: 0,
        rpcHealthy: true,
        cexHealthy: true,
        directionalStreak: 0,
        reversalCount: 0,
        nowMs: Date.now(),
      },
      market: { bid: 99, ask: 101, mid: 100, liquidityUsd: 10_000 },
      intents: [],
      riskDecisions: [],
    });

    console.log(
      `[paper] Cycle ${cycleCount}: regime=${result.regimeClassification?.regime ?? "unknown"} submitted=${result.submittedCount} blocked=${result.blockedCount}`,
    );
  }, cycleIntervalMs);

  // Wait for shutdown signal
  await new Promise<void>((resolve) => {
    const shutdown = () => {
      clearInterval(timer);

      console.log("\n[paper] Shutting down...");

      // Flush and stop the session
      session.stop();

      // Print session summary
      printSessionSummary(startTimeMs, config, "SIGINT/SIGTERM");

      console.log("[paper] Session ended. Goodbye.");
      resolve();
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });

  return { exitCode: 0 };
}

// ── Live Mode Dispatch ────────────────────────────────────────────────

/**
 * Run live mode. Delegates to the GammaSession in live configuration.
 * Currently a placeholder — live mode requires exchange connectivity
 * (Bybit REST + WebSocket) which is being built in parallel.
 */
async function runLiveMode(
  config: AppConfig,
  cycleIntervalMs: number,
  dryRun: boolean,
): Promise<{ exitCode: number }> {
  const startTimeMs = Date.now();

  console.log("[live] Live mode is not yet fully operational.");
  console.log("[live] For live trading, ensure Bybit REST and WebSocket connectors are wired.");

  // TODO(wire-up): Implement live execution pipeline with Bybit REST + WS.
  // For now, demonstrate mode dispatch with a GammaSession in live config.
  const { GammaSession } = await import("@agenttrading/core");
  const session = new GammaSession({
    canaryConfig: config.canaryConfig,
    learningCycleInterval: 10,
  });

  session.start();
  console.log(`[live] Session started. Cycle interval: ${cycleIntervalMs}ms`);

  if (dryRun) {
    console.log("[live] DRY-RUN mode active — order submission will be skipped.");
  }

  console.log("[live] Press Ctrl+C to stop.\n");

  let cycleCount = 0;
  const timer = setInterval(() => {
    cycleCount++;

    if (dryRun) {
      console.log(`[live] Cycle ${cycleCount}: dry-run — submission skipped.`);
      return;
    }

    const result = session.runCycle({
      regime: {
        realizedVolatility: 0.5,
        spreadBps: 10,
        liquidityUsd: 50_000,
        gasPriceUsd: 5,
        cumulativePnlUsd: 0,
        maxDrawdownUsd: 0,
        rpcHealthy: true,
        cexHealthy: true,
        directionalStreak: 0,
        reversalCount: 0,
        nowMs: Date.now(),
      },
      market: { bid: 99, ask: 101, mid: 100, liquidityUsd: 10_000 },
      intents: [],
      riskDecisions: [],
    });

    console.log(
      `[live] Cycle ${cycleCount}: regime=${result.regimeClassification?.regime ?? "unknown"} submitted=${result.submittedCount} blocked=${result.blockedCount}`,
    );
  }, cycleIntervalMs);

  await new Promise<void>((resolve) => {
    const shutdown = () => {
      clearInterval(timer);
      console.log("\n[live] Shutting down...");
      session.stop();
      printSessionSummary(startTimeMs, config, "SIGINT/SIGTERM");
      console.log("[live] Session ended. Goodbye.");
      resolve();
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });

  return { exitCode: 0 };
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

  // ── Step 5: Dispatch to mode ─────────────────────────────────────
  let exitCode: number;

  if (config.mode === "live") {
    exitCode = (await runLiveMode(config, cycleIntervalMs, cliArgs.dryRun)).exitCode;
  } else {
    exitCode = (await runPaperMode(config, cycleIntervalMs, cliArgs.dryRun)).exitCode;
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
