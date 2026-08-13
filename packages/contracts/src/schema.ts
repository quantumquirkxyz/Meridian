/**
 * Minimal dependency-free runtime schema validation.
 *
 * The contracts package must stay free of runtime framework dependencies
 * (ADR-0001, issue #12). Instead of pulling in a schema library, we provide a
 * tiny set of composable type guards. Each validator is a `Validator<T>` type
 * predicate, so it narrows `unknown` to `T` and doubles as a runtime check.
 */

export type Validator<T> = (value: unknown) => value is T;

export const isString: Validator<string> = (value): value is string =>
  typeof value === "string";

export const isNumber: Validator<number> = (value): value is number =>
  typeof value === "number" && Number.isFinite(value);

export const isBoolean: Validator<boolean> = (value): value is boolean =>
  typeof value === "boolean";

export const isFunction: Validator<(...args: unknown[]) => unknown> = (
  value,
): value is (...args: unknown[]) => unknown => typeof value === "function";

export const isBooleanLiteralTrue: Validator<true> = (
  value,
): value is true => value === true;

export const isBooleanLiteralFalse: Validator<false> = (
  value,
): value is false => value === false;

export function isLiteral<T extends string | number | boolean>(
  expected: T,
): Validator<T> {
  return (value): value is T => value === expected;
}

export function isEnumOf<T extends string>(
  values: readonly T[],
): Validator<T> {
  const allowed = new Set<string>(values);
  return (value): value is T => typeof value === "string" && allowed.has(value);
}

export function isOptional<T>(inner: Validator<T>): Validator<T | undefined> {
  return (value): value is T | undefined =>
    value === undefined || inner(value);
}

export function isNullable<T>(inner: Validator<T>): Validator<T | null> {
  return (value): value is T | null => value === null || inner(value);
}

export function isArrayOf<T>(inner: Validator<T>): Validator<T[]> {
  return (value): value is T[] =>
    Array.isArray(value) && value.every((item) => inner(item));
}

export function isRecordOf<T>(inner: Validator<T>): Validator<Record<string, T>> {
  return (value): value is Record<string, T> => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return false;
    }
    return Object.values(value).every((item) => inner(item));
  };
}

/**
 * Structural check for plain objects. Extra keys are allowed (forward
 * compatibility); every declared key must be present and match its validator.
 * Optional fields are modelled with `isOptional` in the shape.
 */
export function isObjectOf<T extends object>(shape: {
  [K in keyof T]: Validator<T[K]>;
}): Validator<T> {
  return (value): value is T => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return false;
    }
    const record = value as Record<string, unknown>;
    for (const key of Object.keys(shape) as (keyof T)[]) {
      const check = shape[key] as Validator<unknown>;
      if (!check(record[key as string])) {
        return false;
      }
    }
    return true;
  };
}

/** Accepts a value that satisfies any of the given validators. */
export function isOneOf<T>(validators: readonly Validator<T>[]): Validator<T> {
  return (value): value is T => validators.some((check) => check(value));
}

/** Inclusive range check for finite numbers. */
export function isInRange(min: number, max: number): Validator<number> {
  return (value): value is number =>
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= min &&
    value <= max;
}

/** Throws a descriptive TypeError when the value does not match the validator. */
export function parse<T>(
  validator: Validator<T>,
  value: unknown,
  label: string,
): T {
  if (validator(value)) {
    return value;
  }
  throw new TypeError(`Invalid ${label}; expected a value matching the contract.`);
}
