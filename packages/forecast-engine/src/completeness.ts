import { isUsZip } from './lookups';
import { firstLoanMissingApr, typicalAprPercent } from './rates';
import type { HouseholdInput } from './types';
import { isLiability } from './types';

export {
  completenessScore,
  hasMortgageAccount,
  hasNamedRent,
  householdHasIncome,
  householdWarnings,
  mortgageFlagContradicts,
  intakeBlocks,
  intakeBlocksForHousehold,
  intakeGap,
  isOutlineReady,
  nextBest,
  nextBestQuestion,
  resolveHasMortgage,
  resolveHasVehicle,
  resolveHousingTenure,
} from './jobs';
export type { IntakeBlock, NextBest, NextBestKey } from './jobs';

export function confidenceChip(household: HouseholdInput): string | null {
  const missingRate = firstLoanMissingApr(household.accounts);
  if (missingRate && isLiability(missingRate.type)) {
    return `Interest unknown on ${missingRate.name} — using a typical ${typicalAprPercent(missingRate.type)}% rate, not your lender's quote.`;
  }
  const home = household.assets.find((a) => a.type === 'home');
  if (home && home.roofYear == null && home.hvacYear == null) {
    const year = home.yearBuilt ?? 'unknown-age';
    return `Home systems unknown — using age-of-home averages${home.yearBuilt ? ` for ${year} homes` : ''}.`;
  }
  if (home && home.value == null) {
    return 'House value unknown — using a labeled ZIP median.';
  }
  const car = household.assets.find((a) => a.type === 'vehicle');
  if (car && !car.make) {
    return `Treating this as a ${car.vehicleClass ?? 'car'}. Change class anytime.`;
  }
  if (!isUsZip(household.zip) && home) {
    return 'ZIP missing — using national USD tables.';
  }
  return null;
}

export function cashLastEdited(household: HouseholdInput): string | null {
  const liquids = household.accounts.filter((a) =>
    a.type === 'checking' || a.type === 'savings' || a.type === 'cash',
  );
  if (!liquids.length) return null;
  return liquids
    .map((a) => a.lastEditedAt)
    .sort()
    .at(-1) ?? null;
}

export function isCashStale(household: HouseholdInput, now = Date.now(), days = 30): boolean {
  const last = cashLastEdited(household);
  if (!last) return false;
  return now - Date.parse(last) > days * 24 * 60 * 60 * 1000;
}
