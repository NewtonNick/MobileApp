import { amortizeMonth } from './amort';
import { extraIncomeForMonth, ownIncomeForMonth, partnerIncomeForMonth, plannedRaiseFactor } from './cadence';
import { expenseCountsInLiving, isRentExpense } from './expenses';
import { amortizingPayment, loanMonthPlan, remainingTermMonths } from './loan-terms';
import { capMonthlyDeferral } from './limits';
import { round2 } from './money';
import { resolvedMonthIndex } from './month';
import { hasHouse, hasVehicle, VEHICLE_COST_ESTIMATES } from './ownership';
import { monthlyRate } from './rates';
import {
  annualHomeMaintPct,
  homeAge,
  homeMaintBasis,
  homeMaintSqftScale,
  macroParams,
  otherAssetCpiScale,
  pickTriple,
  resolveGeo,
  scenarioInvestmentReturn,
  vehicleAge,
  vehicleClassOf,
  vehicleMaintMultiplier,
} from './lookups';
import { applyOverlayToEvents, overlayEffects } from './overlays';
import type { OverlayId } from './overlays';
import { liabilityApr } from './rates';
import { repairRisks } from './risk';
import { coveredAccountLots, localIsoDate, splitUnrealized } from './taxlots';
import type { SeedBundle } from './seed-types';
import type {
  AccountInput,
  AssetInput,
  EventHit,
  HouseholdInput,
  MonthPoint,
  Scenario,
  WaterfallSlice,
} from './types';
import { isInvestment, isLiquid, isLiability } from './types';

export { VEHICLE_COST_ESTIMATES } from './ownership';

export interface VehicleRunningCost {
  insuranceMonthly: number;
  registrationMonthly: number;
  fuelMonthly: number;
  insuranceEstimated: boolean;
  registrationEstimated: boolean;
  fuelEstimated: boolean;
}

export const WALKER_HORIZON_MONTHS = 60;

export interface PathShocks {
  ownIncomeMultiplier(month: number): number;
  partnerIncomeMultiplier(month: number): number;
  livingVariableScale(month: number): number;
  hpiMonthlyReturn(month: number, meanAnnual: number): number;
  investmentMonthlyReturn(month: number, expectedAnnual: number): number;
  liquidMonthlyReturn(expectedAnnual: number): number;
  remapEventMonth(month: number): number;
}

export const identityShocks: PathShocks = {
  ownIncomeMultiplier: () => 1,
  partnerIncomeMultiplier: () => 1,
  livingVariableScale: () => 1,
  hpiMonthlyReturn: (_month, meanAnnual) => monthlyRate(meanAnnual),
  investmentMonthlyReturn: (_month, expectedAnnual) => monthlyRate(expectedAnnual),
  liquidMonthlyReturn: (expectedAnnual) => monthlyRate(expectedAnnual),
  remapEventMonth: (month) => month,
};

interface NamedBalance {
  id: string;
  name: string;
  type: AccountInput['type'];
  balance: number;
  expectedReturn: number;
  apr: number | null;
  minPayment: number | null;
  escrowMonthly: number;
  payoffStyle: AccountInput['payoffStyle'];
  forgivenessMonth: number | null;
  taxTreatment: AccountInput['taxTreatment'];
  employeeMonthly: number;
  employeePercent: number | null;
  matchPercent: number | null;
  matchCapPercent: number | null;
  grossMonthly: number | null;
  linkedExpense: boolean;
  /** Opening statement on a card that is paid in full each month. Charged every month, not once. */
  statement: number;
  /** Set when brokerage lots match this balance. Growth does not increase it. New savings do. */
  costBasis: number | null;
  openingShortGain: number;
  openingLongGain: number;
  currentApr: number | null;
  linkedAssetId: string | null;
  residual: number | null;
  endChoice: AccountInput['endChoice'];
}

interface VehicleState {
  id: string;
  value: number;
  depMonthly: number;
}

export interface WalkerState {
  month: number;
  cash: number;
  income: number;
  living: number;
  debtPaid: number;
  ownership: number;
  houseCost: number;
  carCost: number;
  liquid: NamedBalance[];
  investments: NamedBalance[];
  debts: NamedBalance[];
  homes: { id: string; value: number }[];
  vehicles: VehicleState[];
  other: { id: string; value: number }[];
}

export interface Driver {
  id: string;
  field: string;
  applies: (h: HouseholdInput) => boolean;
  init: (state: WalkerState, ctx: DriverContext) => void;
  step: (state: WalkerState, ctx: DriverContext) => void;
}

export interface DriverContext {
  household: HouseholdInput;
  bundle: SeedBundle;
  scenario: Scenario;
  overlayId?: OverlayId;
  overlay: ReturnType<typeof overlayEffects> | null;
  geo: ReturnType<typeof resolveGeo>;
  events: EventHit[];
  cpiMonthly: number;
  nowYear: number;
  now: Date;
  shocks: PathShocks;
  focusLoanIds?: string[] | null;
  addWater: (key: string, label: string, amount: number, ownership: boolean) => void;
}

function skip(_h: HouseholdInput): boolean {
  return false;
}

function noop(): void {}

function skipDriver(id: string, field: string): Driver {
  return { id, field, applies: skip, init: noop, step: noop };
}

function applyCash(state: WalkerState, delta: number): void {
  const next = round2(state.cash + delta);
  const applied = round2(next - state.cash);
  state.cash = next;
  if (state.liquid.length) state.liquid[0].balance = round2(state.liquid[0].balance + applied);
}

function ownsHouse(h: HouseholdInput): boolean {
  return hasHouse(h);
}

function ownsVehicle(h: HouseholdInput): boolean {
  return hasVehicle(h);
}

