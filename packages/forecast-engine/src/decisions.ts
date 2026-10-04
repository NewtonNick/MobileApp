import { identityShocks, type PathShocks } from './drivers';
import { monthlyRate } from './rates';
import { cushionMonths } from './goals';
import { availableOverlays, OVERLAY_CATALOG } from './overlays';
import { featuredHome, projectZMove } from './sequence';
import { openGoalBoard, standing, type StandingOptions } from './standing';
import type { SeedBundle } from './seed-types';
import { coveredAccountLots, localIsoDate } from './taxlots';
import {
  DEBT_ORDER_LABELS,
  SURPLUS_POLICY_LABELS,
  isInvestment,
  isLiability,
  isLiquid,
  type AccountInput,
  type DebtOrder,
  type DownsizeLoanChoice,
  type HouseholdInput,
  type Scenario,
  type StandingView,
  type SurplusPolicy,
  type WithdrawalBucket,
  type ZMove,
} from './types';

export const GRID_CAP = 1500;

const SHIFT_YEARS = [0, 2, 5] as const;
type ShiftYears = (typeof SHIFT_YEARS)[number];
type SystemName = 'roof' | 'hvac' | 'waterHeater';

const SYSTEM_YEAR = {
  roof: 'roofYear',
  hvac: 'hvacYear',
  waterHeater: 'waterHeaterYear',
} as const;

export interface BenefitPair {
  startAge: number;
  monthlyAmount: number;
}

export interface CarReplacement {
  price: number;
  vehicleYear: number;
}

export interface PayAlternate {
  monthlyIncome: number | null;
  partnerToZero: boolean;
}

export interface RefinanceTerms {
  loanId: string;
  apr: number;
  minPayment: number;
}

export interface LumpMove {
  amount: number;
  destination: 'cash' | 'debt' | 'brokerage';
  loanId: string | null;
}

export interface LabInputs {
  lumpAmount: number | null;
  socialPairs: BenefitPair[];
  pensionPairs: BenefitPair[];
  car: CarReplacement | null;
  payMonthly: number | null;
  partnerToZero: boolean;
  refinance: RefinanceTerms | null;
}

export const EMPTY_LAB: LabInputs = {
  lumpAmount: null,
  socialPairs: [],
  pensionPairs: [],
  car: null,
  payMonthly: null,
  partnerToZero: false,
  refinance: null,
};

export interface Decision {
  id: string;
  changedAxes: string[];
  surplusPolicy: SurplusPolicy;
  debtOrder: DebtOrder;
  surplusLoanId: string | null;
  shifts: Record<SystemName, ShiftYears>;
  zMove: ZMove;
  downsizeLoanChoice: DownsizeLoanChoice | null;
  lump: LumpMove | null;
  bufferMonths: 3 | 6 | 12;
  socialSecurity: BenefitPair | null;
  pension: BenefitPair | null;
  car: CarReplacement | null;
  pay: PayAlternate | null;
  refinance: RefinanceTerms | null;
  withdrawalOrder: WithdrawalBucket[] | null;
}

export interface RankRow {
  decision: Decision;
  hiredMonth: number | null;
  leftover: number;
  reserved: number;
  collisionMonth: number | null;
  /** Positive when this row hires sooner than the current books. */
  monthGap: number | null;
  otherGoals: { name: string; hiredMonth: number | null }[];
  sentence: string;
}

export interface DecisionGrid {
  singles: Decision[];
  rest: Decision[];
  capped: boolean;
  cap: number;
}

export interface StressReport {
  holdCount: number;
  stretchCount: number;
  reversed: { id: string; label: string }[];
}

interface AxisOption {
  axisId: string;
  identity: boolean;
  apply: (decision: Decision) => Decision;
}

export function acceptSocialPair(pair: BenefitPair): boolean {
  return Number.isInteger(pair.startAge) && pair.startAge >= 62 && pair.startAge <= 70 && pair.monthlyAmount > 0;
}

export function acceptPensionPair(pair: BenefitPair): boolean {
  return Number.isFinite(pair.startAge) && pair.startAge > 0 && pair.startAge < 120 && pair.monthlyAmount > 0;
}

export function crashShocks(bundle: SeedBundle): PathShocks {
  const crashAnnual = bundle.home.hpiCrashAnnual.realistic;
  const jump = bundle.macro.crashJump;
  return {
    ...identityShocks,
    hpiMonthlyReturn: (month, meanAnnual) => (month >= 1 && month <= 18 ? monthlyRate(crashAnnual) : monthlyRate(meanAnnual)),
    investmentMonthlyReturn: (month, expectedAnnual) =>
      monthlyRate(expectedAnnual) + (month === 1 ? jump : 0),
  };
}

