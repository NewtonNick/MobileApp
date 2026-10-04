import type { AssetInput } from './types';

export type OutlierAction = 'expected' | 'shock' | 'recurring' | 'ignore_merchant';

export interface TransactionLike {
  id: string;
  amount: number;
  merchant: string;
  category?: string | null;
  date: string;
}

const HOME_HINTS = ['home depot', 'lowe', 'hvac', 'roofer', 'plumbing', 'hardware', 'appliance'];
const VEHICLE_HINTS = [
  'pep boys',
  'autozone',
  'dealer',
  'honda',
  'toyota',
  'ford',
  'jiffy',
  'midas',
  'body shop',
  'tire',
];

export function merchantLooksOwnership(merchant: string): 'home' | 'vehicle' | null {
  const m = merchant.toLowerCase();
  if (HOME_HINTS.some((h) => m.includes(h))) return 'home';
  if (VEHICLE_HINTS.some((h) => m.includes(h))) return 'vehicle';
  return null;
}

export function isOutlier(
  txn: TransactionLike,
  typicalCategoryMonth: number,
  realisticShockCosts: number[],
): boolean {
  const amount = Math.abs(txn.amount);
  if (amount >= 500 && typicalCategoryMonth > 0 && amount >= 2 * typicalCategoryMonth) return true;
  if (merchantLooksOwnership(txn.merchant) && amount >= 200) return true;
  if (realisticShockCosts.some((c) => c > 0 && Math.abs(amount - c) / c <= 0.3)) return true;
  return false;
}

export function notificationAllowed(params: {
  lastNotificationAt: string | null;
  allClearCount: number;
  hasOutlier: boolean;
  now?: Date;
}): { send: boolean; kind: 'outlier' | 'all_clear' | 'silent' } {
  const now = params.now ?? new Date();
  if (params.lastNotificationAt) {
    const last = new Date(params.lastNotificationAt);
    const sameDay =
      last.getFullYear() === now.getFullYear() &&
      last.getMonth() === now.getMonth() &&
      last.getDate() === now.getDate();
    if (sameDay) return { send: false, kind: 'silent' };
  }
  if (params.hasOutlier) return { send: true, kind: 'outlier' };
  if (params.allClearCount >= 3) return { send: false, kind: 'silent' };
  return { send: true, kind: 'all_clear' };
}

export function shockKeyForMerchant(merchant: string, assets: AssetInput[]): string | null {
  const kind = merchantLooksOwnership(merchant);
  if (kind === 'home') {
    const home = assets.find((a) => a.type === 'home');
    return home ? `home:${home.id}:repair` : null;
  }
  if (kind === 'vehicle') {
    const car = assets.find((a) => a.type === 'vehicle');
    return car ? `vehicle:${car.id}:maint` : null;
  }
  return null;
}