function hasIncome(h: HouseholdInput): boolean {
  return (
    (h.monthlyIncome ?? 0) > 0 ||
    (h.partnerMonthlyIncome ?? 0) > 0 ||
    (h.extraIncomes ?? []).some((row) => row.amount > 0)
  );
}

function hasLiquid(h: HouseholdInput): boolean {
  return h.accounts.some((a) => isLiquid(a.type));
}

function hasInvest(h: HouseholdInput): boolean {
  return h.accounts.some((a) => isInvestment(a.type));
}

function hasDebt(h: HouseholdInput): boolean {
  return h.accounts.some((a) => isLiability(a.type));
}

function hasOtherAssets(h: HouseholdInput): boolean {
  return h.assets.some((a) => a.type === 'other');
}

function hasExpenses(h: HouseholdInput): boolean {
  return h.expenses.some((e) => e.monthlyAmount != null && !e.linkedLiabilityId);
}

function inflator(ctx: DriverContext, month: number): number {
  return Math.pow(1 + ctx.cpiMonthly, month);
}

function rentFactor(h: HouseholdInput, month: number): number {
  const growth = h.rentGrowthAnnual ?? 0;
  if (!growth) return 1;
  return Math.pow(1 + growth, (month - 1) / 12);
}

function livingBase(h: HouseholdInput, scenario: Scenario, overlay: DriverContext['overlay'], month: number): {
  fixed: number;
  variable: number;
  rent: number;
} {
  let fixed = 0;
  let variable = 0;
  let rent = 0;
  const rentScale = rentFactor(h, month);
  const varScenario =
    overlay?.variableScenarioThroughMonth && month <= overlay.variableScenarioThroughMonth.throughMonth
      ? overlay.variableScenarioThroughMonth.scenario
      : scenario;
  for (const e of h.expenses) {
    if (!expenseCountsInLiving(e, month, h) || e.monthlyAmount == null) continue;
    let amt = e.monthlyAmount;
    if (isRentExpense(e)) {
      rent += amt * rentScale;
      continue;
    }
    if (e.variable) {
      if (varScenario === 'liberal') amt *= 0.8;
      if (varScenario === 'conservative') amt *= 1.2;
      variable += amt;
    } else {
      fixed += amt;
    }
  }
  return { fixed, variable, rent };
}

function rentalIncome(h: HouseholdInput): number {
  if (!ownsHouse(h)) return 0;
  let sum = 0;
  for (const home of h.assets) {
    if (home.type !== 'home' || !(home.rentalIncomeMonthly && home.rentalIncomeMonthly > 0)) continue;
    const vacancy = Math.min(1, Math.max(0, home.vacancyRate ?? 0));
    const fee = Math.min(1, Math.max(0, home.managementPct ?? 0));
    sum += home.rentalIncomeMonthly * (1 - vacancy) * (1 - fee);
  }
  return sum;
}

function mortgageIndexAnnual(bundle: SeedBundle, scenario: Scenario): number {
  const triple = bundle.macro.mortgageIndex ?? { liberal: 0.035, realistic: 0.045, conservative: 0.06 };
  return pickTriple(triple, scenario);
}

function closeLease(state: WalkerState, ctx: DriverContext, debt: NamedBalance): void {
  const source = ctx.household.accounts.find((account) => account.id === debt.id);
  const car = debt.linkedAssetId ? state.vehicles.find((row) => row.id === debt.linkedAssetId) : undefined;
  if (car) car.value = 0;
  if (!source?.mileageCap || !(source.overageRate && source.overageRate > 0)) return;
  const end = resolvedMonthIndex(source.endsAt, null, ctx.now) ?? 1;
  const years = Math.max(1 / 12, end / 12);
  const asset = ctx.household.assets.find((row) => row.id === debt.linkedAssetId);
  const driven = (asset?.milesPerYear ?? VEHICLE_COST_ESTIMATES.milesPerYear) * years;
  const over = Math.max(0, driven - source.mileageCap);
  if (over > 0) applyCash(state, -over * source.overageRate);
}

function buyLease(state: WalkerState, _ctx: DriverContext, debt: NamedBalance): void {
  const residual = Math.max(0, debt.residual ?? debt.balance);
  applyCash(state, -residual);
  debt.balance = 0;
}

function ownScale(ctx: DriverContext, month: number): number {
  let s = ctx.shocks.ownIncomeMultiplier(month);
  if (ctx.overlay?.zeroOwnIncomeThroughMonth && month <= ctx.overlay.zeroOwnIncomeThroughMonth) s = 0;
  if (ctx.overlay?.raiseOwnIncomeAfterMonth && month > ctx.overlay.raiseOwnIncomeAfterMonth) {
    s *= ctx.overlay.raiseOwnIncomeFactor ?? 1.1;
  }
  return s;
}

const incomeDriver: Driver = {
  id: 'income',
  field: 'monthlyIncome',
  applies: hasIncome,
  init: noop,
  step: (state, ctx) => {
    const infl = inflator(ctx, state.month);
    const own =
      ownIncomeForMonth(ctx.household, state.month, ctx.now) *
      ownScale(ctx, state.month) *
      infl *
      plannedRaiseFactor(ctx.household, 'own', state.month, ctx.now);
    const partner =
      partnerIncomeForMonth(ctx.household, state.month, ctx.now) *
      ctx.shocks.partnerIncomeMultiplier(state.month) *
      infl *
      plannedRaiseFactor(ctx.household, 'partner', state.month, ctx.now);
    const ownEnd = resolvedMonthIndex(ctx.household.incomeEndsAt, null, ctx.now);
    const partnerEnd = resolvedMonthIndex(ctx.household.partnerIncomeEndsAt, null, ctx.now);
    const ownPaid = ownEnd != null && state.month >= ownEnd ? 0 : own;
    const partnerPaid = partnerEnd != null && state.month >= partnerEnd ? 0 : partner;
    const extra = extraIncomeForMonth(ctx.household.extraIncomes, state.month, ctx.now) * infl;
    const rental = rentalIncome(ctx.household) * infl;
    const income = ownPaid + partnerPaid + extra + rental;
    state.income += income;
    applyCash(state, income);
  },
};

