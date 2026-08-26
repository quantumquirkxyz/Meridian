import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadConfig,
  formatConfigErrors,
  type ConfigError,
} from "../src/config.ts";
import { DEFAULT_CANARY_CONFIG } from "@agenttrading/contracts";

// ── Helpers ──────────────────────────────────────────────────────────

function env(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    MODE: "paper",
    ...overrides,
  };
}

function tmpJsonFile(content: object): string {
  const dir = mkdtempSync(join(tmpdir(), "config-test-"));
  const filePath = join(dir, "test-config.json");
  writeFileSync(filePath, JSON.stringify(content));
  return filePath;
}

function cleanTmpDir(filePath: string): void {
  try {
    rmSync(join(filePath, ".."), { recursive: true, force: true });
  } catch {
    // ignore cleanup errors in tests
  }
}

/** Create a temp JSON config file, run the test callback, then clean up. */
async function withTmpJsonFile(
  content: object,
  fn: (filePath: string) => Promise<void>,
): Promise<void> {
  const filePath = tmpJsonFile(content);
  try {
    await fn(filePath);
  } finally {
    cleanTmpDir(filePath);
  }
}

// ── Tests ────────────────────────────────────────────────────────────

describe("loadConfig", () => {
  test("paper mode succeeds without any API keys", async () => {
    const result = await loadConfig({ env: env() });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.mode).toBe("paper");
      expect(result.config.bybitApiKey).toBe("");
      expect(result.config.bybitApiSecret).toBe("");
    }
  });

  test("paper mode succeeds with empty API keys", async () => {
    const result = await loadConfig({
      env: env({ BYBIT_API_KEY: "", BYBIT_API_SECRET: "" }),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.mode).toBe("paper");
    }
  });

  test("demo mode requires Bybit API key", async () => {
    const result = await loadConfig({
      env: env({ MODE: "demo", BYBIT_API_SECRET: "demo-secret" }),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const keyError = result.errors.find((e) => e.field === "BYBIT_API_KEY");
      expect(keyError).toBeDefined();
      expect(keyError!.message).toContain("required for demo mode");
    }
  });

  test("demo mode requires Bybit API secret", async () => {
    const result = await loadConfig({
      env: env({ MODE: "demo", BYBIT_API_KEY: "demo-key" }),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const secretError = result.errors.find((e) => e.field === "BYBIT_API_SECRET");
      expect(secretError).toBeDefined();
      expect(secretError!.message).toContain("required for demo mode");
    }
  });

  test("demo mode succeeds with demo API keys and no live withdrawal gate", async () => {
    await withTmpJsonFile(
      {
        ...DEFAULT_CANARY_CONFIG,
        apiKeys: {
          readApiKey: { keyId: "demo-read", secretRef: "demo-read-secret" },
          tradingApiKey: { keyId: "demo-trade", secretRef: "demo-trade-secret" },
          withdrawalsDisabled: false,
        },
      },
      async (filePath) => {
        const result = await loadConfig({
          env: env({
            MODE: "demo",
            BYBIT_API_KEY: "demo-key",
            BYBIT_API_SECRET: "demo-secret",
          }),
          configPath: filePath,
        });

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.config.mode).toBe("demo");
        }
      },
    );
  });

  test("live mode fails without BYBIT_API_KEY", async () => {
    const result = await loadConfig({
      env: env({ MODE: "live", BYBIT_API_SECRET: "secret-123" }),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const keyError = result.errors.find((e) => e.field === "BYBIT_API_KEY");
      expect(keyError).toBeDefined();
      expect(keyError!.message).toContain("required for live mode");
    }
  });

  test("live mode fails without BYBIT_API_SECRET", async () => {
    const result = await loadConfig({
      env: env({ MODE: "live", BYBIT_API_KEY: "key-123" }),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const secretError = result.errors.find((e) => e.field === "BYBIT_API_SECRET");
      expect(secretError).toBeDefined();
      expect(secretError!.message).toContain("required for live mode");
    }
  });

  test("live mode fails with both keys missing", async () => {
    const result = await loadConfig({
      env: env({ MODE: "live" }),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThanOrEqual(2);
      const fields = result.errors.map((e) => e.field);
      expect(fields).toContain("BYBIT_API_KEY");
      expect(fields).toContain("BYBIT_API_SECRET");
    }
  });

  test("live mode succeeds with valid API keys", async () => {
    const result = await loadConfig({
      env: env({
        MODE: "live",
        BYBIT_API_KEY: "test-api-key",
        BYBIT_API_SECRET: "test-api-secret",
      }),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.mode).toBe("live");
      expect(result.config.bybitApiKey).toBe("test-api-key");
      expect(result.config.bybitApiSecret).toBe("test-api-secret");
    }
  });

  test("fails fast with all errors listed", async () => {
    const result = await loadConfig({
      env: env({
        MODE: "invalid-mode",
        CYCLE_INTERVAL_MS: "not-a-number",
      }),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThanOrEqual(2);
      const fields = result.errors.map((e) => e.field);
      expect(fields).toContain("MODE");
      expect(fields).toContain("CYCLE_INTERVAL_MS");
    }
  });

  test("defaults are applied for optional fields", async () => {
    const result = await loadConfig({ env: env() });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.cycleIntervalMs).toBe(5_000);
      expect(result.config.logLevel).toBe("info");
      expect(result.config.marketFeedMode).toBe("public");
      expect(result.config.reportDir).toBe("./reports");
    }
  });

  test("paper market feed can be selected explicitly from env", async () => {
    const result = await loadConfig({
      env: env({ MARKET_FEED_MODE: "synthetic" }),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.marketFeedMode).toBe("synthetic");
    }
  });

  test("invalid MARKET_FEED_MODE reports error", async () => {
    const result = await loadConfig({
      env: env({ MARKET_FEED_MODE: "simulated" }),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result.errors.find((e) => e.field === "MARKET_FEED_MODE");
      expect(err).toBeDefined();
      expect(err!.message).toContain("public");
      expect(err!.message).toContain("synthetic");
    }
  });

  test("optional fields are parsed from env", async () => {
    const result = await loadConfig({
      env: env({
        CYCLE_INTERVAL_MS: "10000",
        LOG_LEVEL: "debug",
        REPORT_DIR: "./my-reports",
      }),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.cycleIntervalMs).toBe(10_000);
      expect(result.config.logLevel).toBe("debug");
      expect(result.config.reportDir).toBe("./my-reports");
    }
  });

  test("invalid CYCLE_INTERVAL_MS reports error", async () => {
    const result = await loadConfig({
      env: env({ CYCLE_INTERVAL_MS: "-5" }),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result.errors.find((e) => e.field === "CYCLE_INTERVAL_MS");
      expect(err).toBeDefined();
      expect(err!.message).toContain("positive integer");
    }
  });

  test("zero CYCLE_INTERVAL_MS reports error", async () => {
    const result = await loadConfig({
      env: env({ CYCLE_INTERVAL_MS: "0" }),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result.errors.find((e) => e.field === "CYCLE_INTERVAL_MS");
      expect(err).toBeDefined();
    }
  });

  test("float CYCLE_INTERVAL_MS reports error", async () => {
    const result = await loadConfig({
      env: env({ CYCLE_INTERVAL_MS: "5.5" }),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result.errors.find((e) => e.field === "CYCLE_INTERVAL_MS");
      expect(err).toBeDefined();
    }
  });

  test("invalid MODE reports error", async () => {
    const result = await loadConfig({
      env: env({ MODE: "production" }),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result.errors.find((e) => e.field === "MODE");
      expect(err).toBeDefined();
      expect(err!.message).toContain("paper");
      expect(err!.message).toContain("demo");
      expect(err!.message).toContain("live");
    }
  });

  test("valid config includes default canary config", async () => {
    const result = await loadConfig({ env: env() });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.canaryConfig).toEqual(DEFAULT_CANARY_CONFIG);
    }
  });
});

describe("JSON config override", () => {
  test("--config overrides canary capital limits", async () => {
    await withTmpJsonFile(
      {
        ...DEFAULT_CANARY_CONFIG,
        capitalLimits: {
          maxCapitalUsd: 500,
          maxRiskPerTradeUsd: 25,
          maxDailyLossUsd: 50,
          maxWeeklyLossUsd: 150,
        },
      },
      async (filePath) => {
        const result = await loadConfig({ env: env(), configPath: filePath });

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.config.canaryConfig.capitalLimits.maxCapitalUsd).toBe(500);
          expect(result.config.canaryConfig.capitalLimits.maxRiskPerTradeUsd).toBe(25);
          // Shallow merge: entire capitalLimits object is replaced, so all fields come from override
          expect(result.config.canaryConfig.capitalLimits.maxDailyLossUsd).toBe(50);
        }
      },
    );
  });

  test("--config overrides exposure limits", async () => {
    await withTmpJsonFile(
      {
        ...DEFAULT_CANARY_CONFIG,
        exposureLimits: {
          maxExposurePerTokenUsd: 100,
          maxExposurePerVenueUsd: 250,
          maxExposurePerChainUsd: 250,
        },
      },
      async (filePath) => {
        const result = await loadConfig({ env: env(), configPath: filePath });

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.config.canaryConfig.exposureLimits.maxExposurePerTokenUsd).toBe(100);
        }
      },
    );
  });

  test("--config overrides scope", async () => {
    await withTmpJsonFile(
      {
        ...DEFAULT_CANARY_CONFIG,
        scope: {
          allowedStrategyIds: ["alpha-strategy"],
          allowedVenues: ["bybit"],
          allowedChains: ["ethereum"],
          allowedTokens: ["BTC", "ETH"],
        },
      },
      async (filePath) => {
        const result = await loadConfig({ env: env(), configPath: filePath });

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.config.canaryConfig.scope.allowedTokens).toEqual(["BTC", "ETH"]);
        }
      },
    );
  });

  test("non-existent config file returns error", async () => {
    const result = await loadConfig({
      env: env(),
      configPath: "/tmp/nonexistent-config-12345.json",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result.errors.find((e) => e.field === "CONFIG_PATH");
      expect(err).toBeDefined();
      expect(err!.message).toContain("not found");
    }
  });

  test("invalid JSON file returns error", async () => {
    const dir = mkdtempSync(join(tmpdir(), "config-test-"));
    const filePath = join(dir, "bad.json");
    writeFileSync(filePath, "not valid json {{{");

    try {
      const result = await loadConfig({
        env: env(),
        configPath: filePath,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        const err = result.errors.find((e) => e.field === "CONFIG_PATH");
        expect(err).toBeDefined();
        expect(err!.message).toContain("Failed to parse");
      }
    } finally {
      cleanTmpDir(filePath);
    }
  });

  test("invalid canary config fields return error", async () => {
    await withTmpJsonFile(
      { configId: 123, name: "test" },
      async (filePath) => {
        const result = await loadConfig({ env: env(), configPath: filePath });

        expect(result.ok).toBe(false);
        if (!result.ok) {
          const err = result.errors.find((e) => e.field === "CONFIG_PATH");
          expect(err).toBeDefined();
          expect(err!.message).toContain("Invalid canary config");
        }
      },
    );
  });
});

