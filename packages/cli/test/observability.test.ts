import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AuditLogger, generateSessionId } from "@agenttrading/core-execution";
import { StatusDisplay, type CycleStatusInput, type KillSwitchTriggerInput } from "../src/status-display.ts";
import { ManifestWriter, type ManifestData } from "../src/manifest.ts";

// ── Helpers ──────────────────────────────────────────────────────────

let tmpDir: string;

function createTmpDir(): string {
  tmpDir = mkdtempSync(join(tmpdir(), "obs-test-"));
  return tmpDir;
}

function cleanTmpDir(): void {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

// ── AuditLogger sessionId Tests ─────────────────────────────────────

describe("AuditLogger — sessionId", () => {
  beforeEach(() => createTmpDir());
  afterEach(() => cleanTmpDir());

  test("generates sessionId automatically when not provided", () => {
    const filePath = join(tmpDir, "test.jsonl");
    const logger = new AuditLogger({ filePath, nowMs: () => 1000 });

    expect(logger.sessionId).toBeTruthy();
    expect(logger.sessionId).toMatch(/^sess-/);
  });

  test("uses provided sessionId", () => {
    const filePath = join(tmpDir, "test.jsonl");
    const logger = new AuditLogger({
      filePath,
      sessionId: "my-session-123",
      nowMs: () => 1000,
    });

    expect(logger.sessionId).toBe("my-session-123");
  });

  test("AC2: every JSONL line includes sessionId", () => {
    const filePath = join(tmpDir, "test.jsonl");
    const logger = new AuditLogger({
      filePath,
      sessionId: "test-sess",
      nowMs: () => 1000,
    });

    logger.record("EVENT_A", { key: "value" });
    logger.record("EVENT_B", { count: 42 });

    const content = readFileSync(filePath, "utf-8");
    const lines = content.trim().split("\n");
    expect(lines.length).toBe(2);

    const event1 = JSON.parse(lines[0]);
    expect(event1.sessionId).toBe("test-sess");
    expect(event1.type).toBe("EVENT_A");
    expect(event1.timestampMs).toBe(1000);
    expect(event1.data.key).toBe("value");

    const event2 = JSON.parse(lines[1]);
    expect(event2.sessionId).toBe("test-sess");
    expect(event2.type).toBe("EVENT_B");
    expect(event2.data.count).toBe(42);
  });

  test("AC2: each line has timestamp, event type, payload, session id", () => {
    const filePath = join(tmpDir, "test.jsonl");
    const logger = new AuditLogger({
      filePath,
      sessionId: "sess-abc",
      nowMs: () => 5000,
    });

    logger.record("REGIME_CHANGED", { regime: "trend", confidence: 0.8 });

    const content = readFileSync(filePath, "utf-8");
    const event = JSON.parse(content.trim());

    // Verify required fields
    expect(event).toHaveProperty("timestampMs");
    expect(event).toHaveProperty("type");
    expect(event).toHaveProperty("data");
    expect(event).toHaveProperty("sessionId");
    expect(typeof event.timestampMs).toBe("number");
    expect(typeof event.type).toBe("string");
    expect(typeof event.data).toBe("object");
    expect(typeof event.sessionId).toBe("string");
  });
});

// ── StatusDisplay Tests ──────────────────────────────────────────────

describe("StatusDisplay", () => {
  let capturedLogs: string[];

  beforeEach(() => {
    capturedLogs = [];
    // Spy on console.log
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      capturedLogs.push(args.map(String).join(" "));
    };
    // Store original for cleanup
    (console as unknown as { _originalLog: typeof console.log })._originalLog = originalLog;
  });

  afterEach(() => {
    console.log = (console as unknown as { _originalLog: typeof console.log })._originalLog;
  });

  test("AC3: printCycleStatus shows mode, regime, PnL, open orders, kill switch", () => {
    const display = new StatusDisplay({ mode: "demo" });

    const status: CycleStatusInput = {
      mode: "demo",
      cycleCount: 5,
      regime: "trend",
      regimeConfidence: 0.85,
      pnlUsd: 12.50,
      openOrders: 2,
      killSwitchActive: false,
      submitted: 1,
      blocked: 0,
      totalTrades: 3,
    };

    display.printCycleStatus(status);

    expect(capturedLogs.length).toBe(1);
    const output = capturedLogs[0];
    expect(output).toContain("demo");
    expect(output).toContain("Cycle 5");
    expect(output).toContain("regime=trend");
    expect(output).toContain("(85%)");
    expect(output).toContain("PnL=$12.50");
    expect(output).toContain("open=2");
    expect(output).toContain("trades=3");
    expect(output).toContain("✅");
  });

  test("AC3: kill switch active shows ⛔ KILL", () => {
    const display = new StatusDisplay({ mode: "live" });

    const status: CycleStatusInput = {
      mode: "live",
      cycleCount: 10,
      regime: "drawdown",
      regimeConfidence: 0.9,
      pnlUsd: -50.00,
      openOrders: 0,
      killSwitchActive: true,
      submitted: 0,
      blocked: 0,
      totalTrades: 5,
    };

    display.printCycleStatus(status);

    expect(capturedLogs.length).toBe(1);
    expect(capturedLogs[0]).toContain("⛔ KILL");
    expect(capturedLogs[0]).toContain("PnL=$-50.00");
  });

  test("AC4: printRegimeChange shows timestamp and regime transition", () => {
    const display = new StatusDisplay({ mode: "demo" });

    display.printRegimeChange({
      fromRegime: "low_vol",
      toRegime: "trend",
      confidence: 0.75,
      timestampMs: 1700000000000,
    });

    expect(capturedLogs.length).toBe(1);
    const output = capturedLogs[0];
    expect(output).toContain("Regime change");
    expect(output).toContain("low_vol → trend");
    expect(output).toContain("(confidence: 75%)");
  });

  test("AC5: printOrderEvent shows submitted order", () => {
    const display = new StatusDisplay({ mode: "demo" });

    display.printOrderEvent({
      orderId: "ord-1",
      event: "submitted",
      symbol: "BTCUSDT",
      side: "BUY",
      quantity: 0.001,
    });

    expect(capturedLogs.length).toBe(1);
    expect(capturedLogs[0]).toContain("Order submitted");
    expect(capturedLogs[0]).toContain("▲");
    expect(capturedLogs[0]).toContain("BTCUSDT");
    expect(capturedLogs[0]).toContain("BUY");
  });

  test("AC5: printOrderEvent shows filled order with price", () => {
    const display = new StatusDisplay({ mode: "live" });

    display.printOrderEvent({
      orderId: "ord-2",
      event: "filled",
      symbol: "ETHUSDT",
      side: "SELL",
      quantity: 0.1,
      fillPrice: 2500.50,
      feesUsd: 0.5001,
    });

    expect(capturedLogs.length).toBe(1);
    expect(capturedLogs[0]).toContain("FILL");
    expect(capturedLogs[0]).toContain("▼");
    expect(capturedLogs[0]).toContain("$2500.50");
    expect(capturedLogs[0]).toContain("$0.5001");
  });

  test("AC5: printOrderEvent shows rejected order with reason", () => {
    const display = new StatusDisplay({ mode: "live" });

    display.printOrderEvent({
      orderId: "ord-3",
      event: "rejected",
      symbol: "BTCUSDT",
      side: "BUY",
      quantity: 1.0,
      reason: "exceeds max risk per trade",
    });

    expect(capturedLogs.length).toBe(1);
    expect(capturedLogs[0]).toContain("REJECTED");
    expect(capturedLogs[0]).toContain("exceeds max risk per trade");
  });

  test("AC6: printKillSwitchTrigger shows reason and threshold", () => {
    const display = new StatusDisplay({ mode: "live" });

    const trigger: KillSwitchTriggerInput = {
      trigger: "daily-loss",
      reason: "daily loss $100 >= auto-halt threshold $100",
      threshold: 100,
      limit: 100,
    };

    display.printKillSwitchTrigger(trigger);

    expect(capturedLogs.length).toBeGreaterThanOrEqual(3); // At least header, trigger, reason, threshold
    const output = capturedLogs.join("\n");
    expect(output).toContain("KILL SWITCH ACTIVATED");
    expect(output).toContain("daily-loss");
    expect(output).toContain("daily loss $100");
    expect(output).toContain("100 / 100");
  });
});

