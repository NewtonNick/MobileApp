import { useState } from 'react';
import { View } from 'react-native';
import { type Href, useRouter } from 'expo-router';

import {
  BUDGET_CATEGORIES,
  BUDGET_CATEGORY_LABELS,
  BUDGET_GROUP_LABELS,
  acceptMonthAsPlan,
  budgetLines,
  dismissAlreadyCounted,
  fileAsSpend,
  formatUsd,
  ignoreMerchant,
  isInboxRow,
  linkGapUnknown,
  linkIsCurrent,
  markThisMonthOnly,
  monthKey,
  reconcileMonth,
  setCategoryPlan,
  showEmptyMonth,
  showReturn,
  spreadAcrossYear,
  acceptPay,
  alreadyInTakeHome,
  figuresToRetype,
  cashLastEdited,
  shockKeyForMerchant,
  parseMoney,
  isCashStale,
} from '@asset-aware/forecast-engine';
import type { BudgetCategory, BudgetGroup, LedgerRow } from '@asset-aware/forecast-engine';
import { useHousehold } from '@/state/context';
import { Body, Button, Card, Chip, Field, Hairline, Headline, Meta, Screen, Title } from '@/ui/primitives';

const GROUPS: BudgetGroup[] = ['housing', 'bills', 'living', 'sinking'];

export default function BudgetScreen() {
  const router = useRouter();
  const { household, standingView, updateHousehold } = useHousehold();
  const [editing, setEditing] = useState<BudgetCategory | null>(null);
  const [draft, setDraft] = useState('');
  const [planError, setPlanError] = useState<string | null>(null);
  const now = new Date();

  if (!household) {
    return (
      <Screen>
        <Title>Budget</Title>
        <Body>Start a household first. A budget is the plan you already typed.</Body>
      </Screen>
    );
  }

  const lines = budgetLines(household, now);
  const month = monthKey(now);
  const rows = household.ledger ?? [];
  const inbox = rows.filter((row) => isInboxRow(row));
  const linked = (household.plaidItems ?? []).length > 0;
  const current = linkIsCurrent(household.plaidItems, now.getTime());
  const gapUnknown = linkGapUnknown(household.plaidItems, now.getTime());
  const hired = standingView?.hiredDate ?? null;
  const ask = showReturn(household, hired, isCashStale(household, now.getTime()), now)
    ? 'return'
    : showEmptyMonth(household, hired, now)
      ? 'empty'
      : null;
  const rec = reconcileMonth(rows, month);
  const edited = cashLastEdited(household);

  const savePlan = (category: BudgetCategory) => {
    const amount = parseMoney(draft);
    if (amount == null) {
      setPlanError('The plan has to be a number, like 400 or $1,200.');
      return;
    }
    setPlanError(null);
    updateHousehold((current) => setCategoryPlan(current, category, amount));
    setEditing(null);
  };

  return (
    <Screen>
        <Title>Budget</Title>
        <Body>The plan is what the date uses. Spent is only what you have marked as spending this month.</Body>
        <Button label="Dashboard" tone="ghost" onPress={() => router.push('/dashboard' as Href)} />
        {linked && !current ? (
          <Card>
            <Body>This bank needs a refresh. Missing transactions are unknown, not zero spending.</Body>
            <Button
              label="Refresh this bank"
              onPress={() => {
                const staleItem = (household.plaidItems ?? []).find((item) => !linkIsCurrent([item], now.getTime()));
                router.push(
                  staleItem ? ({ pathname: '/plaid', params: { itemId: staleItem.itemId } } as Href) : ('/plaid' as Href),
                );
              }}
            />
          </Card>
        ) : null}
        {ask === 'empty' ? (
          <Card>
            <Body>
              Nothing recorded this month, so left is the whole plan. The date is still a guess.
            </Body>
            <Button label="Add a spend" onPress={() => router.push('/spend' as Href)} />
            <Button
              label="Fill this month from the bank"
              tone="ghost"
              onPress={() => router.push('/paywall' as Href)}
            />
          </Card>
        ) : null}
        {ask === 'return' ? (
          <Card>
            <Body>
              Last edited {edited ? new Date(edited).toLocaleDateString() : 'before this month'}.{' '}
              {figuresToRetype(household)} figures to retype before the date is current.
            </Body>
            <Button label="Add a spend" onPress={() => router.push('/spend' as Href)} />
            <Button
              label="Fill this month from the bank"
              tone="ghost"
              onPress={() => router.push('/paywall' as Href)}
            />
          </Card>
        ) : null}
        {linked && gapUnknown ? (
          <Meta>Recorded spend stays on the books. The rest of this month is unknown, not zero.</Meta>
        ) : linked ? (
          <Meta>
            Bank outflow {formatUsd(rec.outflow)}, minus transfers {formatUsd(rec.transfers)}, versus categorized
            spend {formatUsd(rec.spent)}. The {formatUsd(rec.gap)} difference is the inbox.
          </Meta>
        ) : (
          <Meta>No bank linked. Typed spending still fills this month.</Meta>
        )}
        {GROUPS.map((group) => {
          const section = lines.filter((line) => line.group === group);
          if (!section.length) return null;
          return (
            <Card key={group}>
              <Headline>{BUDGET_GROUP_LABELS[group]}</Headline>
              {section.map((line, index) => (
                <View key={line.id} style={{ gap: 8 }}>
                  {index > 0 ? <Hairline /> : null}
                  <Body>{line.name}</Body>
                  <Meta>
                    {line.kind === 'category' && gapUnknown
                      ? line.spent === 0
                        ? `Plan ${formatUsd(line.planned)} · Spent unknown`
                        : `Plan ${formatUsd(line.planned)} · Spent ${formatUsd(line.spent)} recorded · the rest of this month is unknown`
                      : `Plan ${formatUsd(line.planned)} · Spent ${formatUsd(line.spent)} · Left ${formatUsd(line.left)}`}
                  </Meta>
                  {line.kind !== 'category' ? <Meta>Already in the forecast. Not a second living expense.</Meta> : null}
                  {line.editable && line.category && editing === line.category ? (
                    <>
                      <Field
                        accessibilityLabel={`Monthly plan for ${line.name}`}
                        value={draft}
                        onChangeText={(next) => {
                          setPlanError(null);
                          setDraft(next);
                        }}
                        keyboardType="decimal-pad"
                        placeholder="400 or $1,200"
                      />
                      {planError ? <Meta>{planError}</Meta> : null}
                      <Button label="Save plan" onPress={() => savePlan(line.category as BudgetCategory)} />
                    </>
                  ) : null}
                  {line.editable && line.category && editing !== line.category ? (
                    <Button
                      label="Edit plan"
                      tone="ghost"
                      onPress={() => {
                        setEditing(line.category);
                        setDraft(line.planned ? String(line.planned) : '');
                      }}
                    />
                  ) : null}
                </View>
              ))}
            </Card>
          );
        })}
        <Card>
          <Headline>Inbox</Headline>
          {inbox.length === 0 ? <Meta>Nothing waiting. High-confidence spending is already filed.</Meta> : null}
          {inbox.map((row) => (
            <InboxRow key={row.id} row={row} />
          ))}
        </Card>
        {linked ? (
          <>
            <Button
              label="Use this month as the plan"
              tone={current ? 'accent' : 'ghost'}
              onPress={() => {
                if (!current) return;
                updateHousehold((books) => acceptMonthAsPlan(books, now) ?? books);
              }}
            />
            {current ? null : (
              <Meta>Accept as the plan stays off until a sync succeeds.</Meta>
            )}
          </>
        ) : null}
        <Button label="Add a spend" tone="ghost" onPress={() => router.push('/spend' as Href)} />
    </Screen>
  );
}

