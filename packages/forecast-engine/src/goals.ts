import { plannedEvents } from './drivers';
import { expenseMonth, investmentSum, liabilityPaymentMonth, liquidSum, reservedFromHits, runForecast } from './engine';
import { resolveHousingTenure } from './jobs';
import type { SeedBundle } from './seed-types';
import type {
  EventHit,
  GoalAmountBucket,
  GoalReservedPolicy,
  GoalSpec,
  GoalTarget,
  HouseholdInput,
  JobClass,
  Scenario,
} from './types';
import { DEFAULT_BUFFER_MONTHS, DEFAULT_JOB_CLASS, JOB_CLASSES, JOB_CLASS_LABELS, isLiability } from './types';

/** Months of bills set aside for a year without a paycheck. */
export const PAYCHECK_YEAR_MONTHS = 12;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export function isValidGoalSpec(raw: unknown): raw is GoalSpec {
  return parseGoalSpec(raw) != null;
}

export function parseGoalSpec(raw: unknown): GoalSpec | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Partial<GoalSpec>;
  if (typeof s.id !== 'string' || !s.id.trim()) return null;
  if (typeof s.name !== 'string' || !s.name.trim()) return null;
  if (s.source !== 'preset' && s.source !== 'custom') return null;
  if (s.reserved !== 'ownership' && s.reserved !== 'n_months_living' && s.reserved !== 'paycheck_year' && s.reserved !== 'none') {
    return null;
  }
  const target = parseGoalTarget(s.target);
  if (!target) return null;
  return {
    id: s.id.trim(),
    name: s.name.trim(),
    source: s.source,
    target,
    reserved: s.reserved,
  };
}

function parseGoalTarget(raw: unknown): GoalTarget | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw as { kind?: string };
  switch (t.kind) {
    case 'amount': {
      const dollars = Number((t as { dollars?: unknown }).dollars);
      const bucket = (t as { bucket?: unknown }).bucket as GoalAmountBucket | undefined;
      if (!Number.isFinite(dollars) || dollars < 0) return null;
      if (bucket !== 'liquid' && bucket !== 'investments' && bucket !== 'named_account' && bucket !== 'net_worth') {
        return null;
      }
      const accountId = (t as { accountId?: unknown }).accountId;
      const amount: Extract<GoalTarget, { kind: 'amount' }> = { kind: 'amount', dollars, bucket };
      if (typeof accountId === 'string') amount.accountId = accountId;
      else if (accountId === null) amount.accountId = null;
      return amount;
    }
    case 'date': {
      const by = (t as { by?: unknown }).by;
      if (typeof by !== 'string' || !ISO_DAY.test(by) || !Number.isFinite(Date.parse(by))) return null;
      return { kind: 'date', by };
    }
    case 'debt_zero': {
      const ids = (t as { accountIds?: unknown }).accountIds;
      if (ids == null) return { kind: 'debt_zero', accountIds: null };
      if (!Array.isArray(ids)) return null;
      return { kind: 'debt_zero', accountIds: ids.filter((id): id is string => typeof id === 'string') };
    }
    case 'runway': {
      const months = Number((t as { months?: unknown }).months);
      if (!Number.isFinite(months) || months <= 0) return null;
      return { kind: 'runway', months };
    }
    case 'afford': {
      const dollars = Number((t as { dollars?: unknown }).dollars);
      if (!Number.isFinite(dollars) || dollars < 0) return null;
      const eventKey = (t as { eventKey?: unknown }).eventKey;
      const afford: Extract<GoalTarget, { kind: 'afford' }> = { kind: 'afford', dollars };
      if (typeof eventKey === 'string') afford.eventKey = eventKey;
      else if (eventKey === null) afford.eventKey = null;
      return afford;
    }
    case 'afloat':
      return { kind: 'afloat' };
    case 'work_optional':
      return { kind: 'work_optional' };
    default:
      return null;
  }
}

