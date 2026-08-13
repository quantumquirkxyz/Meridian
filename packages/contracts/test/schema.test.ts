import { describe, expect, test } from "bun:test";
import {
  isArrayOf,
  isBoolean,
  isEnumOf,
  isLiteral,
  isNumber,
  isObjectOf,
  isOneOf,
  isOptional,
  isRecordOf,
  isString,
  parse,
} from "../src/schema.ts";

describe("schema validators", () => {
  test("primitives", () => {
    expect(isString("x")).toBe(true);
    expect(isString(1)).toBe(false);
    expect(isNumber(1)).toBe(true);
    expect(isNumber(Number.NaN)).toBe(false);
    expect(isNumber(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isBoolean(true)).toBe(true);
    expect(isBoolean("true")).toBe(false);
  });

  test("isLiteral", () => {
    expect(isLiteral("BUY")("BUY")).toBe(true);
    expect(isLiteral("BUY")("SELL")).toBe(false);
  });

  test("isEnumOf", () => {
    const check = isEnumOf(["A", "B"] as const);
    expect(check("A")).toBe(true);
    expect(check("C")).toBe(false);
    expect(check(1)).toBe(false);
  });

  test("isOptional", () => {
    const check = isOptional(isNumber);
    expect(check(undefined)).toBe(true);
    expect(check(5)).toBe(true);
    expect(check(null)).toBe(false);
  });

  test("isArrayOf", () => {
    const check = isArrayOf(isNumber);
    expect(check([1, 2])).toBe(true);
    expect(check(["1"])).toBe(false);
    expect(check("nope")).toBe(false);
  });

  test("isRecordOf", () => {
    const check = isRecordOf(isNumber);
    expect(check({ a: 1 })).toBe(true);
    expect(check({ a: "1" })).toBe(false);
    expect(check([1, 2])).toBe(false);
  });

  test("isObjectOf requires declared keys and ignores extra keys", () => {
    const check = isObjectOf({ a: isString, b: isOptional(isNumber) });
    expect(check({ a: "x" })).toBe(true);
    expect(check({ a: "x", b: 2 })).toBe(true);
    expect(check({ a: "x", b: 2, extra: "ignored" })).toBe(true);
    expect(check({ a: 2 })).toBe(false);
    expect(check({ b: 2 })).toBe(false);
    expect(check(null)).toBe(false);
    expect(check([1])).toBe(false);
  });

  test("isOneOf", () => {
    const check = isOneOf<string | number>([isString, isNumber]);
    expect(check("x")).toBe(true);
    expect(check(5)).toBe(true);
    expect(check(true)).toBe(false);
  });

  test("parse returns value or throws", () => {
    expect(parse(isNumber, 1, "n")).toBe(1);
    expect(() => parse(isNumber, "1", "n")).toThrow(TypeError);
    expect(() => parse(isNumber, "1", "n")).toThrow(/n/);
  });
});
