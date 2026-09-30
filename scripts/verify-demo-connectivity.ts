#!/usr/bin/env bun
/**
 * verify-demo-connectivity.ts
 *
 * Read-only connectivity verification for Bybit Demo Trading.
 *
 * Checks:
 *   1. Public connectivity   : GET /v5/market/time        (no auth required)
 *   2. API key validity      : GET /v5/account/info       (HMAC-SHA256 signed)
 *   3. Account reachability  : GET /v5/account/wallet-balance  (HMAC-SHA256 signed)
 *
 * IMPORTANT: No orders are placed. No state is modified. All calls are read-only.
 * API keys and secrets are never logged in plaintext.
 */

import { BybitRESTClient, DEMO_BASE_URL, BybitAPIError } from "../packages/connectors/src/bybit-rest.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface CheckResult {
  name: string;
  passed: boolean;
  detail: string;
}

function redactKey(key: string): string {
  if (key.length <= 8) return "[REDACTED]";
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

function parseEnv(content: string, varName: string): string {
  const match = content.match(new RegExp(`^${varName}=(.*)$`, "m"));
  if (!match) throw new Error(`${varName} not found in .env`);
  return match[1].trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const results: CheckResult[] = [];
  const cwd = process.cwd();
  const envPath = `${cwd}/.env`;

  // ── Step 0: Read credentials ────────────────────────────────────────────

  results.push({ name: ".env exists", passed: false, detail: "" });

  const envFile = Bun.file(envPath);
  if (!(await envFile.exists())) {
    results[0] = { name: ".env exists", passed: false, detail: ".env file not found" };
    printReport(results);
    process.exit(1);
  }
  results[0] = { name: ".env exists", passed: true, detail: "Found" };

  const envContent = await envFile.text();

  let apiKey: string;
  let apiSecret: string;

  try {
    apiKey = parseEnv(envContent, "BYBIT_API_KEY");
    apiSecret = parseEnv(envContent, "BYBIT_API_SECRET");
  } catch (err) {
    results.push({
      name: ".env: credentials present",
      passed: false,
      detail: err instanceof Error ? err.message : String(err),
    });
    printReport(results);
    process.exit(1);
  }

  results.push({
    name: ".env: credentials loaded",
    passed: true,
    detail: `BYBIT_API_KEY=${redactKey(apiKey)}  (secret hidden)`,
  });

  // ── Step 1: Public connectivity + timestamp sync ────────────────────────

  const t0 = Date.now();
  let serverTimeMs = 0;
  try {
    const publicUrl = `${DEMO_BASE_URL}/v5/market/time`;
    const res = await fetch(publicUrl);
    const body = (await res.json()) as {
      retCode: number;
      retMsg: string;
      result: { timeSecond: string; timeNano: string };
    };
    const latencyMs = Date.now() - t0;

    if (body.retCode !== 0) {
      results.push({
        name: "Public connectivity  (GET /v5/market/time)",
        passed: false,
        detail: `Bybit error ${body.retCode}: ${body.retMsg}`,
      });
    } else {
      serverTimeMs = parseInt(body.result.timeNano, 10) / 1_000_000;
      const clientTimeMs = Date.now();
      const drift = clientTimeMs - serverTimeMs;
      const serverTime = new Date(serverTimeMs).toISOString();
      let detail = `OK (${latencyMs} ms) — server time: ${serverTime}`;
      if (Math.abs(drift) > 3000) {
        detail += ` | WARNING: clock drift ${drift >= 0 ? '+' : ''}${drift.toFixed(0)} ms (|drift| > 3000 ms)`;
      }
      results.push({
        name: "Public connectivity  (GET /v5/market/time)",
        passed: true,
        detail,
      });
    }
  } catch (err) {
    results.push({
      name: "Public connectivity  (GET /v5/market/time)",
      passed: false,
      detail: err instanceof Error ? err.message : String(err),
    });
  }


  // ── Step 2: API key validity ────────────────────────────────────────────

  // Brief pause to be polite to the API
  await sleep(500);

  const client = new BybitRESTClient({
    apiKey,
    apiSecret,
    baseUrl: DEMO_BASE_URL,
    recvWindow: 10000,
    maxRetries: 2,
    initialBackoffMs: 1000,
  });

  const t1 = Date.now();
  try {
    const wallet = await client.getAccountInfo();
    const latencyMs = Date.now() - t1;
    const accountType = wallet.list[0]?.accountType ?? "unknown";
    const totalEquity = wallet.list[0]?.totalEquity ?? "0";
    results.push({
      name: "API key validity  (GET /v5/account/wallet-balance)",
      passed: true,
      detail: `OK (${latencyMs} ms) — account type: ${accountType}, total equity: ${totalEquity}`,
    });
  } catch (err) {
    if (err instanceof BybitAPIError) {
      results.push({
        name: "API key validity  (GET /v5/account/wallet-balance)",
        passed: false,
        detail: `Bybit error ${err.retCode}: ${err.retMsg}`,
      });
    } else {
      results.push({
        name: "API key validity  (GET /v5/account/wallet-balance)",
        passed: false,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ── Step 3: Account reachability ────────────────────────────────────────

  await sleep(500);

  const t2 = Date.now();
  try {
    const wallet = await client.getAccountInfo();
    const latencyMs = Date.now() - t2;
    const totalEquity = wallet.list[0]?.totalEquity ?? "0";
    const accountType = wallet.list[0]?.accountType ?? "unknown";
    results.push({
      name: "Account reachability  (GET /v5/account/wallet-balance)",
      passed: true,
      detail: `OK (${latencyMs} ms) — type: ${accountType}, total equity: ${totalEquity}`,
    });
  } catch (err) {
    if (err instanceof BybitAPIError) {
      results.push({
        name: "Account reachability  (GET /v5/account/wallet-balance)",
        passed: false,
        detail: `Bybit error ${err.retCode}: ${err.retMsg}`,
      });
    } else {
      results.push({
        name: "Account reachability  (GET /v5/account/wallet-balance)",
        passed: false,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ── Report ──────────────────────────────────────────────────────────────

  printReport(results);
}

function printReport(results: CheckResult[]): void {
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  const allPassed = failed === 0;

  console.log("\n=== Bybit Demo Trading Connectivity Verification ===\n");
  for (const r of results) {
    const icon = r.passed ? "PASS" : "FAIL";
    console.log(`  [${icon}] ${r.name}: ${r.detail}`);
  }
  console.log(`\nTotal: ${results.length} | Passed: ${passed} | Failed: ${failed}`);
  console.log(
    allPassed
      ? "\nResult: PASS — Bybit Demo Trading is reachable and credentials are valid.\n"
      : "\nResult: FAIL — one or more connectivity checks failed.\n",
  );

  process.exit(allPassed ? 0 : 1);
}

main();
