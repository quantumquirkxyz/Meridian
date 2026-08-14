import { expect } from "bun:test";

export function expectPackageSmoke(
  version: string,
  sampleCheck: () => void,
): void {
  expect(version).toBe("0.1.0");
  sampleCheck();
}
