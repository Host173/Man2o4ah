const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** Offset of `timeZone` from UTC at the given instant, in milliseconds. */
function offsetMs(timeZone: string, utcMs: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const value = (type: string): number =>
    Number(parts.find((part) => part.type === type)?.value);
  const asUtc = Date.UTC(
    value('year'),
    value('month') - 1,
    value('day'),
    value('hour'),
    value('minute'),
    value('second'),
  );
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** `YYYY-MM-DDTHH:mm` wall-clock time in `timeZone` → UTC milliseconds. */
export function localToUtcMs(local: string, timeZone: string): number {
  const [date = '', time = ''] = local.split('T');
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  const [hour = 0, minute = 0] = time.split(':').map(Number);
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  return guess - offsetMs(timeZone, guess - offsetMs(timeZone, guess));
}

/** UTC milliseconds → `YYYY-MM-DDTHH:mm` wall-clock time in `timeZone`. */
export function utcMsToLocal(utcMs: number, timeZone: string): string {
  const shifted = new Date(utcMs + offsetMs(timeZone, utcMs));
  return shifted.toISOString().slice(0, 16);
}

/** `YYYY-MM-DD` plus a number of days (UTC calendar arithmetic). */
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

/** The arrival wall-clock time of a flight leaving at `departureLocal`. */
export function arrivalLocalOf(
  departureLocal: string,
  departureTimeZone: string,
  durationMinutes: number,
  arrivalTimeZone: string,
): string {
  const departureUtc = localToUtcMs(departureLocal, departureTimeZone);
  return utcMsToLocal(
    departureUtc + durationMinutes * MINUTE_MS,
    arrivalTimeZone,
  );
}