const liquidDriver: Driver = {
  id: 'liquid',
  field: 'accounts',
  applies: hasLiquid,
  init: (state, ctx) => {
    for (const a of ctx.household.accounts.filter((x) => isLiquid(x.type))) {
      state.liquid.push({
        id: a.id,
        name: a.name,
        type: a.type,
        balance: a.balance,
        expectedReturn: a.expectedReturn ?? 0,
        apr: a.apr ?? null,
        minPayment: a.minPayment ?? null,
        escrowMonthly: 0,
        payoffStyle: null,
        forgivenessMonth: null,
        taxTreatment: null,
        employeeMonthly: 0,
        employeePercent: null,
        matchPercent: null,
        matchCapPercent: null,
        grossMonthly: null,
        linkedExpense: false,
        statement: 0,
        costBasis: null,
        openingShortGain: 0,
        openingLongGain: 0,
        currentApr: null,
        linkedAssetId: null,
        residual: null,
        endChoice: null,
      });
    }
    state.cash = state.liquid.reduce((s, a) => s + a.balance, 0);
  },
  step: (state, ctx) => {
    for (const a of state.liquid) {
      const y = a.balance * ctx.shocks.liquidMonthlyReturn(a.expectedReturn);
      a.balance += y;
      state.cash += y;
    }
  },
};

const livingDriver: Driver = {
  id: 'expenses',
  field: 'expenses',
  applies: hasExpenses,
  init: noop,
  step: (state, ctx) => {
    const infl = inflator(ctx, state.month);
    const { fixed, variable, rent } = livingBase(ctx.household, ctx.scenario, ctx.overlay, state.month);
    const rentBill = ctx.household.rentGrowthAnnual != null ? rent : rent * infl;
    const living = (fixed + variable * ctx.shocks.livingVariableScale(state.month)) * infl + rentBill;
    state.living += living;
    applyCash(state, -living);
    ctx.addWater('living', 'Living expenses', living / infl, false);
  },
};

const debtDriver: Driver = {
  id: 'liabilities',
  field: 'accounts',
  applies: hasDebt,
  init: (state, ctx) => {
    for (const a of ctx.household.accounts.filter((x) => isLiability(x.type))) {
      state.debts.push({
        id: a.id,
        name: a.name,
        type: a.type,
        balance: a.balance,
        expectedReturn: 0,
        apr: a.apr ?? null,
        minPayment: a.minPayment ?? null,
        escrowMonthly: Math.max(0, a.escrowMonthly ?? 0),
        payoffStyle: a.payoffStyle ?? null,
        forgivenessMonth: a.forgivenessMonth ?? null,
        taxTreatment: null,
        employeeMonthly: 0,
        employeePercent: null,
        matchPercent: null,
        matchCapPercent: null,
        grossMonthly: null,
        linkedExpense: ctx.household.expenses.some((e) => e.linkedLiabilityId === a.id),
        statement: a.payoffStyle === 'paid_monthly' ? Math.max(0, a.typicalMonthlySpend ?? 0) : 0,
        currentApr: a.apr ?? null,
        linkedAssetId: a.linkedAssetId ?? null,
        residual: a.residual ?? null,
        endChoice: a.endChoice ?? null,
        costBasis: null,
        openingShortGain: 0,
        openingLongGain: 0,
      });
    }
  },
  step: (state, ctx) => {
    const aprScenario = ctx.overlay?.forceConservativeApr ? 'conservative' : ctx.scenario;
    for (const d of state.debts) {
      if (d.payoffStyle === 'paid_monthly') {
        if (!d.linkedExpense && d.statement > 0) {
          applyCash(state, -d.statement);
          state.living += d.statement;
        }
        d.balance = 0;
        continue;
      }
      if (d.balance <= 0.5 && d.type !== 'auto_lease') continue;
      const source = ctx.household.accounts.find((account) => account.id === d.id);
      if (!source) continue;
      const index = mortgageIndexAnnual(ctx.bundle, aprScenario);
      const plan = loanMonthPlan(source, state.month, aprScenario, ctx.now, index, d.currentApr);
      d.currentApr = plan.apr;
      if (plan.forgive || (plan.ended && source.endChoice !== 'buy')) {
        if (plan.ended && source.endChoice === 'return') closeLease(state, ctx, d);
        d.balance = 0;
        continue;
      }
      if (plan.ended && source.endChoice === 'buy') {
        buyLease(state, ctx, d);
        continue;
      }
      const escrow =
        d.minPayment == null ? d.escrowMonthly : Math.min(d.escrowMonthly, Math.max(0, d.minPayment));
      if (!plan.accrueInterest && plan.payment === 0) continue;
      if (d.type === 'auto_lease') {
        const pay = plan.payment ?? 0;
        applyCash(state, -pay);
        state.debtPaid += pay;
        continue;
      }
      let principalAndInterest = plan.payment == null ? null : Math.max(0, plan.payment - escrow);
      if (plan.interestOnly) {
        const interestOnly = d.balance * monthlyRate(plan.apr);
        principalAndInterest = d.balance * (plan.apr / 12);
      } else if (plan.payment != null && source.rateFixedUntil && state.month === resolvedMonthIndex(source.rateFixedUntil, null, ctx.now)) {
        const left = remainingTermMonths(d.balance, source.apr ?? plan.apr, Math.max(0, plan.payment - escrow));
        if (left != null && left > 0) principalAndInterest = amortizingPayment(d.balance, plan.apr, left);
      }
      const step = amortizeMonth(d.balance, plan.accrueInterest ? plan.apr : 0, principalAndInterest);
      d.balance = step.balance;
      applyCash(state, -(step.payment + escrow));
      state.debtPaid += step.payment + escrow;
      const ownership = d.type === 'mortgage' || d.type === 'auto_loan';
      ctx.addWater(`int:${d.id}`, `${d.name} interest`, step.interest / inflator(ctx, state.month), ownership);
      if (escrow > 0) {
        ctx.addWater(`escrow:${d.id}`, `${d.name} escrow`, escrow / inflator(ctx, state.month), true);
      }
    }
  },
};

