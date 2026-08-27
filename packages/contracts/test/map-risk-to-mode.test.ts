import { describe, test, expect } from "bun:test";
import { mapRiskToMode } from "../src/modes.ts"; // seam: public interface

describe("mapRiskToMode", () => {
  test("HALT_SYSTEM maps to SystemMode HALT", () => {
    expect(mapRiskToMode("HALT_SYSTEM")).toBe("HALT");
  });
  test("CANCEL_ONLY outcome maps to CANCEL_ONLY mode", () => {
    expect(mapRiskToMode("CANCEL_ONLY")).toBe("CANCEL_ONLY");
  });
  test("APPROVE outcome is not mapped — risk does not dictate normal mode", () => {
    expect(() => mapRiskToMode("APPROVE")).toThrow();
  });
  test("REJECT outcome maps to nothing (defensive only)", () => {
    expect(() => mapRiskToMode("REJECT")).toThrow();
  });
});
