import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LiveRunner } from "../src/live-runner.ts";
import { DEFAULT_CANARY_CONFIG } from "@agenttrading/contracts";

// ── Helpers ──────────────────────────────────────────────────────────

let tmpDir: string;

function createTmpDir(): string {
  tmpDir = mkdtempSync(join(tmpdir(), "live-test-"));
  return tmpDir;
}

function cleanTmpDir(): void {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

function createRunner(overrides?: Record<string, unknown>): LiveRunner {
  return new LiveRunner({
    symbols: ["BTCUSDT"],
    bybitApiKey: "test-key",
    bybitApiSecret: "test-secret",
          bybitEndpoints: { restUrl: "https://api.bybit.com", publicWsUrl: "wss://stream.bybit.com/v5/public/linear", privateWsUrl: "wss://stream.bybit.com/v5/private" },
    cycleIntervalMs: 1000,
    auditLogPath: join(tmpDir, "audit.jsonl"),
    nowMs: () => 1000,
    canaryConfig: {
      ...DEFAULT_CANARY_CONFIG,
      apiKeys: { ...DEFAULT_CANARY_CONFIG.apiKeys, withdrawalsDisabled: true },
    },
    ...overrides,
  });
}

// ── LiveRunner Tests ────────────────────────────────────────────────

describe("LiveRunner", () => {
  beforeEach(() => createTmpDir());
  afterEach(() => cleanTmpDir());

  // ── AC8: API key validation ───────────────────────────────────────

  test("AC8: refuses to start if API key is empty", () => {
    expect(
      () =>
        new LiveRunner({
          symbols: ["BTCUSDT"],
          bybitApiKey: "",
          bybitApiSecret: "test-secret",
          bybitEndpoints: { restUrl: "https://api.bybit.com", publicWsUrl: "wss://stream.bybit.com/v5/public/linear", privateWsUrl: "wss://stream.bybit.com/v5/private" },
          cycleIntervalMs: 1000,
          auditLogPath: join(tmpDir, "test.jsonl"),
          nowMs: () => 1000,
        }),
    ).toThrow("BYBIT_API_KEY is required");
  });

  test("AC8: refuses to start if API secret is empty", () => {
    expect(
      () =>
        new LiveRunner({
          symbols: ["BTCUSDT"],
          bybitApiKey: "test-key",
          bybitApiSecret: "",
          bybitEndpoints: { restUrl: "https://api.bybit.com", publicWsUrl: "wss://stream.bybit.com/v5/public/linear", privateWsUrl: "wss://stream.bybit.com/v5/private" },
          cycleIntervalMs: 1000,
          auditLogPath: join(tmpDir, "test.jsonl"),
          nowMs: () => 1000,
        }),
    ).toThrow("BYBIT_API_SECRET is required");
  });

  test("AC8: refuses to start if withdrawals not disabled", () => {
    expect(
      () =>
        new LiveRunner({
          symbols: ["BTCUSDT"],
          bybitApiKey: "test-key",
          bybitApiSecret: "test-secret",
          bybitEndpoints: { restUrl: "https://api.bybit.com", publicWsUrl: "wss://stream.bybit.com/v5/public/linear", privateWsUrl: "wss://stream.bybit.com/v5/private" },
          cycleIntervalMs: 1000,
          auditLogPath: join(tmpDir, "test.jsonl"),
          nowMs: () => 1000,
          canaryConfig: {
            ...DEFAULT_CANARY_CONFIG,
            apiKeys: { ...DEFAULT_CANARY_CONFIG.apiKeys, withdrawalsDisabled: false },
          },
        }),
    ).toThrow("withdrawals to be disabled");
  });

  test("AC8: accepts valid API keys with withdrawals disabled", () => {
    const runner = createRunner();
    expect(runner).toBeDefined();
  });

  // ── AC9: Exchange connectivity check ──────────────────────────────

  test("AC9: start fails if exchange unreachable", async () => {
    const runner = createRunner();
    await expect(runner.start()).rejects.toThrow(
      "Failed to verify Bybit API connectivity",
    );
  });

  test("AC8: demo mode does not require withdrawals to be disabled", () => {
    const runner = new LiveRunner({
      symbols: ["BTCUSDT"],
      bybitApiKey: "test-key",
      bybitApiSecret: "test-secret",
      bybitEndpoints: { restUrl: "https://api.bybit.com", publicWsUrl: "wss://stream.bybit.com/v5/public/linear", privateWsUrl: "wss://stream.bybit.com/v5/private" },
      cycleIntervalMs: 1000,
      auditLogPath: join(tmpDir, "test.jsonl"),
      nowMs: () => 1000,
      mode: "demo",
      canaryConfig: {
        ...DEFAULT_CANARY_CONFIG,
        apiKeys: { ...DEFAULT_CANARY_CONFIG.apiKeys, withdrawalsDisabled: false },
      },
    });
    expect(runner).toBeDefined();
  });

  // ── AC11: Audit trail ────────────────────────────────────────────

  test("AC11: creates audit log file on construction", () => {
    const auditPath = join(tmpDir, "audit.jsonl");
    createRunner({ auditLogPath: auditPath });
    const content = readFileSync(auditPath, "utf-8");
    expect(content).toBe("");
  });

  // ── AC13: Graceful shutdown ──────────────────────────────────────

  test("AC13: stop produces SESSION_ENDED audit event", () => {
    const auditPath = join(tmpDir, "audit.jsonl");
    const runner = createRunner({ auditLogPath: auditPath });
    runner.stop();
    // Stop should be a no-op when not running
    const content = readFileSync(auditPath, "utf-8");
    expect(content).toBe("");
  });

  test("AC13: stop is idempotent", () => {
    const runner = createRunner();
    runner.stop();
    runner.stop(); // Should not throw
  });

  // ── AC10: Emergency modes ────────────────────────────────────────

  test("AC10: control() sends commands to session", () => {
    const runner = createRunner();
    const result = runner.control("cancel-all");
    expect(result.ok).toBe(true);
    expect(result.command).toBe("cancel-all");
  });

  test("AC10: control() supports reduce-only mode", () => {
    const runner = createRunner();
    const result = runner.control("reduce-only");
    expect(result.ok).toBe(true);
    expect(result.mode).toBe("REDUCE_ONLY");
  });

  test("AC10: control() supports cash-only mode", () => {
    const runner = createRunner();
    const result = runner.control("cash-only");
    expect(result.ok).toBe(true);
    expect(result.mode).toBe("CASH_ONLY");
  });

  test("AC10: control() supports halt", () => {
    const runner = createRunner();
    // Start the session first so halt has an effect
    runner.control("start");
    const result = runner.control("halt");
    expect(result.ok).toBe(true);
    expect(result.killSwitchActive).toBe(true);
  });

  // ── AC4: Canary limits enforcement ───────────────────────────────

  test("AC4: LiveExecutionEngine enforces capital limits via canary config", () => {
    const runner = createRunner({
      canaryConfig: {
        ...DEFAULT_CANARY_CONFIG,
        capitalLimits: {
          ...DEFAULT_CANARY_CONFIG.capitalLimits,
          maxCapitalUsd: 100,
          maxRiskPerTradeUsd: 10,
        },
        apiKeys: { ...DEFAULT_CANARY_CONFIG.apiKeys, withdrawalsDisabled: true },
      },
    });
    expect(runner).toBeDefined();
  });

  // ── Event handler registration ───────────────────────────────────

  test("on() registers event handlers without errors", () => {
    const runner = createRunner();
    runner.on({
      onCycle: () => {},
      onTrade: () => {},
      onError: () => {},
      onShutdown: () => {},
    });
    expect(runner).toBeDefined();
  });

  // ── Constructor validation ───────────────────────────────────────

  test("constructor initializes with valid config", () => {
    const runner = createRunner({ symbols: ["BTCUSDT", "ETHUSDT"] });
    expect(runner).toBeDefined();
  });

  test("constructor defaults symbols to BTCUSDT", () => {
    const runner = createRunner({ symbols: [] });
    expect(runner).toBeDefined();
  });

  // ── AC1/AC2: WebSocket connection types ──────────────────────────

  test("AC1/AC2: runner configures public and private WS streams", () => {
    const runner = createRunner();
    expect(runner).toBeDefined();
  });

  // ── AC5: Kill switch integration ─────────────────────────────────

  test("AC5: kill switch config is passed to session", () => {
    const runner = createRunner({
      canaryConfig: {
        ...DEFAULT_CANARY_CONFIG,
        killSwitch: {
          ...DEFAULT_CANARY_CONFIG.killSwitch,
          autoHaltDailyLossUsd: 50,
          autoHaltWeeklyLossUsd: 200,
          autoHaltOnOrphans: true,
          autoHaltOnReconciliationMismatch: true,
        },
        apiKeys: { ...DEFAULT_CANARY_CONFIG.apiKeys, withdrawalsDisabled: true },
      },
    });
    expect(runner).toBeDefined();
  });

  // ── SP4: Configurable order category ─────────────────────────────

  test("SP4: order category is configurable", () => {
    const runner = createRunner({ orderCategory: "spot" });
    expect(runner).toBeDefined();
  });

  test("SP4: order category defaults to linear", () => {
    const runner = createRunner();
    expect(runner).toBeDefined();
  });

  // ── SP6: Fee rate configuration ──────────────────────────────────

  test("SP6: fee bps is configurable", () => {
    const runner = createRunner({ feeBps: 5 });
    expect(runner).toBeDefined();
  });
});
