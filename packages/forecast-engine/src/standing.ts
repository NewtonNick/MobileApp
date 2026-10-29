import { amortizeMonth } from './amort';
import { cashLastEdited, isCashStale } from './completeness';
import { registerRetireStop, walkForecast, type PathShocks, type WalkOptions } from './drivers';
import type { OverlayId } from './overlays';
import {
  expenseMonth,
  formatUsd,
  investmentSum,
  liabilityPaymentMonth,
  liquidSum,
  netWorthNow,
  plannedEvents,
  recurringOwnershipAnnual,
} from './engine';
import {
  affordCost,
  goalMetric,
  hiredGoalSpec,
  jobClassFromSpec,
  livingReserveMonths,
  openGoalSpecs,
  reservedForSpec,
  runwayNeed,
  selectedLiabilities,
} from './goals';
import { leftoverOf } from './money';
import { addMonths as addCalendarMonths, monthKeyFromIndex, monthLabel, parseIsoDate } from './month';
import { intakeGap, resolveHasVehicle, resolveHousingTenure } from './jobs';
import { resolveGeo, seedIsStale } from './lookups';
import { liabilityApr } from './rates';
import {
  brokerageSliceFromPoint,
  brokerageSliceNow,
  describeBrokerageLots,
  taxOnBrokerageWithdrawal,
  type BrokerageGainSlice,
} from './taxlots';
import type { SeedBundle } from './seed-types';
import type {
  AccountInput,
  CollisionDiff,
  EventHit,
  FireFlavor,
  GoalSpec,
  HouseholdInput,
  JobClass,
  PulseReason,
  Scenario,
  StandingView,
} from './types';
import {
  DEFAULT_FIRE_FLAVOR,
  DEFAULT_WITHDRAWAL_RATE,
  hiredJobTitle,
  isInvestment,
  isLiability,
  isLiquid,
  type WithdrawalBucket,
} from './types';

export interface StandingOptions {
  now?: Date;
  /** Looks-wrong “I’m not on 4%”. Not a household column. */
  withdrawalRate?: number;
  /** Evaluate this spec instead of compiling from jobClass. */
  spec?: GoalSpec;
  /** Optional path shocks for a hired-date walk. Omitted uses the flat return. */
  shocks?: PathShocks;
  /** Optional hard-year or better-year overlay on the hired-date walk. */
  overlayId?: OverlayId;
  /**
   * Draw order for the year's withdrawal. Null forces the blended rate.
   * Omitted uses `household.withdrawalOrder`.
   */
  withdrawalOrder?: WithdrawalBucket[] | null;
}

function walkForDate(opts: StandingOptions, extra: WalkOptions = {}): WalkOptions {
  return {
    horizonMonths: HIRED_HORIZON_MONTHS,
    shocks: opts.shocks,
    overlayId: opts.overlayId,
    now: opts.now,
    collectWaterfall: false,
    ...extra,
    ignoreRetireStop: true,
  };
}

const HIRED_HORIZON_MONTHS = 360;

function addMonths(from: Date, months: number): Date {
  return addCalendarMonths(from, months);
}

/** Walker month 1 is the current calendar month. Month 0 is today. */
function walkerMonthDate(now: Date, month: number): Date {
  return addMonths(now, month <= 0 ? 0 : month - 1);
}

