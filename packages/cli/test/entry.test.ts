import { describe, expect, test } from "bun:test";
import { parseCliArgs, type CliArgs, type CliArgsError } from "../src/args.ts";

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Build a synthetic argv array (Bun-style: [executable, script, ...args]).
 * The executable and script entries are stripped by parseCliArgs.
 */
function argv(...args: string[]): string[] {
  return ["/usr/bin/bun", "/project/packages/cli/src/index.ts", ...args];
}

// ── Arg Parsing Tests ────────────────────────────────────────────────

describe("parseCliArgs", () => {
  test("no args defaults to paper mode", () => {
    const result = parseCliArgs(argv());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.args.mode).toBe("paper");
      expect(result.args.configPath).toBeUndefined();
      expect(result.args.dryRun).toBe(false);
      expect(result.args.cycleIntervalMs).toBeUndefined();
    }
  });

  test("--mode paper is accepted", () => {
    const result = parseCliArgs(argv("--mode", "paper"));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.args.mode).toBe("paper");
    }
  });

  test("--mode live is accepted", () => {
    const result = parseCliArgs(argv("--mode", "live"));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.args.mode).toBe("live");
    }
  });

  test("--mode demo is accepted", () => {
    const result = parseCliArgs(argv("--mode", "demo"));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.args.mode).toBe("demo");
    }
  });

  test("-m shorthand works", () => {
    const result = parseCliArgs(argv("-m", "live"));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.args.mode).toBe("live");
    }
  });

  test("invalid mode returns error", () => {
    const result = parseCliArgs(argv("--mode", "production"));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result.errors.find((e) => e.field === "mode");
      expect(err).toBeDefined();
      expect(err!.message).toContain("Invalid mode");
      expect(err!.message).toContain("paper");
      expect(err!.message).toContain("demo");
      expect(err!.message).toContain("live");
    }
  });

  test("--config flag is parsed", () => {
    const result = parseCliArgs(argv("--config", "./config.json"));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.args.configPath).toBe("./config.json");
    }
  });

  test("-c shorthand works", () => {
    const result = parseCliArgs(argv("-c", "./my-config.json"));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.args.configPath).toBe("./my-config.json");
    }
  });

  test("--dry-run flag is parsed", () => {
    const result = parseCliArgs(argv("--dry-run"));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.args.dryRun).toBe(true);
    }
  });

  test("--dry-run defaults to false", () => {
    const result = parseCliArgs(argv());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.args.dryRun).toBe(false);
    }
  });

  test("--cycle-interval flag is parsed", () => {
    const result = parseCliArgs(argv("--cycle-interval", "10000"));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.args.cycleIntervalMs).toBe(10_000);
    }
  });

  test("--cycle-interval with non-integer returns error", () => {
    const result = parseCliArgs(argv("--cycle-interval", "5.5"));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result.errors.find((e) => e.field === "cycle-interval");
      expect(err).toBeDefined();
      expect(err!.message).toContain("positive integer");
    }
  });

  test("--cycle-interval with zero returns error", () => {
    const result = parseCliArgs(argv("--cycle-interval", "0"));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result.errors.find((e) => e.field === "cycle-interval");
      expect(err).toBeDefined();
    }
  });

  test("--cycle-interval with negative returns error", () => {
    // parseArgs treats -1000 as a separate unknown flag (starts with -),
    // so the error comes from the CLI field (unknown flag), not cycle-interval.
    const result = parseCliArgs(argv("--cycle-interval", "-1000"));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThanOrEqual(1);
    }
  });

  test("--cycle-interval with non-numeric returns error", () => {
    const result = parseCliArgs(argv("--cycle-interval", "abc"));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result.errors.find((e) => e.field === "cycle-interval");
      expect(err).toBeDefined();
    }
  });

  test("unknown flag returns error", () => {
    const result = parseCliArgs(argv("--unknown-flag"));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThanOrEqual(1);
      expect(result.errors[0].field).toBe("CLI");
      expect(result.errors[0].message).toContain("Invalid CLI arguments");
    }
  });

  test("all flags combined", () => {
    const result = parseCliArgs(
      argv("--mode", "live", "--config", "./live.json", "--dry-run", "--cycle-interval", "3000"),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.args.mode).toBe("live");
      expect(result.args.configPath).toBe("./live.json");
      expect(result.args.dryRun).toBe(true);
      expect(result.args.cycleIntervalMs).toBe(3000);
    }
  });

  test("positional args are rejected", () => {
    const result = parseCliArgs(argv("positional-arg"));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThanOrEqual(1);
      expect(result.errors[0].field).toBe("CLI");
    }
  });
});

// ── Mode Dispatch Tests ──────────────────────────────────────────────

describe("mode dispatch", () => {
  test("default mode is paper", () => {
    const result = parseCliArgs(argv());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.args.mode).toBe("paper");
    }
  });

  test("explicit paper mode", () => {
    const result = parseCliArgs(argv("--mode", "paper"));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.args.mode).toBe("paper");
    }
  });

  test("live mode requires API keys at config load time", () => {
    // This verifies the mode dispatch flow — live mode should
    // be parsed correctly by arg parser. Config validation
    // (missing keys) is handled by the config loader.
    const result = parseCliArgs(argv("--mode", "live"));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.args.mode).toBe("live");
    }
  });
});

// ── Dry-Run Flag Tests ───────────────────────────────────────────────

describe("dry-run flag", () => {
  test("dry-run is false by default", () => {
    const result = parseCliArgs(argv());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.args.dryRun).toBe(false);
    }
  });

  test("dry-run is true when specified", () => {
    const result = parseCliArgs(argv("--dry-run"));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.args.dryRun).toBe(true);
    }
  });

  test("dry-run can be combined with mode", () => {
    const result = parseCliArgs(argv("--mode", "live", "--dry-run"));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.args.mode).toBe("live");
      expect(result.args.dryRun).toBe(true);
    }
  });

  test("dry-run with config override", () => {
    const result = parseCliArgs(argv("--dry-run", "--config", "./test.json"));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.args.dryRun).toBe(true);
      expect(result.args.configPath).toBe("./test.json");
    }
  });
});

// ── Error Handling Tests ──────────────────────────────────────────────

describe("error handling", () => {
  test("multiple invalid fields produce multiple errors", () => {
    const result = parseCliArgs(argv("--mode", "invalid", "--cycle-interval", "abc"));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThanOrEqual(2);
      const fields = result.errors.map((e) => e.field);
      expect(fields).toContain("mode");
      expect(fields).toContain("cycle-interval");
    }
  });

  test("error messages are descriptive", () => {
    const result = parseCliArgs(argv("--mode", "test"));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result.errors.find((e) => e.field === "mode");
      expect(err).toBeDefined();
      expect(err!.message).toContain("Invalid mode");
      expect(err!.message).toContain('"test"');
    }
  });
});
