import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writePaperPromotionEvidence } from "../src/index.ts";

let tmpDir: string;

function createTmpDir(): string {
  tmpDir = mkdtempSync(join(tmpdir(), "paper-evidence-test-"));
  return tmpDir;
}

function cleanTmpDir(): void {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

describe("writePaperPromotionEvidence", () => {
  beforeEach(() => createTmpDir());
  afterEach(() => cleanTmpDir());

  test("writes a durable evidence artifact", () => {
    const filePath = join(tmpDir, "evidence.json");

    writePaperPromotionEvidence(filePath, {
      startedAtMs: 1000,
      endedAtMs: 2000,
      durationMs: 1000,
      credentialFree: true,
      endToEndLoopValidated: true,
      reconciliationResolved: true,
      failClosedValidated: true,
      gracefulShutdownValidated: true,
      auditEventCount: 4,
      cycleCount: 1,
      ordersSubmitted: 1,
      ordersFilled: 1,
      ordersBlocked: 0,
      verdict: "pass",
      reasons: [],
    });

    const parsed = JSON.parse(readFileSync(filePath, "utf-8"));
    expect(parsed.credentialFree).toBe(true);
    expect(parsed.verdict).toBe("pass");
    expect(parsed.cycleCount).toBe(1);
  });
});
