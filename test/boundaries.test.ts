import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Enforces the ARCHITECTURE.md package boundaries at the manifest and source
 * level:
 *   - contracts is dependency-free (no LLM or framework runtime);
 *   - core depends only on contracts (never LLMs or connectors);
 *   - connectors, graph, harness depend only on contracts (ARCHITECTURE.md:88).
 *
 * `packages/agents` is deferred to Beta (ROADMAP.md; ADR-0001 lists it in the
 * monorepo but issue #12 scopes the scaffold to six packages). When it lands,
 * add it here with the `agents`-never-imports-`core` boundary from
 * ARCHITECTURE.md:88.
 *
 * `infra` is not restricted to contracts-only by ARCHITECTURE.md:88 (only
 * graph, harness, and connectors are); it may legitimately depend on core
 * later. We assert only that it never depends on LLM/framework runtimes.
 */
const PACKAGE_DIRS = [
  "contracts",
  "core",
  "connectors",
  "graph",
  "harness",
  "infra",
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
      } else if (entry.name.endsWith(".ts")) {
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

  test("connectors, graph, harness depend only on contracts", () => {
    for (const dir of ["connectors", "graph", "harness"]) {
      const { dependencies = {} } = packageJson(dir);
      expect(Object.keys(dependencies).sort()).toEqual(["@agenttrading/contracts"]);
    }
  });

  test("infra never depends on LLM/framework runtimes", () => {
    const { dependencies = {} } = packageJson("infra");
    for (const dep of Object.keys(dependencies)) {
      expect(isForbiddenModule(dep)).toBe(false);
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
});
