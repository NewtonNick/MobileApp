import { plannedEvents, WALKER_HORIZON_MONTHS, walkForecast, identityShocks } from './drivers';
import { clamp, leftoverOf } from './money';
import { monthlyRate } from './rates';
import type { PathShocks } from './drivers';
import { homePathParams, macroParams, pickTriple, resolveGeo } from './lookups';
import type { SeedBundle } from './seed-types';
import type { EventHit, HouseholdInput, MonteCarloFan } from './types';

export type MonteCarloFanExtras = {
  /** Mean of the worst 25% of 12-month cash floors (today’s dollars). */
  cashEs12m: number;
  /** Share of paths with cash below 0 in any month. */
  pCashNegative: number;
  /** Share of paths where cash falls below conservative reserved (leftover claimed). */
  pBillClaimsLeftover: number;
};

export type MonteCarloFanResult = MonteCarloFan & MonteCarloFanExtras;

export function mulberry32(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gaussian(rand: () => number): number {
  const u = Math.max(1e-12, rand());
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function correlated(zJoint: number, rand: () => number, rho = 0.55): number {
  return rho * zJoint + Math.sqrt(Math.max(0, 1 - rho * rho)) * gaussian(rand);
}

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const i = clamp((sorted.length - 1) * q, 0, sorted.length - 1);
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  const t = i - lo;
  return sorted[lo] * (1 - t) + sorted[hi] * t;
}

function reservedFromHits(events: EventHit[]): number {
  return events
    .filter((e) => e.month === -1 || (e.month >= 1 && e.month <= 12))
    .reduce((s, e) => s + (e.month === -1 ? e.cost * 12 : e.cost), 0);
}

function mean(xs: number[]): number {
  if (!xs.length) return 0;
  return xs.reduce((s, n) => s + n, 0) / xs.length;
}

function buildShocks(
  household: HouseholdInput,
  bundle: SeedBundle,
  rand: () => number,
): PathShocks {
  const macro = macroParams(bundle.macro);
  const homeTails = homePathParams(bundle.home);
  const geo = resolveGeo(bundle.home, household.zip);
  const longRun = pickTriple(geo.hpiAnnual, 'realistic');
  const kappa = Math.LN2 / (homeTails.hpiMeanReversionHalfLifeYears * 12);
  const volM = homeTails.hpiVolAnnual / Math.sqrt(12);
  const horizon = WALKER_HORIZON_MONTHS;

  const zJoint: number[] = [0];
  const ownMult: number[] = [1];
  const partnerMult: number[] = [1];
  const livingScale: number[] = [1];
  const jumps: number[] = [0];
  for (let m = 1; m <= horizon; m++) {
    const z = gaussian(rand);
    zJoint.push(z);
    const pLoss =
      (household.monthlyIncome ?? 0) > 0
        ? clamp(macro.jobLossMonthlyChance * Math.exp(-0.7 * z), 0, 0.4)
        : 0;
    const volatility = Math.min(1, Math.max(0, household.incomeVolatility ?? 0));
    const ownShock = volatility > 0 ? clamp(1 + gaussian(rand) * volatility, 0, 2) : 1;
    ownMult.push((rand() < pLoss ? 0 : 1) * ownShock);
    const pPartner =
      (household.partnerMonthlyIncome ?? 0) > 0
        ? clamp(macro.jobLossMonthlyChance * Math.exp(-0.7 * gaussian(rand)), 0, 0.4)
        : 0;
    const partnerShock = volatility > 0 ? clamp(1 + gaussian(rand) * volatility, 0, 2) : 1;
    partnerMult.push((rand() < pPartner ? 0 : 1) * partnerShock);
    jumps.push(rand() < macro.jumpChanceMonthly ? (z < 0 ? macro.crashJump : macro.upJump) : 0);
  }

  let ar = 0;
  const phi = 0.55;
  for (let m = 1; m <= horizon; m++) {
    ar = phi * ar + Math.sqrt(1 - phi * phi) * 0.1 * gaussian(rand);
    livingScale.push(clamp(1 + ar, 0.8, 1.2));
  }

  let muM = monthlyRate(longRun);
  const longM = monthlyRate(longRun);
  const hpiRet: number[] = [0];
  for (let m = 1; m <= horizon; m++) {
    const z = correlated(zJoint[m], rand);
    muM = muM + kappa * (longM - muM);
    hpiRet.push(muM + volM * z);
  }

  return {
    ...identityShocks,
    ownIncomeMultiplier: (month) => ownMult[month] ?? 1,
    partnerIncomeMultiplier: (month) => partnerMult[month] ?? 1,
    livingVariableScale: (month) => livingScale[month] ?? 1,
    hpiMonthlyReturn: (month) => hpiRet[month] ?? longM,
    investmentMonthlyReturn: (month, expectedAnnual) => {
      const vol = macro.equityVolAnnual;
      const sig = vol / Math.sqrt(12);
      const z = correlated(zJoint[month] ?? 0, rand);
      const growth = Math.exp((expectedAnnual - 0.5 * vol * vol) / 12 + sig * z) - 1;
      return growth + (jumps[month] ?? 0);
    },
    liquidMonthlyReturn: (expectedAnnual) => monthlyRate(expectedAnnual),
    remapEventMonth: (month) => {
      const jitter = Math.floor(rand() * 13) - 6;
      return clamp(month + jitter, 1, horizon);
    },
  };
}

export function runMonteCarloFan(
  household: HouseholdInput,
  bundle: SeedBundle,
  paths = 400,
  seed = 42,
): MonteCarloFanResult {
  const rand = mulberry32(seed);
  const netSeries: number[][] = [];
  const cashSeries: number[][] = [];
  const reserved = reservedFromHits(plannedEvents(household, bundle, 'conservative'));

  for (let p = 0; p < paths; p++) {
    const shocks = buildShocks(household, bundle, rand);
    const walked = walkForecast(household, bundle, 'realistic', {
      shocks,
      collectWaterfall: false,
    });
    netSeries.push(walked.months.map((m) => m.netWorth));
    cashSeries.push(walked.months.map((m) => m.cash));
  }

  if (!netSeries.length || !netSeries[0]?.length) {
    return {
      months: [],
      liberal: [],
      realistic: [],
      conservative: [],
      cashEs12m: 0,
      pCashNegative: 0,
      pBillClaimsLeftover: 0,
    };
  }

  const months = netSeries[0].map((_, i) => i + 1);
  const liberal: number[] = [];
  const realistic: number[] = [];
  const conservative: number[] = [];
  for (let i = 0; i < months.length; i++) {
    const col = netSeries.map((s) => s[i]).sort((a, b) => a - b);
    liberal.push(quantile(col, 0.75));
    realistic.push(quantile(col, 0.5));
    conservative.push(quantile(col, 0.25));
  }

  const floors12 = cashSeries.map((c) => Math.min(...c.slice(0, 12)));
  const sortedFloors = [...floors12].sort((a, b) => a - b);
  const tailN = Math.max(1, Math.floor(sortedFloors.length * 0.25));
  const cashEs12m = mean(sortedFloors.slice(0, tailN));
  const pCashNegative = cashSeries.filter((c) => c.some((v) => v < 0)).length / Math.max(1, paths);
  const pBillClaimsLeftover =
    cashSeries.filter((c) => c.some((v) => leftoverOf(v, reserved) === 0 && reserved > 0)).length /
    Math.max(1, paths);

  return { months, liberal, realistic, conservative, cashEs12m, pCashNegative, pBillClaimsLeftover };
}
