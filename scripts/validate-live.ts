#!/usr/bin/env bun
/**
 * validate-live.ts
 *
 * Validates that the Meridian system is ready for live canary trading.
 *
 * Checks:
 *   1. canary-live.json exists, is valid JSON, and passes parseCanaryConfig
 *   2. canary-live.json differs from canary-demo.json (different limits)
 *   3. Config safety constraints:
 *      - withdrawalsDisabled is true
 *      - maxCapitalUsd <= 1000
 *      - maxRiskPerTradeUsd <= 50
 *      - autoHaltDailyLossUsd is set and <= 25% of maxCapitalUsd
 *      - noAutomaticScaling is true
 *   4. .env exists, has MODE=live, and has non-empty Bybit API keys
 *   5. Live endpoints are configured (MODE=live implies mainnet Bybit endpoints)
 *   6. bun run typecheck passes
 *   7. bun test passes with >= 1400 tests
 *   8. bun run validate:costs passes
 *   9. bun run validate:demo passes (demo evidence required before live)
 *
 * Exit 0 if all checks pass, 1 if any fail.
 */

import { parseCanaryConfig } from "../packages/contracts/src/index.ts";
import * as fs from "fs";
import * as path from "path";
import { spawnSync } from "child_process";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CheckResult {
  name: string;
  passed: boolean;
  detail: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fileExistsCheck(filePath: string): CheckResult {
  const exists = fs.existsSync(filePath);
  return {
    name: `File exists: ${path.basename(filePath)}`,
    passed: exists,
    detail: exists ? "Found" : "Not found",
  };
}

function validJsonCheck(filePath: string): CheckResult {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    JSON.parse(raw);
    return { name: `Valid JSON: ${path.basename(filePath)}`, passed: true, detail: "Parseable" };
  } catch (err) {
    return { name: `Valid JSON: ${path.basename(filePath)}`, passed: false, detail: String(err) };
  }
}

function parseCanaryAndReturn(filePath: string): { config: unknown; error: string | null } {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const config = JSON.parse(raw);
    parseCanaryConfig(config);
    return { config, error: null };
  } catch (err) {
    return { config: null, error: String(err) };
  }
}

function envVarCheck(
  filePath: string,
  varName: string,
  expectedValue: string | undefined,
  mustNotBeEmpty = false,
): CheckResult {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const match = content.match(new RegExp(`^${varName}=(.*)$`, "m"));
    if (!match) {
      return { name: `${varName} is set`, passed: false, detail: "Not found in .env" };
    }
    const value = match[1].trim();

    if (expectedValue !== undefined && value !== expectedValue) {
      return {
        name: `${varName}=${expectedValue}`,
        passed: false,
        detail: `Actual: ${value || "(empty)"}`,
      };
    }

    if (mustNotBeEmpty && value === "") {
      return { name: `${varName} not empty`, passed: false, detail: "Empty string" };
    }

    return { name: `${varName} check`, passed: true, detail: value ? "Configured" : "(empty)" };
  } catch (err) {
    return { name: `${varName} check`, passed: false, detail: String(err) };
  }
}

function runCommandCheck(name: string, cmd: string, args: string[]): CheckResult {
  const result = spawnSync(cmd, args, {
    cwd: process.cwd(),
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
    timeout: 60000,
    killSignal: "SIGTERM",
  });

  const output = ((result.stdout as string) || "") + ((result.stderr as string) || "");

  if (result.status === 0) {
    return { name, passed: true, detail: "Passed" };
  }

  const detail = result.error
    ? /timeout|timed out|ETIMEDOUT/.test(result.error.message)
      ? "Timeout after 60s"
      : result.error.message
    : result.signal === "SIGTERM"
      ? "Timeout after 60s"
      : `Exit code ${result.status}`;

  return { name, passed: false, detail: detail.slice(0, 500) };
}

