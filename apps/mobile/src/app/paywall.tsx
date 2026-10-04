import { useSyncExternalStore } from 'react';
import { useRouter } from 'expo-router';

import { BANK_ANNUAL_ID, BANK_MONTHLY_ID } from '@/billing/plans';
import { getBillingSnapshot, purchaseBankPlan, restoreBankPlan, subscribeBilling } from '@/billing/state';
import { BANK_INSTITUTION_CAP, bankLinkIsUnlocked } from '@/entitlements';
import { useHousehold } from '@/state/context';
import { Body, Button, Meta, Screen, Title } from '@/ui/primitives';

export default function PaywallScreen() {
  const router = useRouter();
  const { household } = useHousehold();
  const billing = useSyncExternalStore(subscribeBilling, getBillingSnapshot, getBillingSnapshot);
  const linked = household?.plaidItems?.length ?? 0;
  const unlocked = bankLinkIsUnlocked();

  return (
    <Screen>
      <Title>Keep the date current</Title>
      <Body>
        One plan, capped at two institutions. A checking login and a separate card login are the usual case. The date
        stays on screen. Typing still works.
      </Body>
      <Meta>
        {linked} of {BANK_INSTITUTION_CAP} institutions on this household.
      </Meta>
      {billing.availability === 'unknown' ? <Meta>Checking Google Play…</Meta> : null}
      {billing.availability === 'unavailable' ? (
        <Meta>This install cannot reach Google Play Billing. Bank linking stays open until Play lists the plan.</Meta>
      ) : null}
      {billing.availability === 'unpriced' ? (
        <Meta>Play has no price for this plan yet. Create {BANK_ANNUAL_ID} and {BANK_MONTHLY_ID} in Play Console. Bank linking stays open until a price is listed.</Meta>
      ) : null}
      {billing.subscribed ? <Meta>This phone has the bank-link plan.</Meta> : null}
      {billing.notice ? <Meta>{billing.notice}</Meta> : null}
      {billing.annualPrice ? (
        <Button label={`Annual · ${billing.annualPrice}`} onPress={() => void purchaseBankPlan(BANK_ANNUAL_ID)} />
      ) : null}
      {billing.monthlyPrice ? (
        <Button
          label={`Monthly · ${billing.monthlyPrice}`}
          tone="ghost"
          onPress={() => void purchaseBankPlan(BANK_MONTHLY_ID)}
        />
      ) : null}
      {billing.availability === 'ready' ? (
        <Button label="Restore purchases" tone="ghost" onPress={() => void restoreBankPlan()} />
      ) : null}
      {unlocked ? <Button label="Link a bank" onPress={() => router.push('/plaid')} /> : null}
      <Button label="Back" tone="ghost" onPress={() => router.back()} />
    </Screen>
  );
}
