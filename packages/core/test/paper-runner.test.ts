import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PaperAuditLogger } from "../src/paper/audit-logger.ts";
import { buildSessionReport, printSessionReport } from "../src/paper/session-report.ts";
import { PaperRunner } from "../src/paper/paper-runner.ts";

// ── Helpers ──────────────────────────────────────────────────────────

let tmpDir: string;

function createTmpDir(): string {
  tmpDir = mkdtempSync(join(tmpdir(), "paper-test-"));
  return tmpDir;
}

function cleanTmpDir(): void {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

/** Mock WebSocket for testing. */
function createMockWs() {
  const messages: string[] = [];
  const handlers: Record<string, (event: unknown) => void> = {};

  const ws = {
    readyState: 1, // OPEN
    messages,
    close() {},
    send(data: string) {
      messages.push(data);
    },
    addEventListener(type: string, handler: (event: unknown) => void) {
      handlers[type] = handler;
    },
    simulateMessage(data: string) {
      handlers["message"]?.({ data });
    },
    simulateOpen() {
      handlers["open"]?.({});
    },
    simulateClose() {
      handlers["close"]?.({ reason: "test" });
    },
  };

  return ws;
}

// ── AuditLogger Tests ────────────────────────────────────────────────

describe("PaperAuditLogger", () => {
  beforeEach(() => createTmpDir());
  afterEach(() => cleanTmpDir());

  test("creates file and records events", () => {
    const filePath = join(tmpDir, "test.jsonl");
    const logger = new PaperAuditLogger({ filePath, nowMs: () => 1000 });

    logger.record("SESSION_STARTED", { symbols: ["BTCUSDT"] });
    logger.record("CYCLE_COMPLETE", { cycleCount: 1 });

    expect(logger.count).toBe(2);

    const content = readFileSync(filePath, "utf-8");
    const lines = content.trim().split("\n");
    expect(lines.length).toBe(2);

    const event1 = JSON.parse(lines[0]);
    expect(event1.type).toBe("SESSION_STARTED");
    expect(event1.timestampMs).toBe(1000);
    expect(event1.data.symbols).toEqual(["BTCUSDT"]);

    const event2 = JSON.parse(lines[1]);
    expect(event2.type).toBe("CYCLE_COMPLETE");
    expect(event2.data.cycleCount).toBe(1);
  });

  test("flush is a no-op (synchronous writes)", () => {
    const filePath = join(tmpDir, "test.jsonl");
    const logger = new PaperAuditLogger({ filePath, nowMs: () => 1000 });

    logger.record("TEST", { key: "value" });
    logger.flush(); // Should not throw

    expect(logger.count).toBe(1);
  });
});

// ── SessionReport Tests ──────────────────────────────────────────────

describe("SessionReport", () => {
  test("builds a session report from counters", () => {
    const report = buildSessionReport({
      startedAtMs: 1000,
      endedAtMs: 5000,
      cycleCount: 10,
      opportunitiesDetected: 2,
      ordersSubmitted: 1,
      ordersFilled: 1,
      ordersBlocked: 1,
      trades: [
        {
          orderId: "trade-1",
          symbol: "BTCUSDT",
          side: "BUY",
          fillPrice: 100,
          fillQuantity: 0.01,
          notionalUsd: 1,
          feesUsd: 0.002,
          slippageBps: 10,
          filledAtMs: 2000,
        },
      ],
      regimeChangeCount: 3,
      finalRegime: "trend",
      learningRecommendationCount: 5,
      auditEventCount: 50,
    });

    expect(report.durationMs).toBe(4000);
    expect(report.cycleCount).toBe(10);
    expect(report.trades.length).toBe(1);
    expect(report.trades[0].symbol).toBe("BTCUSDT");
    expect(report.regimeChangeCount).toBe(3);
    expect(report.finalRegime).toBe("trend");
  });

  test("printSessionReport does not throw", () => {
    const report = buildSessionReport({
      startedAtMs: 1000,
      endedAtMs: 5000,
      cycleCount: 10,
      opportunitiesDetected: 2,
      ordersSubmitted: 1,
      ordersFilled: 1,
      ordersBlocked: 1,
      trades: [],
      regimeChangeCount: 3,
      finalRegime: "trend",
      learningRecommendationCount: 5,
      auditEventCount: 50,
    });

    // Should not throw
    printSessionReport(report);
  });
});

// ── PaperRunner Tests ────────────────────────────────────────────────

describe("PaperRunner", () => {
  beforeEach(() => createTmpDir());
  afterEach(() => cleanTmpDir());

  test("constructor initializes subsystems", () => {
    const runner = new PaperRunner({
      symbols: ["BTCUSDT"],
      cycleIntervalMs: 1000,
      auditLogPath: join(tmpDir, "test.jsonl"),
      nowMs: () => 1000,
    });

    // Should be constructable without errors
    expect(runner).toBeDefined();
  });

  test("start connects WebSocket and starts session", async () => {
    const mockWs = createMockWs();
    const runner = new PaperRunner({
      symbols: ["BTCUSDT"],
      cycleIntervalMs: 100,
      auditLogPath: join(tmpDir, "test.jsonl"),
      nowMs: () => 1000,
      wsFactory: () => mockWs as never,
    });

    await runner.start();

    // WebSocket should have received subscribe message
    const subscribeMsg = mockWs.messages.find((m) => m.includes("subscribe"));
    expect(subscribeMsg).toBeDefined();
    expect(subscribeMsg).toContain("orderbook.50.BTCUSDT");
    expect(subscribeMsg).toContain("trade.BTCUSDT");

    runner.stop();
  });

  test("stop produces session report", async () => {
    const mockWs = createMockWs();
    const runner = new PaperRunner({
      symbols: ["BTCUSDT"],
      cycleIntervalMs: 100,
      auditLogPath: join(tmpDir, "test.jsonl"),
      nowMs: () => 1000,
      wsFactory: () => mockWs as never,
    });

    await runner.start();
    const artifacts = runner.stop();

    // Audit log should have SESSION_STARTED and SESSION_ENDED events
    const content = readFileSync(join(tmpDir, "test.jsonl"), "utf-8");
    expect(content).toContain("SESSION_STARTED");
    expect(content).toContain("SESSION_ENDED");
    expect(artifacts?.evidence.credentialFree).toBe(true);
    expect(artifacts?.evidence.verdict).toBe("fail");
    expect(artifacts?.evidence.reasons).toContain("paper cycle did not execute");
  });

  test("receives orderbook data and updates market state", async () => {
    const mockWs = createMockWs();
    let cycleReported = false;

    const runner = new PaperRunner({
      symbols: ["BTCUSDT"],
      cycleIntervalMs: 50,
      auditLogPath: join(tmpDir, "test.jsonl"),
      nowMs: () => 1000,
      wsFactory: () => mockWs as never,
    });

    runner.on({
      onCycle: () => { cycleReported = true; },
    });

    await runner.start();

    // Simulate orderbook data
    mockWs.simulateMessage(JSON.stringify({
      topic: "orderbook.50.BTCUSDT",
      data: {
        s: "BTCUSDT",
        b: [{ price: "50000", size: "1" }, { price: "49999", size: "2" }],
        a: [{ price: "50001", size: "1" }, { price: "50002", size: "2" }],
      },
    }));

    // Wait for a cycle
    await new Promise((r) => setTimeout(r, 100));

    runner.stop();

    // Audit log should have CYCLE_COMPLETE
    const content = readFileSync(join(tmpDir, "test.jsonl"), "utf-8");
    expect(content).toContain("CYCLE_COMPLETE");
  });

  test("emits promotion evidence after a paper cycle", async () => {
    const mockWs = createMockWs();
    const runner = new PaperRunner({
      symbols: ["BTCUSDT"],
      cycleIntervalMs: 50,
      auditLogPath: join(tmpDir, "test.jsonl"),
      nowMs: () => 1000,
      wsFactory: () => mockWs as never,
    });

    await runner.start();
    mockWs.simulateMessage(JSON.stringify({
      topic: "orderbook.50.BTCUSDT",
      data: {
        s: "BTCUSDT",
        b: [{ price: "50000", size: "1" }],
        a: [{ price: "50001", size: "1" }],
      },
    }));

    await new Promise((r) => setTimeout(r, 100));

    const artifacts = runner.stop();
    expect(artifacts).toBeDefined();
    expect(artifacts?.evidence.credentialFree).toBe(true);
    expect(artifacts?.evidence.endToEndLoopValidated).toBe(true);
    expect(artifacts?.evidence.failClosedValidated).toBe(true);
    expect(artifacts?.evidence.verdict).toBe("pass");
    expect(artifacts?.report.auditEventCount).toBeGreaterThan(0);
  });

  test("handles graceful shutdown via stop()", async () => {
    const mockWs = createMockWs();
    const runner = new PaperRunner({
      symbols: ["BTCUSDT"],
      cycleIntervalMs: 100,
      auditLogPath: join(tmpDir, "test.jsonl"),
      nowMs: () => 1000,
      wsFactory: () => mockWs as never,
    });

    await runner.start();
    runner.stop();

    // Should complete without errors
    const content = readFileSync(join(tmpDir, "test.jsonl"), "utf-8");
    const lines = content.trim().split("\n");
    const events = lines.map((l) => JSON.parse(l));
    const types = events.map((e: { type: string }) => e.type);

    expect(types).toContain("SESSION_STARTED");
    expect(types).toContain("SESSION_ENDED");
  });
});
