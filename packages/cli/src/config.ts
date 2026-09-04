/**
 * Configuration loader for the AgentTrading CLI.
 *
 * Responsibilities:
 * - Load `.env` file via Bun built-in (`Bun.env`)
 * - Validate required API keys for demo/live modes and venue selection
 * - Parse optional parameters (MODE, VENUE, CONFIG_PATH, etc.)
 * - Apply JSON config overrides from `--config` flag
 * - Demo mode uses Bybit Demo Trading credentials but cannot pass as live
 * - Venue selection (bybit / both / pancakeswap) gates which credentials are required
 * - Fail fast with descriptive error listing all missing/invalid fields
 */

import { parseCanaryConfig } from "@agenttrading/contracts";
import type { CanaryConfig } from "@agenttrading/contracts";
import { DEFAULT_CANARY_CONFIG } from "@agenttrading/contracts";
import { DEMO_BASE_URL, DEMO_PUBLIC_WS_URL, DEMO_PRIVATE_WS_URL } from "@agenttrading/connectors";
import type { Venue } from "./args.ts";

// ── Types ────────────────────────────────────────────────────────────

/** System mode: Bybit Demo Trading or live capital. */
export type Mode = "demo" | "live";

/** Bybit endpoints for a given mode (REST + public/private WS). */
export interface BybitEndpoints {
  /** REST base URL. */
  restUrl: string;
  /** Public WebSocket URL (market data). */
  publicWsUrl: string;
  /** Private WebSocket URL (orders, positions, executions). */
  privateWsUrl: string;
}

/** Validated runtime configuration for the CLI. */
export interface AppConfig {
  /** Active system mode. */
  mode: Mode;
  /** Selected venue set. */
  venue: Venue;
  /** API key for Bybit (demo or live). */
  bybitApiKey: string;
  /** API secret for Bybit (demo or live). */
  bybitApiSecret: string;
  /** Bybit REST + WS endpoints for the current mode. */
  bybitEndpoints: BybitEndpoints;
  /** PancakeSwap RPC URL for on-chain BNB chain market data (optional). */
  pancakeSwapRpcUrl?: string;
  /** PancakeSwap private key for signing on-chain swaps (execution). */
  pancakeSwapPrivateKey?: `0x${string}`;
  /** PancakeSwap router address for swap execution. */
  pancakeSwapRouterAddress?: `0x${string}`;
  /** Path to JSON config override file (optional). */
  configPath?: string;
  /** Cycle interval in milliseconds. */
  cycleIntervalMs: number;
  /** Log level. */
  logLevel: string;
  /** Report output directory. */
  reportDir: string;
  /** Merged canary config (defaults + JSON overrides). */
  canaryConfig: CanaryConfig;
  /** LLM base URL for agent reasoning (e.g. OpenRouter endpoint). */
  llmBaseUrl: string;
  /** LLM API key for agent reasoning. */
  llmApiKey: string;
}

/** Single field validation error. */
export interface ConfigError {
  field: string;
  message: string;
}

/** Result of config loading — either valid config or list of errors. */
export type LoadConfigResult =
  | { ok: true; config: AppConfig }
  | { ok: false; errors: ConfigError[] };

// ── Defaults ─────────────────────────────────────────────────────────

const DEFAULT_CYCLE_INTERVAL_MS = 5_000;
const DEFAULT_LOG_LEVEL = "info";
const DEFAULT_REPORT_DIR = "./reports";

const VALID_LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof VALID_LOG_LEVELS)[number];

// ── Loading ─────────────────────────────────────────────────────────

/**
 * Load and validate configuration from environment variables and optional
 * JSON config override. Bun reads `.env` natively, so `Bun.env` contains
 * all variables from the `.env` file.
 *
 * @param overrides - Optional overrides for testing (env values + configPath).
 * @returns ConfigResult — ok with validated config, or errors list.
 */
