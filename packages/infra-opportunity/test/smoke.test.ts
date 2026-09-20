import { describe, expect, test } from "bun:test";
import { INFRA_OPPORTUNITY_VERSION } from "../src/index.ts";
import { isSystemMode } from "@agenttrading/contracts";
import { expectPackageSmoke } from "../../../test/smoke-helper.ts";

describe("@agenttrading/infra-opportunity smoke", () => {
  test("package resolves", () => {
    expectPackageSmoke(INFRA_OPPORTUNITY_VERSION, () => {
      expect(isSystemMode("CANCEL_ONLY")).toBe(true);
    });
  });
});
