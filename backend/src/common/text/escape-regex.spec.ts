import { escapeRegex, keywordRegex } from './escape-regex.js';

describe('escapeRegex and keywordRegex', () => {
  it('matches special characters only literally', () => {
    const regex = keywordRegex('a.b*c');
    expect(regex.test('a.b*c')).toBe(true);
    expect(regex.test('aXbbbc')).toBe(false);
  });

  it('does not throw on an unbalanced bracket', () => {
    expect(() => keywordRegex('(')).not.toThrow();
    expect(keywordRegex('(').test('f(x)')).toBe(true);
  });

  it('ignores case', () => {
    expect(keywordRegex('Cairo').test('flight to CAIRO')).toBe(true);
  });

  it('trims the input', () => {
    expect(keywordRegex('  cairo ').test('cairo')).toBe(true);
  });

  it('escapes every special character', () => {
    const special = '.*+?^${}()|[]\\';
    expect(new RegExp(`^${escapeRegex(special)}$`).test(special)).toBe(true);
  });

  it('escapes a NUL character, which MongoDB rejects inside a pattern', () => {
    expect(escapeRegex('a\0b')).toBe('a\\x00b');
    expect(escapeRegex('a\0b')).not.toContain('\0');
    expect(keywordRegex('a\0b').test('xa\0bx')).toBe(true);
    expect(keywordRegex('a\0b').test('ab')).toBe(false);
  });
});