const investDriver: Driver = {
  id: 'investments',
  field: 'accounts',
  applies: hasInvest,
  init: (state, ctx) => {
    for (const a of ctx.household.accounts.filter((x) => isInvestment(x.type))) {
      state.investments.push({
        id: a.id,
        name: a.name,
        type: a.type,
        balance: a.balance,
        expectedReturn: a.expectedReturn ?? 0.07,
        apr: null,
        minPayment: null,
        escrowMonthly: 0,
        payoffStyle: null,
        forgivenessMonth: null,
        taxTreatment: a.taxTreatment ?? null,
        employeeMonthly: Math.max(0, a.employeeContributionMonthly ?? 0),
        employeePercent: a.employeeContributionPercent ?? null,
        matchPercent: a.employerMatchPercent ?? null,
        matchCapPercent: a.employerMatchCapPercent ?? null,
        grossMonthly: a.grossMonthly ?? null,
        linkedExpense: false,
        statement: 0,
        costBasis: null,
        openingShortGain: 0,
        openingLongGain: 0,
        currentApr: null,
        linkedAssetId: null,
        residual: null,
        endChoice: null,
      });
      const row = state.investments[state.investments.length - 1];
      const covered = coveredAccountLots(a, ctx.household.taxLots, localIsoDate(ctx.now));
      if (covered && row) {
        row.costBasis = covered.basis;
        row.openingShortGain = covered.shortGain;
        row.openingLongGain = covered.longGain;
      }
    }
  },
  step: (state, ctx) => {
    const invScenario = ctx.overlay?.forceInvestmentScenario ?? ctx.scenario;
    for (const a of state.investments) {
      const annual = scenarioInvestmentReturn(a.expectedReturn, invScenario);
      a.balance *= 1 + ctx.shocks.investmentMonthlyReturn(state.month, annual);
      const added = retirementContribution(a, ctx.household);
      a.balance += added;
      if (a.costBasis != null) a.costBasis += added;
    }
  },
};

const homeDriver: Driver = {
  id: 'home',
  field: 'zip',
  applies: ownsHouse,
  init: (state, ctx) => {
    const fallback = ctx.geo.medianHomeValue;
    for (const home of ctx.household.assets.filter((a) => a.type === 'home')) {
      state.homes.push({ id: home.id, value: home.value ?? fallback });
    }
  },
  step: (state, ctx) => {
    const hpiTriple = ctx.overlay?.hpiAnnual ?? ctx.geo.hpiAnnual;
    const mean = pickTriple(hpiTriple, ctx.scenario);
    const r = ctx.shocks.hpiMonthlyReturn(state.month, mean);
    for (const home of state.homes) home.value *= 1 + r;
  },
};

const vehicleDriver: Driver = {
  id: 'vehicles',
  field: 'hasVehicle',
  applies: ownsVehicle,
  init: (state, ctx) => {
    for (const car of ctx.household.assets.filter((a) => a.type === 'vehicle')) {
      const cls = vehicleClassOf(car, ctx.bundle.vehicle);
      const costs = ctx.bundle.vehicle.byClass.find((c) => c.class === cls) ?? ctx.bundle.vehicle.byClass[0];
      const annual = pickTriple(costs.annualDepreciationPct, ctx.scenario);
      const leased = ctx.household.accounts.some(
        (account) => account.type === 'auto_lease' && account.linkedAssetId === car.id,
      );
      const dep = leased || annual >= 1 ? (leased ? 0 : 1) : 1 - Math.pow(1 - Math.max(0, annual), 1 / 12);
      state.vehicles.push({ id: car.id, value: car.value ?? 0, depMonthly: dep });
    }
  },
  step: (state) => {
    for (const car of state.vehicles) {
      car.value *= 1 - car.depMonthly;
    }
  },
};

const otherDriver: Driver = {
  id: 'otherAssets',
  field: 'assets',
  applies: hasOtherAssets,
  init: (state, ctx) => {
    for (const a of ctx.household.assets.filter((x) => x.type === 'other')) {
      state.other.push({ id: a.id, value: a.value ?? 0 });
    }
  },
  step: (state, ctx) => {
    const scale = otherAssetCpiScale(ctx.scenario);
    const r = monthlyRate(ctx.bundle.macro.cpiAnnual * scale);
    for (const a of state.other) a.value *= 1 + r;
  },
};

const eventsDriver: Driver = {
  id: 'realizedEventKeys',
  field: 'realizedEventKeys',
  applies: () => true,
  init: noop,
  step: (state, ctx) => {
    const infl = inflator(ctx, state.month);
    for (const ev of ctx.events) {
      if (ev.month === -1 || ev.month === state.month) {
        const cost = ev.cost * infl;
        applyCash(state, -cost);
        state.ownership += cost;
        if (ev.key.includes('home')) state.houseCost += cost;
        if (ev.key.includes('vehicle')) state.carCost += cost;
        ctx.addWater(ev.key, ev.label, ev.cost, ev.ownership);
      }
    }
  },
};

