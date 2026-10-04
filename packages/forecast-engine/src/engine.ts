import { cashLastEdited, completenessScore, confidenceChip, isCashStale, nextBestQuestion } from './completeness';
import { formatUsd } from './money';
import { assetsInNetWorth } from './ownership';
import { expenseCountsInLiving } from './expenses';
import { typicalMonthlyIncome } from './cadence';
import { plannedEvents, walkForecast } from './drivers';
import { resolveGeo, seedIsStale, seedSources, scenarioInvestmentReturn } from './lookups';
import type { OverlayId } from './overlays';
import type { SeedBundle } from './seed-types';
import type {
  EventHit,
  ForecastResult,
  HouseholdInput,
  Scenario,
} from './types';
import { isInvestment, isLiability, isLiquid } from './types';
import { rateSecurity, repairRisks, type SecurityRating } from './risk';

export const FORECAST_HORIZON_MONTHS = 60;

export { plannedEvents } from './drivers';
export { runMonteCarloFan } from './montecarlo';
export type { MonteCarloFanExtras, MonteCarloFanResult } from './montecarlo';

export { formatUsd };

export function liquidSum(h: HouseholdInput): number {
  return h.accounts.filter((a) => isLiquid(a.type)).reduce((s, a) => s + a.balance, 0);
}

/**
 * Set the household's liquid total without stamping that number onto every
 * checking, savings, and cash row. One liquid account is replaced. Several
 * keep their shares; a zero total lands on the first account.
 */
export function applyLiquidTotal(
  household: HouseholdInput,
  total: number,
  now = new Date().toISOString(),
): HouseholdInput {
  if (!Number.isFinite(total)) return household;
  const liquids = household.accounts.filter((a) => isLiquid(a.type));
  if (!liquids.length) {
    return {
      ...household,
      accounts: [
        ...household.accounts,
        {
          id: 'cash-1',
          type: 'cash' as const,
          name: 'Cash and savings',
          balance: total,
          lastEditedAt: now,
        },
      ],
    };
  }
  const nextBalances = new Map<string, number>();
  const sum = liquids.reduce((s, a) => s + a.balance, 0);
  if (liquids.length === 1 || sum === 0) {
    nextBalances.set(liquids[0].id, total);
    for (const a of liquids.slice(1)) nextBalances.set(a.id, a.balance);
  } else {
    let remaining = total;
    liquids.forEach((a, i) => {
      if (i === liquids.length - 1) {
        nextBalances.set(a.id, remaining);
        return;
      }
      const share = (a.balance / sum) * total;
      remaining -= share;
      nextBalances.set(a.id, share);
    });
  }
  return {
    ...household,
    accounts: household.accounts.map((a) => {
      const balance = nextBalances.get(a.id);
      return balance == null ? a : { ...a, balance, lastEditedAt: now };
    }),
  };
}

export function investmentSum(h: HouseholdInput): number {
  return h.accounts.filter((a) => isInvestment(a.type)).reduce((s, a) => s + a.balance, 0);
}

function liabilitySum(h: HouseholdInput): number {
  return h.accounts.filter((a) => isLiability(a.type)).reduce((s, a) => s + a.balance, 0);
}

function assetSum(h: HouseholdInput, type: 'home' | 'vehicle' | 'other', fallbackHome: number): number {
  return assetsInNetWorth(h, type).reduce((s, a) => s + (a.value ?? (type === 'home' ? fallbackHome : 0)), 0);
}

export function expenseMonth(h: HouseholdInput, scenario: Scenario, month = 1): number {
  let sum = 0;
  for (const e of h.expenses) {
    if (!expenseCountsInLiving(e, month, h) || e.monthlyAmount == null) continue;
    let amt = e.monthlyAmount;
    if (e.variable) {
      if (scenario === 'liberal') amt *= 0.8;
      if (scenario === 'conservative') amt *= 1.2;
    }
    sum += amt;
  }
  return sum;
}

export function liabilityPaymentMonth(h: HouseholdInput): number {
  return h.accounts
    .filter((a) => isLiability(a.type) && a.balance > 0.5)
    .reduce((s, a) => s + (a.minPayment ?? 0), 0);
}

export function investmentReturn(h: HouseholdInput, scenario: Scenario): number {
  const inv = h.accounts.filter((a) => isInvestment(a.type));
  if (!inv.length) return 0;
  const weighted = inv.reduce((s, a) => s + a.balance * (a.expectedReturn ?? 0.07), 0);
  const total = inv.reduce((s, a) => s + a.balance, 0);
  const r = total > 0 ? weighted / total : 0.07;
  return scenarioInvestmentReturn(r, scenario);
}

export function netWorthNow(h: HouseholdInput, fallbackHome: number): {
  net: number;
  liquid: number;
  illiquid: number;
} {
  const liquid = liquidSum(h);
  const investments = investmentSum(h);
  const homes = assetSum(h, 'home', fallbackHome);
  const vehicles = assetSum(h, 'vehicle', 0);
  const other = assetSum(h, 'other', 0);
  const debt = liabilitySum(h);
  const net = liquid + investments + homes + vehicles + other - debt;
  return { net, liquid, illiquid: net - liquid };
}

