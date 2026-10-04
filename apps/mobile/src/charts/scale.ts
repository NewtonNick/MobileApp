export type Domain = { min: number; max: number; span: number };

/** Include zero when the series crosses it or the low end is close relative to the rise. */
function crossesOrNearsZero(min: number, max: number): boolean {
  if (min <= 0 && max >= 0) return true;
  const span = Math.max(max - min, 1);
  if (min > 0 && min <= span * 0.35) return true;
  if (max < 0 && Math.abs(max) <= span * 0.35) return true;
  return false;
}

export function domainOf(series: number[][], opts?: { pinZero?: boolean }): Domain {
  const finite = series.flat().filter((n) => Number.isFinite(n));
  if (!finite.length) return { min: 0, max: 1, span: 1 };
  let lo = Math.min(...finite);
  let hi = Math.max(...finite);
  const pin = opts?.pinZero === true || crossesOrNearsZero(lo, hi);
  if (pin && lo > 0) lo = 0;
  if (pin && hi < 0) hi = 0;
  if (hi - lo < 1e-6) hi = lo + 1;
  const pad = Math.max((hi - lo) * 0.08, 1);
  const min = pin && lo === 0 ? 0 : lo - pad;
  const max = pin && hi === 0 ? 0 : hi + pad;
  return { min, max, span: Math.max(max - min, 1) };
}

function niceStep(rough: number): number {
  const safe = Math.max(rough, 1);
  const pow = 10 ** Math.floor(Math.log10(safe));
  const err = safe / pow;
  const nice = err <= 1 ? 1 : err <= 2 ? 2 : err <= 5 ? 5 : 10;
  return nice * pow;
}

export function axisTicks(min: number, max: number, count = 3): number[] {
  const span = max - min;
  if (!(span > 0)) return [min];
  const step = niceStep(span / Math.max(1, count - 1));
  const start = Math.ceil((min - step * 1e-6) / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + step * 1e-6 && ticks.length < 5; v += step) {
    const rounded = Math.round(v / step) * step;
    if (rounded < min - step * 0.01 || rounded > max + step * 0.01) continue;
    ticks.push(Object.is(rounded, -0) ? 0 : rounded);
  }
  return ticks.length ? ticks : [min];
}

export { compactUsd } from '@asset-aware/forecast-engine';

export function yearMarks(months: number[], now = new Date(), width = 400): { index: number; label: string }[] {
  if (!months.length) return [];
  const marks: { index: number; label: string }[] = [];
  let lastYear = Number.NaN;
  months.forEach((month, index) => {
    const year = new Date(now.getFullYear(), now.getMonth() + month - 1, 1).getFullYear();
    if (year === lastYear) return;
    marks.push({ index, label: String(year) });
    lastYear = year;
  });
  const cap = width > 0 && width < 340 ? 3 : 4;
  if (marks.length <= cap) return marks;
  const last = marks.length - 1;
  const keep =
    cap === 3
      ? new Set([0, last, Math.round(last / 2)])
      : new Set([0, last, Math.round(last / 3), Math.round((last * 2) / 3)]);
  return marks.filter((_, index) => keep.has(index));
}

export function widestGap(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let gap = 0;
  for (let i = 0; i < n; i++) gap = Math.max(gap, Math.abs((a[i] ?? 0) - (b[i] ?? 0)));
  return gap;
}

export function widestSpread(rows: number[][]): number {
  if (!rows.length) return 0;
  const n = Math.min(...rows.map((row) => row.length));
  let gap = 0;
  for (let i = 0; i < n; i++) {
    const column = rows.map((row) => row[i] ?? 0);
    gap = Math.max(gap, Math.max(...column) - Math.min(...column));
  }
  return gap;
}

export function extremeIndex(values: number[]): number {
  let index = 0;
  let best = -1;
  values.forEach((value, i) => {
    const magnitude = Math.abs(value);
    if (magnitude > best) {
      best = magnitude;
      index = i;
    }
  });
  return index;
}

/**
 * Draw every month through five years. Longer paths keep the first month,
 * each year-end, the last month, and any pinned month such as the hired date.
 */
export function plottedSeries(
  months: number[],
  values: number[],
  pins: number[] = [],
  coarseAfter = 72,
): Array<{ month: number; value: number }> {
  const pairs = months.map((month, i) => ({
    month,
    value: Number.isFinite(values[i]) ? (values[i] as number) : 0,
  }));
  if (pairs.length <= coarseAfter) return pairs;
  const byMonth = new Map(pairs.map((point) => [point.month, point.value]));
  const keep = new Set<number>();
  const first = pairs[0];
  const last = pairs[pairs.length - 1];
  if (first) keep.add(first.month);
  if (last) keep.add(last.month);
  for (const pin of pins) {
    if (byMonth.has(pin)) keep.add(pin);
  }
  const end = last?.month ?? 0;
  for (let start = 1; start <= end; start += 12) {
    let endMonth = -1;
    for (let month = start; month < start + 12; month++) {
      if (byMonth.has(month)) endMonth = month;
    }
    if (endMonth > 0) keep.add(endMonth);
  }
  return [...keep]
    .sort((a, b) => a - b)
    .map((month) => ({ month, value: byMonth.get(month) ?? 0 }));
}