function runCommandWithParse(
  name: string,
  cmd: string,
  args: string[],
  parser: (output: string) => CheckResult,
): CheckResult {
  const result = spawnSync(cmd, args, {
    cwd: process.cwd(),
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
    timeout: 60000,
    killSignal: "SIGTERM",
  });

  const output = ((result.stdout as string) || "") + ((result.stderr as string) || "");

  if (result.status === 0) {
    return parser(output);
  }

  const detail = result.error
    ? /timeout|timed out|ETIMEDOUT/.test(result.error.message)
      ? "Timeout after 60s"
      : result.error.message
    : result.signal === "SIGTERM"
      ? "Timeout after 60s"
      : `Exit code ${result.status}`;

  return { name, passed: false, detail: detail.slice(0, 500) };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const results: CheckResult[] = [];
  const cwd = process.cwd();

  const liveConfigPath = path.join(cwd, "canary-live.json");
  const demoConfigPath = path.join(cwd, "canary-demo.json");
  const envPath = path.join(cwd, ".env");

  // --- 1. Configuration File Checks ---

  results.push(fileExistsCheck(liveConfigPath));

  let liveConfig: unknown = null;
  let liveParseError: string | null = null;

  if (fs.existsSync(liveConfigPath)) {
    results.push(validJsonCheck(liveConfigPath));
    const parseResult = parseCanaryAndReturn(liveConfigPath);
    liveParseError = parseResult.error;
    liveConfig = parseResult.config;
    results.push({
      name: "parseCanaryConfig validation",
      passed: parseResult.error === null,
      detail: parseResult.error === null ? "Valid canary config" : parseResult.error,
    });
  }

  // --- 2. Config Diff from Demo (pre-flight) ---

  if (liveConfig && fs.existsSync(demoConfigPath)) {
    try {
      const demoRaw = fs.readFileSync(demoConfigPath, "utf-8");
      const demoConfig = JSON.parse(demoRaw);
      const liveParsed = liveConfig as Record<string, unknown>;
      const demoParsed = demoConfig as Record<string, unknown>;

      const liveCapital = (liveParsed.capitalLimits as Record<string, unknown>)?.maxCapitalUsd;
      const demoCapital = (demoParsed.capitalLimits as Record<string, unknown>)?.maxCapitalUsd;

      if (liveCapital === demoCapital) {
        results.push({
          name: "Live config differs from demo (maxCapitalUsd)",
          passed: false,
          detail: `Both have maxCapitalUsd=${liveCapital}`,
        });
      } else {
        results.push({
          name: "Live config differs from demo (maxCapitalUsd)",
          passed: true,
          detail: `live=${liveCapital} vs demo=${demoCapital}`,
        });
      }
    } catch (err) {
      results.push({
        name: "Live config differs from demo",
        passed: false,
        detail: String(err),
      });
    }
  }

  // --- 3. Config Safety Constraints ---

  if (liveConfig && !liveParseError) {
    const parsed = liveConfig as Record<string, unknown>;
    const apiKeys = parsed.apiKeys as Record<string, unknown> | undefined;
    const capitalLimits = parsed.capitalLimits as Record<string, unknown> | undefined;
    const killSwitch = parsed.killSwitch as Record<string, unknown> | undefined;

    // withdrawalsDisabled
    const withdrawalsDisabled = apiKeys?.withdrawalsDisabled === true;
    results.push({
      name: "withdrawalsDisabled is true (CRITICAL)",
      passed: withdrawalsDisabled,
      detail: withdrawalsDisabled ? "Confirmed" : `Actual: ${apiKeys?.withdrawalsDisabled}`,
    });

    // maxCapitalUsd <= 1000
    const maxCapitalUsd = typeof capitalLimits?.maxCapitalUsd === "number" ? (capitalLimits.maxCapitalUsd as number) : NaN;
    const capitalOk = !Number.isNaN(maxCapitalUsd) && maxCapitalUsd <= 1000;
    results.push({
      name: "maxCapitalUsd <= 1000",
      passed: capitalOk,
      detail: Number.isNaN(maxCapitalUsd) ? "Not found" : `Actual: ${maxCapitalUsd}`,
    });

    // maxRiskPerTradeUsd <= 50
    const maxRiskPerTradeUsd = typeof capitalLimits?.maxRiskPerTradeUsd === "number" ? (capitalLimits.maxRiskPerTradeUsd as number) : NaN;
    const riskOk = !Number.isNaN(maxRiskPerTradeUsd) && maxRiskPerTradeUsd <= 50;
    results.push({
      name: "maxRiskPerTradeUsd <= 50",
      passed: riskOk,
      detail: Number.isNaN(maxRiskPerTradeUsd) ? "Not found" : `Actual: ${maxRiskPerTradeUsd}`,
    });

    // autoHaltDailyLossUsd is set and <= 25% of maxCapitalUsd
    const autoHaltDailyLossUsd = typeof killSwitch?.autoHaltDailyLossUsd === "number" ? (killSwitch.autoHaltDailyLossUsd as number) : null;
    let haltOk = false;
    let haltDetail = "Not set";
    if (autoHaltDailyLossUsd !== null && !Number.isNaN(maxCapitalUsd)) {
      const threshold = maxCapitalUsd * 0.25;
      haltOk = autoHaltDailyLossUsd <= threshold;
      haltDetail = `Actual: ${autoHaltDailyLossUsd} (threshold: ${threshold.toFixed(2)})`;
    }
    results.push({
      name: "autoHaltDailyLossUsd <= 25% of maxCapitalUsd",
      passed: haltOk,
      detail: haltDetail,
    });

    // noAutomaticScaling is true
    const noAutomaticScaling = parsed.noAutomaticScaling === true;
    results.push({
      name: "noAutomaticScaling is true",
      passed: noAutomaticScaling,
      detail: noAutomaticScaling ? "Confirmed" : `Actual: ${parsed.noAutomaticScaling}`,
    });
  }

  // --- 4. Environment Checks ---

  results.push(fileExistsCheck(envPath));

  if (fs.existsSync(envPath)) {
    results.push(envVarCheck(envPath, "MODE", "live"));
    results.push(envVarCheck(envPath, "BYBIT_API_KEY", undefined, true));
    results.push(envVarCheck(envPath, "BYBIT_API_SECRET", undefined, true));
    results.push(envVarCheck(envPath, "LLM_API_KEY", undefined, false));
  }

  // --- 5. Live Endpoints Check ---

  // Endpoints are determined by MODE in config.ts:
  // MODE=live => mainnet Bybit endpoints
  // MODE=demo => DEMO_BASE_URL
  // Since we check MODE=live above, this is covered. Add explicit check.
  const modeMatch = fs.existsSync(envPath)
    ? (() => {
        const content = fs.readFileSync(envPath, "utf-8");
        const match = content.match(/^MODE=(.*)$/m);
        return match ? match[1].trim() : null;
      })()
    : null;

  const liveEndpointsOk = modeMatch === "live";
  results.push({
    name: "Live endpoints configured (not demo)",
    passed: liveEndpointsOk,
    detail: liveEndpointsOk ? "MODE=live → mainnet Bybit endpoints" : `Actual: MODE=${modeMatch || "(not set)"}`,
  });

  // --- 6. Codebase Readiness Checks ---

  // Typecheck
  results.push(runCommandCheck("bun run typecheck", "bun", ["run", "typecheck"]));

  // Tests - need at least 1400 passing
  results.push(
    runCommandWithParse(
      "bun test (>=1400 pass) [long-running]",
      "bun",
      ["test"],
      (output) => {
        const passMatch = output.match(/(\d+) pass/);
        const failMatch = output.match(/(\d+) fail/);
        const passCount = passMatch ? parseInt(passMatch[1]) : 0;
        const failCount = failMatch ? parseInt(failMatch[1]) : 0;

        if (failCount > 0) {
          return {
            name: "bun test (>=1400 pass) [long-running]",
            passed: false,
            detail: `${failCount} tests failed`,
          };
        }
        if (passCount >= 1400) {
          return {
            name: "bun test (>=1400 pass) [long-running]",
            passed: true,
            detail: `${passCount} tests passed`,
          };
        }
        return {
          name: "bun test (>=1400 pass) [long-running]",
          passed: false,
          detail: `Only ${passCount} tests passed (need >=1400)`,
        };
      },
    ),
  );

  // Cost validation
  results.push(runCommandCheck("bun run validate:costs", "bun", ["run", "validate:costs"]));

  // Demo validation (evidence required before live)
  results.push(runCommandCheck("bun run validate:demo", "bun", ["run", "validate:demo"]));

  // --- Summary ---

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  console.log("\n=== LIVE CANARY VALIDATION REPORT ===\n");
  for (const r of results) {
    const icon = r.passed ? "✓" : "✗";
    console.log(`  ${icon} [${r.passed ? "PASS" : "FAIL"}] ${r.name}: ${r.detail}`);
  }
  console.log(`\nTotal: ${results.length} | Passed: ${passed} | Failed: ${failed}`);

  if (failed > 0) {
    console.log("\nResult: FAIL — one or more validation checks failed. Do not proceed with live canary trading.\n");
    process.exit(1);
  } else {
    console.log("\nResult: PASS — all validation checks passed. System is ready for live canary trading.\n");
    process.exit(0);
  }
}

main();
