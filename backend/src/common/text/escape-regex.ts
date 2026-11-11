/** Escapes `. * + ? ^ $ { } ( ) | [ ] \` so client text matches literally in a regex. */
export function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Case-insensitive keyword search regex. Never put client text in a regex without this. */
export function keywordRegex(input: string): RegExp {
  return new RegExp(escapeRegex(input.trim()), 'i');
}
