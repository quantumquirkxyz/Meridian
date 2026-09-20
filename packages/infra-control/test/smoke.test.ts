import { describe, expect, test } from "bun:test";
import { INFRA_CONTROL_VERSION } from "../src/index.ts";
import { isSystemMode } from "@agenttrading/contracts";
import { expectPackageSmoke } from "../../../test/smoke-helper.ts";

describe("@agenttrading/infra-control smoke", () => {
  test("package resolves", () => {
    expectPackageSmoke(INFRA_CONTROL_VERSION, () => {
      expect(isSystemMode("CANCEL_ONLY")).toBe(true);
    });
  });
});