export function monthGapLine(monthGap: number | null): string {
  if (monthGap == null) return 'Not dated on these numbers';
  if (monthGap === 0) return 'The date stays on these numbers';
  const months = Math.abs(monthGap);
  const word = months === 1 ? 'month' : 'months';
  return monthGap > 0
    ? `About ${months} ${word} sooner on these numbers`
    : `About ${months} ${word} later on these numbers`;
}

export function decisionLabel(decision: Decision, household: HouseholdInput): string {
  if (!decision.changedAxes.length) return 'Current books';
  return decision.changedAxes.map((axis) => axisPhrase(axis, decision, household)).join(' · ');
}

export function applyDecision(household: HouseholdInput, decision: Decision): HouseholdInput {
  let next = cloneHousehold(household);
  next = applyRefinance(next, decision.refinance);
  next = applyPay(next, decision.pay);
  next = applyBenefits(next, decision);
  next = { ...next, bufferMonths: decision.bufferMonths };
  next = applyCar(next, decision.car);
  next = applyMove(next, decision);
  next = applyShifts(next, decision.shifts);
  next = applyLump(next, decision.lump);
  return {
    ...next,
    surplusPolicy: decision.surplusPolicy,
    debtOrder: decision.debtOrder,
    surplusTargetLoanId: decision.surplusPolicy === 'debt' ? decision.surplusLoanId : null,
    withdrawalOrder: decision.withdrawalOrder ? [...decision.withdrawalOrder] : null,
  };
}

export function splitGrid(household: HouseholdInput, lab: LabInputs = EMPTY_LAB): DecisionGrid {
  const baseline = baselineDecision(household);
  const axes = legalAxes(household, lab, baseline);
  const count = axes.reduce((product, axis) => product * axis.length, 1);
  const delay = delayCandidate(household, baseline);
  const singles = [...singleDecisions(baseline, axes), ...(delay ? [delay] : [])];
  if (count > GRID_CAP) {
    return { singles, rest: [], capped: true, cap: GRID_CAP };
  }
  const full = stampProduct(baseline, axes);
  const singleIds = new Set(singles.map((decision) => decision.id));
  return {
    singles,
    rest: full.filter((decision) => !singleIds.has(decision.id)),
    capped: false,
    cap: GRID_CAP,
  };
}

export function cappedRest(household: HouseholdInput, lab: LabInputs, scored: RankRow[]): Decision[] {
  const grid = splitGrid(household, lab);
  if (!grid.capped) return grid.rest;
  const baseline = scored.find((row) => row.decision.id === 'current');
  if (!baseline) return [];
  const winners: Decision[] = [];
  const axisIds = [...new Set(scored.flatMap((row) => (row.decision.changedAxes.length === 1 ? row.decision.changedAxes : [])))];
  for (const axisId of axisIds) {
    const rows = scored.filter((row) => row.decision.changedAxes.length === 1 && row.decision.changedAxes[0] === axisId);
    if (!rows.length) continue;
    const best = [...rows].sort(compareRank)[0];
    if (compareRank(best, baseline) < 0) winners.push(best.decision);
  }
  const have = new Set(grid.singles.map((decision) => decision.id));
  const rest: Decision[] = [];
  const groups = subsetsOf(winners).sort((a, b) => b.length - a.length);
  for (const group of groups) {
    if (grid.singles.length + rest.length >= GRID_CAP) break;
    const merged = mergeWinners(baseline.decision, group);
    if (have.has(merged.id)) continue;
    have.add(merged.id);
    rest.push(merged);
  }
  return rest;
}

export function compareRank(a: RankRow, b: RankRow): number {
  const month = hiredRank(a.hiredMonth) - hiredRank(b.hiredMonth);
  if (month) return month;
  const aClaimed = a.collisionMonth != null;
  const bClaimed = b.collisionMonth != null;
  if (aClaimed !== bClaimed) return aClaimed ? 1 : -1;
  if (a.leftover !== b.leftover) return b.leftover - a.leftover;
  if (a.decision.id < b.decision.id) return -1;
  if (a.decision.id > b.decision.id) return 1;
  return 0;
}

export function scoreDecisions(
  household: HouseholdInput,
  bundle: SeedBundle,
  scenario: Scenario,
  decisions: Decision[],
  base?: RankRow,
): RankRow[] {
  const origin = base ?? scoreOne(household, bundle, scenario, baselineDecision(household), null);
  return decisions.map((decision) => scoreOne(household, bundle, scenario, decision, origin));
}

