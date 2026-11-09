/** Reusable Mongoose validator objects. Spread into `validate:` or pass directly. */

export const integerValidator = {
  validator: (value: unknown) => Number.isInteger(value),
  message: '{PATH} must be an integer.',
};

/** Number strictly greater than 0 (`min: 0` would allow 0). */
export const positiveNumberValidator = {
  validator: (value: unknown) => typeof value === 'number' && value > 0,
  message: '{PATH} must be greater than 0.',
};

/** 24h time of day, HH 00-23, mm 00-59. */
export const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Calendar date string, with a real month (01-12) and day (01-31). */
export const YYYY_MM_DD = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** Array has no duplicate values (primitives compared with ===). */
export const uniqueValuesValidator = {
  validator: (value: unknown[]) => new Set(value).size === value.length,
  message: '{PATH} must not contain duplicates.',
};

/** Array of objects has no duplicate value for `key` (compared as strings). */
export function uniqueByValidator(key: string) {
  return {
    validator: (items: Record<string, unknown>[]) =>
      new Set(items.map((item) => String(item[key]))).size === items.length,
    message: `{PATH} must not contain duplicate ${key} values.`,
  };
}

/** Array has at most `max` items. */
export function maxItemsValidator(max: number) {
  return {
    validator: (value: unknown[]) => value.length <= max,
    message: `{PATH} must have at most ${max} items.`,
  };
}

/** Array has between `min` and `max` items. */
export function itemsBetweenValidator(min: number, max: number) {
  return {
    validator: (value: unknown[]) => value.length >= min && value.length <= max,
    message: `{PATH} must have between ${min} and ${max} items.`,
  };
}