function InboxRow({ row }: { row: LedgerRow }) {
  const router = useRouter();
  const { household, setHousehold, updateHousehold } = useHousehold();
  if (!household) return null;
  const home = household.assets.find((asset) => asset.type === 'home');
  const repairKey =
    shockKeyForMerchant(row.merchant, household.assets) ?? (home ? `home:${home.id}:repair` : null);

  return (
    <Card>
      <Body>
        {row.merchant} · {formatUsd(row.amount)}
      </Body>
      <Button label="Open this purchase" tone="ghost" onPress={() => router.push(`/event/${row.id}` as Href)} />
      <Meta>
        {row.role === 'income'
          ? 'Income'
          : row.role === 'already_counted'
            ? 'Already counted'
            : row.role === 'transfer'
              ? 'Transfer'
              : row.category
                ? BUDGET_CATEGORY_LABELS[row.category]
                : 'Unsure category'}
      </Meta>
      {row.role === 'income' ? (
        <>
          <Button label="This is pay" onPress={() => updateHousehold((current) => acceptPay(current, row.id))} />
          <Button
            label="Already in take-home"
            tone="ghost"
            onPress={() => updateHousehold((current) => alreadyInTakeHome(current, row.id))}
          />
        </>
      ) : null}
      {row.role === 'already_counted' ? (
        <>
          <Button
            label="Leave it on the forecast"
            onPress={() => updateHousehold((current) => dismissAlreadyCounted(current, row.id))}
          />
          {repairKey ? (
            <Button
              label="Use as a repair"
              tone="ghost"
              onPress={() =>
                setHousehold({
                  ...dismissAlreadyCounted(household, row.id),
                  realizedEventKeys: [...new Set([...household.realizedEventKeys, repairKey])],
                })
              }
            />
          ) : null}
        </>
      ) : null}
      {row.role === 'spend' || row.role === 'transfer' ? (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {BUDGET_CATEGORIES.map((category) => (
              <Chip
                key={category}
                label={BUDGET_CATEGORY_LABELS[category]}
                onPress={() => updateHousehold((current) => fileAsSpend(current, row.id, category))}
              />
            ))}
          </View>
          <Button label="This month only" tone="ghost" onPress={() => updateHousehold((current) => markThisMonthOnly(current, row.id))} />
          <Button
            label="Spread across the year"
            tone="ghost"
            onPress={() => {
              const next = spreadAcrossYear(household, row.id);
              if (next) setHousehold(next);
            }}
          />
        </>
      ) : null}
      <Button
        label="Ignore merchant"
        tone="ghost"
        onPress={() => updateHousehold((current) => ignoreMerchant(current, row.merchant))}
      />
    </Card>
  );
}

