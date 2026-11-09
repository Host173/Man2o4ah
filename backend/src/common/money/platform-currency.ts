/**
 * Reads PLATFORM_CURRENCY lazily, so a value loaded from backend/.env by
 * ConfigModule is seen (schema files are imported before .env is loaded).
 * Falls back to 'USD'. Use this in schema defaults.
 */
export function getPlatformCurrency(): string {
  return process.env.PLATFORM_CURRENCY ?? 'USD';
}

/** Snapshot taken at import time. Prefer getPlatformCurrency() in schema defaults. */
export const PLATFORM_CURRENCY: string = getPlatformCurrency();