export function rankDecisions(
  household: HouseholdInput,
  bundle: SeedBundle,
  scenario: Scenario,
  decisions: Decision[],
): RankRow[] {
  return scoreDecisions(household, bundle, scenario, decisions).sort(compareRank);
}

export function otherGoalMonths(
  household: HouseholdInput,
  bundle: SeedBundle,
  scenario: Scenario,
): { name: string; hiredMonth: number | null }[] {
  const featured = household.jobClass;
  return openGoalBoard(household, bundle, scenario)
    .filter((card) => card.jobClass !== featured)
    .map((card) => ({ name: card.spec.name, hiredMonth: card.view.hiredMonth }));
}

export function stressLeaders(
  household: HouseholdInput,
  bundle: SeedBundle,
  rows: RankRow[],
): StressReport {
  const current = rows.find((row) => row.decision.id === 'current') ?? rows[0];
  const winner = rows[0] ?? current;
  const leaders = rows
    .filter((row) => row.decision.id !== winner?.decision.id && row.decision.id !== current?.decision.id)
    .slice(0, 2);
  if (!current || !winner) return { holdCount: 0, stretchCount: 0, reversed: [] };
  const stretches = stressStretches(household, bundle);
  if (winner.decision.id === current.decision.id) {
    return { holdCount: stretches.length, stretchCount: stretches.length, reversed: [] };
  }
  const reversed: { id: string; label: string }[] = [];
  for (const stretch of stretches) {
    const books = [current, winner, ...leaders];
    const scored = books.map((row) => standingRank(household, bundle, row.decision, stretch.opts, stretch.scenario));
    if (compareRank(scored[1], scored[0]) > 0) reversed.push({ id: stretch.id, label: stretch.label });
  }
  return {
    holdCount: stretches.length - reversed.length,
    stretchCount: stretches.length,
    reversed,
  };
}

function stressStretches(
  household: HouseholdInput,
  bundle: SeedBundle,
): { id: string; label: string; scenario: Scenario; opts: StandingOptions }[] {
  const crash: { id: string; label: string; scenario: Scenario; opts: StandingOptions } = {
    id: 'crash',
    label: 'Cited crash',
    scenario: 'realistic',
    opts: { shocks: crashShocks(bundle) },
  };
  const conservative = {
    id: 'conservative',
    label: 'Conservative',
    scenario: 'conservative' as Scenario,
    opts: {},
  };
  const overlays = availableOverlays(household).map((overlay) => ({
    id: overlay.id,
    label: overlay.label,
    scenario: 'realistic' as Scenario,
    opts: { overlayId: overlay.id },
  }));
  return [conservative, crash, ...overlays];
}

function standingRank(
  household: HouseholdInput,
  bundle: SeedBundle,
  decision: Decision,
  opts: StandingOptions,
  scenario: Scenario,
): RankRow {
  const books = applyDecision(household, decision);
  const view = standing(books, bundle, scenario, books.jobClass, opts);
  return rowFromView(decision, view, null);
}

function scoreOne(
  household: HouseholdInput,
  bundle: SeedBundle,
  scenario: Scenario,
  decision: Decision,
  origin: RankRow | null,
): RankRow {
  const books = applyDecision(household, decision);
  const view = standing(books, bundle, scenario, books.jobClass);
  return rowFromView(decision, view, origin);
}

function rowFromView(decision: Decision, view: StandingView, origin: RankRow | null): RankRow {
  const hiredMonth = view.hiredMonth;
  const monthGap =
    origin && origin.hiredMonth != null && hiredMonth != null ? origin.hiredMonth - hiredMonth : null;
  return {
    decision,
    hiredMonth,
    leftover: view.leftover,
    reserved: view.reserved,
    collisionMonth: view.collisionMonth,
    monthGap: decision.id === 'current' ? 0 : monthGap,
    otherGoals: [],
    sentence: view.sentence,
  };
}

function hiredRank(month: number | null): number {
  return month == null ? Number.POSITIVE_INFINITY : month;
}

function baselineDecision(household: HouseholdInput): Decision {
  const decision: Decision = {
    id: 'current',
    changedAxes: [],
    surplusPolicy: household.surplusPolicy ?? 'cash',
    debtOrder: household.debtOrder ?? 'highest_rate',
    surplusLoanId: null,
    shifts: { roof: 0, hvac: 0, waterHeater: 0 },
    zMove: 'keep',
    downsizeLoanChoice: null,
    lump: null,
    bufferMonths: cushionMonths(household),
    socialSecurity: null,
    pension: null,
    car: null,
    pay: null,
    refinance: null,
    withdrawalOrder: household.withdrawalOrder ? [...household.withdrawalOrder] : null,
  };
  decision.id = 'current';
  return decision;
}

