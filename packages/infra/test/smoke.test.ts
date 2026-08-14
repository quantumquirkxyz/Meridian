import { describe, expect, test } from "bun:test";
import { INFRA_VERSION } from "../src/index.ts";
import { isSystemMode } from "@agenttrading/contracts";
import { expectPackageSmoke } from "../../../test/smoke-helper.ts";

describe("@agenttrading/infra smoke", () => {
  test("package resolves", () => {
    expectPackageSmoke(INFRA_VERSION, () => {
      expect(isSystemMode("CANCEL_ONLY")).toBe(true);
    });
  });
});
