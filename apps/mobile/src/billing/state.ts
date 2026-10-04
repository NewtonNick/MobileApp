import { bankLinkAllowed, type BillingAvailability, type BankPlanId } from '@/billing/plans';

export type BillingSnapshot = {
  availability: BillingAvailability;
  subscribed: boolean;
  annualPrice: string | null;
  monthlyPrice: string | null;
  notice: string | null;
};

const EMPTY: BillingSnapshot = {
  availability: 'unknown',
  subscribed: false,
  annualPrice: null,
  monthlyPrice: null,
  notice: null,
};

let snapshot: BillingSnapshot = EMPTY;
const listeners = new Set<() => void>();

type PurchaseImpl = (plan: BankPlanId) => Promise<void>;

let purchaseImpl: PurchaseImpl | null = null;
let restoreImpl: (() => Promise<void>) | null = null;

export function getBillingSnapshot(): BillingSnapshot {
  return snapshot;
}

export function setBillingSnapshot(patch: Partial<BillingSnapshot>): void {
  snapshot = { ...snapshot, ...patch };
  listeners.forEach((listener) => listener());
}

export function subscribeBilling(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function registerBillingActions(actions: { purchase: PurchaseImpl; restore: () => Promise<void> } | null): void {
  purchaseImpl = actions?.purchase ?? null;
  restoreImpl = actions?.restore ?? null;
}

export function bankLinkIsUnlocked(): boolean {
  return bankLinkAllowed({
    envLocked: process.env.EXPO_PUBLIC_BANK_LINK_LOCKED === '1',
    availability: snapshot.availability,
    subscribed: snapshot.subscribed,
  });
}

export async function purchaseBankPlan(plan: BankPlanId): Promise<void> {
  if (!purchaseImpl) {
    setBillingSnapshot({ notice: 'Play Billing is not on this install.' });
    return;
  }
  await purchaseImpl(plan);
}

export async function restoreBankPlan(): Promise<void> {
  if (!restoreImpl) {
    setBillingSnapshot({ notice: 'Play Billing is not on this install.' });
    return;
  }
  await restoreImpl();
}

export function resetBillingState(): void {
  snapshot = EMPTY;
  purchaseImpl = null;
  restoreImpl = null;
  listeners.forEach((listener) => listener());
}
