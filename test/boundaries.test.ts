import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Enforces the ARCHITECTURE.md package boundaries at the manifest and source
 * level:
 *   - contracts is dependency-free (no LLM or framework runtime);
 *   - core sub-packages depend only on contracts, graph, and other core sub-packages;
 *   - connectors, graph, events depend only on contracts;
 *   - chain depends only on contracts and viem (on-chain execution seam);
 *   - agents sub-packages depend only on contracts and other agents sub-packages;
 *     agents never imports core (ARCHITECTURE.md boundary).
 *   - infra sub-packages depend only on contracts, events, and other infra sub-packages.
 */
const PACKAGE_DIRS = [
  "contracts",
  "core",
  "chain",
  "connectors",
  "events",
  "graph",
  "harness",
  "infra",
  "agents",
  "core-stategraph",
  "core-risk",
  "core-reconciliation",
  "core-execution",
  "core-session",
  "core-inventory",
  "agents-core",
  "agents-catalog",
  "agents-general",
  "agents-runtimes",
  "infra-observability",
  "infra-opportunity",
  "infra-control",
] as const;

const FORBIDDEN_MODULE_PATHS = [
  "ai",
  "openai",
  "anthropic",
  "mastra",
  "vercel",
  "langchain",
  "langgraph",
  "connectors",
  "lodash",
  "zod",
] as const;

/**
 * True when a module specifier (dependency name or source import path)
 * references a forbidden LLM/framework runtime or the connectors package.
 */
function isForbiddenModule(specifier: string): boolean {
  return FORBIDDEN_MODULE_PATHS.some((name) =>
    new RegExp(`(^|\\/)@?${name}\\b`, "i").test(specifier),
  );
}

