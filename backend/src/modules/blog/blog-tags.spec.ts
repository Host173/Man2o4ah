import { describe, expect, it } from 'vitest';
import { buildExcerpt, EXCERPT_MAX_LENGTH } from './blog-tags.js';

type WithIsWellFormed = string & { isWellFormed(): boolean };

function hasLoneSurrogate(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      i += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function expectWellFormedExcerpt(actual: string, expected: string): void {
  expect((actual as WithIsWellFormed).isWellFormed()).toBe(true);
  expect(hasLoneSurrogate(actual)).toBe(false);
  expect(actual).toBe(expected);
}

describe('buildExcerpt (BLG-09)', () => {
  it('keeps 199 "a" characters followed by 😀 whole at 200 code points without ellipsis', () => {
    const input = `${'a'.repeat(199)}😀`;
    const result = buildExcerpt(input);

    expectWellFormedExcerpt(result, input);
    expect(Array.from(result)).toHaveLength(EXCERPT_MAX_LENGTH);

    const overInput = `${'a'.repeat(199)}😀more text`;
    const overResult = buildExcerpt(overInput);
    expectWellFormedExcerpt(overResult, `${input}...`);
    expect(Array.from(overResult)).toHaveLength(EXCERPT_MAX_LENGTH + 3);
  });

  it('cuts 200 "a" characters followed by 😀 right before the emoji with ellipsis', () => {
    const input = `${'a'.repeat(200)}😀`;
    const result = buildExcerpt(input);

    expectWellFormedExcerpt(result, `${'a'.repeat(200)}...`);
  });

  it('handles 198 "a" characters followed by 😀 and more text without breaking the emoji', () => {
    const joined = `${'a'.repeat(198)}😀more text`;
    expectWellFormedExcerpt(buildExcerpt(joined), `${'a'.repeat(198)}😀m...`);

    const spaced = `${'a'.repeat(198)}😀 more text`;
    expectWellFormedExcerpt(buildExcerpt(spaced), `${'a'.repeat(198)}😀...`);
  });

  it('returns bodies of exactly 200 code points without ellipsis', () => {
    const ascii200 = 'a'.repeat(200);
    expectWellFormedExcerpt(buildExcerpt(ascii200), ascii200);

    const mixed200 = `${'a'.repeat(190)}${'😀'.repeat(10)}`;
    expect(Array.from(mixed200)).toHaveLength(200);
    expectWellFormedExcerpt(buildExcerpt(mixed200), mixed200);
  });

  it('truncates bodies of 201 code points to 200 code points plus ellipsis', () => {
    const ascii201 = 'a'.repeat(201);
    expectWellFormedExcerpt(buildExcerpt(ascii201), `${'a'.repeat(200)}...`);

    const mixed201 = `${'a'.repeat(190)}${'😀'.repeat(11)}`;
    expect(Array.from(mixed201)).toHaveLength(201);
    expectWellFormedExcerpt(
      buildExcerpt(mixed201),
      `${'a'.repeat(190)}${'😀'.repeat(10)}...`,
    );
  });

  it('returns short and empty bodies unchanged and well formed', () => {
    expectWellFormedExcerpt(buildExcerpt(''), '');
    expectWellFormedExcerpt(buildExcerpt('   \n\t  '), '');
    expectWellFormedExcerpt(buildExcerpt('Siwa Oasis 😀'), 'Siwa Oasis 😀');
    expectWellFormedExcerpt(
      buildExcerpt('<p>Siwa   <b>Oasis</b> 😀</p>'),
      'Siwa Oasis 😀',
    );
  });

  it('handles bodies made solely of emoji cleanly across short, exact, and over-limit lengths', () => {
    const shortEmoji = '😀'.repeat(5);
    expectWellFormedExcerpt(buildExcerpt(shortEmoji), shortEmoji);

    const exactEmoji200 = '😀'.repeat(200);
    expectWellFormedExcerpt(buildExcerpt(exactEmoji200), exactEmoji200);

    const longEmoji205 = '😀'.repeat(205);
    expectWellFormedExcerpt(
      buildExcerpt(longEmoji205),
      `${'😀'.repeat(200)}...`,
    );
  });
});
