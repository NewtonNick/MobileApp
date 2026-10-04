import { pickTriple } from './lookups';
import type { AccountInput, AccountType, PercentileTriple, Scenario } from './types';
import { isLiability } from './types';

/**
 * Labeled typical APRs when the user has not entered a rate.
 * Conservative = a harder year (higher rate). Not a lender quote.
 */
export const TYPICAL_APR: Record<
  Extract<AccountType, 'mortgage' | 'auto_loan' | 'student_loan' | 'credit_card' | 'other_liability'>,
  PercentileTriple
> = {
  mortgage: { liberal: 0.055, realistic: 0.065, conservative: 0.08 },
  auto_loan: { liberal: 0.055, realistic: 0.07, conservative: 0.12 },
  student_loan: { liberal: 0.05, realistic: 0.065, conservative: 0.09 },
  credit_card: { liberal: 0.18, realistic: 0.22, conservative: 0.28 },
  other_liability: { liberal: 0.08, realistic: 0.12, conservative: 0.18 },
};

export type PercentRead =
  | { status: 'empty' }
  | { status: 'ok'; rate: number }
  | { status: 'ambiguous'; asPercent: number; asDecimal: number; percentLabel: string; decimalLabel: string }
  | { status: 'rejected'; message: string };

export interface PercentReadOptions {
  /** APR fields store a bare fraction such as 0.065 as 6.5%, not as an ambiguous pair. */
  bareFractionMeans?: 'decimal' | 'ask';
  /** Withdrawal and similar fields may be exactly zero. */
  allowZero?: boolean;
}

/** Compound monthly rate from an annual rate. `(1+annual)^(1/12) - 1`. */
export function monthlyRate(annual: number): number {
  if (!Number.isFinite(annual) || annual <= -1) return 0;
  return Math.pow(1 + annual, 1 / 12) - 1;
}

/**
 * User types 6.5 for 6.5%. A number strictly between 0 and 1 is not stored
 * until they say whether they meant a percent or a decimal, unless
 * `bareFractionMeans` is `decimal`. Above 80% is rejected.
 */
export function readPercentInput(raw: string, opts: PercentReadOptions = {}): PercentRead {
  const trimmed = String(raw).trim();
  if (!trimmed) return { status: 'empty' };
  const hadMark = trimmed.endsWith('%');
  const body = hadMark ? trimmed.slice(0, -1).trim() : trimmed;
  const n = Number(body);
  if (!Number.isFinite(n)) return { status: 'rejected', message: 'Enter a number.' };
  if (n < 0) return { status: 'rejected', message: 'Rate cannot be negative.' };
  if (n === 0) return opts.allowZero === false ? { status: 'rejected', message: 'Rate cannot be zero.' } : { status: 'ok', rate: 0 };
  if (n > 80 && !(opts.bareFractionMeans === 'decimal' && n <= 1)) {
    return { status: 'rejected', message: 'Rate must be 80% or less.' };
  }
  if (!hadMark && n > 0 && n < 1 && opts.bareFractionMeans === 'decimal') {
    return { status: 'ok', rate: n };
  }
  if (!hadMark && n > 0 && n < 1) {
    return {
      status: 'ambiguous',
      asPercent: n / 100,
      asDecimal: n,
      percentLabel: `${n}%`,
      decimalLabel: `${trimRate(n * 100)}%`,
    };
  }
  return { status: 'ok', rate: n / 100 };
}

function trimRate(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}

/** Unambiguous rates only. Ambiguous and out-of-range values do not store. */
export function parsePercentInput(raw: string, opts: PercentReadOptions = {}): number | null {
  const read = readPercentInput(raw, opts);
  return read.status === 'ok' ? read.rate : null;
}

export function percentOrBlock(
  raw: string,
  force?: 'percent' | 'decimal' | null,
): { rate: number | null; blocked: boolean; message: string | null } {
  const read = readPercentInput(raw);
  if (read.status === 'empty') return { rate: null, blocked: false, message: null };
  if (read.status === 'rejected') return { rate: null, blocked: true, message: read.message };
  if (read.status === 'ambiguous') {
    if (force === 'percent') return { rate: read.asPercent, blocked: false, message: null };
    if (force === 'decimal') return { rate: read.asDecimal, blocked: false, message: null };
    return { rate: null, blocked: true, message: 'Confirm whether this is a percent or a decimal.' };
  }
  return { rate: read.rate, blocked: false, message: null };
}

export function typicalAprPercent(type: AccountType, scenario: Scenario = 'realistic'): number {
  const triple =
    type === 'mortgage' ||
    type === 'auto_loan' ||
    type === 'student_loan' ||
    type === 'credit_card' ||
    type === 'other_liability'
      ? TYPICAL_APR[type]
      : TYPICAL_APR.other_liability;
  return Math.round(pickTriple(triple, scenario) * 1000) / 10;
}

export function liabilityApr(account: AccountInput, scenario: Scenario): number {
  if (account.apr != null && Number.isFinite(account.apr)) return Math.max(0, account.apr);
  if (!isLiability(account.type)) return 0;
  return pickTriple(
    account.type in TYPICAL_APR
      ? TYPICAL_APR[account.type as keyof typeof TYPICAL_APR]
      : TYPICAL_APR.other_liability,
    scenario,
  );
}

export function loanMissingApr(account: AccountInput): boolean {
  return isLiability(account.type) && account.balance > 0 && account.apr == null;
}

export function firstLoanMissingApr(accounts: AccountInput[]): AccountInput | null {
  return accounts.find(loanMissingApr) ?? null;
}
