const GROUPED = /^\d{1,3}(,\d{3})*(\.\d+)?$/;
const PLAIN = /^\d+(\.\d+)?$/;

export type MoneyParse = { ok: true; value: number } | { ok: false; reason: string };

/** US grouping only: `1250`, `1,250`, or `1,250.50`. A blank or a stray comma is a reason, not a number. */
export function parseMoneyDetailed(raw: string): MoneyParse {
  const trimmed = String(raw).trim().replace(/\s/g, '');
  if (!trimmed) return { ok: false, reason: 'Enter an amount.' };
  const body = trimmed.startsWith('$') ? trimmed.slice(1) : trimmed;
  if (!body) return { ok: false, reason: 'Enter an amount.' };
  if (body.startsWith('-')) return { ok: false, reason: 'Amount cannot be negative.' };
  if (!GROUPED.test(body) && !PLAIN.test(body)) {
    return { ok: false, reason: 'Use a number like 1,250 or 1250.50.' };
  }
  const n = Number(body.replace(/,/g, ''));
  if (!Number.isFinite(n) || n < 0) return { ok: false, reason: 'Enter an amount.' };
  return { ok: true, value: n };
}

/** Pay, balances, and bills. Rejects negatives, blanks, and uneven commas. */
export function parseMoney(raw: string): number | null {
  const read = parseMoneyDetailed(raw);
  return read.ok ? read.value : null;
}

/** Draft text for a money field: `4200` becomes `4,200`, and cents stay when they exist. */
export function formatMoneyDraft(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  const [whole, frac] = rounded.toFixed(2).split('.');
  const withCommas = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return frac === '00' ? withCommas : `${withCommas}.${frac}`;
}

/** Install and model years. 1900 through next calendar year. */
export function parseYear(raw: string, nowYear = new Date().getFullYear()): number | null {
  const trimmed = String(raw).trim();
  if (!/^\d{4}$/.test(trimmed)) return null;
  const n = Number(trimmed);
  if (n < 1900 || n > nowYear + 1) return null;
  return n;
}

/** Odometer. 0 through 500,000. */
export function parseMileage(raw: string): number | null {
  const n = parseMoney(raw);
  if (n == null || n > 500_000) return null;
  return n;
}
