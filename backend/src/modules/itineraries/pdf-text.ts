import { readFileSync } from 'node:fs';
import { create } from 'fontkit';

export const pdfFonts = [
  ['Latin', 'NotoSans.ttf', 'font/ttf'],
  ['Arabic', 'NotoSansArabic.ttf', 'font/ttf'],
  ['CJK', 'NotoSansCJKsc.otf', 'font/otf'],
  ['Emoji', 'NotoEmoji.ttf', 'font/ttf'],
].map(([name, file, contentType]) => {
  const bytes = readFileSync(new URL(`./fonts/${file}`, import.meta.url));
  const font = create(bytes);
  if (!('hasGlyphForCodePoint' in font)) {
    throw new Error(`Expected a single PDF font: ${name}`);
  }
  return {
    name,
    url: `https://itinerary.invalid/fonts/${file}`,
    bytes,
    contentType,
    font,
  };
});

const segmenter = new Intl.Segmenter('und', { granularity: 'grapheme' });
const layoutCharacters = new Set([
  '\n',
  '\r',
  '\t',
  '\u200d',
  '\ufe0e',
  '\ufe0f',
]);

/** Escapes markup and preserves missing graphemes as explicit Unicode notation. */
export function pdfText(value: string): string {
  const normalized = Array.from(segmenter.segment(value), ({ segment }) => {
    const characters = Array.from(segment);
    const supported = pdfFonts.some(({ font }) =>
      characters.every(
        (character) =>
          layoutCharacters.has(character) ||
          font.hasGlyphForCodePoint(character.codePointAt(0)!),
      ),
    );
    return supported
      ? segment
      : characters
          .map(
            (character) =>
              `[U+${character.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}]`,
          )
          .join('');
  }).join('');
  return normalized
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
