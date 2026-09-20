import { describe, expect, test } from "bun:test";
import { INFRA_OBSERVABILITY_VERSION } from "../src/index.ts";
import { isSystemMode } from "@agenttrading/contracts";
import { expectPackageSmoke } from "../../../test/smoke-helper.ts";

describe("@agenttrading/infra-observability smoke", () => {
  test("package resolves", () => {
    expectPackageSmoke(INFRA_OBSERVABILITY_VERSION, () => {
      expect(isSystemMode("CANCEL_ONLY")).toBe(true);
    });
  });
});
