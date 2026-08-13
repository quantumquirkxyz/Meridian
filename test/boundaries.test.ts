import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Enforces the ARCHITECTURE.md package boundaries at the manifest and source
 * level:
 *   - contracts is dependency-free (no LLM or framework runtime);
 *   - core depends only on contracts (never LLMs or connectors);
 *   - connectors, graph, harness, infra depend only on contracts.
 */
const PACKAGE_DIRS = [
  "contracts",
  "core",
  "connectors",
  "graph",
  "harness",
  "infra",
] as const;

const LLM_LIKE = /(^|\/)@?(ai|openai|anthropic|mastra|vercel|lodash|zod|langchain|langgraph)\b/i;

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
      expect(LLM_LIKE.test(dep)).toBe(false);
    }
  });

  test("core depends only on contracts and never on LLMs/connectors", () => {
    const { dependencies = {} } = packageJson("core");
    expect(Object.keys(dependencies).sort()).toEqual(["@agenttrading/contracts"]);
    for (const dep of Object.keys(dependencies)) {
      expect(LLM_LIKE.test(dep)).toBe(false);
      expect(dep).not.toMatch(/connectors/);
    }
  });

  test("connectors, graph, harness, infra depend only on contracts", () => {
    for (const dir of ["connectors", "graph", "harness", "infra"]) {
      const { dependencies = {} } = packageJson(dir);
      expect(Object.keys(dependencies).sort()).toEqual(["@agenttrading/contracts"]);
    }
  });

  test("core source never imports LLM or connector modules", () => {
    const forbidden = /from\s+["'](@?.*(ai|openai|anthropic|mastra|vercel|langchain|langgraph|connectors).*)["']/i;
    for (const file of sourceFiles("core")) {
      const content = readFileSync(file, "utf8");
      expect(content).not.toMatch(forbidden);
    }
  });
});