function legalAxes(household: HouseholdInput, lab: LabInputs, baseline: Decision): AxisOption[][] {
  const axes: AxisOption[][] = [];
  const loans = amortizingLoans(household);
  const surplus: AxisOption[] = [identity('surplus')];
  if (baseline.surplusPolicy !== 'retirement') {
    surplus.push(
      change('surplus', (decision) => {
        decision.surplusPolicy = 'retirement';
        decision.surplusLoanId = null;
      }),
    );
  }
  if (baseline.surplusPolicy !== 'cash') {
    surplus.push(
      change('surplus', (decision) => {
        decision.surplusPolicy = 'cash';
        decision.surplusLoanId = null;
      }),
    );
  }
  if (loans.length) {
    for (const loan of loans) {
      surplus.push(
        change('surplus', (decision) => {
          decision.surplusPolicy = 'debt';
          decision.surplusLoanId = loan.id;
        }),
      );
    }
  } else if (baseline.surplusPolicy !== 'debt') {
    surplus.push(
      change('surplus', (decision) => {
        decision.surplusPolicy = 'debt';
        decision.surplusLoanId = null;
      }),
    );
  }
  axes.push(surplus);

  if (loans.length) {
    axes.push([
      identity('debtOrder'),
      change('debtOrder', (decision) => {
        decision.debtOrder = baseline.debtOrder === 'smallest_balance' ? 'highest_rate' : 'smallest_balance';
      }),
    ]);
  }

  axes.push([
    identity('cushion'),
    ...([3, 6, 12] as const)
      .filter((months) => months !== baseline.bufferMonths)
      .map((months) =>
        change('cushion', (decision) => {
          decision.bufferMonths = months;
        }),
      ),
  ]);

  const home = featuredHome(household);
  for (const system of ['roof', 'hvac', 'waterHeater'] as const) {
    const year = home?.[SYSTEM_YEAR[system]];
    if (year == null) continue;
    axes.push([
      identity(system),
      ...([2, 5] as const).map((years) =>
        change(system, (decision) => {
          decision.shifts = { ...decision.shifts, [system]: years };
        }),
      ),
    ]);
  }

  if (home?.value != null) {
    const mortgages = household.accounts.filter((account) => account.type === 'mortgage' && account.balance > 0);
    const house: AxisOption[] = [identity('house')];
    if (!mortgages.length) {
      house.push(
        change('house', (decision) => {
          decision.zMove = 'downsize';
          decision.downsizeLoanChoice = null;
        }),
      );
    } else {
      for (const choice of ['keep_loan', 'pay_down'] as const) {
        house.push(
          change('house', (decision) => {
            decision.zMove = 'downsize';
            decision.downsizeLoanChoice = choice;
          }),
        );
      }
    }
    axes.push(house);
  }

  if (lab.lumpAmount != null && lab.lumpAmount > 0) {
    const lump: AxisOption[] = [identity('lump')];
    for (const loan of loans) {
      lump.push(
        change('lump', (decision) => {
          decision.lump = { amount: lab.lumpAmount ?? 0, destination: 'debt', loanId: loan.id };
        }),
      );
    }
    if (household.accounts.some((account) => account.type === 'brokerage')) {
      lump.push(
        change('lump', (decision) => {
          decision.lump = { amount: lab.lumpAmount ?? 0, destination: 'brokerage', loanId: null };
        }),
      );
    }
    if (lump.length > 1) axes.push(lump);
  }

  const socialSaved = (household.socialSecurity?.monthlyAmount ?? 0) > 0;
  const socialExtras = lab.socialPairs.filter(acceptSocialPair);
  if (socialSaved && socialExtras.length) {
    axes.push([
      identity('social'),
      ...socialExtras.map((pair) =>
        change('social', (decision) => {
          decision.socialSecurity = { ...pair };
        }),
      ),
    ]);
  }
  const pensionSaved = (household.pension?.monthlyAmount ?? 0) > 0;
  const pensionExtras = lab.pensionPairs.filter(acceptPensionPair);
  if (pensionSaved && pensionExtras.length) {
    axes.push([
      identity('pension'),
      ...pensionExtras.map((pair) =>
        change('pension', (decision) => {
          decision.pension = { ...pair };
        }),
      ),
    ]);
  }

  if (
    lab.car &&
    lab.car.price > 0 &&
    Number.isFinite(lab.car.vehicleYear) &&
    household.assets.some((asset) => asset.type === 'vehicle')
  ) {
    axes.push([
      identity('car'),
      change('car', (decision) => {
        decision.car = { price: lab.car?.price ?? 0, vehicleYear: lab.car?.vehicleYear ?? 0 };
      }),
    ]);
  }

  const payOptions: AxisOption[] = [identity('pay')];
  const partnerPay = household.partnerMonthlyIncome ?? 0;
  if (lab.payMonthly != null && Number.isFinite(lab.payMonthly) && lab.payMonthly >= 0) {
    payOptions.push(
      change('pay', (decision) => {
        decision.pay = { monthlyIncome: lab.payMonthly, partnerToZero: false };
      }),
    );
  }
  if (partnerPay > 0 && lab.partnerToZero) {
    payOptions.push(
      change('pay', (decision) => {
        decision.pay = { monthlyIncome: null, partnerToZero: true };
      }),
    );
  }
  if (
    lab.payMonthly != null &&
    Number.isFinite(lab.payMonthly) &&
    lab.payMonthly >= 0 &&
    partnerPay > 0 &&
    lab.partnerToZero
  ) {
    payOptions.push(
      change('pay', (decision) => {
        decision.pay = { monthlyIncome: lab.payMonthly, partnerToZero: true };
      }),
    );
  }
  if (payOptions.length > 1) axes.push(payOptions);

  if (validRefinance(lab.refinance) && loans.some((loan) => loan.id === lab.refinance?.loanId)) {
    const terms = lab.refinance;
    axes.push([
      identity('refinance'),
      change('refinance', (decision) => {
        if (terms) decision.refinance = { ...terms };
      }),
    ]);
  }

  const buckets = presentBuckets(household);
  const taxed =
    household.withdrawalTaxRate != null ||
    ((household.taxLots?.length ?? 0) > 0 &&
      (household.shortTermGainRate != null || household.longTermGainRate != null));
  if (buckets.length >= 2 && taxed) {
    const withdrawal: AxisOption[] = [identity('withdrawal')];
    for (const order of permutations(buckets)) {
      if (sameOrder(order, baseline.withdrawalOrder)) continue;
      withdrawal.push(
        change('withdrawal', (decision) => {
          decision.withdrawalOrder = [...order];
        }),
      );
    }
    if (withdrawal.length > 1) axes.push(withdrawal);
  }

  return axes.filter((axis) => axis.length > 1);
}