/** Custom hire is complete enough to persist (name + numeric/date target). */
export function isCompleteCustomSpec(spec: GoalSpec | null | undefined): spec is GoalSpec {
  if (!spec || spec.source !== 'custom' || !spec.name.trim()) return false;
  return isCompleteTarget(spec.target);
}

export function isCompleteTarget(target: GoalTarget): boolean {
  switch (target.kind) {
    case 'amount':
      if (!(target.dollars > 0)) return false;
      if (target.bucket === 'named_account') return !!target.accountId;
      return true;
    case 'date':
      return ISO_DAY.test(target.by) && Number.isFinite(Date.parse(target.by));
    case 'debt_zero':
      return true;
    case 'runway':
      return target.months > 0;
    case 'afford':
      return target.dollars > 0;
    case 'afloat':
    case 'work_optional':
      return true;
  }
}

export function presetGoalSpec(
  household: HouseholdInput,
  jobClass: JobClass,
  _opts?: { withdrawalRate?: number },
): GoalSpec {
  const preset = jobClass === 'custom' ? DEFAULT_JOB_CLASS : jobClass;
  const name = JOB_CLASS_LABELS[preset];
  const id = `preset:${preset}`;
  switch (preset) {
    case 'work_optional':
      return { id, name, source: 'preset', target: { kind: 'work_optional' }, reserved: 'ownership' };
    case 'debt_free':
      return { id, name, source: 'preset', target: { kind: 'debt_zero' }, reserved: 'ownership' };
    case 'cash_buffer':
      return {
        id,
        name,
        source: 'preset',
        target: { kind: 'runway', months: cushionMonths(household) },
        reserved: 'n_months_living',
      };
    case 'survive_paycheck':
      return { id, name, source: 'preset', target: { kind: 'runway', months: 12 }, reserved: 'paycheck_year' };
    case 'keep_house_car':
    default:
      return { id, name, source: 'preset', target: { kind: 'afloat' }, reserved: 'ownership' };
  }
}

/**
 * Hired spec for this evaluation. Custom only when the household hired custom and the spec is valid.
 * Other jobClass overrides (sequence / other dates) always compile the matching preset.
 */
export function hiredGoalSpec(
  household: HouseholdInput,
  jobClass: JobClass = household.jobClass,
  opts?: { withdrawalRate?: number },
): GoalSpec {
  if (jobClass === 'custom' && household.jobClass === 'custom' && isCompleteCustomSpec(household.goalSpec)) {
    return household.goalSpec;
  }
  return presetGoalSpec(household, jobClass, opts);
}

/** Preset id stored on elected goals (`preset:debt_free`). */
export function presetGoalId(jobClass: JobClass): string {
  const preset = jobClass === 'custom' ? DEFAULT_JOB_CLASS : jobClass;
  return `preset:${preset}`;
}

export function jobClassFromSpec(spec: GoalSpec): JobClass {
  if (spec.source === 'preset') {
    const raw = spec.id.startsWith('preset:') ? spec.id.slice('preset:'.length) : spec.id;
    if (JOB_CLASSES.includes(raw as JobClass) && raw !== 'custom') return raw as JobClass;
  }
  return 'custom';
}

function parseOpenGoals(raw: unknown): GoalSpec[] | null {
  if (!Array.isArray(raw)) return null;
  return raw.map(parseGoalSpec).filter((s): s is GoalSpec => s != null);
}

/**
 * Elected goals for the home board. Old books with only `jobClass` synthesize one spec.
 * An explicit empty array means they have not chosen any yet.
 */
export function openGoalSpecs(household: HouseholdInput): GoalSpec[] {
  const parsed = parseOpenGoals(household.openGoals);
  if (parsed) return parsed;
  return [hiredGoalSpec(household)];
}

export function hasOpenGoals(household: HouseholdInput): boolean {
  return openGoalSpecs(household).length > 0;
}