const partnerCadenceDriver: Driver = {
  id: 'partnerMonthlyIncome',
  field: 'partnerMonthlyIncome',
  applies: skip,
  init: noop,
  step: noop,
};

const cadenceDriver: Driver = {
  id: 'paycheckCadence',
  field: 'paycheckCadence',
  applies: skip,
  init: noop,
  step: noop,
};

const tenureDriver: Driver = {
  id: 'housingTenure',
  field: 'housingTenure',
  applies: skip,
  init: noop,
  step: noop,
};

function retirementContribution(account: NamedBalance, household: HouseholdInput): number {
  if ((household.fireFlavor ?? 'standard') === 'coast') return 0;
  const gross = account.grossMonthly ?? household.monthlyGross ?? 0;
  let employee = account.employeeMonthly;
  if (account.employeePercent != null && gross > 0) employee += gross * account.employeePercent;
  if (account.type === 'retirement_401k' || account.type === 'retirement_ira') {
    const year = new Date().getFullYear();
    employee = capMonthlyDeferral(
      employee,
      year,
      household.currentAge ?? null,
      account.type === 'retirement_ira' ? 'ira' : '401k',
    );
  }
  let match = employee * Math.max(0, account.matchPercent ?? 0);
  if (account.matchCapPercent != null && gross > 0) match = Math.min(match, gross * account.matchCapPercent);
  return Math.max(0, employee) + Math.max(0, match);
}

function bucketOf(account: NamedBalance): 'traditional' | 'roth' | 'brokerage' {
  if (account.taxTreatment === 'roth') return 'roth';
  if (account.type === 'brokerage' && account.taxTreatment !== 'traditional') return 'brokerage';
  return 'traditional';
}

function applyMonthSurplus(state: WalkerState, ctx: DriverContext): void {
  const flow = state.income - state.living - state.debtPaid - state.ownership;
  if (!(flow > 1)) return;
  const policy = ctx.household.surplusPolicy ?? 'cash';
  const focusEarly = ctx.focusLoanIds?.filter((id) => id);
  if (policy === 'cash' && !focusEarly?.length) return;
  if (policy === 'retirement' && !focusEarly?.length) {
    if ((ctx.household.fireFlavor ?? 'standard') === 'coast') return;
    const target =
      state.investments.find((a) => a.type === 'retirement_401k' || a.type === 'retirement_ira') ??
      state.investments[0];
    if (!target) return;
    const move = Math.min(flow, Math.max(0, state.cash));
    if (!(move > 0)) return;
    applyCash(state, -move);
    target.balance += move;
    if (target.costBasis != null) target.costBasis += move;
    return;
  }
  const focus = ctx.focusLoanIds?.filter((id) => id);
  const open = state.debts.filter(
    (d) => d.balance > 0.5 && d.payoffStyle !== 'paid_monthly' && d.type !== 'auto_lease' && (!focus?.length || focus.includes(d.id)),
  );
  if (!open.length) return;
  if (!focus?.length && policy === 'cash') return;
  const scenario = ctx.overlay?.forceConservativeApr ? 'conservative' : ctx.scenario;
  const stub = (row: NamedBalance): AccountInput => ({
    id: row.id,
    type: row.type,
    name: row.name,
    balance: row.balance,
    apr: row.apr,
    minPayment: row.minPayment,
    lastEditedAt: '',
  });
  const pinned = ctx.household.surplusTargetLoanId
    ? open.find((debt) => debt.id === ctx.household.surplusTargetLoanId)
    : undefined;
  const target =
    pinned ??
    (ctx.household.debtOrder === 'smallest_balance'
      ? open.reduce((best, debt) => (debt.balance < best.balance ? debt : best))
      : open.reduce((best, debt) =>
          liabilityApr(stub(debt), scenario) > liabilityApr(stub(best), scenario) ? debt : best,
        ));
  const extra = Math.min(flow, Math.max(0, state.cash), target.balance);
  if (!(extra > 0)) return;
  target.balance = Math.max(0, target.balance - extra);
  applyCash(state, -extra);
}

function sameName(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();
}

function catalogMpg(car: AssetInput, bundle: SeedBundle): number | null {
  const row = bundle.vehicle.catalog.find(
    (item) => item.year === car.vehicleYear && sameName(item.make, car.make) && sameName(item.model, car.model),
  );
  return row?.mpg != null && row.mpg > 0 ? row.mpg : null;
}

export function vehicleRunningCost(car: AssetInput, bundle: SeedBundle, fuelPrice?: number | null): VehicleRunningCost {
  const insuranceEstimated = car.insuranceMonthly == null;
  const registrationEstimated = car.registrationAnnual == null;
  const insuranceMonthly = car.insuranceMonthly ?? VEHICLE_COST_ESTIMATES.insuranceMonthly;
  const registrationMonthly = (car.registrationAnnual ?? VEHICLE_COST_ESTIMATES.registrationAnnual) / 12;
  if (car.fuelMonthly != null) {
    return {
      insuranceMonthly,
      registrationMonthly,
      fuelMonthly: car.fuelMonthly,
      insuranceEstimated,
      registrationEstimated,
      fuelEstimated: false,
    };
  }
  if (car.vehicleClass === 'ev') {
    const kwh = car.kwhPerMile != null && car.kwhPerMile > 0 ? car.kwhPerMile : VEHICLE_COST_ESTIMATES.kwhPerMile;
    const miles = car.milesPerYear ?? VEHICLE_COST_ESTIMATES.milesPerYear;
    const price = bundle.macro.electricityPricePerKwh ?? VEHICLE_COST_ESTIMATES.electricityPricePerKwh;
    return {
      insuranceMonthly,
      registrationMonthly,
      fuelMonthly: (miles * kwh * price) / 12,
      insuranceEstimated,
      registrationEstimated,
      fuelEstimated: car.kwhPerMile == null,
    };
  }
  const mpg = car.mpg != null && car.mpg > 0 ? car.mpg : catalogMpg(car, bundle);
  if (mpg) {
    const miles = car.milesPerYear ?? VEHICLE_COST_ESTIMATES.milesPerYear;
    const price = fuelPrice ?? VEHICLE_COST_ESTIMATES.fuelPricePerGallon;
    return {
      insuranceMonthly,
      registrationMonthly,
      fuelMonthly: (miles / mpg) * price / 12,
      insuranceEstimated,
      registrationEstimated,
      fuelEstimated: car.mpg == null,
    };
  }
  return {
    insuranceMonthly,
    registrationMonthly,
    fuelMonthly: VEHICLE_COST_ESTIMATES.fuelMonthly,
    insuranceEstimated,
    registrationEstimated,
    fuelEstimated: true,
  };
}