export async function loadConfig(
  overrides?: {
    configPath?: string;
    venue?: Venue;
    env?: Record<string, string | undefined>;
  },
): Promise<LoadConfigResult> {
  const env = overrides?.env ?? (Bun.env as Record<string, string | undefined>);
  const configPath = overrides?.configPath ?? env.CONFIG_PATH;
  const venue = overrides?.venue ?? parseVenue(env.VENUE);

  const errors: ConfigError[] = [];

  // ── Parse mode ────────────────────────────────────────────────────
  const rawMode = env.MODE ?? "demo";
  const mode = parseMode(rawMode);
  if (mode === undefined) {
    errors.push({
      field: "MODE",
      message: `Invalid mode "${rawMode}". Must be "demo" or "live".`,
    });
  }

  // ── Parse optional numeric fields ─────────────────────────────────
  const cycleIntervalMs = parsePositiveInt(
    env.CYCLE_INTERVAL_MS,
    DEFAULT_CYCLE_INTERVAL_MS,
    "CYCLE_INTERVAL_MS",
    errors,
  );

  const rawLogLevel = env.LOG_LEVEL ?? DEFAULT_LOG_LEVEL;
  const logLevel = parseLogLevel(rawLogLevel, errors);
  const reportDir = env.REPORT_DIR ?? DEFAULT_REPORT_DIR;

  // ── Parse Bybit API keys (always required for demo/live) ─────────
  const bybitApiKey = env.BYBIT_API_KEY ?? "";
  const bybitApiSecret = env.BYBIT_API_SECRET ?? "";

  if (mode === "live" || mode === "demo") {
    if (!bybitApiKey.trim()) {
      errors.push({
        field: "BYBIT_API_KEY",
        message: `BYBIT_API_KEY is required for ${mode} mode.`,
      });
    }
    if (!bybitApiSecret.trim()) {
      errors.push({
        field: "BYBIT_API_SECRET",
        message: `BYBIT_API_SECRET is required for ${mode} mode.`,
      });
    }
  }

  // ── Parse PancakeSwap credentials (required for pancakeswap venues) ─
  const pancakeSwapRpcUrl = env.PANCAKESWAP_RPC_URL?.trim();
  const pancakeSwapPrivateKey = (env.PANCAKESWAP_PRIVATE_KEY?.trim() || undefined) as `0x${string}` | undefined;
  const pancakeSwapRouterAddress = (env.PANCAKESWAP_ROUTER_ADDRESS?.trim() || undefined) as `0x${string}` | undefined;

  if (venue === "pancakeswap" || venue === "both") {
    if (!pancakeSwapRpcUrl) {
      errors.push({
        field: "PANCAKESWAP_RPC_URL",
        message: `PANCAKESWAP_RPC_URL is required when venue is "${venue}".`,
      });
    }
    if (!pancakeSwapPrivateKey) {
      errors.push({
        field: "PANCAKESWAP_PRIVATE_KEY",
        message: `PANCAKESWAP_PRIVATE_KEY is required when venue is "${venue}".`,
      });
    }
    if (!pancakeSwapRouterAddress) {
      errors.push({
        field: "PANCAKESWAP_ROUTER_ADDRESS",
        message: `PANCAKESWAP_ROUTER_ADDRESS is required when venue is "${venue}".`,
      });
    }
  }

  // ── Early return if validation failed (pre-config) ───────────────
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // ── Load and merge JSON config override ───────────────────────────
  let canaryConfig = DEFAULT_CANARY_CONFIG;
  if (configPath) {
    const loadResult = await loadJsonConfig(configPath);
    if (!loadResult.ok) {
      return { ok: false, errors: loadResult.errors };
    }
    canaryConfig = mergeCanaryConfig(DEFAULT_CANARY_CONFIG, loadResult.config);
  }

  // Demo mode connects to Bybit Demo Trading (testnet); only live requires withdrawals disabled
  if (mode === "live" && !canaryConfig.apiKeys.withdrawalsDisabled) {
    errors.push({
      field: "WITHDRAWALS_DISABLED",
      message: "Live mode requires withdrawals to be disabled on API keys.",
    });
  }

  // ── Early return if post-config validation failed ─────────────────
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const bybitEndpoints: BybitEndpoints =
    mode === "demo"
      ? { restUrl: DEMO_BASE_URL, publicWsUrl: DEMO_PUBLIC_WS_URL, privateWsUrl: DEMO_PRIVATE_WS_URL }
      : { restUrl: "https://api.bybit.com", publicWsUrl: "wss://stream.bybit.com/v5/public/linear", privateWsUrl: "wss://stream.bybit.com/v5/private" };

  return {
    ok: true,
    config: {
      mode: mode!,
      venue: venue ?? "bybit",
      bybitApiKey,
      bybitApiSecret,
      bybitEndpoints,
      pancakeSwapRpcUrl,
      pancakeSwapPrivateKey,
      pancakeSwapRouterAddress,
      configPath,
      cycleIntervalMs,
      logLevel,
      reportDir,
      canaryConfig,
      llmBaseUrl: env.LLM_BASE_URL ?? "https://openrouter.ai/api/v1",
      llmApiKey: env.LLM_API_KEY ?? "",
    },
  };
}