export function alignValues(months: number[], values: number[], plottedMonths: number[]): number[] {
  const byMonth = new Map(months.map((month, i) => [month, Number.isFinite(values[i]) ? (values[i] as number) : 0]));
  return plottedMonths.map((month) => byMonth.get(month) ?? 0);
}

/** Low month inside a year, when it sits well below that year's ending amount. */
export function dipMarks(
  months: number[],
  values: number[],
  span: number,
  limit = 4,
): Array<{ month: number; value: number }> {
  if (months.length <= 72 || span <= 0) return [];
  const dips: Array<{ month: number; value: number; depth: number }> = [];
  const end = months[months.length - 1] ?? 0;
  for (let start = 1; start <= end; start += 12) {
    let endValue = 0;
    let endMonth = -1;
    let minValue = Infinity;
    let minMonth = -1;
    for (let i = 0; i < months.length; i++) {
      const month = months[i] ?? 0;
      if (month < start || month >= start + 12) continue;
      const value = values[i] ?? 0;
      endMonth = month;
      endValue = value;
      if (value < minValue) {
        minValue = value;
        minMonth = month;
      }
    }
    if (endMonth < 0 || minMonth === endMonth) continue;
    const depth = endValue - minValue;
    if (depth >= span * 0.08) dips.push({ month: minMonth, value: minValue, depth });
  }
  return dips
    .sort((a, b) => b.depth - a.depth)
    .slice(0, limit)
    .map(({ month, value }) => ({ month, value }));
}

export type DatedValue = { month: number; value: number };

export type RangeSpan = { month: number; low: number; high: number; close: number };

function finitePairs(months: number[], values: number[]): DatedValue[] {
  return months.map((month, index) => ({
    month,
    value: Number.isFinite(values[index]) ? (values[index] as number) : 0,
  }));
}

function bucketCloses(pairs: DatedValue[], bucket: number): DatedValue[] {
  const end = pairs[pairs.length - 1]?.month ?? 0;
  const byMonth = new Map(pairs.map((point) => [point.month, point.value]));
  const closes: DatedValue[] = [];
  for (let start = 1; start <= end; start += bucket) {
    let endMonth = -1;
    for (let month = start; month < start + bucket; month++) {
      if (byMonth.has(month)) endMonth = month;
    }
    if (endMonth > 0) closes.push({ month: endMonth, value: byMonth.get(endMonth) ?? 0 });
  }
  return closes;
}

/** Month-to-month moves on a short path. Year-end moves once the path is longer than 18 months. */
export function periodChanges(months: number[], values: number[]): DatedValue[] {
  const pairs = finitePairs(months, values);
  if (pairs.length < 2) return [];
  if (pairs.length <= 18) {
    return pairs.slice(1).map((point, index) => ({
      month: point.month,
      value: point.value - (pairs[index]?.value ?? 0),
    }));
  }
  const closes = bucketCloses(pairs, 12);
  const changes: DatedValue[] = [];
  let previous = pairs[0]?.value ?? 0;
  for (const close of closes) {
    changes.push({ month: close.month, value: close.value - previous });
    previous = close.value;
  }
  return changes;
}

/** Low, high, and ending amount. Quarters on a short path, years after that. */
export function rangeSpans(months: number[], values: number[]): RangeSpan[] {
  const pairs = finitePairs(months, values);
  if (!pairs.length) return [];
  const bucket = pairs.length > 18 ? 12 : 3;
  const end = pairs[pairs.length - 1]?.month ?? 0;
  const spans: RangeSpan[] = [];
  for (let start = 1; start <= end; start += bucket) {
    let low = Infinity;
    let high = -Infinity;
    let closeMonth = -1;
    let close = 0;
    for (const point of pairs) {
      if (point.month < start || point.month >= start + bucket) continue;
      low = Math.min(low, point.value);
      high = Math.max(high, point.value);
      closeMonth = point.month;
      close = point.value;
    }
    if (closeMonth > 0) spans.push({ month: closeMonth, low, high, close });
  }
  return spans;
}

export function fromToday(values: number[]): number[] {
  const base = values.find((value) => Number.isFinite(value)) ?? 0;
  return values.map((value) => (Number.isFinite(value) ? value - base : 0));
}

export function fractionalIndex(months: number[], month: number): number | null {
  if (!months.length) return null;
  const first = months[0] ?? 0;
  const lastIndex = months.length - 1;
  const last = months[lastIndex] ?? first;
  if (month <= first) return 0;
  if (month >= last) return lastIndex;
  for (let i = 1; i < months.length; i++) {
    const prev = months[i - 1] ?? 0;
    const next = months[i] ?? prev;
    if (month <= next) return i - 1 + (month - prev) / Math.max(1, next - prev);
  }
  return lastIndex;
}