/** Every HouseholdInput field either has a stepping driver or an honest skip. */
export const DRIVERS: Driver[] = [
  skipDriver('id', 'id'),
  skipDriver('kind', 'kind'),
  skipDriver('createdAt', 'createdAt'),
  skipDriver('jobClass', 'jobClass'),
  skipDriver('goalSpec', 'goalSpec'),
  skipDriver('openGoals', 'openGoals'),
  skipDriver('fireFlavor', 'fireFlavor'),
  skipDriver('targetDate', 'targetDate'),
  skipDriver('surplusPolicy', 'surplusPolicy'),
  skipDriver('bufferMonths', 'bufferMonths'),
  skipDriver('skippedQuestions', 'skippedQuestions'),
  skipDriver('nextPayday', 'nextPayday'),
  skipDriver('partnerPaycheckCadence', 'partnerPaycheckCadence'),
  skipDriver('partnerNextPayday', 'partnerNextPayday'),
  skipDriver('birthYear', 'birthYear'),
  skipDriver('currentAge', 'currentAge'),
  skipDriver('socialSecurity', 'socialSecurity'),
  skipDriver('pension', 'pension'),
  skipDriver('healthAfterWorkMonthly', 'healthAfterWorkMonthly'),
  skipDriver('withdrawalTaxRate', 'withdrawalTaxRate'),
  // Lots are opened by the investments driver. Rates are read when the hired date is priced, like withdrawal tax.
  skipDriver('shortTermGainRate', 'shortTermGainRate'),
  skipDriver('longTermGainRate', 'longTermGainRate'),
  skipDriver('taxLots', 'taxLots'),
  skipDriver('rentGrowthAnnual', 'rentGrowthAnnual'),
  skipDriver('plannedRaiseMonth', 'plannedRaiseMonth'),
  skipDriver('plannedRaisePercent', 'plannedRaisePercent'),
  skipDriver('plannedRaiseEarner', 'plannedRaiseEarner'),
  skipDriver('monthlyGross', 'monthlyGross'),
  skipDriver('extraIncomes', 'extraIncomes'),
  skipDriver('featuredHomeId', 'featuredHomeId'),
  skipDriver('ignoredMerchants', 'ignoredMerchants'),
  skipDriver('reviewedPurchaseIds', 'reviewedPurchaseIds'),
  skipDriver('ledger', 'ledger'),
  skipDriver('plaidUserId', 'plaidUserId'),
  skipDriver('plaidItems', 'plaidItems'),
  skipDriver('categoryOverrides', 'categoryOverrides'),
  skipDriver('merchantSightings', 'merchantSightings'),
  skipDriver('fuelPricePerGallon', 'fuelPricePerGallon'),
  skipDriver('hasMortgage', 'hasMortgage'),
  tenureDriver,
  cadenceDriver,
  partnerCadenceDriver,
  liquidDriver,
  incomeDriver,
  livingDriver,
  debtDriver,
  investDriver,
  homeDriver,
  vehicleDriver,
  otherDriver,
  eventsDriver,
];