function isoDay(d: Date): string {
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

function parseIsoLocal(iso: string): Date | null {
  const parts = parseIsoDate(iso.slice(0, 10));
  if (!parts) return null;
  return new Date(parts.y, parts.m - 1, parts.d);
}

function nextDiscreteHit(events: EventHit[]): EventHit | null {
  const discrete = events.filter((e) => e.month >= 1).sort((a, b) => a.month - b.month || b.cost - a.cost);
  return discrete[0] ?? null;
}

/** Reserved follows hire + tenure. Never invent a house shock for a renter. */
export function reservedForHire(
  household: HouseholdInput,
  events: EventHit[],
  jobClass: JobClass,
): number {
  return reservedForSpec(household, events, hiredGoalSpec(household, jobClass));
}

export function reservedLabelFor(household: HouseholdInput, jobClass: JobClass): string {
  const spec = hiredGoalSpec(household, jobClass);
  const tenure = resolveHousingTenure(household);
  const hasHome = household.assets.some((a) => a.type === 'home');
  const hasCar = resolveHasVehicle(household) !== false && household.assets.some((a) => a.type === 'vehicle');
  if (spec.reserved === 'n_months_living') {
    const months = spec.target.kind === 'runway' ? spec.target.months : 3;
    return `Set aside for ${months} months of bills`;
  }
  if (spec.reserved === 'paycheck_year') return 'Set aside for a year without a paycheck';
  if (tenure === 'rent') return 'Set aside for rent and nearby bills';
  if (hasHome && hasCar) return 'Set aside for house and car';
  if (hasHome) return 'Set aside for the house';
  if (hasCar) return 'Set aside for the car';
  return 'Set aside';
}

function monthsUntilIso(target: string, now: Date): number {
  const t = Date.parse(target);
  if (!Number.isFinite(t)) return 0;
  const diffMs = t - now.getTime();
  return Math.max(0, Math.round(diffMs / (30.4375 * 24 * 60 * 60 * 1000)));
}

function hiredFromIso(target: string, now: Date): { hiredMonth: number; hiredDate: string } | null {
  if (!ISO_DAY_OK(target)) return null;
  const hiredMonth = monthsUntilIso(target, now);
  return { hiredMonth, hiredDate: target };
}

function ISO_DAY_OK(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s));
}

function hiredFromTargetDate(household: HouseholdInput, now: Date): { hiredMonth: number; hiredDate: string } | null {
  if (!household.targetDate) return null;
  return hiredFromIso(household.targetDate, now);
}

function flavorScale(flavor: FireFlavor): number {
  if (flavor === 'lean') return 0.7;
  if (flavor === 'fat') return 1.5;
  return 1;
}

function ageAt(household: HouseholdInput, month: number, nowYear: number): number | null {
  const base =
    household.currentAge != null
      ? household.currentAge
      : household.birthYear != null
        ? nowYear - household.birthYear
        : null;
  if (base == null || !Number.isFinite(base)) return null;
  return base + month / 12;
}

function partnerAgeAt(household: HouseholdInput, month: number): number | null {
  if (household.partnerAge == null || !Number.isFinite(household.partnerAge)) return null;
  return household.partnerAge + month / 12;
}

function benefitAt(benefit: HouseholdInput['socialSecurity'], age: number | null): number {
  if (!benefit?.monthlyAmount || benefit.startAge == null || age == null) return 0;
  return age >= benefit.startAge ? benefit.monthlyAmount : 0;
}

function benefitsMonthly(household: HouseholdInput, month: number, nowYear: number): number {
  const age = ageAt(household, month, nowYear);
  const partner = partnerAgeAt(household, month);
  return (
    benefitAt(household.socialSecurity, age) +
    benefitAt(household.pension, age) +
    benefitAt(household.partnerSocialSecurity, partner) +
    benefitAt(household.partnerPension, partner)
  );
}

/** After-tax dollars a withdrawal rate produces. A blank tax rate means this plan does not tax withdrawals. */
export function annualSpendable(
  traditional: number,
  roth: number,
  brokerage: number,
  withdrawalRate: number,
  taxRate: number | null,
  brokerageGains?: BrokerageGainSlice | null,
): number {
  const keep = taxRate == null ? 1 : 1 - Math.min(0.8, Math.max(0, taxRate));
  const traditionalSpend = Math.max(0, traditional) * keep * withdrawalRate;
  const rothSpend = Math.max(0, roth) * withdrawalRate;
  let brokerageSpend = Math.max(0, brokerage) * withdrawalRate;
  if (brokerageGains && brokerageGains.covered > 0) {
    const fromCovered = Math.max(0, brokerageGains.covered) * withdrawalRate;
    const tax = taxOnBrokerageWithdrawal(fromCovered, brokerageGains);
    if (tax != null && tax > 0) brokerageSpend = Math.max(0, brokerageSpend - tax);
  }
  return traditionalSpend + rothSpend + brokerageSpend;
}

