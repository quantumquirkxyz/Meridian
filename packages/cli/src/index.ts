/**
 * @agenttrading/cli — CLI entry point for the AgentTrading system.
 *
 * Provides configuration loading, mode + venue dispatch, an interactive
 * venue menu, and the `bun run start` entry point. Wires together core,
 * contracts, and connectors.
 *
 * Usage: `bun run start [options]`
 *
 * Flags:
 *   --mode demo|live            System mode (default: demo)
 *   --venue bybit|both|pancakeswap  Venue selection (default: interactive menu)
 *   --config <path>             JSON config override path
 *   --dry-run                   Skip order submission
 *   --cycle-interval <ms>       Override cycle frequency
 *
 * Venue selection:
 *   bybit       — Trade only on Bybit (CEX).
 *   both        — Trade on both Bybit (CEX) and PancakeSwap (DEX).
 *   pancakeswap — Trade only on PancakeSwap (DEX).
 *
 * If --venue is omitted, an interactive menu is shown so the operator can
 * pick one of the three configurations before the run starts.
 */

import { loadConfig, formatConfigErrors } from "./config.ts";
import type { AppConfig, LoadConfigResult } from "./config.ts";
import { parseCliArgs } from "./args.ts";
import type { Venue } from "./args.ts";
import { generateSessionId } from "@agenttrading/core-execution";
import { LiveRunner, type LiveRunnerConfig } from "./live-runner.ts";
import { ManifestWriter } from "./manifest.ts";

// ── Re-exports (keep backward-compatible library API) ─────────────────

export { loadConfig, formatConfigErrors } from "./config.ts";
export type { AppConfig, Mode, LoadConfigResult, ConfigError, LogLevel } from "./config.ts";
export { parseCliArgs, type CliArgs, type CliArgsError, type ParseCliArgsResult, type Venue } from "./args.ts";
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
  evidencePath: string;
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
    evidencePath: `${sessionDir}/evidence.json`,
    summaryPath: `${sessionDir}/summary.json`,
    manifestPath: `${sessionDir}/manifest.json`,
  };
}

// ── Venue Menu ───────────────────────────────────────────────────────

/**
 * Interactive menu that lets the operator pick one of three venue
 * configurations: Bybit only, both Bybit + PancakeSwap, or PancakeSwap
 * only. Reads a single line from stdin.
 */
export async function promptVenueMenu(): Promise<Venue> {
  console.log("");
  console.log("┌──────────────────────────────────────────────────────────────┐");
  console.log("│                  Select Trading Venues                       │");
  console.log("├──────────────────────────────────────────────────────────────┤");
  console.log("│  1) bybit        — Operate only on Bybit (CEX)               │");
  console.log("│  2) both         — Operate on Bybit (CEX) + PancakeSwap      │");
  console.log("│                     (DEX, BNB Chain)                         │");
  console.log("│  3) pancakeswap  — Operate only on PancakeSwap (DEX)          │");
  console.log("├──────────────────────────────────────────────────────────────┤");
  console.log("│  Selection: 1 / 2 / 3   (default: 1)                         │");
  console.log("└──────────────────────────────────────────────────────────────┘");

  const choice = await readLine("  Enter choice [1]: ");
  switch (choice.trim()) {
    case "":
    case "1":
      return "bybit";
    case "2":
      return "both";
    case "3":
      return "pancakeswap";
    default:
      console.log(`  Unknown option "${choice}", defaulting to bybit.`);
      return "bybit";
  }
}

/**
 * Read a single line from stdin. Used for the interactive venue menu.
 * Bails out with the provided default if no TTY is available (e.g. when
 * the process is started without a controlling terminal).
 */
function readLine(prompt: string, fallback: string = ""): Promise<string> {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      resolve(fallback);
      return;
    }
    process.stdout.write(prompt);
    let buffer = "";
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      if (buffer.includes("\n")) {
        process.stdin.removeListener("data", onData);
        process.stdin.pause();
        resolve(buffer.split("\n")[0] ?? "");
      }
    };
    process.stdin.resume();
    process.stdin.once("data", onData);
  });
}

/**
 * Friendly label for the venue selection (used in banners / logs).
 */
