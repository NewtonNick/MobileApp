import type { AccountType, FireFlavor, HousingTenure, PaycheckCadence, VehicleClass } from '@asset-aware/forecast-engine';
import { kvDelete, kvGet, kvSet } from '@/db/client';

const DRAFT_KEY = 'onboarding-draft';

export type DraftLoan = {
  id: string;
  name: string;
  type: AccountType;
  balance: string;
  payment: string;
  apr: string;
};

export type OnboardingDraft = {
  tenure: HousingTenure | null;
  hasVehicle: boolean | null;
  hasMortgage: boolean | null;
  zip: string;
  houseValue: string;
  yearBuilt: string;
  roofYear: string;
  skipHouse: boolean;
  carQuery: string;
  carValue: string;
  carMileage: string;
  carClass: VehicleClass;
  skipCar: boolean;
  cash: string;
  income: string;
  partner: string;
  cadence: PaycheckCadence;
  fireFlavor: FireFlavor;
  spend: string;
  investments: string;
  investReturn: string;
  rent: string;
  loans: DraftLoan[];
  alerts: 'daily' | 'outliers' | 'off';
};

export function loadOnboardingDraft(): OnboardingDraft | null {
  const raw = kvGet(DRAFT_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as OnboardingDraft;
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.loans)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveOnboardingDraft(draft: OnboardingDraft): void {
  kvSet(DRAFT_KEY, JSON.stringify(draft));
}

export function clearOnboardingDraft(): void {
  kvDelete(DRAFT_KEY);
}