/**
 * After-tax dollars from one portfolio withdrawal, drawn in `order`.
 * The gross draw is the withdrawal rate times the whole portfolio, taken from each bucket until it is used.
 * A blank tax rate and unpriced lots leave the draw untaxed, which matches `annualSpendable`.
 */
export function sequencedSpendable(
  traditional: number,
  roth: number,
  brokerage: number,
  withdrawalRate: number,
  taxRate: number | null,
  order: WithdrawalBucket[],
  brokerageGains?: BrokerageGainSlice | null,
): number {
  const keep = taxRate == null ? 1 : 1 - Math.min(0.8, Math.max(0, taxRate));
  const balances: Record<WithdrawalBucket, number> = {
    traditional: Math.max(0, traditional),
    roth: Math.max(0, roth),
    brokerage: Math.max(0, brokerage),
  };
  let remaining = Math.max(0, traditional + roth + brokerage) * withdrawalRate;
  let net = 0;
  for (const bucket of order) {
    if (!(remaining > 0)) break;
    const draw = Math.min(balances[bucket], remaining);
    if (!(draw > 0)) continue;
    remaining -= draw;
    if (bucket === 'roth') net += draw;
    else if (bucket === 'traditional') net += draw * keep;
    else {
      const tax = brokerageGains ? (taxOnBrokerageWithdrawal(draw, brokerageGains) ?? 0) : 0;
      net += Math.max(0, draw - tax);
    }
  }
  return net;
}

function spendableCovers(
  household: HouseholdInput,
  traditional: number,
  roth: number,
  brokerage: number,
  withdrawalRate: number,
  tax: number | null,
  gains: BrokerageGainSlice | null,
  need: number,
  opts: StandingOptions,
): boolean {
  const order = opts.withdrawalOrder !== undefined ? opts.withdrawalOrder : household.withdrawalOrder ?? null;
  const spendable =
    order && order.length
      ? sequencedSpendable(traditional, roth, brokerage, withdrawalRate, tax, order, gains)
      : annualSpendable(traditional, roth, brokerage, withdrawalRate, tax, gains);
  return spendable >= need;
}

export function retirementNeedAnnual(
  household: HouseholdInput,
  livingRealMonthly: number,
  ownershipAnnual: number,
  month: number,
  nowYear: number,
): number {
  const scale = flavorScale(household.fireFlavor ?? DEFAULT_FIRE_FLAVOR);
  const health = (household.healthAfterWorkMonthly ?? 0) * 12;
  const benefits = benefitsMonthly(household, month, nowYear) * 12;
  return Math.max(0, livingRealMonthly * 12 * scale + ownershipAnnual + health - benefits);
}

function investmentBuckets(household: HouseholdInput): { traditional: number; roth: number; brokerage: number } {
  let traditional = 0;
  let roth = 0;
  let brokerage = 0;
  for (const account of household.accounts) {
    if (!isInvestment(account.type)) continue;
    if (account.taxTreatment === 'roth') roth += account.balance;
    else if (account.type === 'brokerage' && account.taxTreatment !== 'traditional') brokerage += account.balance;
    else traditional += account.balance;
  }
  return { traditional, roth, brokerage };
}

function workOptionalMonth(
  household: HouseholdInput,
  bundle: SeedBundle,
  scenario: Scenario,
  _leftover: number,
  withdrawalRate: number,
  opts: StandingOptions,
): number | null {
  const events = plannedEvents(household, bundle, scenario);
  const ownershipAnnual = recurringOwnershipAnnual(events);
  const livingNow = expenseMonth(household, scenario);
  if (livingNow <= 0 && ownershipAnnual <= 0 && !(household.healthAfterWorkMonthly && household.healthAfterWorkMonthly > 0)) {
    return null;
  }
  const nowYear = new Date().getFullYear();
  const tax = household.withdrawalTaxRate ?? null;
  const buckets = investmentBuckets(household);
  const needNow = retirementNeedAnnual(household, livingNow, ownershipAnnual, 0, nowYear);
  const nowSlice = brokerageSliceNow(household);
  if (spendableCovers(household, buckets.traditional, buckets.roth, buckets.brokerage, withdrawalRate, tax, nowSlice, needNow, opts)) {
    return 0;
  }
  const walked = walkForecast(household, bundle, scenario, walkForDate(opts));
  for (const point of walked.months) {
    const need = retirementNeedAnnual(household, point.livingExpenses, ownershipAnnual, point.month, nowYear);
    if (
      spendableCovers(
        household,
        point.traditional,
        point.roth,
        point.brokerage,
        withdrawalRate,
        tax,
        brokerageSliceFromPoint(household, point),
        need,
        opts,
      )
    ) {
      return point.month;
    }
  }
  return null;
}

