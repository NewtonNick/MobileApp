import { pickTriple, vehicleAge } from './lookups';
import type { SeedBundle } from './seed-types';
import type { AssetInput, HouseholdInput, Scenario } from './types';

/** Wear-out curve. Higher means failures cluster near the useful life. */
const WEIBULL_SHAPE = 3;
/** Never quote a repair as certain. The old heuristic billed the full job next month. */
const PROBABILITY_CAP = 0.8;
const HORIZON_YEARS = 5;
const HORIZON_MONTHS = HORIZON_YEARS * 12;
/** Unknown system year: mid-life, not "original to a 100-year house." */
const ASSUMED_LIFE_FRACTION = 0.45;
const ANNUAL_MILES = 12_000;

export interface VehicleMajorRepair {
  key: string;
  label: string;
  lifeYears: number;
  lifeMiles: number;
  cost: { liberal: number; realistic: number; conservative: number };
}

/** One named job. Routine maintenance stays a separate monthly line. */
export const VEHICLE_MAJOR_REPAIRS: VehicleMajorRepair[] = [
  {
    key: 'transmission',
    label: 'Transmission replacement',
    lifeYears: 15,
    lifeMiles: 150_000,
    cost: { liberal: 2800, realistic: 4500, conservative: 7000 },
  },
];

export interface RepairRisk {
  key: string;
  label: string;
  /** Chance the job happens within 5 years. Capped below 1. */
  likelihood5y: number;
  /** Dollars if the repair actually happens. */
  repairCost: number;
  /** Chance-weighted cost spread over 60 months. This is what the forecast reserves. */
  monthlyCost: number;
  /** True when we do not have an install year or odometer and used a typical age. */
  assumed: boolean;
  /**
   * Known future replacement, in forecast months. Null keeps the chance-weighted monthly cost.
   * Overdue jobs stay null so we do not bill the full repair next month.
   */
  dueMonth: number | null;
}

export type SecurityBand = 'secure' | 'stable' | 'exposed' | 'fragile';

export interface SecurityRating {
  score: number;
  band: SecurityBand;
  title: string;
  summary: string;
  monthlySurplus: number;
  emergencyFund: number;
  largestRepair: number;
  expectedMonthly: number;
  risks: RepairRisk[];
}

/**
 * Conditional chance of failure during the next `horizon` units, given survival to `age`.
 * Units are years or miles, as long as `life` and `horizon` match.
 */
export function failureChance(age: number, life: number, horizon: number, shape = WEIBULL_SHAPE): number {
  if (!(life > 0) || !(horizon > 0)) return 0;
  const survived = Math.max(0, age);
  const reliability = (t: number) => Math.exp(-Math.pow(Math.max(0, t) / life, shape));
  const now = reliability(survived);
  if (now <= 1e-9) return PROBABILITY_CAP;
  const raw = 1 - reliability(survived + horizon) / now;
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.min(PROBABILITY_CAP, raw);
}

function systemAge(installYear: number | null | undefined, lifeYears: number, nowYear: number): { age: number; assumed: boolean } {
  if (installYear == null || !Number.isFinite(installYear) || installYear < 1900 || installYear > nowYear + 1) {
    return { age: lifeYears * ASSUMED_LIFE_FRACTION, assumed: true };
  }
  return { age: Math.max(0, nowYear - installYear), assumed: false };
}

/** Months until a known install reaches useful life. Overdue and unknown years return null. */
export function knownReplacementMonth(
  installYear: number | null | undefined,
  lifeYears: number,
  nowYear: number,
): number | null {
  if (installYear == null || !Number.isFinite(installYear) || installYear < 1900 || installYear > nowYear + 1) {
    return null;
  }
  const months = (installYear + lifeYears - nowYear) * 12;
  if (months < 1) return null;
  return months;
}

function monthlyFrom(likelihood5y: number, repairCost: number): number {
  if (!(repairCost > 0) || !(likelihood5y > 0)) return 0;
  return (likelihood5y * repairCost) / HORIZON_MONTHS;
}

function houseInScope(h: HouseholdInput): boolean {
  if (h.housingTenure === 'rent' || h.housingTenure === 'none') return false;
  return h.assets.some((a) => a.type === 'home');
}

function carInScope(h: HouseholdInput): boolean {
  if (h.hasVehicle === false) return false;
  return h.assets.some((a) => a.type === 'vehicle');
}

function homeInstallYear(home: AssetInput, key: string): number | null | undefined {
  if (key === 'roof') return home.roofYear;
  if (key === 'hvac') return home.hvacYear;
  if (key === 'water_heater') return home.waterHeaterYear;
  return null;
}

function pushRisk(out: RepairRisk[], risk: RepairRisk) {
  if (risk.repairCost <= 0 || risk.likelihood5y <= 0) return;
  out.push(risk);
}