function packageJson(dir: string): {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
} {
  const path = join(import.meta.dir, "..", "packages", dir, "package.json");
  if (!existsSync(path)) {
    throw new Error(`missing package.json for packages/${dir}`);
  }
  return JSON.parse(readFileSync(path, "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
}

function sourceFiles(dir: string): string[] {
  const root = join(import.meta.dir, "..", "packages", dir, "src");
  if (!existsSync(root)) {
    return [];
  }
  const out: string[] = [];
  const walk = (p: string): void => {
    for (const entry of readdirSync(p, { withFileTypes: true })) {
      const full = join(p, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
        out.push(full);
      }
    }
  };
  walk(root);
  return out;
}

describe("package boundaries (ARCHITECTURE.md)", () => {
  test("scaffold package set exists", () => {
    for (const dir of PACKAGE_DIRS) {
      expect(existsSync(join(import.meta.dir, "..", "packages", dir))).toBe(true);
    }
  });

  test("contracts has no runtime dependencies", () => {
    const { dependencies, devDependencies } = packageJson("contracts");
    expect(dependencies ?? {}).toEqual({});
    for (const dep of Object.keys(devDependencies ?? {})) {
      expect(isForbiddenModule(dep)).toBe(false);
    }
  });

  test("core sub-packages depend only on contracts and graph (never on LLMs/connectors)", () => {
    const allowedCoreSubDeps = new Set([
      "@agenttrading/contracts",
      "@agenttrading/graph",
      "@agenttrading/core-stategraph",
      "@agenttrading/core-risk",
      "@agenttrading/core-reconciliation",
      "@agenttrading/core-execution",
      "@agenttrading/core-session",
      "@agenttrading/core-inventory",
    ]);
    for (const dir of [
      "core-stategraph",
      "core-risk",
      "core-reconciliation",
      "core-execution",
      "core-session",
      "core-inventory",
    ]) {
      const { dependencies = {} } = packageJson(dir);
      for (const dep of Object.keys(dependencies)) {
        expect(isForbiddenModule(dep)).toBe(false);
        expect(allowedCoreSubDeps.has(dep)).toBe(true);
      }
    }
  });

  test("connectors, graph, events depend only on contracts", () => {
    for (const dir of ["connectors", "graph", "events"]) {
      const { dependencies = {} } = packageJson(dir);
      expect(Object.keys(dependencies).sort()).toEqual(["@agenttrading/contracts"]);
    }
  });

  test("chain depends only on contracts and viem (on-chain execution seam)", () => {
    const { dependencies = {} } = packageJson("chain");
    expect(Object.keys(dependencies).sort()).toEqual([
      "@agenttrading/contracts",
      "viem",
    ]);
    for (const dep of Object.keys(dependencies)) {
      expect(isForbiddenModule(dep)).toBe(false);
    }
  });

  test("harness depends on contracts, events, and graph (ADR-0007)", () => {
    const { dependencies = {} } = packageJson("harness");
    expect(Object.keys(dependencies).sort()).toEqual([
      "@agenttrading/contracts",
      "@agenttrading/events",
      "@agenttrading/graph",
    ]);
  });

  test("infra sub-packages depend only on contracts, events, and other infra sub-packages", () => {
    const allowedInfraSubDeps = new Set([
      "@agenttrading/contracts",
      "@agenttrading/events",
      "@agenttrading/infra-observability",
      "@agenttrading/infra-opportunity",
      "@agenttrading/infra-control",
    ]);
    for (const dir of [
      "infra-observability",
      "infra-opportunity",
      "infra-control",
    ]) {
      const { dependencies = {} } = packageJson(dir);
      for (const dep of Object.keys(dependencies)) {
        expect(isForbiddenModule(dep)).toBe(false);
        expect(allowedInfraSubDeps.has(dep)).toBe(true);
      }
    }
  });

  test("agents sub-packages depend only on contracts and other agents sub-packages", () => {
    const allowedAgentsSubDeps = new Set([
      "@agenttrading/contracts",
      "@agenttrading/agents-core",
      "@agenttrading/agents-catalog",
      "@agenttrading/agents-general",
      "@agenttrading/agents-runtimes",
    ]);
    for (const dir of [
      "agents-core",
      "agents-catalog",
      "agents-general",
      "agents-runtimes",
    ]) {
      const { dependencies = {} } = packageJson(dir);
      for (const dep of Object.keys(dependencies)) {
        expect(isForbiddenModule(dep)).toBe(false);
        expect(allowedAgentsSubDeps.has(dep)).toBe(true);
      }
    }
  });

  test("core sub-packages never import LLM or connector modules", () => {
    const importSpecifiers =
      /(?:from\s+|import\s*\(\s*)["']([^"']+)["']/g;
    for (const dir of [
      "core-stategraph",
      "core-risk",
      "core-reconciliation",
      "core-execution",
      "core-session",
      "core-inventory",
    ]) {
      for (const file of sourceFiles(dir)) {
        const content = readFileSync(file, "utf8");
        for (const match of content.matchAll(importSpecifiers)) {
          expect(isForbiddenModule(match[1])).toBe(false);
        }
      }
    }
  });

  test("agents sub-packages never import core or connector modules", () => {
    const importSpecifiers =
      /(?:from\s+|import\s*\(\s*)["']([^"']+)["']/g;
    for (const dir of [
      "agents-core",
      "agents-catalog",
      "agents-general",
    ]) {
      for (const file of sourceFiles(dir)) {
        const content = readFileSync(file, "utf8");
        for (const match of content.matchAll(importSpecifiers)) {
          expect(match[1]).not.toContain("@agenttrading/core");
          expect(match[1]).not.toMatch(/\.\.\/core/);
          expect(isForbiddenModule(match[1])).toBe(false);
        }
      }
    }
  });

  test("agents runtimes may import LLM frameworks", () => {
    const importSpecifiers =
      /(?:from\s+|import\s*\(\s*)["']([^"']+)["']/g;
    for (const file of sourceFiles("agents-runtimes")) {
      const content = readFileSync(file, "utf8");
      for (const match of content.matchAll(importSpecifiers)) {
        expect(match[1]).not.toContain("@agenttrading/core");
        expect(match[1]).not.toMatch(/\.\.\/core/);
        expect(match[1]).not.toContain("connectors");
        expect(match[1]).not.toMatch(/\.\.\/connectors/);
      }
    }
  });

  test("infra sub-packages never import core, connectors, or LLM modules", () => {
    const importSpecifiers =
      /(?:from\s+|import\s*\(\s*)["']([^"']+)["']/g;
    for (const dir of [
      "infra-observability",
      "infra-opportunity",
      "infra-control",
    ]) {
      for (const file of sourceFiles(dir)) {
        const content = readFileSync(file, "utf8");
        for (const match of content.matchAll(importSpecifiers)) {
          const spec = match[1];
          expect(spec).not.toContain("@agenttrading/core");
          expect(spec).not.toMatch(/\.\.\/core/);
          expect(spec).not.toMatch(/\.\.\/connectors/);
          expect(isForbiddenModule(spec)).toBe(false);
        }
      }
    }
  });
});
