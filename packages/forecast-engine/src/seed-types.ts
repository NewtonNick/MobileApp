import type { PercentileTriple, VehicleClass } from './types';

export interface HomeSystemCurve {
  key: string;
  label: string;
  usefulLifeYears: number;
  replacement: PercentileTriple;
  source: string;
  vintage: string;
}

export interface HomeAgeBucket {
  minAge: number;
  maxAge: number;
  annualMaintPctOfValue: PercentileTriple;
}

export interface ZipRegion {
  prefix: string;
  region: string;
  hpiAnnual: PercentileTriple;
  medianHomeValue: number;
}

export interface HomeSeed {
  model: string;
  vintage: string;
  sources: { source: string; vintage: string; url?: string; license: string }[];
  fiveYearRepairPctOfValue: PercentileTriple;
  ageBuckets: HomeAgeBucket[];
  systems: HomeSystemCurve[];
  zipRegions: ZipRegion[];
  national: {
    hpiAnnual: PercentileTriple;
    medianHomeValue: number;
    region: string;
  };
  /** Cited FHFA-style crash year, used by the hpi_crash overlay. */
  hpiCrashAnnual: PercentileTriple;
  /** Cited FHFA-style boom year, used by the hpi_boom overlay. */
  hpiBoomAnnual: PercentileTriple;
  hpiMeanReversionHalfLifeYears: number;
  hpiVolAnnual: number;
}

export interface VehicleClassCosts {
  class: VehicleClass;
  annualMaintenance: PercentileTriple;
  annualDepreciationPct: PercentileTriple;
}

export interface VehicleCatalogRow {
  year: number;
  make: string;
  model: string;
  class: VehicleClass;
  mpg?: number;
  /** EV catalog efficiency, kWh per mile. */
  kwhPerMile?: number;
}

export interface VehicleSeed {
  model: string;
  vintage: string;
  sources: { source: string; vintage: string; url?: string; license: string }[];
  byClass: VehicleClassCosts[];
  ageMultipliers: { minAge: number; maxAge: number; multiplier: number }[];
  mileageMultipliers: { minMiles: number; maxMiles: number; multiplier: number }[];
  catalog: VehicleCatalogRow[];
}

export interface MacroSeed {
  model: string;
  vintage: string;
  sources: { source: string; vintage: string; url?: string; license: string }[];
  cpiAnnual: number;
  usedVehicleCpiAnnual: number;
  equityVolAnnual: number;
  bondVolAnnual: number;
  crashJump: number;
  upJump: number;
  jumpChanceMonthly: number;
  jobLossMonthlyChance: number;
  raisePct: number;
  cpiVolAnnual: number;
  /** Scenario mortgage index. Missing uses a labeled fallback in the walker. */
  mortgageIndex?: PercentileTriple;
  /** Dollars per kWh for an EV fuel estimate. */
  electricityPricePerKwh?: number;
}

export interface SeedBundle {
  home: HomeSeed;
  vehicle: VehicleSeed;
  macro: MacroSeed;
}
