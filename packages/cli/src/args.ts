/**
 * CLI argument parser for AgentTrading.
 *
 * Uses `parseArgs` from `node:util` (Bun built-in) — zero external
 * dependencies. Accepts --mode, --config, --dry-run, and --cycle-interval
 * flags with sensible defaults.
 */

import { parseArgs } from "node:util";

// Read version from package.json instead of hardcoding.
const { version: CLI_VERSION } = require("../../../package.json") as {
  version: string;
};

/** Valid system mode. */
export type Mode = "paper" | "live";

/** Parsed CLI arguments. */
export interface CliArgs {
  mode: Mode;
  configPath: string | undefined;
  dryRun: boolean;
  cycleIntervalMs: number | undefined;
}

/** Error returned when CLI args are invalid. */
export interface CliArgsError {
  field: string;
  message: string;
}

/** Result of CLI argument parsing. */
export type ParseCliArgsResult =
  | { ok: true; args: CliArgs }
  | { ok: false; errors: CliArgsError[] };

/**
 * Parse CLI arguments from a raw argv array (without the first two
 * elements that Bun injects: executable + script path).
 *
 * @param argv - Raw process.argv (Bun-style). The first two entries
 *   (node binary + script path) are stripped before parsing.
 * @returns Parsed args or validation errors.
 */
export function parseCliArgs(argv: string[]): ParseCliArgsResult {
  const errors: CliArgsError[] = [];

  // Strip the first two entries (executable path + script path)
  const args = argv.slice(2);

  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args,
      options: {
        mode: {
          type: "string",
          short: "m",
          default: "paper",
        },
        config: {
          type: "string",
          short: "c",
        },
        "dry-run": {
          type: "boolean",
          default: false,
        },
        "cycle-interval": {
          type: "string",
        },
        help: {
          type: "boolean",
          short: "h",
          default: false,
        },
        version: {
          type: "boolean",
          short: "V",
          default: false,
        },
      },
      strict: true,
      allowPositionals: false,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    errors.push({ field: "CLI", message: `Invalid CLI arguments: ${message}` });
    return { ok: false, errors };
  }

  // Handle --help
  if (parsed.values.help) {
    printHelp();
    process.exit(0);
  }

  // Handle --version (S4: reads from package.json)
  if (parsed.values.version) {
    console.log(CLI_VERSION);
    process.exit(0);
  }

  // Parse and validate --mode
  const rawMode = String(parsed.values.mode ?? "paper");
  const mode = parseMode(rawMode);
  if (mode === undefined) {
    errors.push({
      field: "mode",
      message: `Invalid mode "${rawMode}". Must be "paper" or "live".`,
    });
  }

  // Parse --cycle-interval
  let cycleIntervalMs: number | undefined;
  if (parsed.values["cycle-interval"] !== undefined) {
    const raw = String(parsed.values["cycle-interval"]);
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
      errors.push({
        field: "cycle-interval",
        message: `Invalid cycle interval "${raw}". Must be a positive integer (ms).`,
      });
    } else {
      cycleIntervalMs = n;
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    args: {
      mode: mode!,
      configPath: typeof parsed.values.config === "string" ? parsed.values.config : undefined,
      dryRun: (parsed.values["dry-run"] as boolean) ?? false,
      cycleIntervalMs,
    },
  };
}

// ── Helpers ──────────────────────────────────────────────────────────

function parseMode(raw: string): Mode | undefined {
  if (raw === "paper" || raw === "live") return raw;
  return undefined;
}

function printHelp(): void {
  console.log(
    `AgentTrading CLI — start a paper or live trading session.

Usage:
  bun run start [options]

Options:
  -m, --mode <paper|live>       System mode (default: paper)
  -c, --config <path>           Path to JSON config override
      --dry-run                 Run full cycle but skip order submission
      --cycle-interval <ms>     Override cycle frequency (ms)
  -h, --help                    Show this help message
  -V, --version                 Show version number

Examples:
  bun run start                          # Paper mode, defaults
  bun run start --mode paper --dry-run   # Paper mode, dry run
  bun run start --config ./config.json   # Paper mode with config override
  bun run start --mode live --config ./live.json  # Live mode`,
  );
}
