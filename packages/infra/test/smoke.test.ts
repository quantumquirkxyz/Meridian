import { describe, expect, test } from "bun:test";
import { INFRA_VERSION } from "../src/index.ts";
import { isSystemMode } from "@agenttrading/contracts";

describe("@agenttrading/infra smoke", () => {
  test("package resolves", () => {
    expect(INFRA_VERSION).toBe("0.1.0");
  });

  test("system mode shape comes from contracts", () => {
    expect(isSystemMode("CANCEL_ONLY")).toBe(true);
  });
});
