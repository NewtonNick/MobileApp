/** Validated local calendar dates. Forecast month 1 is the month of `now`. */

export interface DateParts {
  y: number;
  m: number;
  d: number;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function parseIsoDate(value: string): DateParts | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.slice(0, 10));
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null;
  return { y, m, d };
}

export function parseMonthKey(value: string): { y: number; m: number } | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  if (m < 1 || m > 12) return null;
  return { y, m };
}

export function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function monthKeyOf(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

/** Keeps the day when the target month has it, otherwise the last day. */
export function addMonths(from: Date, months: number): Date {
  const day = from.getDate();
  const d = new Date(from.getFullYear(), from.getMonth() + months, 1);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return d;
}

/** Whole months from `fromKey` to `toKey`. */
export function monthDiff(fromKey: string, toKey: string): number | null {
  const from = parseMonthKey(fromKey);
  const to = parseMonthKey(toKey);
  if (!from || !to) return null;
  return (to.y - from.y) * 12 + (to.m - from.m);
}

/** Forecast index for a `YYYY-MM` key. 1 is the current month. Past keys are 0 or less. */
export function monthIndexFrom(key: string, now: Date): number | null {
  const parsed = parseMonthKey(key);
  if (!parsed) return null;
  const current = now.getFullYear() * 12 + now.getMonth();
  const target = parsed.y * 12 + (parsed.m - 1);
  return target - current + 1;
}

export function monthKeyFromIndex(index: number, now: Date): string {
  const date = new Date(now.getFullYear(), now.getMonth() + (index - 1), 1);
  return monthKey(date);
}

export function monthLabel(date: Date): string {
  return date.toLocaleString('en-US', { month: 'short', year: 'numeric' });
}

export function labelFromMonthKey(key: string): string | null {
  const parsed = parseMonthKey(key);
  if (!parsed) return null;
  return monthLabel(new Date(parsed.y, parsed.m - 1, 1));
}

/** Old forecast offsets become the calendar month they meant on `now`. */
export function offsetToMonthKey(offset: number, now: Date): string | null {
  if (!Number.isFinite(offset)) return null;
  return monthKeyFromIndex(Math.round(offset), now);
}

/** UTC day number of a local calendar date, so DST does not change the count. */
export function utcDayNumber(year: number, month: number, day: number): number {
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

export function utcDayOf(date: Date): number {
  return utcDayNumber(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

/** `YYYY-MM` wins. A legacy forecast offset is used only when the key is missing. */
export function resolvedMonthIndex(
  at: string | null | undefined,
  legacy: number | null | undefined,
  now: Date,
): number | null {
  if (typeof at === 'string' && at.trim()) {
    const index = monthIndexFrom(at.trim(), now);
    if (index != null) return index;
  }
  if (legacy != null && Number.isFinite(legacy)) return legacy;
  return null;
}
