/**
 * Billing lives outside household JSON. Engine never imports this file.
 * Standing stays free. The paid object is an annual or monthly bank link, two institutions.
 * The dollar amount comes from Google Play, not from this file.
 */
import { bankLinkIsUnlocked } from '@/billing/state';

export const BANK_INSTITUTION_CAP = 2;

export { bankLinkIsUnlocked };

export type Entitlements = {
  standingUnlocked: true;
  plus: false;
  collisionPacketUnlocked: true;
  bankLinkUnlocked: boolean;
};

export function readEntitlements(): Entitlements {
  return {
    standingUnlocked: true,
    plus: false,
    collisionPacketUnlocked: true,
    bankLinkUnlocked: bankLinkIsUnlocked(),
  };
}

export function standingIsUnlocked(): boolean {
  return true;
}

export function collisionPacketIsUnlocked(): boolean {
  return true;
}