describe("live mode safety checks", () => {
  test("live mode fails when withdrawalsDisabled is false in config", async () => {
    await withTmpJsonFile(
      {
        ...DEFAULT_CANARY_CONFIG,
        apiKeys: {
          readApiKey: { keyId: "k", secretRef: "s" },
          tradingApiKey: { keyId: "k", secretRef: "s" },
          withdrawalsDisabled: false,
        },
      },
      async (filePath) => {
        const result = await loadConfig({
          env: env({
            MODE: "live",
            BYBIT_API_KEY: "test-key",
            BYBIT_API_SECRET: "test-secret",
          }),
          configPath: filePath,
        });

        expect(result.ok).toBe(false);
        if (!result.ok) {
          const err = result.errors.find((e) => e.field === "WITHDRAWALS_DISABLED");
          expect(err).toBeDefined();
          expect(err!.message).toContain("withdrawals");
        }
      },
    );
  });

  test("live mode succeeds when withdrawalsDisabled is true in config", async () => {
    await withTmpJsonFile(
      {
        ...DEFAULT_CANARY_CONFIG,
        apiKeys: {
          readApiKey: { keyId: "k", secretRef: "s" },
          tradingApiKey: { keyId: "k", secretRef: "s" },
          withdrawalsDisabled: true,
        },
      },
      async (filePath) => {
        const result = await loadConfig({
          env: env({
            MODE: "live",
            BYBIT_API_KEY: "test-key",
            BYBIT_API_SECRET: "test-secret",
          }),
          configPath: filePath,
        });

        expect(result.ok).toBe(true);
      },
    );
  });
});