function identity(axisId: string): AxisOption {
  return { axisId, identity: true, apply: (decision) => cloneDecision(decision) };
}

function change(axisId: string, edit: (decision: Decision) => void): AxisOption {
  return {
    axisId,
    identity: false,
    apply: (decision) => {
      const next = cloneDecision(decision);
      edit(next);
      return next;
    },
  };
}

function singleDecisions(baseline: Decision, axes: AxisOption[][]): Decision[] {
  const rows = [stamp(cloneDecision(baseline), [])];
  for (const axis of axes) {
    for (const option of axis) {
      if (option.identity) continue;
      rows.push(stamp(option.apply(baseline), [option.axisId]));
    }
  }
  return rows;
}

function delayCandidate(household: HouseholdInput, baseline: Decision): Decision | null {
  const projected = projectZMove(household, 'delay_replace');
  if (!projected.applied || projected.household === household) return null;
  const next = cloneDecision(baseline);
  next.zMove = 'delay_replace';
  return stamp(next, ['delay_replace']);
}

function stampProduct(baseline: Decision, axes: AxisOption[][]): Decision[] {
  let rows: { decision: Decision; axes: string[] }[] = [{ decision: cloneDecision(baseline), axes: [] }];
  for (const axis of axes) {
    const next: { decision: Decision; axes: string[] }[] = [];
    for (const row of rows) {
      for (const option of axis) {
        next.push({
          decision: option.apply(row.decision),
          axes: option.identity ? row.axes : [...row.axes, option.axisId],
        });
      }
    }
    rows = next;
  }
  return rows.map((row) => stamp(row.decision, row.axes));
}

function stamp(decision: Decision, axes: string[]): Decision {
  const next = cloneDecision(decision);
  next.changedAxes = [...axes];
  next.id = axes.length ? decisionKey(next) : 'current';
  return next;
}

function mergeWinners(baseline: Decision, parts: Decision[]): Decision {
  let next = cloneDecision(baseline);
  const axes: string[] = [];
  for (const part of parts) {
    const axis = part.changedAxes[0];
    if (!axis) continue;
    next = copyAxis(next, part, axis);
    axes.push(axis);
  }
  return stamp(next, axes);
}

