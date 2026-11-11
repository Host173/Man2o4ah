import { ErrorCode } from './error-codes.js';

function toUpperSnake(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();
}

describe('ErrorCode', () => {
  it('has 33 entries', () => {
    expect(Object.keys(ErrorCode)).toHaveLength(33);
  });

  it('uses the key in UPPER_SNAKE as every value', () => {
    for (const [key, value] of Object.entries(ErrorCode)) {
      expect(value).toBe(toUpperSnake(key));
    }
  });

  it('has unique values', () => {
    const values = Object.values(ErrorCode);
    expect(new Set(values).size).toBe(values.length);
  });
});