describe("LOG_LEVEL validation", () => {
  test("valid log levels are accepted", async () => {
    for (const level of ["debug", "info", "warn", "error"]) {
      const result = await loadConfig({ env: env({ LOG_LEVEL: level }) });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.config.logLevel).toBe(level);
      }
    }
  });

  test("invalid log level reports error", async () => {
    const result = await loadConfig({
      env: env({ LOG_LEVEL: "debg" }),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result.errors.find((e) => e.field === "LOG_LEVEL");
      expect(err).toBeDefined();
      expect(err!.message).toContain("Invalid log level");
      expect(err!.message).toContain("debug");
    }
  });

  test("empty log level falls back to default", async () => {
    const result = await loadConfig({ env: env({ LOG_LEVEL: "" }) });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.logLevel).toBe("info");
    }
  });
});

describe("formatConfigErrors", () => {
  test("formats error list into readable message", () => {
    const errors: ConfigError[] = [
      { field: "BYBIT_API_KEY", message: "BYBIT_API_KEY is required for live mode." },
      { field: "BYBIT_API_SECRET", message: "BYBIT_API_SECRET is required for live mode." },
    ];

    const msg = formatConfigErrors(errors);
    expect(msg).toContain("Configuration validation failed:");
    expect(msg).toContain("- BYBIT_API_KEY: BYBIT_API_KEY is required for live mode.");
    expect(msg).toContain("- BYBIT_API_SECRET: BYBIT_API_SECRET is required for live mode.");
  });

  test("formats single error", () => {
    const errors: ConfigError[] = [
      { field: "MODE", message: 'Invalid mode "test". Must be "paper", "demo", or "live".' },
    ];

    const msg = formatConfigErrors(errors);
    expect(msg).toContain("- MODE: Invalid mode \"test\".");
  });
});
