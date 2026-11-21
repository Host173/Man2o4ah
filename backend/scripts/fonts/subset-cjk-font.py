r"""Builds the CJK subset used by the itinerary PDF (ITN-28).

Keeps the standard character sets: GB2312 (simplified Chinese, 6 763 hanzi + symbols),
JIS X 0208 (Japanese kanji, kana, symbols), KS X 1001 (2 350 common Hangul, hanja, symbols),
plus CJK punctuation (U+3000-303F), kana (U+3040-30FF) and full-width forms (U+FF00-FFEF).

Usage (from the repo root, with fontTools installed):
  python backend\scripts\fonts\subset-cjk-font.py <path to the full NotoSansCJKsc-Regular.otf>
Writes backend\src\modules\itineraries\fonts\NotoSansCJKsc.otf.
"""

import pathlib
import subprocess
import sys
import tempfile


def table(codec: str, rows: range, cols: range, chars: set[str]) -> None:
    for a in rows:
        for b in cols:
            try:
                chars.add(bytes([a, b]).decode(codec))
            except UnicodeDecodeError:
                continue


def main(source: str) -> None:
    chars: set[str] = set()
    table('gb2312', range(0xA1, 0xF8), range(0xA1, 0xFF), chars)
    table('euc_jp', range(0xA1, 0xF5), range(0xA1, 0xFF), chars)
    table('euc_kr', range(0xA1, 0xFE), range(0xA1, 0xFF), chars)
    for start, end in [(0x3000, 0x303F), (0x3040, 0x30FF), (0xFF00, 0xFFEF)]:
        chars.update(chr(c) for c in range(start, end + 1))
    chars = {c for c in chars if len(c) == 1}
    out = (
        pathlib.Path('backend') / 'src' / 'modules' / 'itineraries'
        / 'fonts' / 'NotoSansCJKsc.otf'
    )
    with tempfile.NamedTemporaryFile('w', encoding='utf-8', suffix='.txt', delete=False) as f:
        f.write(''.join(sorted(chars)))
        text_file = pathlib.Path(f.name)
    try:
        subprocess.run(
            [
                sys.executable, '-m', 'fontTools.subset', source,
                f'--text-file={text_file}', f'--output-file={out}',
                '--layout-features=*', '--no-hinting', '--desubroutinize',
            ],
            check=True,
        )
    finally:
        text_file.unlink()
    print(f'{len(chars)} characters -> {out} ({out.stat().st_size / 1048576:.2f} MiB)')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('Usage: subset-cjk-font.py <path to the full NotoSansCJKsc-Regular.otf>')
    main(sys.argv[1])