export function plannedEvents(h: HouseholdInput, bundle: SeedBundle, scenario: Scenario): EventHit[] {
  const events: EventHit[] = [];
  const nowYear = new Date().getFullYear();

  if (ownsHouse(h)) {
    for (const home of h.assets.filter((a) => a.type === 'home')) {
      if (h.realizedEventKeys.includes(`home:${home.id}:repair`)) continue;
      const value = home.value ?? resolveGeo(bundle.home, h.zip).medianHomeValue;
      const age = homeAge(home, nowYear);
      const maintPct = pickTriple(annualHomeMaintPct(bundle.home, age), scenario);
      const sqftScale = homeMaintSqftScale(home.sqft);
      const basis = homeMaintBasis(value);
      const seedAnnual = basis * (age == null ? maintPct / 5 : maintPct) * sqftScale;
      const annual = home.costOverrides?.annualMaint ?? seedAnnual;
      events.push({
        key: `home:${home.id}:maint`,
        month: -1,
        cost: annual / 12,
        label: 'Home repairs',
        ownership: true,
      });
      const escrowCoversHousing = h.accounts.some((account) => {
        if (account.type !== 'mortgage') return false;
        if (account.linkedAssetId && account.linkedAssetId !== home.id) return false;
        if (account.escrowCoversHousing === true) return true;
        return account.escrowCoversHousing == null && (account.escrowMonthly ?? 0) > 0;
      });
      const housing: { key: string; amount: number | null | undefined; label: string }[] = [
        { key: 'tax', amount: escrowCoversHousing ? 0 : home.taxMonthly, label: 'Property tax' },
        { key: 'insurance', amount: escrowCoversHousing ? 0 : home.insuranceMonthly, label: 'Home insurance' },
        { key: 'hoa', amount: home.hoaMonthly, label: 'HOA' },
      ];
      for (const line of housing) {
        if (line.amount == null || !(line.amount > 0)) continue;
        const key = `home:${home.id}:${line.key}`;
        if (h.realizedEventKeys.includes(key)) continue;
        events.push({ key, month: -1, cost: line.amount, label: line.label, ownership: true });
      }
    }
  }

  for (const risk of repairRisks(h, bundle, scenario, nowYear)) {
    if (risk.dueMonth != null) {
      events.push({
        key: risk.key,
        month: risk.dueMonth,
        cost: risk.repairCost,
        label: risk.label,
        ownership: true,
      });
    } else {
      events.push({
        key: risk.key,
        month: -1,
        cost: risk.monthlyCost,
        label: risk.label,
        ownership: true,
      });
    }
  }

  if (ownsVehicle(h)) {
    for (const car of h.assets.filter((a) => a.type === 'vehicle')) {
      const cls = vehicleClassOf(car, bundle.vehicle);
      const costs = bundle.vehicle.byClass.find((c) => c.class === cls) ?? bundle.vehicle.byClass[0];
      const age = vehicleAge(car, nowYear);
      const mult = vehicleMaintMultiplier(bundle.vehicle, age, car.mileage ?? null);
      const annual =
        car.costOverrides?.annualMaint ?? pickTriple(costs.annualMaintenance, scenario) * mult;
      if (!h.realizedEventKeys.includes(`vehicle:${car.id}:maint`)) {
        events.push({
          key: `vehicle:${car.id}:maint`,
          month: -1,
          cost: annual / 12,
          label: 'Vehicle maintenance',
          ownership: true,
        });
      }
      const running = vehicleRunningCost(car, bundle, h.fuelPricePerGallon);
      const lines = [
        { key: 'insurance', cost: running.insuranceMonthly, label: running.insuranceEstimated ? 'Vehicle insurance (estimate)' : 'Vehicle insurance' },
        { key: 'registration', cost: running.registrationMonthly, label: running.registrationEstimated ? 'Registration (estimate)' : 'Registration' },
        { key: 'fuel', cost: running.fuelMonthly, label: running.fuelEstimated ? 'Fuel (estimate)' : 'Fuel' },
      ];
      for (const line of lines) {
        if (!(line.cost > 0)) continue;
        const key = `vehicle:${car.id}:${line.key}`;
        if (h.realizedEventKeys.includes(key)) continue;
        events.push({ key, month: -1, cost: line.cost, label: line.label, ownership: true });
      }
    }
  }
  return events;
}

function emptyState(): WalkerState {
  return {
    month: 0,
    cash: 0,
    income: 0,
    living: 0,
    debtPaid: 0,
    ownership: 0,
    houseCost: 0,
    carCost: 0,
    liquid: [],
    investments: [],
    debts: [],
    homes: [],
    vehicles: [],
    other: [],
  };
}

export interface WalkOptions {
  overlayId?: OverlayId;
  shocks?: PathShocks;
  collectWaterfall?: boolean;
  scenarioForEvents?: Scenario;
  /** Defaults to 60. Retire dates and debt payoff walk up to 360. */
  horizonMonths?: number;
  now?: Date;
  /** Record this liquid or investment account, in today’s dollars, one entry per month. */
  watchAccountId?: string;
  /** Debt-free dates route leftover to these loans. */
  focusLoanIds?: string[] | null;
  /**
   * Date searches set this. The hired-month search has to keep pay on, and it
   * must not ask for the hired month again.
   */
  ignoreRetireStop?: boolean;
}

export interface WalkResult {
  months: MonthPoint[];
  waterfall: WaterfallSlice[];
  houseCost5y: number;
  carCost5y: number;
  ownershipCost12m: number;
  ownershipCost5y: number;
  houseValueUsed: number | null;
  houseValueIsEstimate: boolean;
  /** Present when `watchAccountId` is set. Today’s dollars, index 0 is walker month 1. */
  watchedBalances?: number[];
  /** Nominal balances of `focusLoanIds`, index 0 is walker month 1. */
  watchedFocusDebt?: number[];
}

export type RetireStopFn = (
  household: HouseholdInput,
  bundle: SeedBundle,
  scenario: Scenario,
  now: Date,
) => HouseholdInput;

let retireStopFn: RetireStopFn | null = null;

/** Standing registers this. The walker can stop pay without importing standing. */
export function registerRetireStop(fn: RetireStopFn): void {
  retireStopFn = fn;
}