export function syncFocusJob(household: HouseholdInput): HouseholdInput {
  let specs = openGoalSpecs(household);
  if (household.jobClass && household.jobClass !== 'custom') {
    const id = presetGoalId(household.jobClass);
    if (specs.length && !specs.some((s) => s.id === id)) {
      specs = [...specs, presetGoalSpec(household, household.jobClass)];
    }
  }
  if (
    household.jobClass === 'custom' &&
    isCompleteCustomSpec(household.goalSpec) &&
    !specs.some((s) => s.id === household.goalSpec!.id)
  ) {
    specs = [...specs, household.goalSpec];
  }
  if (!specs.length) {
    return { ...household, openGoals: [], goalSpec: household.jobClass === 'custom' ? household.goalSpec ?? null : null };
  }
  const focus =
    (household.jobClass === 'custom' && household.goalSpec
      ? specs.find((spec) => spec.id === household.goalSpec?.id)
      : null) ??
    specs.find((s) => jobClassFromSpec(s) === household.jobClass) ??
    specs[0];
  const jobClass = jobClassFromSpec(focus);
  return {
    ...household,
    openGoals: specs,
    jobClass,
    goalSpec: jobClass === 'custom' ? focus : null,
    targetDate: jobClass === 'custom' && focus.target.kind === 'date' ? focus.target.by : household.targetDate ?? null,
  };
}

export function setOpenGoals(household: HouseholdInput, specs: GoalSpec[]): HouseholdInput {
  return syncFocusJob({ ...household, openGoals: specs });
}

export function togglePresetGoal(household: HouseholdInput, jobClass: JobClass): HouseholdInput {
  if (jobClass === 'custom') return household;
  const specs = openGoalSpecs(household);
  const id = presetGoalId(jobClass);
  const has = specs.some((s) => s.id === id);
  const next = has ? specs.filter((s) => s.id !== id) : [...specs, presetGoalSpec(household, jobClass)];
  return setOpenGoals(household, next);
}

export function upsertCustomGoal(household: HouseholdInput, spec: GoalSpec): HouseholdInput {
  const specs = openGoalSpecs(household).filter((s) => s.id !== spec.id);
  return setOpenGoals(household, [...specs, spec]);
}

/** Emergency Fund preset is 3 or 6 months. Other runway goals stay as written. */
export function setEmergencyBuffer(household: HouseholdInput, months: 3 | 6): HouseholdInput {
  const next = { ...household, bufferMonths: months };
  const specs = openGoalSpecs(next).map((spec) =>
    spec.id === presetGoalId('cash_buffer') ? presetGoalSpec(next, 'cash_buffer') : spec,
  );
  return setOpenGoals(next, specs);
}

export function removeOpenGoal(household: HouseholdInput, id: string): HouseholdInput {
  return setOpenGoals(
    household,
    openGoalSpecs(household).filter((s) => s.id !== id),
  );
}

function conservativeLiving(household: HouseholdInput): number {
  return Math.max(0, expenseMonth(household, 'conservative'));
}

/** 3, 6, or 12 when the household saved one of those. Otherwise the default of 3. */
export function cushionMonths(household: HouseholdInput): 3 | 6 | 12 {
  if (household.bufferMonths === 12) return 12;
  if (household.bufferMonths === 6) return 6;
  if (household.bufferMonths === 3) return 3;
  return DEFAULT_BUFFER_MONTHS;
}

/**
 * Months of living reserved for an `n_months_living` spec.
 * An explicit 3, 6, or 12 on the household wins over a stored runway length.
 */
export function livingReserveMonths(household: HouseholdInput, spec: GoalSpec): number {
  if (spec.reserved === 'n_months_living') {
    if (household.bufferMonths === 3 || household.bufferMonths === 6 || household.bufferMonths === 12) {
      return household.bufferMonths;
    }
  }
  if (spec.target.kind === 'runway') return spec.target.months;
  return DEFAULT_BUFFER_MONTHS;
}

