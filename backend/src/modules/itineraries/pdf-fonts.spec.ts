import { statSync } from 'node:fs';
import { pdfFonts, pdfText } from './pdf-text.js';

describe('Itinerary PDF CJK font (ITN-28)', () => {
  const cjk = pdfFonts.find(({ name }) => name === 'CJK')!;

  it('keeps the bundled CJK font smaller than 6 MB', () => {
    const file = new URL('./fonts/NotoSansCJKsc.otf', import.meta.url);
    expect(statSync(file).size).toBeLessThan(6_000_000);
  });

  it.each([
    ['simplified Chinese', '东京'],
    ['Japanese kanji and hiragana', '東京ありがとう'],
    ['Japanese katakana', 'カタカナ'],
    ['Korean', '안녕하세요'],
    ['CJK punctuation', '、。「」'],
    ['full-width forms', 'ＡＢＣ１２３'],
  ])('preserves glyphs for %s', (_, text) => {
    for (const character of text) {
      expect(cjk.font.hasGlyphForCodePoint(character.codePointAt(0)!)).toBe(
        true,
      );
    }
  });

  it('explicitly represents an unsupported Extension B character', () => {
    expect(cjk.font.hasGlyphForCodePoint(0x20000)).toBe(false);
    expect(pdfText('𠀀')).toBe('[U+20000]');
  });
});