function debtFreeMonth(
  household: HouseholdInput,
  bundle: SeedBundle,
  scenario: Scenario,
  accountIds: string[] | null | undefined,
  opts: StandingOptions,
): number | null {
  const selected = selectedLiabilities(household, accountIds);
  const filtering = !!(accountIds && accountIds.length);
  if (filtering) {
    if (!selected.length || selected.every((a) => a.balance <= 0.5)) return 0;
    const walked = walkForecast(household, bundle, scenario, walkForDate(opts, { focusLoanIds: accountIds }));
    const series = walked.watchedFocusDebt ?? [];
    const hit = series.findIndex((balance) => balance <= 0.5);
    return hit < 0 ? null : hit + 1;
  }
  const start = household.accounts.filter((a) => isLiability(a.type)).reduce((s, a) => s + a.balance, 0);
  if (start <= 0.5) return 0;
  const walked = walkForecast(household, bundle, scenario, walkForDate(opts));
  return walked.months.find((m) => m.liabilities <= 0.5)?.month ?? null;
}

function amortizeLoanMonth(loan: AccountInput, scenario: Scenario): number | null {
  if (loan.balance <= 0.5) return 0;
  if (loan.payoffStyle === 'paid_monthly') return 1;
  const escrow = Math.max(0, loan.escrowMonthly ?? 0);
  const payment = loan.minPayment == null ? 0 : Math.max(0, loan.minPayment - escrow);
  if (payment <= 0 && loan.forgivenessMonth == null) return null;
  let bal = loan.balance;
  const apr = liabilityApr(loan, scenario);
  for (let m = 1; m <= HIRED_HORIZON_MONTHS; m++) {
    if (loan.forgivenessMonth != null && m >= loan.forgivenessMonth) return m;
    const step = amortizeMonth(bal, apr, payment);
    bal = step.balance;
    if (bal <= 0.5) return m;
  }
  return null;
}

function amountHiredMonth(
  household: HouseholdInput,
  bundle: SeedBundle,
  scenario: Scenario,
  spec: Extract<GoalSpec['target'], { kind: 'amount' }>,
  opts: StandingOptions,
): number | null {
  const need = spec.dollars;
  if (need <= 0) return 0;
  if (spec.bucket === 'named_account') {
    const acct = household.accounts.find((a) => a.id === spec.accountId);
    if (!acct) return null;
    if (acct.balance >= need) return 0;
    if (isLiquid(acct.type) || isInvestment(acct.type)) {
      const series =
        walkForecast(household, bundle, scenario, walkForDate(opts, { watchAccountId: acct.id })).watchedBalances ?? [];
      const hit = series.findIndex((balance) => balance >= need);
      return hit < 0 ? null : hit + 1;
    }
    const r = acct.expectedReturn ?? 0;
    let bal = acct.balance;
    for (let m = 1; m <= HIRED_HORIZON_MONTHS; m++) {
      bal *= 1 + r / 12;
      if (bal >= need) return m;
    }
    return null;
  }
  const months = walkForecast(household, bundle, scenario, walkForDate(opts)).months;
  if (spec.bucket === 'liquid') {
    if (liquidSum(household) >= need) return 0;
    return months.find((m) => m.cash >= need)?.month ?? null;
  }
  if (spec.bucket === 'investments') {
    if (investmentSum(household) >= need) return 0;
    return months.find((m) => m.investments >= need)?.month ?? null;
  }
  if (spec.bucket === 'net_worth') {
    const fallback = resolveGeo(bundle.home, household.zip).medianHomeValue;
    if (netWorthNow(household, fallback).net >= need) return 0;
    return months.find((m) => m.netWorth >= need)?.month ?? null;
  }
  return null;
}

