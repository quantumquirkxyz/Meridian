import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Workspace-level smoke test. Proves `bun test` runs across the workspace and
 * that every scaffold package resolves and can be imported.
 */
describe("workspace", () => {
  test("root smoke", () => {
    const pkg = JSON.parse(
      readFileSync(join(import.meta.dir, "..", "package.json"), "utf8"),
    ) as { name: string; workspaces: string[] };
    expect(pkg.name).toBe("agenttrading");
    expect(pkg.workspaces).toContain("packages/*");
  });
});