function copyAxis(dest: Decision, src: Decision, axis: string): Decision {
  const next = cloneDecision(dest);
  if (axis === 'surplus') {
    next.surplusPolicy = src.surplusPolicy;
    next.surplusLoanId = src.surplusLoanId;
  } else if (axis === 'debtOrder') next.debtOrder = src.debtOrder;
  else if (axis === 'roof' || axis === 'hvac' || axis === 'waterHeater') next.shifts[axis] = src.shifts[axis];
  else if (axis === 'house' || axis === 'delay_replace') {
    next.zMove = src.zMove;
    next.downsizeLoanChoice = src.downsizeLoanChoice;
  } else if (axis === 'lump') next.lump = src.lump ? { ...src.lump } : null;
  else if (axis === 'cushion') next.bufferMonths = src.bufferMonths;
  else if (axis === 'social') next.socialSecurity = src.socialSecurity ? { ...src.socialSecurity } : null;
  else if (axis === 'pension') next.pension = src.pension ? { ...src.pension } : null;
  else if (axis === 'car') next.car = src.car ? { ...src.car } : null;
  else if (axis === 'pay') next.pay = src.pay ? { ...src.pay } : null;
  else if (axis === 'refinance') next.refinance = src.refinance ? { ...src.refinance } : null;
  else if (axis === 'withdrawal') next.withdrawalOrder = src.withdrawalOrder ? [...src.withdrawalOrder] : null;
  return next;
}

function subsetsOf(items: Decision[]): Decision[][] {
  const out: Decision[][] = [];
  const total = 1 << items.length;
  for (let mask = 1; mask < total; mask++) {
    const group: Decision[] = [];
    for (let index = 0; index < items.length; index++) {
      if (mask & (1 << index)) group.push(items[index]);
    }
    if (group.length >= 2) out.push(group);
  }
  return out;
}

function decisionKey(decision: Decision): string {
  return [
    decision.surplusPolicy,
    decision.debtOrder,
    decision.surplusLoanId ?? '',
    `${decision.shifts.roof},${decision.shifts.hvac},${decision.shifts.waterHeater}`,
    decision.zMove,
    decision.downsizeLoanChoice ?? '',
    decision.lump ? `${decision.lump.destination}:${decision.lump.loanId ?? ''}:${decision.lump.amount}` : '',
    decision.bufferMonths,
    decision.socialSecurity ? `${decision.socialSecurity.startAge}:${decision.socialSecurity.monthlyAmount}` : '',
    decision.pension ? `${decision.pension.startAge}:${decision.pension.monthlyAmount}` : '',
    decision.car ? `${decision.car.vehicleYear}:${decision.car.price}` : '',
    decision.pay ? `${decision.pay.monthlyIncome ?? ''}:${decision.pay.partnerToZero ? 1 : 0}` : '',
    decision.refinance ? `${decision.refinance.loanId}:${decision.refinance.apr}:${decision.refinance.minPayment}` : '',
    decision.withdrawalOrder ? decision.withdrawalOrder.join('>') : '',
  ].join('|');
}

function cloneDecision(decision: Decision): Decision {
  return {
    ...decision,
    changedAxes: [...decision.changedAxes],
    shifts: { ...decision.shifts },
    lump: decision.lump ? { ...decision.lump } : null,
    socialSecurity: decision.socialSecurity ? { ...decision.socialSecurity } : null,
    pension: decision.pension ? { ...decision.pension } : null,
    car: decision.car ? { ...decision.car } : null,
    pay: decision.pay ? { ...decision.pay } : null,
    refinance: decision.refinance ? { ...decision.refinance } : null,
    withdrawalOrder: decision.withdrawalOrder ? [...decision.withdrawalOrder] : null,
  };
}

function cloneHousehold(household: HouseholdInput): HouseholdInput {
  return {
    ...household,
    accounts: household.accounts.map((account) => ({ ...account })),
    assets: household.assets.map((asset) => ({ ...asset })),
    expenses: household.expenses.map((expense) => ({ ...expense })),
    socialSecurity: household.socialSecurity ? { ...household.socialSecurity } : household.socialSecurity,
    pension: household.pension ? { ...household.pension } : household.pension,
    taxLots: household.taxLots ? household.taxLots.map((lot) => ({ ...lot })) : household.taxLots,
    withdrawalOrder: household.withdrawalOrder ? [...household.withdrawalOrder] : household.withdrawalOrder,
  };
}

function applyRefinance(household: HouseholdInput, terms: RefinanceTerms | null): HouseholdInput {
  if (!validRefinance(terms)) return household;
  return {
    ...household,
    accounts: household.accounts.map((account) =>
      account.id === terms.loanId ? { ...account, apr: terms.apr, minPayment: terms.minPayment } : account,
    ),
  };
}