function describeVenue(venue: Venue): string {
  switch (venue) {
    case "bybit":
      return "Bybit (CEX only)";
    case "both":
      return "Bybit (CEX) + PancakeSwap (DEX)";
    case "pancakeswap":
      return "PancakeSwap (DEX only)";
  }
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
  console.log(`║  Venue:         ${describeVenue(config.venue).padEnd(40)}║`);
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

// ── Mode Dispatch ─────────────────────────────────────────────────────

/**
 * Build a LiveRunnerConfig from the validated AppConfig + session paths.
 * Wires in Bybit and (optionally) PancakeSwap credentials based on the
 * selected venue.
 */
function buildRunnerConfig(opts: RunOptions, paths: SessionPaths): LiveRunnerConfig {
  const { config } = opts;
  const base = {
    symbols: config.canaryConfig.scope.allowedTokens.map((t) => {
      const base = t.replace("/", "");
      return base.endsWith("USDT") ? base : `${base}USDT`;
    }),
    bybitApiKey: config.bybitApiKey,
    bybitApiSecret: config.bybitApiSecret,
    bybitEndpoints: config.bybitEndpoints,
    cycleIntervalMs: opts.cycleIntervalMs,
    canaryConfig: config.canaryConfig,
    auditLogPath: paths.auditLogPath,
    sessionId: paths.sessionId,
    mode: config.mode,
    llmApiKey: config.llmApiKey,
    llmBaseUrl: config.llmBaseUrl,
  };

  // For pancakeswap / both venues, pass DEX credentials through to the runner.
  if (config.venue === "pancakeswap" || config.venue === "both") {
    return {
      ...base,
      pancakeSwapRpcUrl: config.pancakeSwapRpcUrl,
      pancakeSwapPrivateKey: config.pancakeSwapPrivateKey,
      pancakeSwapRouterAddress: config.pancakeSwapRouterAddress,
    };
  }

  return base;
}

/**
 * Run live mode using LiveRunner. Connects to Bybit private+public WS,
 * places real orders through LiveExecutionEngine with canary limits,
 * confirms fills via WS, reconciles, and produces full audit trail.
 */
async function runLiveMode(
  opts: RunOptions,
  paths: SessionPaths,
  manifest: ManifestWriter,
): Promise<{ exitCode: number }> {
  const runner = new LiveRunner(buildRunnerConfig(opts, paths));

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

/**
 * Demo mode connects to Bybit Demo Trading (api-demo.bybit.com,
 * stream-demo.bybit.com) with virtual balances. It validates the
 * full execution/ reconciliation/audit pipeline against real
 * exchange endpoints. Not a pure internal simulation.
 */
async function runDemoMode(
  opts: RunOptions,
  paths: SessionPaths,
): Promise<{ exitCode: number }> {
  const runner = new LiveRunner(buildRunnerConfig(opts, paths));

  await runner.start();

  // Wait for graceful shutdown via SIGINT/SIGTERM
  const manifest = new ManifestWriter({
    sessionId: paths.sessionId,
    startedAtMs: Date.now(),
  });
  manifest.track("audit-log", paths.auditLogPath);

  await new Promise<void>((resolve) => {
    let shutdownDone = false;

    const shutdown = () => {
      if (shutdownDone) return;
      shutdownDone = true;

      process.removeListener("SIGINT", shutdown);
      process.removeListener("SIGTERM", shutdown);

      console.log("\n[demo] Shutting down...");
      runner.stop();

      shutdownObservability({
        runner: { startedAtMs: runner.startedAtMs, stoppedAtMs: Date.now() },
        paths,
        config: opts.config,
        manifest,
      });

      resolve();
    };

    runner.on({
      onShutdown: () => {
        console.log("[demo] Session ended via event.");
        setTimeout(() => shutdown(), 1000);
      },
    });

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

/** S2+S3: Shared shutdown observability — writes manifest after the mode-specific artifacts are flushed. */
function shutdownObservability(opts: {
  runner: { startedAtMs: number; stoppedAtMs: number };
  paths: SessionPaths;
  config: AppConfig;
  manifest: ManifestWriter;
}): void {
  const { paths, manifest } = opts;

  // AC10: Write manifest at shutdown
  manifest.writeManifest(paths.manifestPath);
}

// ── Main ──────────────────────────────────────────────────────────────

/**
 * Main entry point. Parse CLI args, prompt for venue if needed, load
 * config, display banner, and dispatch to the appropriate mode.
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

  // ── Step 2: Resolve venue (CLI flag → interactive menu) ─────────
  let venue: Venue = cliArgs.venue ?? (Bun.env.VENUE as Venue | undefined) ?? "bybit";
  if (!cliArgs.venue && !Bun.env.VENUE) {
    venue = await promptVenueMenu();
  }

  // ── Step 3: Load and validate configuration ──────────────────────
  const loadResult: LoadConfigResult = await loadConfig({
    configPath: cliArgs.configPath,
    venue,
    env: {
      ...(Bun.env as Record<string, string | undefined>),
      MODE: cliArgs.mode,
    },
  });

  if (!loadResult.ok) {
    console.error(formatConfigErrors(loadResult.errors));
    process.exit(1);
  }

  const config = loadResult.config;

  // ── Step 4: Determine cycle interval ─────────────────────────────
  // CLI flag takes precedence over config/env.
  const cycleIntervalMs = cliArgs.cycleIntervalMs ?? config.cycleIntervalMs;

  // ── Step 5: Generate session ID and compute output paths ─────────
  const sessionId = generateSessionId();
  const paths = buildSessionPaths(config.reportDir, sessionId);

  // ── Step 6: Print startup banner ─────────────────────────────────
  printBanner(config, cycleIntervalMs);

  // ── Step 7: Exchange connectivity check (SP2) ───────────────────
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

  // ── Step 8: Dispatch to mode ─────────────────────────────────────
  const runOpts: RunOptions = {
    config,
    cycleIntervalMs,
    dryRun: cliArgs.dryRun,
    label: config.mode,
  };

  let exitCode: number;
  if (config.mode === "demo") {
    exitCode = (await runDemoMode(runOpts, paths)).exitCode;
  } else {
    // Only use manifest for live mode
    const manifest = new ManifestWriter({
      sessionId: paths.sessionId,
      startedAtMs: Date.now(),
    });
    manifest.track("audit-log", paths.auditLogPath);

    // Add manifest to runOpts for live mode
    exitCode = (await runLiveMode(runOpts, paths, manifest)).exitCode;
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