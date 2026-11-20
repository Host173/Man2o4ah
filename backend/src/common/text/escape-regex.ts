/**
 * Escapes `. * + ? ^ $ { } ( ) | [ ] \` so client text matches literally in a
 * regex, and writes a NUL character as `\x00`: MongoDB rejects a raw NUL
 * inside a pattern, which would answer 500.
 */
export function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replaceAll('\0', '\\x00');
}

/** Case-insensitive keyword search regex. Never put client text in a regex without this. */
export function keywordRegex(input: string): RegExp {
  return new RegExp(escapeRegex(input.trim()), 'i');
}
