import { resolvedMonthIndex, utcDayNumber } from './month';
import type { ExtraIncomeInput, HouseholdInput, PaycheckCadence, RaiseEarner } from './types';
import { DEFAULT_PAYCHECK_CADENCE } from './types';

export function paychecksPerYear(cadence: PaycheckCadence): number {
  if (cadence === 'weekly') return 52;
  if (cadence === 'biweekly') return 26;
  if (cadence === 'semimonthly') return 24;
  return 12;
}

export function resolvePaycheckCadence(h: HouseholdInput): PaycheckCadence {
  return h.paycheckCadence ?? DEFAULT_PAYCHECK_CADENCE;
}

export function resolvePartnerCadence(h: HouseholdInput): PaycheckCadence {
  return h.partnerPaycheckCadence ?? resolvePaycheckCadence(h);
}

/** Typical monthly take-home (own + partner). Cadence jitter is applied in the walker. */
export function typicalMonthlyIncome(h: HouseholdInput): number {
  return Math.max(0, (h.monthlyIncome ?? 0) + (h.partnerMonthlyIncome ?? 0));
}

function paychecksInCalendarMonth(cadence: PaycheckCadence, monthIndex: number, now: Date): number {
  const m = calendarMonthNumber(now, monthIndex);
  if (cadence === 'biweekly') return m === 3 || m === 9 ? 3 : 2;
  if (cadence === 'weekly') return m === 2 || m === 5 || m === 8 || m === 11 ? 5 : 4;
  if (cadence === 'semimonthly') return 2;
  return 1;
}

function parseIsoDay(iso: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isFinite(date.getTime()) ? date : null;
}

function monthWindow(now: Date, monthIndex: number): { start: Date; end: Date } {
  const start = new Date(now.getFullYear(), now.getMonth() + (monthIndex - 1), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + monthIndex, 1);
  return { start, end };
}

function localDay(date: Date): number {
  return utcDayNumber(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

function countPaydays(cadence: PaycheckCadence, start: Date, end: Date, anchor: Date): number {
  const step = cadence === 'weekly' ? 7 : 14;
  const startDay = localDay(start);
  const endDay = localDay(end);
  let cursor = localDay(anchor);
  if (cursor < startDay) {
    cursor += Math.floor((startDay - cursor) / step) * step;
    while (cursor < startDay) cursor += step;
  } else {
    while (cursor - step >= startDay) cursor -= step;
    if (cursor < startDay) cursor += step;
  }
  let count = 0;
  while (cursor < endDay) {
    if (cursor >= startDay) count += 1;
    cursor += step;
  }
  return count;
}

function anchoredCounts(cadence: PaycheckCadence, monthIndex: number, anchor: Date, now: Date): { count: number; yearChecks: number } {
  const block = Math.floor((monthIndex - 1) / 12) * 12 + 1;
  let yearChecks = 0;
  let count = 0;
  for (let m = block; m < block + 12; m++) {
    const { start, end } = monthWindow(now, m);
    const n = countPaydays(cadence, start, end, anchor);
    yearChecks += n;
    if (m === monthIndex) count = n;
  }
  return { count, yearChecks: yearChecks || paychecksPerYear(cadence) };
}

/** Calendar month 1–12 for forecast month 1 = the month of `now`. */
export function calendarMonthNumber(now: Date, monthIndex: number): number {
  return new Date(now.getFullYear(), now.getMonth() + (monthIndex - 1), 1).getMonth() + 1;
}

/**
 * Income posted in forecast month `monthIndex` (1-based). Annual total matches typical * 12.
 * Without a payday anchor, biweekly three-check months stay March and September.
 */
export function incomeForMonth(
  monthlyEquivalent: number | null | undefined,
  cadence: PaycheckCadence,
  monthIndex: number,
  anchor?: string | null,
  now: Date = new Date(),
): number {
  const monthly = monthlyEquivalent ?? 0;
  if (monthly <= 0) return 0;
  if (cadence === 'monthly' || cadence === 'semimonthly') {
    const checks = cadence === 'semimonthly' ? 2 : 1;
    const paycheck = (monthly * 12) / paychecksPerYear(cadence);
    return paycheck * checks;
  }
  const payday = anchor ? parseIsoDay(anchor) : null;
  if (!payday || (cadence !== 'biweekly' && cadence !== 'weekly')) {
    const paycheck = (monthly * 12) / paychecksPerYear(cadence);
    return paycheck * paychecksInCalendarMonth(cadence, monthIndex, now);
  }
  const { count, yearChecks } = anchoredCounts(cadence, monthIndex, payday, now);
  const paycheck = (monthly * 12) / yearChecks;
  return paycheck * count;
}

export function plannedRaiseFactor(h: HouseholdInput, earner: RaiseEarner, month: number, now = new Date()): number {
  const start = resolvedMonthIndex(h.plannedRaiseAt, h.plannedRaiseMonth, now);
  if (start == null || h.plannedRaisePercent == null) return 1;
  if ((h.plannedRaiseEarner ?? 'own') !== earner) return 1;
  if (month >= start) return 1 + Math.max(0, h.plannedRaisePercent);
  return 1;
}

export function extraIncomeForMonth(rows: ExtraIncomeInput[] | null | undefined, monthIndex: number, now: Date): number {
  let sum = 0;
  for (const row of rows ?? []) {
    if (!(row.amount > 0)) continue;
    if (row.schedule === 'monthly') sum += row.amount;
    else if (row.schedule === 'annual' && calendarMonthNumber(now, monthIndex) === (row.monthOfYear ?? 0)) sum += row.amount;
    else if (row.schedule === 'once' && resolvedMonthIndex(row.onceAt, row.onceMonth, now) === monthIndex) sum += row.amount;
  }
  return sum;
}

export function householdIncomeForMonth(h: HouseholdInput, monthIndex: number, now: Date = new Date()): number {
  return ownIncomeForMonth(h, monthIndex, now) + partnerIncomeForMonth(h, monthIndex, now);
}

export function ownIncomeForMonth(h: HouseholdInput, monthIndex: number, now: Date = new Date()): number {
  return incomeForMonth(h.monthlyIncome, resolvePaycheckCadence(h), monthIndex, h.nextPayday, now);
}

export function partnerIncomeForMonth(h: HouseholdInput, monthIndex: number, now: Date = new Date()): number {
  return incomeForMonth(h.partnerMonthlyIncome, resolvePartnerCadence(h), monthIndex, h.partnerNextPayday, now);
}
