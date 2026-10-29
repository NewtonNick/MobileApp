import type { HomeSeed, SeedBundle, VehicleCatalogRow, VehicleSeed } from './seed-types';
import type { AssetInput, PercentileTriple, Scenario, SourceRef, VehicleClass } from './types';
import { parseYear } from './validate';

export function pickTriple(t: PercentileTriple, scenario: Scenario): number {
  return t[scenario];
}

/**
 * Routine upkeep does not scale with coastal prices. A roof is not 2% of a $1.3M house.
 * Major jobs are chance-weighted separately.
 */
export const HOME_MAINT_VALUE_CAP = 400_000;

export function homeMaintBasis(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(value, HOME_MAINT_VALUE_CAP);
}

/** AHS maint is quoted for a typical ~2,000 sqft house. Unknown sqft → 1. */
export function homeMaintSqftScale(sqft: number | null | undefined): number {
  if (sqft == null || !Number.isFinite(sqft) || sqft <= 0) return 1;
  return Math.min(1.8, Math.max(0.6, sqft / 2000));
}

/** Liberal +2pp cap 12%; conservative −2pp floor 0%. */
export function scenarioInvestmentReturn(baseAnnual: number, scenario: Scenario): number {
  if (scenario === 'liberal') return Math.min(0.12, baseAnnual + 0.02);
  if (scenario === 'conservative') return Math.max(0, baseAnnual - 0.02);
  return baseAnnual;
}

/** Other assets have no return field. Conservative flat; liberal full CPI; realistic half. */
export function otherAssetCpiScale(scenario: Scenario): number {
  if (scenario === 'liberal') return 1;
  if (scenario === 'realistic') return 0.5;
  return 0;
}

export function macroParams(macro: SeedBundle['macro'] | MacroSeedLike) {
  return {
    cpiAnnual: macro.cpiAnnual,
    usedVehicleCpiAnnual: 'usedVehicleCpiAnnual' in macro ? macro.usedVehicleCpiAnnual : 0,
    equityVolAnnual: macro.equityVolAnnual ?? 0.16,
    bondVolAnnual: macro.bondVolAnnual ?? 0.06,
    crashJump: macro.crashJump ?? -0.2,
    upJump: macro.upJump ?? 0.12,
    jumpChanceMonthly: macro.jumpChanceMonthly ?? 0.015,
    jobLossMonthlyChance: macro.jobLossMonthlyChance ?? 0.004,
    raisePct: macro.raisePct ?? 0.1,
    cpiVolAnnual: macro.cpiVolAnnual ?? 0.01,
  };
}

export function homePathParams(home: SeedBundle['home'] | HomePathLike) {
  return {
    hpiCrashAnnual: home.hpiCrashAnnual ?? { liberal: -0.05, realistic: -0.12, conservative: -0.2 },
    hpiBoomAnnual: home.hpiBoomAnnual ?? { liberal: 0.12, realistic: 0.08, conservative: 0.04 },
    hpiMeanReversionHalfLifeYears: home.hpiMeanReversionHalfLifeYears ?? 8,
    hpiVolAnnual: home.hpiVolAnnual ?? 0.06,
  };
}

type MacroSeedLike = {
  cpiAnnual: number;
  usedVehicleCpiAnnual?: number;
  equityVolAnnual?: number;
  bondVolAnnual?: number;
  crashJump?: number;
  upJump?: number;
  jumpChanceMonthly?: number;
  jobLossMonthlyChance?: number;
  raisePct?: number;
  cpiVolAnnual?: number;
};

type HomePathLike = {
  hpiCrashAnnual?: PercentileTriple;
  hpiBoomAnnual?: PercentileTriple;
  hpiMeanReversionHalfLifeYears?: number;
  hpiVolAnnual?: number;
};

export function zipPrefix(zip: string): string {
  return (zip || '').replace(/\D/g, '').slice(0, 3);
}

export function isUsZip(zip: string): boolean {
  return /^\d{5}$/.test((zip || '').trim());
}

export function resolveGeo(seed: HomeSeed, zip: string) {
  const prefix = zipPrefix(zip);
  const match = seed.zipRegions.find((z) => z.prefix === prefix);
  if (match) {
    return {
      region: match.region,
      hpiAnnual: match.hpiAnnual,
      medianHomeValue: match.medianHomeValue,
      geoLabel: `ZIP ${zip} · ${match.region}`,
      fallback: false,
    };
  }
  return {
    region: seed.national.region,
    hpiAnnual: seed.national.hpiAnnual,
    medianHomeValue: seed.national.medianHomeValue,
    geoLabel: isUsZip(zip) ? `Metro unknown · ${seed.national.region}` : `National USD · ${seed.national.region}`,
    fallback: true,
  };
}

export function homeAge(asset: AssetInput, nowYear = new Date().getFullYear()): number | null {
  if (!asset.yearBuilt) return null;
  return Math.max(0, nowYear - asset.yearBuilt);
}

export function annualHomeMaintPct(seed: HomeSeed, age: number | null): PercentileTriple {
  if (age == null) {
    return seed.fiveYearRepairPctOfValue;
  }
  const bucket = seed.ageBuckets.find((b) => age >= b.minAge && age <= b.maxAge);
  return bucket?.annualMaintPctOfValue ?? seed.fiveYearRepairPctOfValue;
}

export function systemDueMonths(
  installYear: number | null,
  usefulLife: number,
  nowYear = new Date().getFullYear(),
): number | null {
  if (installYear == null) return null;
  const remaining = usefulLife - (nowYear - installYear);
  if (remaining < 0) return null;
  return Math.round(remaining * 12);
}

