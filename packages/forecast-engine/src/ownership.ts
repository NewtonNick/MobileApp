import type { AssetInput, ExpenseInput, HouseholdInput } from './types';

/** Labeled estimates when the user has not typed a vehicle bill. Zero means they cleared it. */
export const VEHICLE_COST_ESTIMATES = {
  insuranceMonthly: 140,
  registrationAnnual: 200,
  fuelMonthly: 160,
  milesPerYear: 12_000,
  fuelPricePerGallon: 3.5,
  /** kWh per mile when the catalog has no efficiency. */
  kwhPerMile: 0.3,
  electricityPricePerKwh: 0.16,
};

export function hasHouse(h: HouseholdInput): boolean {
  if (h.housingTenure === 'rent' || h.housingTenure === 'none') return false;
  return h.assets.some((asset) => asset.type === 'home');
}

export function hasVehicle(h: HouseholdInput): boolean {
  if (h.hasVehicle === false) return false;
  return h.assets.some((asset) => asset.type === 'vehicle');
}

export interface OwnershipLine {
  id: string;
  assetId: string;
  suffix: string;
  name: string;
  amount: number;
}

/** Typed ownership bills. Estimates stay out of this list so a blank is not a second bill. */
export function ownershipLines(h: HouseholdInput): OwnershipLine[] {
  const lines: OwnershipLine[] = [];
  for (const asset of h.assets) {
    const owned: { suffix: string; name: string; amount: number | null | undefined }[] =
      asset.type === 'home'
        ? [
            { suffix: 'tax', name: 'Property tax', amount: asset.taxMonthly },
            { suffix: 'insurance', name: 'Home insurance', amount: asset.insuranceMonthly },
            { suffix: 'hoa', name: 'HOA', amount: asset.hoaMonthly },
          ]
        : asset.type === 'vehicle'
          ? [
              { suffix: 'fuel', name: 'Fuel', amount: asset.fuelMonthly },
              { suffix: 'insurance', name: 'Vehicle insurance', amount: asset.insuranceMonthly },
            ]
          : [];
    for (const line of owned) {
      if (line.amount == null) continue;
      lines.push({
        id: `own:${asset.id}:${line.suffix}`,
        assetId: asset.id,
        suffix: line.suffix,
        name: line.name,
        amount: line.amount,
      });
    }
  }
  return lines;
}

const NAME_TOKENS: { token: RegExp; suffixes: string[] }[] = [
  { token: /\b(property tax|real estate tax|\btax\b)/i, suffixes: ['tax'] },
  { token: /\b(insurance)\b/i, suffixes: ['insurance'] },
  { token: /\b(hoa|association)\b/i, suffixes: ['hoa'] },
  { token: /\b(fuel|gas)\b/i, suffixes: ['fuel'] },
  { token: /\b(registration)\b/i, suffixes: ['registration'] },
];

/** True when a living bill repeats a house or car line that already exists. */
export function expenseMatchesOwnership(expense: ExpenseInput, household: HouseholdInput): boolean {
  if (expense.linkedAssetKey) return true;
  const name = expense.name.trim();
  if (!name) return false;
  const lines = ownershipLines(household);
  return NAME_TOKENS.some((row) => {
    if (!row.token.test(name)) return false;
    return lines.some((line) => row.suffixes.includes(line.suffix) && line.amount > 0);
  });
}

export interface StaleAssetPrompt {
  assetId: string;
  name: string;
  message: string;
}

/** A renter or a no-vehicle household still holding that asset. */
export function staleAssetPrompts(household: HouseholdInput): StaleAssetPrompt[] {
  const prompts: StaleAssetPrompt[] = [];
  if (household.housingTenure === 'rent' || household.housingTenure === 'none') {
    for (const asset of household.assets.filter((row) => row.type === 'home')) {
      prompts.push({
        assetId: asset.id,
        name: asset.name,
        message: `Remove this asset? ${asset.name} is still on the books, and this plan is not an owned home.`,
      });
    }
  }
  if (household.hasVehicle === false) {
    for (const asset of household.assets.filter((row) => row.type === 'vehicle')) {
      prompts.push({
        assetId: asset.id,
        name: asset.name,
        message: `Remove this asset? ${asset.name} is still on the books, and this plan has no vehicle.`,
      });
    }
  }
  return prompts;
}

export function assetsInNetWorth(household: HouseholdInput, type: AssetInput['type']): AssetInput[] {
  if (type === 'home' && !hasHouse(household) && (household.housingTenure === 'rent' || household.housingTenure === 'none')) {
    return [];
  }
  if (type === 'vehicle' && household.hasVehicle === false) return [];
  return household.assets.filter((asset) => asset.type === type);
}
