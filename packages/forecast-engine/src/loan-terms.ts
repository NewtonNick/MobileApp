import { resolvedMonthIndex } from './month';
import { monthlyRate } from './rates';
import { liabilityApr } from './rates';
import type { AccountInput, Scenario } from './types';

export interface LoanMonthPlan {
  apr: number;
  /** Null means no payment this month. */
  payment: number | null;
  interestOnly: boolean;
  forgive: boolean;
  ended: boolean;
  accrueInterest: boolean;
}

/** Months of principal and interest left at a constant payment. Null when the payment never catches interest. */
export function remainingTermMonths(balance: number, annualRate: number, payment: number): number | null {
  if (!(balance > 0.5)) return 0;
  if (!(payment > 0)) return null;
  let bal = balance;
  for (let month = 1; month <= 360; month++) {
    const interest = bal * monthlyRate(annualRate);
    if (payment <= interest + 0.005) return null;
    bal = Math.max(0, bal + interest - payment);
    if (bal <= 0.5) return month;
  }
  return null;
}

export function amortizingPayment(balance: number, annualRate: number, months: number): number {
  if (!(balance > 0) || !(months > 0)) return 0;
  const rate = monthlyRate(annualRate);
  if (rate === 0) return balance / months;
  return (balance * rate) / (1 - Math.pow(1 + rate, -months));
}

/**
 * Rate and payment for one forecast month.
 * `indexAnnual` is the scenario mortgage index used at an adjustable reset.
 * `priorApr` is the rate already in force, so a periodic cap has a base.
 */
export function loanMonthPlan(
  account: AccountInput,
  month: number,
  scenario: Scenario,
  now: Date,
  indexAnnual: number | null,
  priorApr: number | null,
): LoanMonthPlan {
  const opening = liabilityApr(account, scenario);
  let apr = priorApr ?? opening;
  const promoEnd = resolvedMonthIndex(account.promoEndsAt, null, now);
  if (account.promoApr != null && Number.isFinite(account.promoApr) && promoEnd != null && month < promoEnd) {
    apr = Math.max(0, account.promoApr);
  }

  const fixedUntil = resolvedMonthIndex(account.rateFixedUntil, null, now);
  if (
    account.type === 'mortgage' &&
    fixedUntil != null &&
    account.indexMargin != null &&
    indexAnnual != null &&
    month >= fixedUntil &&
    (month === fixedUntil || (month - fixedUntil) % 12 === 0)
  ) {
    const uncapped = indexAnnual + Math.max(0, account.indexMargin);
    const periodic = account.capPeriodic != null ? Math.max(0, account.capPeriodic) : null;
    const fromPrior = priorApr ?? opening;
    let next = uncapped;
    if (periodic != null) next = Math.min(fromPrior + periodic, Math.max(fromPrior - periodic, next));
    const lifetime = account.capLifetime != null ? opening + Math.max(0, account.capLifetime) : null;
    if (lifetime != null) next = Math.min(next, lifetime);
    apr = Math.max(0, next);
  }

  const forgiveAt = resolvedMonthIndex(account.forgivenessAt, account.forgivenessMonth, now);
  if (account.type === 'student_loan' && forgiveAt != null && month >= forgiveAt) {
    return { apr, payment: 0, interestOnly: false, forgive: true, ended: false, accrueInterest: false };
  }

  const deferred = resolvedMonthIndex(account.deferredUntil, null, now);
  if (account.type === 'student_loan' && deferred != null && month < deferred) {
    return {
      apr,
      payment: 0,
      interestOnly: false,
      forgive: false,
      ended: false,
      accrueInterest: account.subsidized !== true,
    };
  }

  const leaseEnd = resolvedMonthIndex(account.endsAt, null, now);
  if (account.type === 'auto_lease' && leaseEnd != null && month > leaseEnd) {
    return { apr: 0, payment: 0, interestOnly: false, forgive: false, ended: true, accrueInterest: false };
  }

  const interestOnlyUntil = resolvedMonthIndex(account.interestOnlyUntil, null, now);
  const interestOnly = interestOnlyUntil != null && month <= interestOnlyUntil;
  const stated = account.minPayment == null ? null : Math.max(0, account.minPayment);
  return {
    apr,
    payment: stated,
    interestOnly,
    forgive: false,
    ended: false,
    accrueInterest: true,
  };
}