// ── Helpers ─────────────────────────────────────────────────────────

function parseMode(raw: string): Mode | undefined {
  if (raw === "demo" || raw === "live") return raw;
  return undefined;
}

function parseVenue(raw: string | undefined): Venue | undefined {
  if (raw === "bybit" || raw === "both" || raw === "pancakeswap") return raw;
  return undefined;
}

function parseLogLevel(raw: string, errors: ConfigError[]): string {
  if (raw === "") return DEFAULT_LOG_LEVEL;
  if ((VALID_LOG_LEVELS as readonly string[]).includes(raw)) {
    return raw;
  }
  errors.push({
    field: "LOG_LEVEL",
    message: `Invalid log level "${raw}". Must be one of: ${VALID_LOG_LEVELS.join(", ")}.`,
  });
  return DEFAULT_LOG_LEVEL;
}

function parsePositiveInt(
  raw: string | undefined,
  defaultValue: number,
  field: string,
  errors: ConfigError[],
): number {
  if (raw === undefined || raw === "") return defaultValue;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
    errors.push({ field, message: `${field} must be a positive integer, got "${raw}".` });
    return defaultValue;
  }
  return n;
}

interface JsonConfigLoadResult {
  ok: true;
  config: Partial<CanaryConfig>;
}
interface JsonConfigLoadFail {
  ok: false;
  errors: ConfigError[];
}
type JsonConfigResult = JsonConfigLoadResult | JsonConfigLoadFail;

/**
 * Read and parse a JSON config file. Returns the parsed partial canary
 * config, or validation errors if the file is missing/unreadable or
 * contains invalid JSON.
 */
async function loadJsonConfig(filePath: string): Promise<JsonConfigResult> {
  const file = Bun.file(filePath);
  if (!(await file.exists())) {
    return {
      ok: false,
      errors: [{ field: "CONFIG_PATH", message: `Config file not found: ${filePath}` }],
    };
  }

  let raw: unknown;
  try {
    const text = await file.text();
    raw = JSON.parse(text);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      errors: [{ field: "CONFIG_PATH", message: `Failed to parse config file: ${msg}` }],
    };
  }

  // Validate the partial config against the canary schema.
  // We merge with defaults first so partial overrides work.
  try {
    const merged = mergeCanaryConfig(DEFAULT_CANARY_CONFIG, raw as Partial<CanaryConfig>);
    // Re-validate the merged result through the canonical parser.
    parseCanaryConfig(merged);
    return { ok: true, config: raw as Partial<CanaryConfig> };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      errors: [{ field: "CONFIG_PATH", message: `Invalid canary config: ${msg}` }],
    };
  }
}

/**
 * Shallow-merge a partial canary config override onto a base config.
 * Top-level objects are replaced entirely (not deeply merged) to keep
 * the override semantics explicit and predictable.
 */
function mergeCanaryConfig(
  base: CanaryConfig,
  override: Partial<CanaryConfig>,
): CanaryConfig {
  const result = { ...base };
  for (const key of Object.keys(override) as (keyof CanaryConfig)[]) {
    const value = override[key];
    if (value !== undefined) {
      (result as Record<string, unknown>)[key] = value;
    }
  }
  return result;
}

// ── Public helpers ───────────────────────────────────────────────────

/**
 * Format config errors into a human-readable message listing all
 * missing/invalid fields. Intended for startup failure output.
 */
export function formatConfigErrors(errors: ConfigError[]): string {
  const lines = errors.map((e) => `  - ${e.field}: ${e.message}`);
  return `Configuration validation failed:\n${lines.join("\n")}`;
}