export function repairRisks(
  household: HouseholdInput,
  bundle: SeedBundle,
  scenario: Scenario,
  nowYear = new Date().getFullYear(),
): RepairRisk[] {
  const risks: RepairRisk[] = [];

  if (houseInScope(household)) {
    for (const home of household.assets.filter((a) => a.type === 'home')) {
      if (household.realizedEventKeys.includes(`home:${home.id}:repair`)) continue;
      for (const sys of bundle.home.systems) {
        if (home.exteriorResponsibility === 'hoa' && (sys.key === 'roof' || sys.key === 'exterior')) continue;
        const key = `home:${home.id}:${sys.key}`;
        if (household.realizedEventKeys.includes(key)) continue;
        const install = homeInstallYear(home, sys.key);
        const { age, assumed } = systemAge(install, sys.usefulLifeYears, nowYear);
        const likelihood5y = failureChance(age, sys.usefulLifeYears, HORIZON_YEARS);
        const repairCost = home.costOverrides?.[sys.key] ?? pickTriple(sys.replacement, scenario);
        pushRisk(risks, {
          key,
          label: sys.label,
          likelihood5y,
          repairCost,
          monthlyCost: monthlyFrom(likelihood5y, repairCost),
          assumed,
          dueMonth: knownReplacementMonth(install, sys.usefulLifeYears, nowYear),
        });
      }
    }
  }

  if (carInScope(household)) {
    for (const car of household.assets.filter((a) => a.type === 'vehicle')) {
      const ageYears = vehicleAge(car, nowYear);
      const miles = car.mileage ?? null;
      for (const job of VEHICLE_MAJOR_REPAIRS) {
        const key = `vehicle:${car.id}:${job.key}`;
        if (household.realizedEventKeys.includes(key)) continue;
        const byAge = ageYears == null ? null : failureChance(ageYears, job.lifeYears, HORIZON_YEARS);
        const byMiles = miles == null ? null : failureChance(miles, job.lifeMiles, ANNUAL_MILES * HORIZON_YEARS);
        const assumed = byAge == null && byMiles == null;
        const likelihood5y = assumed
          ? failureChance(job.lifeYears * ASSUMED_LIFE_FRACTION, job.lifeYears, HORIZON_YEARS)
          : Math.max(byAge ?? 0, byMiles ?? 0);
        const repairCost = car.costOverrides?.[job.key] ?? pickTriple(job.cost, scenario);
        const name = car.name?.trim();
        pushRisk(risks, {
          key,
          label: name ? `${name} · ${job.label}` : job.label,
          likelihood5y,
          repairCost,
          monthlyCost: monthlyFrom(likelihood5y, repairCost),
          assumed,
          dueMonth: null,
        });
      }
    }
  }

  return risks.sort((a, b) => b.likelihood5y * b.repairCost - a.likelihood5y * a.repairCost);
}

function bandFor(score: number): { band: SecurityBand; title: string } {
  if (score >= 80) return { band: 'secure', title: 'Secure' };
  if (score >= 60) return { band: 'stable', title: 'Stable' };
  if (score >= 40) return { band: 'exposed', title: 'Exposed' };
  return { band: 'fragile', title: 'Fragile' };
}

export function rateSecurity(input: {
  risks: RepairRisk[];
  monthlyIncome: number;
  /** Living, debt payments, routine upkeep, and chance-weighted repairs. */
  monthlyBills: number;
  emergencyFund: number;
}): SecurityRating {
  const risks = input.risks;
  const emergencyFund = Math.max(0, input.emergencyFund);
  const expectedMonthly = risks.reduce((sum, risk) => sum + risk.monthlyCost, 0);
  const largestRepair = risks.reduce((max, risk) => Math.max(max, risk.repairCost), 0);
  const monthlySurplus = input.monthlyIncome - input.monthlyBills;
  const billsForRunway = Math.max(0, input.monthlyBills);
  const runwayMonths = billsForRunway > 0 ? emergencyFund / billsForRunway : emergencyFund > 0 ? 6 : 0;

  const shockCover = largestRepair > 0 ? Math.min(emergencyFund / largestRepair, 1.25) / 1.25 : 1;
  const runwayScore = Math.min(Math.max(runwayMonths, 0), 6) / 6;
  // monthlyBills already includes chance-weighted repairs, so leftover after bills is not asked to cover them again.
  const flowScore = monthlySurplus >= 0 ? 1 : monthlySurplus + expectedMonthly >= 0 ? 0.5 : 0;
  const score = Math.round(Math.min(100, shockCover * 50 + runwayScore * 30 + flowScore * 20));
  const { band, title } = bandFor(score);

  const top = risks[0];
  const sentences: string[] = [];
  if (top) {
    const pct = Math.round(top.likelihood5y * 100);
    sentences.push(
      `${top.label}: ${pct}% chance in 5 years, ${dollar(top.repairCost)} if it happens, about ${dollar(top.monthlyCost)} a month.`,
    );
  } else {
    sentences.push('No house or car repair is on this plan.');
  }
  if (largestRepair > 0 && emergencyFund >= largestRepair) {
    sentences.push(`Cash on hand covers the largest repair (${dollar(largestRepair)}).`);
  } else if (largestRepair > 0) {
    sentences.push(`Cash on hand is ${dollar(emergencyFund)}, short of the ${dollar(largestRepair)} repair.`);
  }
  if (monthlySurplus >= 0) {
    sentences.push(`Monthly leftover after bills and these chance-weighted costs is about ${dollar(monthlySurplus)}.`);
  } else {
    sentences.push(
      `Monthly cash flow is short about ${dollar(Math.abs(monthlySurplus))} after bills and these chance-weighted costs.`,
    );
  }

  return {
    score,
    band,
    title,
    summary: sentences.join(' '),
    monthlySurplus,
    emergencyFund,
    largestRepair,
    expectedMonthly,
    risks,
  };
}

function dollar(n: number): string {
  const sign = n < 0 ? '-' : '';
  return `${sign}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
}
