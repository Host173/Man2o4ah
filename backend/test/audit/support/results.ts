import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const OUT_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'out',
);

export function writeOut(file: string, data: unknown): void {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, file), `${JSON.stringify(data, null, 2)}\n`);
}
