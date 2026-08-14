import { describe, expect, test } from "bun:test";
import { EVENTS_VERSION } from "../src/index.ts";
import { isEventEnvelope } from "@agenttrading/contracts";
import { expectPackageSmoke } from "../../../test/smoke-helper.ts";

describe("@agenttrading/events smoke", () => {
  test("package resolves", () => {
    expectPackageSmoke(EVENTS_VERSION, () => {
      expect(
        isEventEnvelope({
          eventId: "e1",
          sequence: 1,
          type: "MARKET_TICK",
          kind: "raw",
          timestampMs: 0,
          source: "smoke",
          payload: {},
        }),
      ).toBe(true);
    });
  });
});