function affordHiredMonth(
  household: HouseholdInput,
  bundle: SeedBundle,
  scenario: Scenario,
  reserved: number,
  leftover: number,
  cost: number,
  opts: StandingOptions,
): number | null {
  if (cost <= 0 || leftover >= cost) return 0;
  return cashBufferMonth(household, bundle, scenario, reserved + cost, leftover, opts);
}

function cashBufferMonth(
  household: HouseholdInput,
  bundle: SeedBundle,
  scenario: Scenario,
  reserved: number,
  leftover: number,
  opts: StandingOptions,
): number | null {
  if (reserved <= 0 || leftover > 0 || liquidSum(household) >= reserved) return 0;
  const months = walkForecast(household, bundle, scenario, walkForDate(opts)).months;
  return months.find((m) => m.cash >= reserved)?.month ?? null;
}

function keepHouseCarMonth(
  household: HouseholdInput,
  bundle: SeedBundle,
  scenario: Scenario,
  reserved: number,
  leftover: number,
  opts: StandingOptions,
): number | null {
  if (leftover > 0 || reserved <= 0) return 0;
  return cashBufferMonth(household, bundle, scenario, reserved, leftover, opts);
}

function paycheckRunwayMonths(household: HouseholdInput, bundle: SeedBundle, liquid: number): number | null {
  const burn = expenseMonth(household, 'conservative') + liabilityPaymentMonth(household);
  const events = plannedEvents(household, bundle, 'conservative');
  let cash = liquid;
  if (cash <= 0) return 0;
  for (let m = 1; m <= HIRED_HORIZON_MONTHS; m++) {
    cash -= burn;
    for (const ev of events) {
      if (ev.month === -1 || ev.month === m) cash -= ev.cost;
    }
    if (cash < 0) return m - 1;
  }
  return HIRED_HORIZON_MONTHS;
}

function survivePaycheckMonth(
  household: HouseholdInput,
  bundle: SeedBundle,
  scenario: Scenario,
  reserved: number,
  leftover: number,
  opts: StandingOptions,
): number | null {
  if (leftover > 0 || reserved <= 0) return 0;
  return cashBufferMonth(household, bundle, scenario, reserved, leftover, opts);
}

function resolveHiredMonth(
  household: HouseholdInput,
  bundle: SeedBundle,
  scenario: Scenario,
  spec: GoalSpec,
  reserved: number,
  leftover: number,
  now: Date,
  withdrawalRate: number,
  opts: StandingOptions,
): { hiredMonth: number | null; hiredDate: string | null } {
  if (spec.target.kind === 'date') {
    const dated =
      hiredFromIso(spec.target.by, now) ??
      (household.targetDate ? hiredFromIso(household.targetDate, now) : null);
    return dated ?? { hiredMonth: null, hiredDate: null };
  }
  const featured = hiredGoalSpec(household);
  if (spec.id === featured.id) {
    const override = hiredFromTargetDate(household, now);
    if (override) return override;
  }

  let hiredMonth: number | null = null;
  switch (spec.target.kind) {
    case 'work_optional':
      hiredMonth = workOptionalMonth(household, bundle, scenario, leftover, withdrawalRate, opts);
      break;
    case 'debt_zero':
      hiredMonth = debtFreeMonth(household, bundle, scenario, spec.target.accountIds, opts);
      break;
    case 'runway': {
      if (spec.reserved === 'paycheck_year') {
        hiredMonth = survivePaycheckMonth(household, bundle, scenario, reserved, leftover, opts);
      } else {
        const need = runwayNeed(household, livingReserveMonths(household, spec));
        const liq = liquidSum(household);
        hiredMonth = cashBufferMonth(household, bundle, scenario, need, Math.max(0, liq - need), opts);
      }
      break;
    }
    case 'afloat':
      hiredMonth = keepHouseCarMonth(household, bundle, scenario, reserved, leftover, opts);
      break;
    case 'amount':
      hiredMonth = amountHiredMonth(household, bundle, scenario, spec.target, opts);
      break;
    case 'afford': {
      const events = plannedEvents(household, bundle, 'conservative');
      hiredMonth = affordHiredMonth(
        household,
        bundle,
        scenario,
        reserved,
        leftover,
        affordCost(household, events, spec.target),
        opts,
      );
      break;
    }
    default:
      hiredMonth = null;
      break;
  }
  return {
    hiredMonth,
    hiredDate: hiredMonth == null ? null : isoDay(walkerMonthDate(now, hiredMonth)),
  };
}

