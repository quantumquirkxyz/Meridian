/**
 * Configuration loader for the AgentTrading CLI.
 *
 * Responsibilities:
 * - Load `.env` file via Bun built-in (`Bun.env`)
 * - Validate required API keys for live mode
 * - Parse optional parameters (MODE, CONFIG_PATH, etc.)
 * - Apply JSON config overrides from `--config` flag
 * - Paper mode requires zero API keys
 * - Fail fast with descriptive error listing all missing/invalid fields
 */

import { parseCanaryConfig } from "@agenttrading/contracts";
import type { CanaryConfig } from "@agenttrading/contracts";
import { DEFAULT_CANARY_CONFIG } from "@agenttrading/contracts";

// ── Types ────────────────────────────────────────────────────────────

/** System mode: paper or live. */
export type Mode = "paper" | "live";

/** Validated runtime configuration for the CLI. */
export interface AppConfig {
  /** Active system mode. */
  mode: Mode;
  /** API key for Bybit (live mode only). */
  bybitApiKey: string;
  /** API secret for Bybit (live mode only). */
  bybitApiSecret: string;
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
}

/** Single field validation error. */
export interface ConfigError {
  field: string;
  message: string;
}

/** Result of config loading — either valid config or list of errors. */
export type ConfigResult =
  | { ok: true; config: AppConfig }
  | { ok: false; errors: ConfigError[] };

// ── Defaults ─────────────────────────────────────────────────────────

const DEFAULT_CYCLE_INTERVAL_MS = 5_000;
const DEFAULT_LOG_LEVEL = "info";
const DEFAULT_REPORT_DIR = "./reports";

// ── Loading ──────────────────────────────────────────────────────────

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
    env?: Record<string, string | undefined>;
  },
): Promise<ConfigResult> {
  const env = overrides?.env ?? (Bun.env as Record<string, string | undefined>);
  const configPath = overrides?.configPath ?? env.CONFIG_PATH;

  const errors: ConfigError[] = [];

  // ── Parse mode ────────────────────────────────────────────────────
  const rawMode = env.MODE ?? "paper";
  const mode = parseMode(rawMode);
  if (mode === undefined) {
    errors.push({ field: "MODE", message: `Invalid mode "${rawMode}". Must be "paper" or "live".` });
  }

  // ── Parse optional numeric fields ─────────────────────────────────
  const cycleIntervalMs = parsePositiveInt(
    env.CYCLE_INTERVAL_MS,
    DEFAULT_CYCLE_INTERVAL_MS,
    "CYCLE_INTERVAL_MS",
    errors,
  );

  const logLevel = env.LOG_LEVEL ?? DEFAULT_LOG_LEVEL;
  const reportDir = env.REPORT_DIR ?? DEFAULT_REPORT_DIR;

  // ── Validate API keys based on mode ───────────────────────────────
  const bybitApiKey = env.BYBIT_API_KEY ?? "";
  const bybitApiSecret = env.BYBIT_API_SECRET ?? "";

  if (mode === "live") {
    if (!bybitApiKey.trim()) {
      errors.push({
        field: "BYBIT_API_KEY",
        message: "BYBIT_API_KEY is required for live mode.",
      });
    }
    if (!bybitApiSecret.trim()) {
      errors.push({
        field: "BYBIT_API_SECRET",
        message: "BYBIT_API_SECRET is required for live mode.",
      });
    }
  }

  // ── Early return if validation failed ─────────────────────────────
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

  return {
    ok: true,
    config: {
      mode: mode!,
      bybitApiKey,
      bybitApiSecret,
      configPath,
      cycleIntervalMs,
      logLevel,
      reportDir,
      canaryConfig,
    },
  };
}

// ── Helpers ──────────────────────────────────────────────────────────

function parseMode(raw: string): Mode | undefined {
  if (raw === "paper" || raw === "live") return raw;
  return undefined;
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
