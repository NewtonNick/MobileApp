/** Play Console product ids. The price is whatever Play returns. Do not hardcode one. */
export const BANK_ANNUAL_ID = 'bank_link_annual';
export const BANK_MONTHLY_ID = 'bank_link_monthly';

export const BANK_PLAN_IDS = [BANK_ANNUAL_ID, BANK_MONTHLY_ID] as const;

export type BankPlanId = (typeof BANK_PLAN_IDS)[number];

export type BillingAvailability = 'unknown' | 'unavailable' | 'unpriced' | 'ready';

export type StorePlan = {
  id: string;
  displayPrice: string;
  /** Google Play Billing 8 status. Missing on iOS. */
  productStatusAndroid?: string | null;
  offerToken?: string | null;
};

export function bankLinkAllowed(input: {
  envLocked: boolean;
  availability: BillingAvailability;
  subscribed: boolean;
}): boolean {
  if (input.envLocked) return false;
  if (input.availability === 'ready' && !input.subscribed) return false;
  return true;
}

export function listedPlan(plan: StorePlan | null, expectedId: BankPlanId): StorePlan | null {
  if (!plan || plan.id !== expectedId) return null;
  if (plan.productStatusAndroid === 'not-found') return null;
  if (!plan.displayPrice.trim()) return null;
  return plan;
}

export function availabilityFrom(input: {
  queried: boolean;
  connected: boolean;
  annual: StorePlan | null;
  monthly: StorePlan | null;
}): BillingAvailability {
  if (!input.queried) return 'unknown';
  if (!input.connected) return 'unavailable';
  if (!input.annual && !input.monthly) return 'unpriced';
  return 'ready';
}

export function hasBankPlan(subs: { productId: string; isActive: boolean }[]): boolean {
  return subs.some((sub) => (sub.productId === BANK_ANNUAL_ID || sub.productId === BANK_MONTHLY_ID) && sub.isActive);
}

export function offerTokenFor(plan: StorePlan | null): string | null {
  const token = plan?.offerToken?.trim();
  return token ? token : null;
}
