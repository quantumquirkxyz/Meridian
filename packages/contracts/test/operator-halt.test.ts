import { describe, test, expect } from "bun:test";
import { parseOperatorHaltRequested } from "../src/events.ts";

describe("OperatorHaltRequested event (ADR-0010)", () => {
  test("valid event parses with type=OPERATOR_HALT_REQUESTED", () => {
    const event = parseOperatorHaltRequested({
      type: "OPERATOR_HALT_REQUESTED",
      requestedAtMs: 1700000000000,
      source: "tui",
    });
    expect(event.type).toBe("OPERATOR_HALT_REQUESTED");
    expect(event.source).toBe("tui");
  });
  test("missing source is rejected", () => {
    expect(() =>
      parseOperatorHaltRequested({
        type: "OPERATOR_HALT_REQUESTED",
        requestedAtMs: 1700000000000,
      }),
    ).toThrow();
  });
});
