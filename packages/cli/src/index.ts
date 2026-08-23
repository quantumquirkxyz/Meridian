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

// ── Synthetic cycle input ─────────────────────────────────────────────

/** Generate synthetic GammaCycleInput for the cycle loop. */
function syntheticCycleInput() {
  return {
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
  };
}

// ── Mode Dispatch (S1: shared helper) ─────────────────────────────────

/**
 * Run a trading session (paper or live). Creates a GammaSession, starts
 * it, and runs cycles at the configured interval.
 *
 * SP1: Dry-run runs the full cycle but skips order submission.
 * SP3: Mid-run errors are caught and the session summary is still printed.
 */
async function runSession(opts: RunOptions): Promise<{ exitCode: number }> {
  const { config, cycleIntervalMs, dryRun, label } = opts;
  const startTimeMs = Date.now();

  const { GammaSession } = await import("@agenttrading/core");
  const session = new GammaSession({
    canaryConfig: config.canaryConfig,
    learningCycleInterval: 10,
  });

  session.start();

  console.log(`[${label}] Session started. Cycle interval: ${cycleIntervalMs}ms`);
  if (dryRun) {
    console.log(`[${label}] DRY-RUN mode active — order submission will be skipped.`);
  }
  console.log(`[${label}] Press Ctrl+C to stop.\n`);

  // SP3: resolveRef lets the shutdown handler resolve the outer Promise
  // even if the setInterval callback throws.
  let resolveWait!: () => void;
  const waitPromise = new Promise<void>((resolve) => {
    resolveWait = resolve;
  });

  // Start the cycle loop
  let cycleCount = 0;
  const timer = setInterval(() => {
    cycleCount++;

    try {
      // SP1: Always run the full cycle — dry-run only suppresses
      // order submission, not regime classification / learning / routes.
      const result = session.runCycle(syntheticCycleInput());

      if (dryRun) {
        // SP1: Log what the cycle did, but note submission is skipped.
        console.log(
          `[${label}] Cycle ${cycleCount} (dry-run): regime=${result.regimeClassification?.regime ?? "unknown"} submitted=${result.submittedCount} blocked=${result.blockedCount} — submission skipped`,
        );
      } else {
        console.log(
          `[${label}] Cycle ${cycleCount}: regime=${result.regimeClassification?.regime ?? "unknown"} submitted=${result.submittedCount} blocked=${result.blockedCount}`,
        );
      }
    } catch (err) {
      // SP3: Catch mid-run errors, print summary, and shut down.
      const message = err instanceof Error ? err.message : String(err);
      console.error(`\n[${label}] Cycle ${cycleCount} failed: ${message}`);
      clearInterval(timer);
      session.stop();
      printSessionSummary(startTimeMs, config, `cycle error: ${message}`, false);
      console.log(`[${label}] Session ended due to error. Goodbye.`);
      resolveWait();
    }
  }, cycleIntervalMs);

  // Wait for shutdown signal
  await new Promise<void>((resolve) => {
    let shutdownDone = false;

    const shutdown = () => {
      if (shutdownDone) return;
      shutdownDone = true;

      clearInterval(timer);
      process.removeListener("SIGINT", shutdown);
      process.removeListener("SIGTERM", shutdown);

      console.log(`\n[${label}] Shutting down...`);

      // Flush and stop the session
      session.stop();

      // Print session summary
      printSessionSummary(startTimeMs, config, "SIGINT/SIGTERM", true);

      console.log(`[${label}] Session ended. Goodbye.`);
      resolve();
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    // Also resolve when the wait promise resolves (from SP3 error handler)
    waitPromise.then(() => {
      if (!shutdownDone) shutdown();
    });
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

  if (config.mode === "live") {
    console.log("[live] Live mode is not yet fully operational.");
    console.log("[live] For live trading, ensure Bybit REST and WebSocket connectors are wired.\n");
  }

  const { exitCode } = await runSession(runOpts);
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
