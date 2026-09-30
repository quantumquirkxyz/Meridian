#!/usr/bin/env bun
/**
 * validate-demo.ts
 *
 * Validates that the Meridian demo mode is configured correctly and
 * the codebase is ready for a Bybit Demo Trading session.
 *
 * Checks:
 *   1. canary-demo.json exists, is valid JSON, and passes parseCanaryConfig
 *   2. .env exists, has MODE=demo, and has non-empty Bybit API keys
 *   3. bun run typecheck passes
 *   4. bun test passes with >= 1400 tests
 *   5. bun run validate:costs passes
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

function parseCanaryCheck(filePath: string): CheckResult {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const config = JSON.parse(raw);
    parseCanaryConfig(config);
    return { name: "parseCanaryConfig validation", passed: true, detail: "Valid canary config" };
  } catch (err) {
    return { name: "parseCanaryConfig validation", passed: false, detail: String(err) };
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
  });

  const output = ((result.stdout as string) || "") + ((result.stderr as string) || "");

  if (result.status === 0) {
    return { name, passed: true, detail: "Passed" };
  }

  const detail = result.error
    ? result.error.message
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
  });

  const output = ((result.stdout as string) || "") + ((result.stderr as string) || "");

  if (result.status === 0) {
    return parser(output);
  }

  const detail = result.error
    ? result.error.message
    : `Exit code ${result.status}`;

  return { name, passed: false, detail: detail.slice(0, 500) };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const results: CheckResult[] = [];
  const cwd = process.cwd();

  // --- Configuration Checks ---

  const canaryPath = path.join(cwd, "canary-demo.json");
  const envPath = path.join(cwd, ".env");

  results.push(fileExistsCheck(canaryPath));

  if (fs.existsSync(canaryPath)) {
    results.push(validJsonCheck(canaryPath));
    results.push(parseCanaryCheck(canaryPath));
  }

  results.push(fileExistsCheck(envPath));

  if (fs.existsSync(envPath)) {
    results.push(envVarCheck(envPath, "MODE", "demo"));
    results.push(envVarCheck(envPath, "BYBIT_API_KEY", undefined, true));
    results.push(envVarCheck(envPath, "BYBIT_API_SECRET", undefined, true));
  }

  // --- Codebase Readiness Checks ---

  // Typecheck
  results.push(runCommandCheck("bun run typecheck", "bun", ["run", "typecheck"]));

  // Tests - need at least 1400 passing
  results.push(
    runCommandWithParse(
      "bun test (>=1400 pass)",
      "bun",
      ["test"],
      (output) => {
        const passMatch = output.match(/(\d+) pass/);
        const failMatch = output.match(/(\d+) fail/);
        const passCount = passMatch ? parseInt(passMatch[1]) : 0;
        const failCount = failMatch ? parseInt(failMatch[1]) : 0;

        if (failCount > 0) {
          return {
            name: "bun test (>=1400 pass)",
            passed: false,
            detail: `${failCount} tests failed`,
          };
        }
        if (passCount >= 1400) {
          return {
            name: "bun test (>=1400 pass)",
            passed: true,
            detail: `${passCount} tests passed`,
          };
        }
        return {
          name: "bun test (>=1400 pass)",
          passed: false,
          detail: `Only ${passCount} tests passed (need >=1400)`,
        };
      },
    ),
  );

  // Cost validation
  results.push(runCommandCheck("bun run validate:costs", "bun", ["run", "validate:costs"]));

  // --- Summary ---

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  console.log("\n=== DEMO VALIDATION REPORT ===\n");
  for (const r of results) {
    const icon = r.passed ? "✓" : "✗";
    console.log(`  ${icon} [${r.passed ? "PASS" : "FAIL"}] ${r.name}: ${r.detail}`);
  }
  console.log(`\nTotal: ${results.length} | Passed: ${passed} | Failed: ${failed}`);

  if (failed > 0) {
    console.log("\nResult: FAIL — one or more validation checks failed.\n");
    process.exit(1);
  } else {
    console.log("\nResult: PASS — all validation checks passed.\n");
    process.exit(0);
  }
}

main();