function applyPay(household: HouseholdInput, pay: PayAlternate | null): HouseholdInput {
  if (!pay) return household;
  return {
    ...household,
    monthlyIncome: pay.monthlyIncome != null && pay.monthlyIncome >= 0 ? pay.monthlyIncome : household.monthlyIncome,
    partnerMonthlyIncome: pay.partnerToZero ? 0 : household.partnerMonthlyIncome,
  };
}

function applyBenefits(household: HouseholdInput, decision: Decision): HouseholdInput {
  let next = household;
  if (decision.socialSecurity && acceptSocialPair(decision.socialSecurity)) {
    next = { ...next, socialSecurity: { ...decision.socialSecurity } };
  }
  if (decision.pension && acceptPensionPair(decision.pension)) {
    next = { ...next, pension: { ...decision.pension } };
  }
  return next;
}

function applyCar(household: HouseholdInput, car: CarReplacement | null): HouseholdInput {
  if (!car || !(car.price > 0) || !Number.isFinite(car.vehicleYear)) return household;
  const vehicle = household.assets.find((asset) => asset.type === 'vehicle');
  if (!vehicle) return household;
  return {
    ...household,
    assets: household.assets.map((asset) =>
      asset.id === vehicle.id ? { ...asset, value: car.price, vehicleYear: car.vehicleYear } : asset,
    ),
  };
}

function applyMove(household: HouseholdInput, decision: Decision): HouseholdInput {
  if (decision.zMove === 'keep') return household;
  const projected = projectZMove(household, decision.zMove, decision.downsizeLoanChoice);
  return projected.applied ? projected.household : household;
}

function applyShifts(household: HouseholdInput, shifts: Decision['shifts']): HouseholdInput {
  const home = featuredHome(household);
  if (!home) return household;
  if (shifts.roof === 0 && shifts.hvac === 0 && shifts.waterHeater === 0) return household;
  return {
    ...household,
    assets: household.assets.map((asset) => {
      if (asset.id !== home.id) return asset;
      const bump = (system: SystemName, year: number | null | undefined) =>
        year == null || shifts[system] === 0 ? year : year + shifts[system];
      return {
        ...asset,
        roofYear: bump('roof', asset.roofYear) ?? asset.roofYear,
        hvacYear: bump('hvac', asset.hvacYear) ?? asset.hvacYear,
        waterHeaterYear: bump('waterHeater', asset.waterHeaterYear) ?? asset.waterHeaterYear,
      };
    }),
  };
}

function applyLump(household: HouseholdInput, lump: LumpMove | null): HouseholdInput {
  if (!lump || !(lump.amount > 0) || lump.destination === 'cash') return household;
  const liquid = household.accounts
    .filter((account) => isLiquid(account.type))
    .reduce((sum, account) => sum + Math.max(0, account.balance), 0);
  const amount = Math.min(lump.amount, Math.max(0, liquid));
  if (!(amount > 0)) return household;
  if (lump.destination === 'debt') {
    const loan = household.accounts.find((account) => account.id === lump.loanId && isLiability(account.type));
    if (!loan || loan.payoffStyle === 'paid_monthly') return household;
    return drawLiquid(
      {
        ...household,
        accounts: household.accounts.map((account) =>
          account.id === loan.id ? { ...account, balance: Math.max(0, account.balance - amount) } : account,
        ),
      },
      amount,
    );
  }
  const brokerage = household.accounts.find((account) => account.type === 'brokerage');
  if (!brokerage) return household;
  return addBrokerageCash(drawLiquid(household, amount), brokerage.id, amount);
}

function drawLiquid(household: HouseholdInput, amount: number): HouseholdInput {
  let left = amount;
  return {
    ...household,
    accounts: household.accounts.map((account) => {
      if (!isLiquid(account.type) || !(left > 0)) return account;
      const take = Math.min(Math.max(0, account.balance), left);
      left -= take;
      return { ...account, balance: account.balance - take };
    }),
  };
}

function addBrokerageCash(household: HouseholdInput, accountId: string, amount: number): HouseholdInput {
  const account = household.accounts.find((row) => row.id === accountId);
  if (!account) return household;
  const asOf = localIsoDate();
  const covered = coveredAccountLots(account, household.taxLots, asOf);
  const nextBalance = account.balance + amount;
  const lots = household.taxLots ? [...household.taxLots] : [];
  if (covered) {
    lots.push(zeroGainLot(accountId, amount, asOf));
  } else if (!lots.some((lot) => lot.accountId === accountId)) {
    lots.push(zeroGainLot(accountId, nextBalance, asOf));
  } else {
    lots.push(zeroGainLot(accountId, amount, asOf));
  }
  return {
    ...household,
    taxLots: lots,
    accounts: household.accounts.map((row) => (row.id === accountId ? { ...row, balance: nextBalance } : row)),
  };
}