// ── ManifestWriter Tests ─────────────────────────────────────────────

describe("ManifestWriter", () => {
  beforeEach(() => createTmpDir());
  afterEach(() => cleanTmpDir());

  test("tracks file entries", () => {
    const manifest = new ManifestWriter({
      sessionId: "sess-test",
      startedAtMs: 1000,
      nowMs: () => 2000,
    });

    manifest.track("audit-log", "./audit.jsonl", 1024);
    manifest.track("summary", "./summary.json", 512);

    expect(manifest.count).toBe(2);
    expect(manifest.files[0].category).toBe("audit-log");
    expect(manifest.files[0].path).toBe("./audit.jsonl");
    expect(manifest.files[0].sizeBytes).toBe(1024);
    expect(manifest.files[1].category).toBe("summary");
  });

  test("AC10: writeManifest writes manifest JSON file", () => {
    const manifest = new ManifestWriter({
      sessionId: "sess-abc",
      startedAtMs: 1000,
      nowMs: () => 5000,
    });

    manifest.track("audit-log", "./audit.jsonl", 2048);
    manifest.track("report-json", "./report.json", 1024);

    const manifestPath = join(tmpDir, "manifest.json");
    const data = manifest.writeManifest(manifestPath);

    expect(data.sessionId).toBe("sess-abc");
    expect(data.startedAtMs).toBe(1000);
    expect(data.endedAtMs).toBe(5000);
    expect(data.files.length).toBe(3); // 2 tracked + 1 manifest itself
    expect(data.totalFiles).toBe(3);

    // Verify the manifest file on disk
    const content = readFileSync(manifestPath, "utf-8");
    const parsed = JSON.parse(content);
    expect(parsed.sessionId).toBe("sess-abc");
    expect(parsed.files.length).toBe(3);
    expect(parsed.files.some((f: { category: string }) => f.category === "manifest")).toBe(true);
  });

  test("manifest includes all required categories", () => {
    const manifest = new ManifestWriter({
      sessionId: "sess-full",
      startedAtMs: 1000,
    });

    manifest.track("audit-log", "./audit.jsonl");
    manifest.track("report-json", "./report.json");
    manifest.track("report-csv", "./report.csv");
    manifest.track("report-txt", "./report.txt");
    manifest.track("summary", "./summary.json");

    const manifestPath = join(tmpDir, "manifest.json");
    const data = manifest.writeManifest(manifestPath);

    const categories = data.files.map((f) => f.category);
    expect(categories).toContain("audit-log");
    expect(categories).toContain("report-json");
    expect(categories).toContain("report-csv");
    expect(categories).toContain("report-txt");
    expect(categories).toContain("summary");
    expect(categories).toContain("manifest");
  });

  test("manifest is valid JSON with proper structure", () => {
    const manifest = new ManifestWriter({
      sessionId: "sess-json",
      startedAtMs: 1000,
      nowMs: () => 3000,
    });

    manifest.track("audit-log", "./audit.jsonl");

    const manifestPath = join(tmpDir, "manifest.json");
    manifest.writeManifest(manifestPath);

    const content = readFileSync(manifestPath, "utf-8");
    const parsed: ManifestData = JSON.parse(content);

    // Verify top-level structure
    expect(typeof parsed.sessionId).toBe("string");
    expect(typeof parsed.startedAtMs).toBe("number");
    expect(typeof parsed.endedAtMs).toBe("number");
    expect(Array.isArray(parsed.files)).toBe(true);
    expect(typeof parsed.totalFiles).toBe("number");

    // Verify entry structure
    for (const file of parsed.files) {
      expect(typeof file.category).toBe("string");
      expect(typeof file.path).toBe("string");
      expect(typeof file.sizeBytes).toBe("number");
      expect(typeof file.writtenAtMs).toBe("number");
    }
  });
});

// ── generateSessionId Tests ──────────────────────────────────────────

describe("generateSessionId", () => {
  test("produces sess-YYYYMMDD-HHmmss-<hex> format", () => {
    const id = generateSessionId(1700000000000);
    expect(id).toMatch(/^sess-\d{8}-\d{6}-[0-9a-f]{8}$/);
  });

  test("uses provided timestamp", () => {
    // 2023-11-14T22:13:20.000Z
    const id = generateSessionId(1700000000000);
    expect(id).toContain("20231114");
    expect(id).toContain("221320");
  });

  test("uses Date.now() when no timestamp provided", () => {
    const id = generateSessionId();
    expect(id).toMatch(/^sess-/);
  });

  test("generates unique IDs on successive calls", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(generateSessionId());
    }
    // With random suffix, collisions should be extremely rare
    expect(ids.size).toBe(100);
  });
});