export function walkForecast(
  household: HouseholdInput,
  bundle: SeedBundle,
  scenario: Scenario,
  opts: WalkOptions = {},
): WalkResult {
  if (retireStopFn && household.retireAtHiredDate && !household.incomeEndsAt && !opts.ignoreRetireStop) {
    const stopped = retireStopFn(household, bundle, scenario, opts.now ?? new Date());
    if (stopped.incomeEndsAt) {
      return walkForecast(stopped, bundle, scenario, { ...opts, ignoreRetireStop: true });
    }
  }
  const overlay = opts.overlayId ? overlayEffects(opts.overlayId, bundle) : null;
  const shocks = opts.shocks ?? identityShocks;
  const geo = resolveGeo(bundle.home, household.zip);
  const homeAsset = household.assets.find((a) => a.type === 'home');
  const skipHome = !ownsHouse(household);
  const houseValueIsEstimate = !!homeAsset && homeAsset.value == null && !skipHome;
  const fallbackHome = geo.medianHomeValue;
  const cpiMonthly = monthlyRate(macroParams(bundle.macro).cpiAnnual);
  const now = opts.now ?? new Date();
  const horizon = Math.min(360, Math.max(1, Math.round(opts.horizonMonths ?? WALKER_HORIZON_MONTHS)));

  const rawEvents = plannedEvents(household, bundle, opts.scenarioForEvents ?? scenario);
  const overlaid = applyOverlayToEvents(rawEvents, overlay);
  const events = overlaid.map((e) => {
    const shifted = e.month >= 1 ? shocks.remapEventMonth(e.month) : e.month;
    const month = overlay?.id === 'delayed_replacement' && shifted > horizon ? horizon : shifted;
    return month === e.month ? e : { ...e, month };
  });

  const waterMap = new Map<string, WaterfallSlice>();
  const addWater = (key: string, label: string, amount: number, ownership: boolean) => {
    if (opts.collectWaterfall === false) return;
    const cur = waterMap.get(key);
    if (cur) cur.amount += amount;
    else waterMap.set(key, { key, label, amount, ownership });
  };

  const ctx: DriverContext = {
    household,
    bundle,
    scenario,
    overlayId: opts.overlayId,
    overlay,
    geo,
    events,
    cpiMonthly,
    nowYear: now.getFullYear(),
    now,
    shocks,
    focusLoanIds: opts.focusLoanIds,
    addWater,
  };

  const state = emptyState();
  for (const d of DRIVERS) {
    if (d.applies(household)) d.init(state, ctx);
  }
  if (!hasLiquid(household)) {
    state.cash = 0;
  }

  const months: MonthPoint[] = [];
  const watchedBalances: number[] = [];
  const watchedFocusDebt: number[] = [];
  let houseCost5y = 0;
  let carCost5y = 0;
  let ownershipCost12m = 0;
  let ownershipCost5y = 0;

  for (let m = 1; m <= horizon; m++) {
    state.month = m;
    state.income = 0;
    state.living = 0;
    state.debtPaid = 0;
    state.ownership = 0;
    state.houseCost = 0;
    state.carCost = 0;
    for (const d of DRIVERS) {
      if (d.applies(household)) d.step(state, ctx);
    }
    applyMonthSurplus(state, ctx);

    const infl = Math.pow(1 + cpiMonthly, m);
    if (m <= WALKER_HORIZON_MONTHS) {
      houseCost5y += state.houseCost / infl;
      carCost5y += state.carCost / infl;
      ownershipCost5y += state.ownership / infl;
      if (m <= 12) ownershipCost12m += state.ownership / infl;
    }

    const investments = state.investments.reduce((s, a) => s + a.balance, 0);
    let traditional = 0;
    let roth = 0;
    let brokerage = 0;
    let coveredNominal = 0;
    let basisNominal = 0;
    let openingShort = 0;
    let openingLong = 0;
    for (const account of state.investments) {
      const bucket = bucketOf(account);
      if (bucket === 'roth') roth += account.balance;
      else if (bucket === 'brokerage') brokerage += account.balance;
      else traditional += account.balance;
      if (bucket === 'brokerage' && account.costBasis != null) {
        coveredNominal += account.balance;
        basisNominal += account.costBasis;
        openingShort += account.openingShortGain;
        openingLong += account.openingLongGain;
      }
    }
    const gainSplit = splitUnrealized(coveredNominal - basisNominal, openingShort, openingLong, m);
    const homes = state.homes.reduce((s, a) => s + a.value, 0);
    const vehicles = state.vehicles.reduce((s, a) => s + a.value, 0);
    const other = state.other.reduce((s, a) => s + a.value, 0);
    const debtBal = state.debts.reduce((s, d) => s + d.balance, 0);
    const nominalNetWorth = state.cash + investments + homes + vehicles + other - debtBal;
    months.push({
      month: m,
      netWorth: nominalNetWorth / infl,
      cash: state.cash / infl,
      home: homes / infl,
      vehicles: vehicles / infl,
      investments: investments / infl,
      liabilities: debtBal / infl,
      ownershipCost: state.ownership / infl,
      livingExpenses: state.living / infl,
      income: state.income / infl,
      nominalNetWorth,
      traditional: traditional / infl,
      roth: roth / infl,
      brokerage: brokerage / infl,
      brokerageCovered: coveredNominal / infl,
      brokerageBasis: basisNominal / infl,
      brokerageShortGain: gainSplit.short / infl,
      brokerageLongGain: gainSplit.long / infl,
    });
    if (opts.focusLoanIds?.length) {
      const ids = new Set(opts.focusLoanIds);
      watchedFocusDebt.push(state.debts.filter((debt) => ids.has(debt.id)).reduce((sum, debt) => sum + debt.balance, 0));
    }
    if (opts.watchAccountId) {
      const watched =
        state.liquid.find((account) => account.id === opts.watchAccountId) ??
        state.investments.find((account) => account.id === opts.watchAccountId) ??
        state.debts.find((account) => account.id === opts.watchAccountId);
      watchedBalances.push((watched?.balance ?? 0) / infl);
    }
  }

  return {
    months,
    waterfall: [...waterMap.values()].sort((a, b) => b.amount - a.amount),
    houseCost5y,
    carCost5y,
    ownershipCost12m,
    ownershipCost5y,
    houseValueUsed: skipHome ? null : homeAsset ? (homeAsset.value ?? fallbackHome) : null,
    houseValueIsEstimate,
    ...(opts.watchAccountId ? { watchedBalances } : {}),
    ...(opts.focusLoanIds?.length ? { watchedFocusDebt } : {}),
  };
}

export function driverFields(): string[] {
  return DRIVERS.map((d) => d.field);
}