function pulseReasons(household: HouseholdInput, bundle: SeedBundle, now: Date): PulseReason[] {
  const reasons: PulseReason[] = [];
  const last = cashLastEdited(household);
  if (last) reasons.push({ kind: 'last_edited', at: last });
  if (isCashStale(household, now.getTime())) {
    const days = last ? Math.floor((now.getTime() - Date.parse(last)) / (24 * 60 * 60 * 1000)) : 30;
    reasons.push({ kind: 'stale_cash', days });
  }
  for (const key of household.realizedEventKeys) {
    reasons.push({ kind: 'realized_shock', key });
  }
  if (seedIsStale(bundle, now)) reasons.push({ kind: 'stale_seed' });
  return reasons;
}

function composeSentence(
  jobClass: JobClass,
  hiredMonth: number | null,
  hiredDate: string | null,
  reserved: number,
  leftover: number,
  next: EventHit | null,
  now: Date,
  gap: string | null,
  household: HouseholdInput,
  spec: GoalSpec,
): string {
  const tenure = resolveHousingTenure(household);
  const hasHome = household.assets.some((a) => a.type === 'home');
  const hasCar = household.assets.some((a) => a.type === 'vehicle');
  const setAside = reservedLabelFor(household, jobClass).replace(/^Set aside/, 'cash is set aside');
  const cashLine = `About ${formatUsd(reserved)} of ${setAside}; about ${formatUsd(leftover)} is free`;
  const constraint = next
    ? leftover < next.cost
      ? `${next.label} would use that free cash around ${monthLabel(walkerMonthDate(now, next.month))}`
      : `Next ownership bill: ${next.label} around ${monthLabel(walkerMonthDate(now, next.month))}`
    : tenure === 'rent'
      ? 'Rent stays on this path as we learn more bills'
      : hasHome && hasCar
        ? 'House and car stay on this path as we learn system ages'
        : hasHome
          ? 'The house stays on this path as we learn system ages'
          : hasCar
            ? 'The car stays on this path as we learn more about it'
            : tenure === 'own'
              ? 'We will add house costs when you add the house — we will not invent one'
              : 'We only count a house or a car if you have one';
  if (gap) {
    return `${gap} ${cashLine}. ${constraint}.`;
  }
  const title = hiredJobTitle(jobClass, household.fireFlavor, spec);
  const when =
    hiredMonth == null
      ? `${title} is not in the next 30 years on these numbers`
      : hiredMonth === 0
        ? `${title} looks on track now`
        : `${title} around ${monthLabel((hiredDate && parseIsoLocal(hiredDate)) || walkerMonthDate(now, hiredMonth))}`;
  return `${when}. ${cashLine}. ${constraint}.`;
}

/**
 * Live standing projector. Never persist the result; recompute on household save.
 */