/** Conservative 12-month ownership shocks. Recurring maint is annualized. Live only. */
export function reservedFromHits(events: EventHit[]): number {
  const near = events
    .filter((e) => e.month === -1 || (e.month >= 1 && e.month <= 12))
    .reduce((s, e) => s + (e.month === -1 ? e.cost * 12 : e.cost), 0);
  const sinking = events
    .filter((e) => e.month > 12)
    .reduce((s, e) => s + Math.min(e.cost, (e.cost / e.month) * 12), 0);
  return near + sinking;
}

/** Recurring ownership only — not one-shot replacements. Used for work-optional need. */
export function recurringOwnershipAnnual(events: EventHit[]): number {
  return events.filter((e) => e.month === -1).reduce((s, e) => s + e.cost * 12, 0);
}

export function runForecast(
  household: HouseholdInput,
  bundle: SeedBundle,
  scenario: Scenario,
  overlayId?: OverlayId,
  now: Date = new Date(),
): ForecastResult {
  const geo = resolveGeo(bundle.home, household.zip);
  const homeAsset = household.assets.find((a) => a.type === 'home');
  const skipHome = household.housingTenure === 'rent' || household.housingTenure === 'none';
  const houseValueIsEstimate = !!homeAsset && homeAsset.value == null && !skipHome;
  const fallbackHome = geo.medianHomeValue;
  const snapshot = netWorthNow(household, fallbackHome);

  const walked = walkForecast(household, bundle, scenario, { overlayId, now });

  const conservativeShocks = reservedFromHits(plannedEvents(household, bundle, 'conservative'));
  const realisticExp = expenseMonth(household, 'realistic') + liabilityPaymentMonth(household);
  const liberalExp = expenseMonth(household, 'liberal') + liabilityPaymentMonth(household);
  const conservativeExp = expenseMonth(household, 'conservative') + liabilityPaymentMonth(household);
  const emergencyFundRecommended = Math.max(3 * conservativeExp, conservativeShocks);
  const emergencyFundTargets = {
    liberal: Math.max(3 * liberalExp, reservedFromHits(plannedEvents(household, bundle, 'liberal'))),
    realistic: Math.max(3 * realisticExp, reservedFromHits(plannedEvents(household, bundle, 'realistic'))),
    conservative: Math.max(3 * conservativeExp, conservativeShocks),
  };

  const sources = seedSources(bundle);
  if (geo.fallback) {
    sources.unshift({
      source: 'FHFA HPI national fallback',
      vintage: bundle.home.vintage,
      model: bundle.home.model,
      note: geo.geoLabel,
    });
  }

  return {
    scenario,
    netWorthNow: snapshot.net,
    liquidNow: snapshot.liquid,
    illiquidNow: snapshot.illiquid,
    houseCost5y: walked.houseCost5y,
    carCost5y: walked.carCost5y,
    ownershipCost12m: walked.ownershipCost12m,
    ownershipCost5y: walked.ownershipCost5y,
    emergencyFundRecommended,
    emergencyFundTargets,
    emergencyGap: Math.max(0, emergencyFundRecommended - snapshot.liquid),
    cashCoversConservative: snapshot.liquid >= conservativeShocks,
    months: walked.months,
    waterfall: walked.waterfall,
    completeness: completenessScore(household),
    nextQuestion: nextBestQuestion(household),
    confidenceChip: confidenceChip(household),
    sources,
    houseValueUsed: skipHome ? null : homeAsset ? (homeAsset.value ?? fallbackHome) : walked.houseValueUsed,
    houseValueIsEstimate,
    staleCash: isCashStale(household, now.getTime()),
    cashLastEditedAt: cashLastEdited(household),
  };
}

export function runAllScenarios(household: HouseholdInput, bundle: SeedBundle, now: Date = new Date()) {
  return {
    liberal: runForecast(household, bundle, 'liberal', undefined, now),
    realistic: runForecast(household, bundle, 'realistic', undefined, now),
    conservative: runForecast(household, bundle, 'conservative', undefined, now),
    seedStale: seedIsStale(bundle, now),
  };
}

/** Realistic world plus this signed overlay. Lives here so overlays.ts does not import engine. */
export function runOverlay(household: HouseholdInput, bundle: SeedBundle, overlayId: OverlayId): ForecastResult {
  return runForecast(household, bundle, 'realistic', overlayId);
}

/** Chance-weighted repairs against cash on hand and monthly leftover. */
export function assessSecurity(household: HouseholdInput, bundle: SeedBundle, scenario: Scenario): SecurityRating {
  const risks = repairRisks(household, bundle, scenario);
  const events = plannedEvents(household, bundle, scenario);
  const riskKeys = new Set(risks.map((risk) => risk.key));
  const routineMonthly = events
    .filter((event) => event.month === -1 && !riskKeys.has(event.key))
    .reduce((sum, event) => sum + event.cost, 0);
  const repairMonthly = risks.reduce((sum, risk) => sum + risk.monthlyCost, 0);
  return rateSecurity({
    risks,
    monthlyIncome: typicalMonthlyIncome(household),
    monthlyBills:
      expenseMonth(household, scenario) + liabilityPaymentMonth(household) + routineMonthly + repairMonthly,
    emergencyFund: liquidSum(household),
  });
}

