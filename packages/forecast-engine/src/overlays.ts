import { leftoverOf } from './money';
import { hasHouse, hasVehicle } from './ownership';
import { homePathParams, macroParams } from './lookups';
import type { SeedBundle } from './seed-types';
import type { AccountInput, EventHit, ForecastResult, HouseholdInput, PercentileTriple, Scenario } from './types';
import { isInvestment, isLiability } from './types';

export const OVERLAY_IDS = [
  'paycheck_gap',
  'raise',
  'rate_spike',
  'hpi_crash',
  'hpi_boom',
  'clustered_repairs',
  'delayed_replacement',
  'expense_shock',
  'lean_spend',
  'market_run',
] as const;

export type OverlayId = (typeof OVERLAY_IDS)[number];

export type OverlaySign = 'adverse' | 'upside';

export interface OverlaySpec {
  id: OverlayId;
  sign: OverlaySign;
  label: string;
  appliesIf: (household: HouseholdInput) => boolean;
}

export interface OverlayEffects {
  id: OverlayId;
  zeroOwnIncomeThroughMonth?: number;
  raiseOwnIncomeAfterMonth?: number;
  raiseOwnIncomeFactor?: number;
  forceConservativeApr?: boolean;
  hpiAnnual?: PercentileTriple;
  clusterDiscreteMonths?: [number, number];
  delayDiscreteMonths?: number;
  variableScenarioThroughMonth?: { scenario: Scenario; throughMonth: number };
  forceInvestmentScenario?: Scenario;
}

export function hasHouseDriver(h: HouseholdInput): boolean {
  return hasHouse(h);
}

export function hasVehicleDriver(h: HouseholdInput): boolean {
  return hasVehicle(h);
}

function hasOwnIncome(h: HouseholdInput): boolean {
  return (h.monthlyIncome ?? 0) > 0;
}

function hasUnknownApr(h: HouseholdInput): boolean {
  return h.accounts.some((a: AccountInput) => isLiability(a.type) && a.balance > 0 && a.apr == null);
}

function hasVariableExpense(h: HouseholdInput): boolean {
  return h.expenses.some((e) => e.variable && (e.monthlyAmount ?? 0) > 0 && !e.linkedLiabilityId);
}

function hasInvestments(h: HouseholdInput): boolean {
  return h.accounts.some((a) => isInvestment(a.type) && a.balance !== 0);
}

export const OVERLAY_CATALOG: OverlaySpec[] = [
  {
    id: 'paycheck_gap',
    sign: 'adverse',
    label: 'Paycheck gap',
    appliesIf: hasOwnIncome,
  },
  {
    id: 'raise',
    sign: 'upside',
    label: 'Raise',
    appliesIf: hasOwnIncome,
  },
  {
    id: 'rate_spike',
    sign: 'adverse',
    label: 'Rate spike',
    appliesIf: hasUnknownApr,
  },
  {
    id: 'hpi_crash',
    sign: 'adverse',
    label: 'Home-price crash',
    appliesIf: hasHouseDriver,
  },
  {
    id: 'hpi_boom',
    sign: 'upside',
    label: 'Home-price boom',
    appliesIf: hasHouseDriver,
  },
  {
    id: 'clustered_repairs',
    sign: 'adverse',
    label: 'Clustered repairs',
    appliesIf: hasHouseDriver,
  },
  {
    id: 'delayed_replacement',
    sign: 'upside',
    label: 'Delayed replacement',
    appliesIf: hasHouseDriver,
  },
  {
    id: 'expense_shock',
    sign: 'adverse',
    label: 'Expense shock',
    appliesIf: hasVariableExpense,
  },
  {
    id: 'lean_spend',
    sign: 'upside',
    label: 'Lean spend',
    appliesIf: hasVariableExpense,
  },
  {
    id: 'market_run',
    sign: 'upside',
    label: 'Market run',
    appliesIf: hasInvestments,
  },
];

export function availableOverlays(household: HouseholdInput): OverlaySpec[] {
  return OVERLAY_CATALOG.filter((o) => o.appliesIf(household));
}

export function overlayEffects(id: OverlayId, bundle: SeedBundle): OverlayEffects {
  const tails = homePathParams(bundle.home);
  const macro = macroParams(bundle.macro);
  switch (id) {
    case 'paycheck_gap':
      return { id, zeroOwnIncomeThroughMonth: 6 };
    case 'raise':
      return { id, raiseOwnIncomeAfterMonth: 6, raiseOwnIncomeFactor: 1 + macro.raisePct };
    case 'rate_spike':
      return { id, forceConservativeApr: true };
    case 'hpi_crash':
      return { id, hpiAnnual: tails.hpiCrashAnnual };
    case 'hpi_boom':
      return { id, hpiAnnual: tails.hpiBoomAnnual };
    case 'clustered_repairs':
      return { id, clusterDiscreteMonths: [3, 6] };
    case 'delayed_replacement':
      return { id, delayDiscreteMonths: 60 };
    case 'expense_shock':
      return { id, variableScenarioThroughMonth: { scenario: 'conservative', throughMonth: 12 } };
    case 'lean_spend':
      return { id, variableScenarioThroughMonth: { scenario: 'liberal', throughMonth: 12 } };
    case 'market_run':
      return { id, forceInvestmentScenario: 'liberal' };
  }
}

export function applyOverlayToEvents(events: EventHit[], overlay: OverlayEffects | null | undefined): EventHit[] {
  if (!overlay) return events;
  if (overlay.clusterDiscreteMonths) {
    const [m1, m2] = overlay.clusterDiscreteMonths;
    const discrete = events.filter((e) => e.month >= 1).sort((a, b) => a.month - b.month || b.cost - a.cost);
    const recurring = events.filter((e) => e.month < 1);
    const first = discrete.slice(0, 2).map((e, i) => ({ ...e, month: i === 0 ? m1 : m2 }));
    const rest = discrete.slice(2);
    return [...recurring, ...first, ...rest];
  }
  if (overlay.delayDiscreteMonths) {
    const shift = overlay.delayDiscreteMonths;
    return events.map((e) => (e.month >= 1 ? { ...e, month: e.month + shift } : e));
  }
  return events;
}

export function cashFloor(forecast: ForecastResult): number {
  if (!forecast.months.length) return 0;
  return forecast.months.reduce((min, p) => Math.min(min, p.cash), forecast.months[0].cash);
}

export function leftoverAtMonth(forecast: ForecastResult, month: number, reserved: number): number {
  const pt = forecast.months.find((m) => m.month === month) ?? forecast.months[month - 1];
  if (!pt) return leftoverOf(forecast.liquidNow, reserved);
  return leftoverOf(pt.cash, reserved);
}