export function standing(
  household: HouseholdInput,
  bundle: SeedBundle,
  scenario: Scenario,
  jobClass: JobClass = household.jobClass,
  opts: StandingOptions = {},
): StandingView {
  const now = opts.now ?? new Date();
  const withdrawalRate = opts.withdrawalRate ?? DEFAULT_WITHDRAWAL_RATE;
  const spec = opts.spec ?? hiredGoalSpec(household, jobClass, { withdrawalRate });
  const resolvedJob = opts.spec ? jobClassFromSpec(spec) : jobClass;
  const liquid = household.accounts.filter((a) => isLiquid(a.type)).reduce((s, a) => s + a.balance, 0);
  const events = plannedEvents(household, bundle, 'conservative');
  const reserved = reservedForSpec(household, events, spec);
  const leftover = leftoverOf(liquid, reserved);
  const next = nextDiscreteHit(events);
  const gap = intakeGap(household, resolvedJob);
  const { hiredMonth, hiredDate } = gap
    ? { hiredMonth: null as number | null, hiredDate: null as string | null }
    : resolveHiredMonth(household, bundle, scenario, spec, reserved, leftover, now, withdrawalRate, opts);
  const collision = next && next.cost > leftover ? next : null;
  const runwayMonths = paycheckRunwayMonths(household, bundle, liquid);
  let sentence = composeSentence(
    resolvedJob,
    hiredMonth,
    hiredDate,
    reserved,
    leftover,
    next,
    now,
    gap,
    household,
    spec,
  );
  if (resolvedJob === 'survive_paycheck' && !gap && runwayMonths != null) {
    sentence += ` If pay stopped tomorrow, cash lasts about ${runwayMonths} month${runwayMonths === 1 ? '' : 's'}.`;
  }
  if (resolvedJob === 'work_optional' && !gap) {
    const benefitAmounts =
      (household.socialSecurity?.monthlyAmount ?? 0) > 0 || (household.pension?.monthlyAmount ?? 0) > 0;
    const health = (household.healthAfterWorkMonthly ?? 0) > 0;
    const ageKnown = household.currentAge != null || household.birthYear != null;
    if (!benefitAmounts && !health) sentence += ' Benefits are not included.';
    else if (benefitAmounts && !ageKnown) sentence += ' Social Security and pension wait until you add your age.';
    const lots = describeBrokerageLots(household);
    if (household.withdrawalTaxRate == null && lots !== 'taxed') {
      sentence += ' Withdrawals are not taxed in this plan.';
    } else if (household.withdrawalTaxRate == null) {
      sentence += ' Traditional withdrawals are not taxed in this plan.';
    }
    if (lots === 'taxed') sentence += ' A brokerage withdrawal is taxed on the gain in the lots.';
    if (lots === 'unpriced') sentence += ' Brokerage lots stay untaxed until you set both gain rates.';
  }
  return {
    jobClass: resolvedJob,
    scenario,
    sentence,
    reserved,
    leftover,
    liquid,
    reservedLabel: reservedLabelFor(household, resolvedJob),
    hiredMonth,
    hiredDate,
    collisionMonth: collision?.month ?? null,
    collisionLabel: collision?.label ?? null,
    collisionKey: collision?.key ?? null,
    constraintLabel: next?.label ?? null,
    status: goalStatus(gap, hiredMonth, spec, now),
    runwayMonths,
    pulseReasons: pulseReasons(household, bundle, now),
  };
}

function goalStatus(
  gap: string | null,
  hiredMonth: number | null,
  spec: GoalSpec,
  now: Date,
): StandingView['status'] {
  if (gap) return 'incomplete';
  if (spec.target.kind === 'date' && spec.target.by) {
    const parts = parseIsoDate(spec.target.by.slice(0, 10));
    if (parts) {
      const due = new Date(parts.y, parts.m - 1, parts.d);
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      if (due < today) return 'overdue';
    }
  }
  if (hiredMonth === 0) return 'on_track';
  if (hiredMonth == null) return 'beyond_horizon';
  return 'dated';
}

export interface GoalBoardCard {
  spec: GoalSpec;
  jobClass: JobClass;
  view: StandingView;
  current: number | null;
  target: number | null;
  percent: number | null;
  headline: string;
  sharesCashWith: string[];
}

function headlineFor(view: StandingView, spec: GoalSpec, metric: { current: number | null; target: number | null; percent: number | null }): string {
  if (view.hiredMonth === 0) return 'On track now';
  if (view.hiredMonth == null) {
    if (spec.target.kind === 'debt_zero' && metric.current != null) {
      return `About ${formatUsd(metric.current)} left — not dated yet`;
    }
    return 'Not dated yet';
  }
  if (view.hiredDate) {
    const when = parseIsoLocal(view.hiredDate);
    if (when) return `Around ${when.toLocaleString('en-US', { month: 'short', year: 'numeric' })}`;
  }
  return `In about ${view.hiredMonth} month${view.hiredMonth === 1 ? '' : 's'}`;
}