let lumpSerial = 0;

function zeroGainLot(accountId: string, basis: number, acquiredOn: string) {
  lumpSerial += 1;
  return {
    id: `lump-${accountId}-${lumpSerial}`,
    accountId,
    symbol: 'CASH',
    acquiredOn,
    shares: 1,
    costBasis: basis,
    pricePerShare: basis,
  };
}

function amortizingLoans(household: HouseholdInput): AccountInput[] {
  return household.accounts.filter(
    (account) => isLiability(account.type) && account.balance > 0 && account.payoffStyle !== 'paid_monthly',
  );
}

function presentBuckets(household: HouseholdInput): WithdrawalBucket[] {
  const found = new Set<WithdrawalBucket>();
  for (const account of household.accounts) {
    if (!isInvestment(account.type) || !(account.balance > 0)) continue;
    if (account.taxTreatment === 'roth') found.add('roth');
    else if (account.type === 'brokerage' && account.taxTreatment !== 'traditional') found.add('brokerage');
    else found.add('traditional');
  }
  return (['traditional', 'roth', 'brokerage'] as const).filter((bucket) => found.has(bucket));
}

function permutations(items: WithdrawalBucket[]): WithdrawalBucket[][] {
  if (items.length <= 1) return [items];
  const out: WithdrawalBucket[][] = [];
  items.forEach((item, index) => {
    const rest = [...items.slice(0, index), ...items.slice(index + 1)];
    for (const tail of permutations(rest)) out.push([item, ...tail]);
  });
  return out;
}

function sameOrder(order: WithdrawalBucket[], current: WithdrawalBucket[] | null): boolean {
  if (!current || current.length !== order.length) return false;
  return order.every((bucket, index) => bucket === current[index]);
}

function validRefinance(terms: RefinanceTerms | null): terms is RefinanceTerms {
  if (!terms) return false;
  if (!terms.loanId) return false;
  if (!Number.isFinite(terms.apr) || terms.apr < 0 || terms.apr > 0.8) return false;
  if (!Number.isFinite(terms.minPayment) || terms.minPayment < 0) return false;
  return true;
}

function axisPhrase(axis: string, decision: Decision, household: HouseholdInput): string {
  if (axis === 'surplus') {
    if (decision.surplusPolicy === 'debt' && decision.surplusLoanId) {
      const name = household.accounts.find((account) => account.id === decision.surplusLoanId)?.name;
      return name ? `Extra to ${name}` : 'Extra to a loan';
    }
    return SURPLUS_POLICY_LABELS[decision.surplusPolicy];
  }
  if (axis === 'debtOrder') return DEBT_ORDER_LABELS[decision.debtOrder];
  if (axis === 'cushion') return `${decision.bufferMonths} months of living set aside`;
  if (axis === 'roof' || axis === 'hvac' || axis === 'waterHeater') {
    const label = axis === 'waterHeater' ? 'water heater' : axis;
    return `Push the ${label} ${decision.shifts[axis]} years`;
  }
  if (axis === 'house') return decision.downsizeLoanChoice === 'pay_down' ? 'Downsize and pay the loan down' : 'Downsize this house';
  if (axis === 'delay_replace') return 'Delay the next replacement';
  if (axis === 'lump') {
    if (decision.lump?.destination === 'brokerage') return 'Lump into the brokerage';
    const name = household.accounts.find((account) => account.id === decision.lump?.loanId)?.name;
    return name ? `Lump onto ${name}` : 'Lump onto a loan';
  }
  if (axis === 'social' && decision.socialSecurity) {
    return `Social Security at ${decision.socialSecurity.startAge}`;
  }
  if (axis === 'pension' && decision.pension) return `Pension at ${decision.pension.startAge}`;
  if (axis === 'car' && decision.car) return `Replace the car in ${decision.car.vehicleYear}`;
  if (axis === 'pay' && decision.pay?.partnerToZero && decision.pay.monthlyIncome == null) return 'Partner pay stops';
  if (axis === 'pay') return 'Take-home changes';
  if (axis === 'refinance') return 'Refinance this loan';
  if (axis === 'withdrawal' && decision.withdrawalOrder) {
    return `Withdraw ${decision.withdrawalOrder.join(', then ')}`;
  }
  return axis;
}

export function overlayApplies(household: HouseholdInput, id: string): boolean {
  return OVERLAY_CATALOG.some((overlay) => overlay.id === id && overlay.appliesIf(household));
}