export function vehicleAge(asset: AssetInput, nowYear = new Date().getFullYear()): number | null {
  if (!asset.vehicleYear) return null;
  return Math.max(0, nowYear - asset.vehicleYear);
}

export function vehicleClassOf(asset: AssetInput, seed: VehicleSeed): VehicleClass {
  if (asset.vehicleClass) return asset.vehicleClass;
  if (asset.make && asset.model && asset.vehicleYear) {
    const row = seed.catalog.find(
      (c) =>
        c.year === asset.vehicleYear &&
        c.make.toLowerCase() === asset.make!.toLowerCase() &&
        c.model.toLowerCase() === asset.model!.toLowerCase(),
    );
    if (row) return row.class;
  }
  return 'car';
}

export function vehicleMaintMultiplier(seed: VehicleSeed, age: number | null, miles: number | null): number {
  let m = 1;
  if (age != null) {
    const row = seed.ageMultipliers.find((a) => age >= a.minAge && age <= a.maxAge);
    if (row) m *= row.multiplier;
  }
  if (miles != null) {
    const row = seed.mileageMultipliers.find((a) => miles >= a.minMiles && miles <= a.maxMiles);
    if (row) m *= row.multiplier;
  }
  if (age == null) m *= 1.15;
  if (miles == null) m *= 1.1;
  return Math.min(m, 1.75);
}

function vehicleLabel(row: VehicleCatalogRow): string {
  return `${row.year} ${row.make} ${row.model}`.toLowerCase();
}

/** An empty box matches nothing, so the form does not list a default make. */
export function searchVehicles(seed: VehicleSeed, query: string, limit = 12) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const parts = q.split(/\s+/).filter(Boolean);
  const years = parts.filter((part) => /^\d{4}$/.test(part)).map((part) => Number(part));
  const hits = seed.catalog.filter((row) => {
    const hay = vehicleLabel(row);
    return parts.every((part) => hay.includes(part));
  });
  hits.sort((a, b) => {
    const aExact = years.includes(a.year) ? 0 : 1;
    const bExact = years.includes(b.year) ? 0 : 1;
    if (aExact !== bExact) return aExact - bExact;
    if (a.year !== b.year) return b.year - a.year;
    const make = a.make.localeCompare(b.make);
    if (make !== 0) return make;
    return a.model.localeCompare(b.model);
  });
  return hits.slice(0, limit);
}

/** The typed string is one catalog row, or it equals that row's year, make, and model. */
export function resolveVehicleQuery(seed: VehicleSeed, query: string): VehicleCatalogRow | null {
  const q = query.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!q) return null;
  const parts = q.split(' ');
  const hits = seed.catalog.filter((row) => {
    const hay = vehicleLabel(row);
    return parts.every((part) => hay.includes(part));
  });
  const exact = hits.filter((row) => vehicleLabel(row) === q);
  if (exact.length === 1) return exact[0];
  if (hits.length === 1) return hits[0];
  return null;
}

/** First token when it is a model year. A miss still gets an age. */
export function leadingVehicleYear(query: string, nowYear = new Date().getFullYear()): number | null {
  const first = query.trim().split(/\s+/)[0] ?? '';
  return parseYear(first, nowYear);
}

export interface VehicleIdentity {
  name: string;
  vehicleYear: number | null;
  make: string | null;
  model: string | null;
  vehicleClass: VehicleClass;
  mpg: number | null;
  kwhPerMile: number | null;
}

/** A tap or a unique catalog match. Otherwise the typed name, class, and a leading year. */
export function vehicleIdentityFromQuery(
  seed: VehicleSeed,
  query: string,
  picked: VehicleCatalogRow | null,
  fallbackClass: VehicleClass = 'car',
): VehicleIdentity {
  const chosen = picked ?? resolveVehicleQuery(seed, query);
  if (chosen) {
    return {
      name: `${chosen.year} ${chosen.make} ${chosen.model}`,
      vehicleYear: chosen.year,
      make: chosen.make,
      model: chosen.model,
      vehicleClass: chosen.class,
      mpg: chosen.mpg ?? null,
      kwhPerMile: chosen.kwhPerMile ?? null,
    };
  }
  const trimmed = query.trim();
  return {
    name: trimmed || 'Vehicle',
    vehicleYear: leadingVehicleYear(trimmed),
    make: null,
    model: null,
    vehicleClass: fallbackClass,
    mpg: null,
    kwhPerMile: null,
  };
}

export function seedSources(bundle: SeedBundle): SourceRef[] {
  const out: SourceRef[] = [];
  for (const block of [bundle.home, bundle.vehicle, bundle.macro]) {
    for (const s of block.sources) {
      out.push({
        source: s.source,
        vintage: s.vintage,
        model: block.model,
        url: s.url,
      });
    }
  }
  return out;
}

function vintageStart(vintage: string): Date | null {
  const month = /^(\d{4})-(\d{2})/.exec(vintage);
  if (month) return new Date(Number(month[1]), Number(month[2]) - 1, 1);
  const quarter = /^(\d{4})-Q([1-4])/.exec(vintage);
  if (quarter) return new Date(Number(quarter[1]), (Number(quarter[2]) - 1) * 3, 1);
  const year = /^(\d{4})/.exec(vintage);
  if (year) return new Date(Number(year[1]), 0, 1);
  return null;
}

/** Seed is stale 18 months after the vintage month. */
export function seedIsStale(bundle: SeedBundle, now = new Date()): boolean {
  const vintages = [bundle.home.vintage, bundle.vehicle.vintage, bundle.macro.vintage];
  return vintages.some((vintage) => {
    const start = vintageStart(vintage);
    if (!start) return false;
    const months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
    return months >= 18;
  });
}