/** Live board for every elected goal. Never persist. */
export function openGoalBoard(
  household: HouseholdInput,
  bundle: SeedBundle,
  scenario: Scenario,
  opts: StandingOptions = {},
): GoalBoardCard[] {
  const specs = openGoalSpecs(household);
  let cashLeft = household.accounts.filter((account) => account.type === 'checking' || account.type === 'savings' || account.type === 'cash').reduce((sum, account) => sum + account.balance, 0);
  const taken: { id: string; name: string }[] = [];
  return specs.map((spec) => {
    const jobClass = jobClassFromSpec(spec);
    const view = standing(household, bundle, scenario, jobClass, { ...opts, spec });
    const metric = goalMetric(household, bundle, scenario, spec);
    const percent =
      metric.percent != null
        ? metric.percent
        : view.hiredMonth === 0
          ? 100
          : view.reserved > 0
            ? Math.max(0, Math.min(100, Math.round((view.liquid / view.reserved) * 100)))
            : view.hiredMonth == null
              ? 0
              : null;
    const sharesCashWith = view.reserved > cashLeft + 0.5 ? taken.map((row) => row.name) : [];
    cashLeft = Math.max(0, cashLeft - view.reserved);
    if (view.reserved > 0) taken.push({ id: spec.id, name: spec.name });
    const shareNote = sharesCashWith.length ? ` Shares cash with ${sharesCashWith.join(', ')}.` : '';
    return {
      spec,
      jobClass,
      view,
      current: metric.current,
      target: metric.target,
      percent,
      headline: `${headlineFor(view, spec, metric)}.${shareNote}`.replace('..', '.'),
      sharesCashWith,
    };
  });
}

/** Diff of two live standing views. Does not write books. */
export function projectCollision(baseStanding: StandingView, shockedStanding: StandingView): CollisionDiff {
  const hiredMonthDelta =
    baseStanding.hiredMonth == null || shockedStanding.hiredMonth == null
      ? null
      : shockedStanding.hiredMonth - baseStanding.hiredMonth;
  const leftoverDelta = shockedStanding.leftover - baseStanding.leftover;
  const reservedDelta = shockedStanding.reserved - baseStanding.reserved;
  const leftoverClaimed = shockedStanding.leftover < baseStanding.leftover || shockedStanding.leftover === 0;
  const dateBit =
    hiredMonthDelta == null
      ? 'the hired date is outside the horizon'
      : hiredMonthDelta === 0
        ? 'the hired date holds'
        : hiredMonthDelta > 0
          ? `the hired date moves later by about ${hiredMonthDelta} month${hiredMonthDelta === 1 ? '' : 's'}`
          : `the hired date moves earlier by about ${Math.abs(hiredMonthDelta)} month${Math.abs(hiredMonthDelta) === 1 ? '' : 's'}`;
  const claimBit = leftoverClaimed
    ? `leftover is reserved (${formatUsd(shockedStanding.leftover)} free after ${formatUsd(shockedStanding.reserved)} reserved)`
    : `leftover stays about ${formatUsd(shockedStanding.leftover)}`;
  const label = shockedStanding.collisionLabel ?? shockedStanding.constraintLabel ?? 'that shock';
  const line = `${label}: ${claimBit}, and ${dateBit}.`;
  return { line, hiredMonthDelta, leftoverDelta, reservedDelta, leftoverClaimed };
}

/**
 * When Retire early is hired, own pay stops that month.
 * A date already typed in `incomeEndsAt` wins. The search walk keeps pay on.
 */
export function payStopsAtHiredMonth(
  household: HouseholdInput,
  bundle: SeedBundle,
  scenario: Scenario,
  now: Date,
): HouseholdInput {
  if (!household.retireAtHiredDate || household.incomeEndsAt) return household;
  const retire =
    household.jobClass === 'work_optional' ||
    household.goalSpec?.target.kind === 'work_optional' ||
    (household.openGoals ?? []).some((spec) => spec.target.kind === 'work_optional');
  if (!retire) return household;
  const month = workOptionalMonth(household, bundle, scenario, 0, DEFAULT_WITHDRAWAL_RATE, { now });
  if (month == null) return household;
  return { ...household, incomeEndsAt: monthKeyFromIndex(Math.max(0, month), now) };
}

registerRetireStop(payStopsAtHiredMonth);