export function reservedForSpec(household: HouseholdInput, events: EventHit[], spec: GoalSpec): number {
  const ownership = reservedFromHits(events);
  const burn = conservativeLiving(household);
  const buffer = Math.max(0, burn * DEFAULT_BUFFER_MONTHS);
  const runwayMonths = livingReserveMonths(household, spec);
  const nMonths = Math.max(0, burn * runwayMonths);
  switch (spec.reserved) {
    case 'none':
      return 0;
    case 'n_months_living':
      return nMonths;
    case 'paycheck_year': {
      const yearMonths = PAYCHECK_YEAR_MONTHS;
      return burn * yearMonths + liabilityPaymentMonth(household) * yearMonths + ownership;
    }
    case 'ownership':
    default: {
      const tenure = resolveHousingTenure(household);
      if ((spec.target.kind === 'afloat' || spec.source === 'custom') && (tenure === 'rent' || tenure === 'none')) {
        return buffer;
      }
      return ownership;
    }
  }
}

export function defaultReservedPolicy(household: HouseholdInput): GoalReservedPolicy {
  return resolveHousingTenure(household) === 'own' ? 'ownership' : 'n_months_living';
}

export function runwayNeed(household: HouseholdInput, months: number): number {
  return Math.max(0, conservativeLiving(household) * months);
}

export function affordCost(
  household: HouseholdInput,
  events: EventHit[],
  target: Extract<GoalTarget, { kind: 'afford' }>,
): number {
  if (target.eventKey) {
    const hit = events.find((e) => e.key === target.eventKey);
    if (hit) return hit.cost;
  }
  return Math.max(0, target.dollars);
}

export function currentAmount(household: HouseholdInput, bundle: SeedBundle, scenario: Scenario, spec: GoalSpec): number | null {
  if (spec.target.kind !== 'amount') return null;
  return amountNow(household, bundle, scenario, spec.target.bucket, spec.target.accountId);
}

function amountNow(
  household: HouseholdInput,
  bundle: SeedBundle,
  scenario: Scenario,
  bucket: GoalAmountBucket,
  accountId?: string | null,
): number {
  if (bucket === 'liquid') return liquidSum(household);
  if (bucket === 'investments') return investmentSum(household);
  if (bucket === 'named_account') {
    const acct = household.accounts.find((a) => a.id === accountId);
    return acct?.balance ?? 0;
  }
  const forecast = runForecast(household, bundle, scenario);
  return forecast.netWorthNow;
}

export function isLiabilitySelected(accountId: string, ids?: string[] | null): boolean {
  if (!ids || ids.length === 0) return true;
  return ids.includes(accountId);
}

export function selectedLiabilities(household: HouseholdInput, accountIds?: string[] | null) {
  return household.accounts.filter((a) => isLiability(a.type) && isLiabilitySelected(a.id, accountIds));
}

function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** Current vs target for a goal card. Null percent means show the date, not a fake bar. */
export function goalMetric(
  household: HouseholdInput,
  bundle: SeedBundle,
  scenario: Scenario,
  spec: GoalSpec,
): { current: number | null; target: number | null; percent: number | null } {
  const liquid = liquidSum(household);
  switch (spec.target.kind) {
    case 'amount': {
      const current = amountNow(household, bundle, scenario, spec.target.bucket, spec.target.accountId);
      const target = spec.target.dollars;
      return { current, target, percent: target > 0 ? clampPct((current / target) * 100) : null };
    }
    case 'runway': {
      const target = runwayNeed(household, spec.target.months);
      return { current: liquid, target, percent: target > 0 ? clampPct((liquid / target) * 100) : 100 };
    }
    case 'debt_zero': {
      const remaining = selectedLiabilities(household, spec.target.accountIds).reduce((s, a) => s + a.balance, 0);
      return { current: remaining, target: 0, percent: remaining <= 0.5 ? 100 : null };
    }
    case 'afford': {
      const events = plannedEvents(household, bundle, scenario);
      const target = affordCost(household, events, spec.target);
      return { current: liquid, target, percent: target > 0 ? clampPct((liquid / target) * 100) : null };
    }
    case 'work_optional': {
      const nest = investmentSum(household) + liquid;
      return { current: nest, target: null, percent: null };
    }
    case 'afloat':
    case 'date':
    default:
      return { current: liquid, target: null, percent: null };
  }
}
