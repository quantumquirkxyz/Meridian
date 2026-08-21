import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Enforces the ARCHITECTURE.md package boundaries at the manifest and source
 * level:
 *   - contracts is dependency-free (no LLM or framework runtime);
 *   - core depends only on contracts (never LLMs or connectors);
 *   - connectors, graph, harness, events depend only on contracts
 *     (ARCHITECTURE.md:88; `events` follows the same rule);
 *   - agents depends only on contracts and never imports core
 *     (ARCHITECTURE.md:88; agents never imports core).
 *
 * `infra` owns observability and the operator control TUI, so ADR-0008 and
 * ADR-0010 explicitly allow contracts, events, ink, and react only.
 */
const PACKAGE_DIRS = [
  "contracts",
  "core",
  "connectors",
  "events",
  "graph",
  "harness",
  "infra",
  "agents",
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
 * Matches the token at the start of a path segment (optionally @-scoped), so
 * `@ai-sdk/provider`, `openai`, and `../connectors` are flagged while
 * `@agenttrading/contracts` is not.
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
    // dev-only tooling is allowed, but nothing LLM/framework-like.
    for (const dep of Object.keys(devDependencies ?? {})) {
      expect(isForbiddenModule(dep)).toBe(false);
    }
  });

  test("core depends only on contracts and never on LLMs/connectors", () => {
    const { dependencies = {} } = packageJson("core");
    expect(Object.keys(dependencies).sort()).toEqual(["@agenttrading/contracts"]);
    for (const dep of Object.keys(dependencies)) {
      expect(isForbiddenModule(dep)).toBe(false);
    }
  });

  test("connectors, graph, events depend only on contracts", () => {
    for (const dir of ["connectors", "graph", "events"]) {
      const { dependencies = {} } = packageJson(dir);
      expect(Object.keys(dependencies).sort()).toEqual(["@agenttrading/contracts"]);
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

  test("infra never depends on LLM/framework runtimes", () => {
    const { dependencies = {} } = packageJson("infra");
    expect(Object.keys(dependencies).sort()).toEqual([
      "@agenttrading/contracts",
      "@agenttrading/events",
      "ink",
      "react",
    ]);
    for (const dep of Object.keys(dependencies)) {
      expect(isForbiddenModule(dep)).toBe(false);
    }
  });

  test("agents depends only on contracts and never on core", () => {
    const { dependencies = {} } = packageJson("agents");
    expect(Object.keys(dependencies).sort()).toEqual(["@agenttrading/contracts"]);
    for (const dep of Object.keys(dependencies)) {
      expect(isForbiddenModule(dep)).toBe(false);
    }
  });

  test("agents source never imports core or LLM modules", () => {
    const importSpecifiers =
      /(?:from\s+|import\s*\(\s*)["']([^"']+)["']/g;
    for (const file of sourceFiles("agents")) {
      const content = readFileSync(file, "utf8");
      for (const match of content.matchAll(importSpecifiers)) {
        const spec = match[1];
        // agents never imports core (ARCHITECTURE.md boundary)
        expect(spec).not.toContain("@agenttrading/core");
        expect(spec).not.toMatch(/\.\.\/core/);
        // agents never imports LLM frameworks directly (deferred to runtime adapters)
        // The runtimes/*.ts files MAY import LLM frameworks at runtime,
        // but the core adapter/registry/runtime modules must not.
        if (!file.includes("runtimes/")) {
          expect(isForbiddenModule(spec)).toBe(false);
        }
      }
    }
  });

  test("core source never imports LLM or connector modules", () => {
    const importSpecifiers =
      /(?:from\s+|import\s*\(\s*)["']([^"']+)["']/g;
    for (const file of sourceFiles("core")) {
      const content = readFileSync(file, "utf8");
      for (const match of content.matchAll(importSpecifiers)) {
        expect(isForbiddenModule(match[1])).toBe(false);
      }
    }
  });

  test("infra source never imports core, connectors, or LLM modules", () => {
    const importSpecifiers =
      /(?:from\s+|import\s*\(\s*)["']([^"']+)["']/g;
    for (const file of sourceFiles("infra")) {
      const content = readFileSync(file, "utf8");
      for (const match of content.matchAll(importSpecifiers)) {
        const spec = match[1];
        expect(spec).not.toContain("@agenttrading/core");
        expect(spec).not.toMatch(/\.\.\/core/);
        expect(spec).not.toMatch(/\.\.\/connectors/);
        expect(isForbiddenModule(spec)).toBe(false);
      }
    }
  });
});
