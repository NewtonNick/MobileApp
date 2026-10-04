import { useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';

import {
  dismissAlreadyCounted,
  fileAsSpend,
  formatUsd,
  ignoreMerchant,
  markThisMonthOnly,
  parseMoney,
  setCategoryPlan,
  spreadAcrossYear,
} from '@asset-aware/forecast-engine';
import type { BudgetCategory } from '@asset-aware/forecast-engine';
import { useForecasts, useHousehold } from '@/state/context';
import { Body, Button, Field, Meta, Screen, Title } from '@/ui/primitives';

export default function EventScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { household, setHousehold, updateHousehold, settings } = useHousehold();
  const results = useForecasts();
  const [recurringAmount, setRecurringAmount] = useState('');
  const [recurringError, setRecurringError] = useState<string | null>(null);
  if (!household || !results) return <Screen><Title>Gone</Title></Screen>;
  const view = results[settings.scenario];
  const cons = results.conservative;

  const merchant = String(id ?? '');
  const row = (household.ledger ?? []).find((item) => item.id === merchant);
  const category: BudgetCategory = row?.category ?? 'other_living';
  const remember = (patch: Partial<typeof household>) => {
    setHousehold({ ...household, ...patch });
    router.back();
  };

  const markShock = (key: string) => {
    const base = row ? dismissAlreadyCounted(household, row.id) : household;
    setHousehold({
      ...base,
      reviewedPurchaseIds: [...new Set([...(base.reviewedPurchaseIds ?? []), merchant])],
      realizedEventKeys: [...base.realizedEventKeys, key],
      accounts: base.accounts.map((a) =>
        a.type === 'cash' || a.type === 'checking' || a.type === 'savings'
          ? { ...a, lastEditedAt: new Date().toISOString() }
          : a,
      ),
    });
    router.back();
  };

  return (
    <Screen>
      <Title>Purchase {id}</Title>
      <Body>
        {settings.scenario} 5-year house cost about {formatUsd(view.houseCost5y)}. Conservative{' '}
        {formatUsd(cons.houseCost5y)}.
      </Body>
      <Meta>Expected · One-off shock · Recurring · Ignore merchant</Meta>
      <Button
        label="Expected"
        onPress={() => {
          if (!row) {
            remember({
              reviewedPurchaseIds: [...new Set([...(household.reviewedPurchaseIds ?? []), merchant])],
            });
            return;
          }
          const next =
            row.role === 'already_counted'
              ? dismissAlreadyCounted(household, row.id)
              : fileAsSpend(household, row.id, category);
          setHousehold({
            ...next,
            reviewedPurchaseIds: [...new Set([...(next.reviewedPurchaseIds ?? []), merchant])],
          });
          router.back();
        }}
      />
      <Button label="One-off shock (home repair)" onPress={() => markShock(`home:${household.assets.find((a) => a.type === 'home')?.id}:repair`)} />
      <Button
        label="One-off shock (vehicle)"
        tone="ghost"
        onPress={() => markShock(`vehicle:${household.assets.find((a) => a.type === 'vehicle')?.id}:maint`)}
      />
      <Meta>Recurring amount per month</Meta>
      <Field
        value={recurringAmount}
        onChangeText={(next) => {
          setRecurringError(null);
          setRecurringAmount(next);
        }}
        keyboardType="decimal-pad"
      />
      {recurringError ? <Meta>{recurringError}</Meta> : null}
      <Button
        label="Recurring"
        tone="ghost"
        onPress={() => {
          const amount = parseMoney(recurringAmount);
          if (amount == null) {
            setRecurringError('Recurring amount has to be a number, like 40 or $40.');
            return;
          }
          const planned = setCategoryPlan(household, category, amount);
          const filed = row ? fileAsSpend(planned, row.id, category) : planned;
          setHousehold({
            ...filed,
            reviewedPurchaseIds: [...new Set([...(filed.reviewedPurchaseIds ?? []), merchant])],
          });
          router.back();
        }}
      />
      <Button
        label="This month only"
        tone="ghost"
        onPress={() => {
          if (!row) return;
          updateHousehold((current) => markThisMonthOnly(current, row.id));
          router.back();
        }}
      />
      <Button
        label="Spread across the year"
        tone="ghost"
        onPress={() => {
          if (!row) return;
          const next = spreadAcrossYear(household, row.id);
          if (next) setHousehold(next);
          router.back();
        }}
      />
      <Button
        label="Ignore merchant"
        tone="ghost"
        onPress={() => {
          updateHousehold((current) => ignoreMerchant(current, row?.merchant || merchant));
          router.back();
        }}
      />
      {(household.ignoredMerchants ?? []).includes(merchant) || (household.reviewedPurchaseIds ?? []).includes(merchant) ? (
        <Meta>This purchase is already reviewed.</Meta>
      ) : null}
    </Screen>
  );
}
