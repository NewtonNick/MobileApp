import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';

import {
  BUDGET_CATEGORIES,
  BUDGET_CATEGORY_LABELS,
  addBillToPlan,
  bookBalances,
  categoryTrack,
  draftMonthAsPlan,
  forgetPlaidItem,
  foundBills,
  formatUsd,
  holdingAllocation,
  linkGapUnknown,
  linkIsCurrent,
  merchantKey,
  observeNetWorth,
  parseMoney,
  recordedBalanceChange,
  renameMerchant,
  setCategoryPlan,
  setMerchantRule,
  setMerchantTag,
  spendingByTag,
  spendingChange,
  splitSpend,
  upcomingCash,
  forecastMonthLabel,
  walkForecast,
  type BookBalance,
  type BudgetCategory,
  type CategoryDelta,
  type CategoryTrack,
  type LedgerRow,
} from '@asset-aware/forecast-engine';
import { ChartChoices, PathChart, pathViews, type PathView } from '@/charts';
import { seedBundle } from '@/lib/seed';
import { disconnectInstitution } from '@/plaid/client';
import { liveStanding } from '@/state/household';
import { useHousehold } from '@/state/context';
import { confirm } from '@/ui/confirm';
import { useColors } from '@/ui/appearance';
import { Body, Button, Card, Chip, Field, Hairline, Headline, Meta, Screen, Title } from '@/ui/primitives';

type Report = 'date' | 'spending' | 'cash' | 'holdings';

const REPORTS: Array<{ id: Report; label: string }> = [
  { id: 'date', label: 'The date' },
  { id: 'spending', label: 'Spending' },
  { id: 'cash', label: 'Cash ahead' },
  { id: 'holdings', label: 'Holdings' },
];

function hiredLabel(iso: string | null | undefined): string {
  if (!iso) return 'not dated yet';
  const [year, month, day] = iso.split('-').map(Number);
  if (!year || !month) return 'not dated yet';
  return new Date(year, month - 1, day || 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

function monthLabel(key: string): string {
  const [year, month] = key.split('-').map(Number);
  if (!year || !month) return key;
  return new Date(year, month - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

function dayLabel(day: number | null): string {
  if (day == null) return 'day not known';
  const teen = day % 100;
  const mod = day % 10;
  const suffix = teen >= 11 && teen <= 13 ? 'th' : mod === 1 ? 'st' : mod === 2 ? 'nd' : mod === 3 ? 'rd' : 'th';
  return `around the ${day}${suffix}`;
}

function dateMove(before: string | null | undefined, after: string | null | undefined): string {
  const from = hiredLabel(before);
  const to = hiredLabel(after);
  if (from === to) return `The hired date stays ${from}.`;
  return `The hired date moves from ${from} to ${to}.`;
}

function changeLine(deltas: CategoryDelta[]): string {
  const moved = [...deltas].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).find((row) => row.delta !== 0);
  if (!moved) return 'Filed spending matches last month. The hired date still uses the plan.';
  const direction = moved.delta > 0 ? 'higher' : 'lower';
  return `${moved.label} is ${formatUsd(Math.abs(moved.delta))} ${direction} than last month. The hired date uses the plan until you apply this month.`;
}

function balanceChangeLine(change: ReturnType<typeof recordedBalanceChange>): string {
  if (!change) {
    return 'Recorded balances start this month. A later month can show the change. This is not a market return.';
  }
  if (change.delta === 0) {
    return `Net worth matches ${monthLabel(change.fromMonth)}. That comparison uses the balances you recorded, not market prices.`;
  }
  const direction = change.delta > 0 ? 'higher' : 'lower';
  return `Net worth is ${formatUsd(Math.abs(change.delta))} ${direction} than ${monthLabel(change.fromMonth)}. That is the change in recorded balances, not a market return.`;
}

function syncLabel(row: BookBalance): string {
  const when = row.syncedAt
    ? new Date(row.syncedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null;
  if (row.institution && when) return `${row.institution} · synced ${when}`;
  if (when) return `Synced ${when}`;
  if (row.institution) return row.institution;
  return 'Typed on the books';
}

export default function DashboardScreen() {
  const colors = useColors();
  const router = useRouter();
  const { household, settings, now, standingView, setHousehold, updateHousehold } = useHousehold();
  const [report, setReport] = useState<Report>('date');
  const [pathView, setPathView] = useState<PathView>('line');
  const [pickedMonth, setPickedMonth] = useState<number | null>(null);

  useEffect(() => {
    if (!household) return;
    const next = observeNetWorth(household, now);
    if (next !== household) setHousehold(next);
  }, [household, now, setHousehold]);

  const mix = household ? holdingAllocation(household) : null;
  const deltas = household ? spendingChange(household, now) : [];
  const tracks = household ? categoryTrack(household, now) : [];
  const tags = household ? spendingByTag(household, now) : [];
  const bills = useMemo(() => (household ? foundBills(household) : []), [household]);
  const upcoming = household ? upcomingCash(household, now, 3) : [];
  const balances = household ? bookBalances(household) : [];
  const balanceChange = household ? recordedBalanceChange(household, now) : null;
  const draft = household ? draftMonthAsPlan(household, now) : null;
  const hiredMonth = standingView?.hiredMonth ?? null;
  const horizon = Math.min(360, Math.max(60, hiredMonth ?? 60));
  const walked = useMemo(
    () => (household ? walkForecast(household, seedBundle, settings.scenario, { horizonMonths: horizon, now }) : null),
    [household, settings.scenario, horizon, now],
  );
  const afterPlan = useMemo(() => {
    if (!household || !draft?.applied.length) return null;
    return liveStanding(draft.household, settings.scenario, settings.withdrawalRate, now);
  }, [household, draft, settings.scenario, settings.withdrawalRate, now]);
  const billDates = useMemo(() => {
    if (!household) return new Map<string, string | null>();
    const dates = new Map<string, string | null>();
    for (const bill of bills) {
      if (bill.onPlan) continue;
      const next = addBillToPlan(household, bill.merchant);
      dates.set(bill.merchant, liveStanding(next, settings.scenario, settings.withdrawalRate, now).hiredDate);
    }
    return dates;
  }, [household, bills, settings.scenario, settings.withdrawalRate, now]);

  if (!household || !standingView || !mix || !walked) {
    return (
      <Screen>
        <Title>Dashboard</Title>
        <Body>Start a household first. This report uses the same books as the hired date.</Body>
      </Screen>
    );
  }

  const chartMonths = walked.months.map((month) => ({
    month: month.month,
    cash: month.cash,
    netWorth: settings.showNominal && month.nominalNetWorth != null ? month.nominalNetWorth : month.netWorth,
  }));
  const chartFocus = chartMonths.find((month) => month.month === pickedMonth) ?? chartMonths.at(-1) ?? null;
  const monthRows = (household.ledger ?? []).filter((row) => {
    const key = row.date.slice(0, 7);
    const nowKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    return key === nowKey && row.role === 'spend' && (row.confidence === 'high' || row.reviewed);
  });
  const linked = (household.plaidItems ?? []).length > 0;
  const current = linkIsCurrent(household.plaidItems, now.getTime());
  const gapUnknown = linkGapUnknown(household.plaidItems, now.getTime());
  const marks = household.netWorthMarks ?? [];

  return (
    <Screen>
        <Title>Dashboard</Title>
        <Body>{standingView.sentence}</Body>
        <Meta>
          Reserved {formatUsd(standingView.reserved)} · Leftover {formatUsd(standingView.leftover)}. Cash home still
          leads with this date.
        </Meta>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {REPORTS.map((item) => (
            <Chip key={item.id} label={item.label} selected={report === item.id} onPress={() => setReport(item.id)} />
          ))}
        </View>

        {report === 'date' ? (
          <>
            <Card>
              <Headline>What the date is using</Headline>
              <Body>Net worth about {formatUsd(mix.net)}.</Body>
              {mix.slices.map((slice) => (
                <ShareBar
                  key={slice.id}
                  label={`${slice.label} ${formatUsd(slice.amount)} · ${Math.round(slice.share * 100)}%`}
                  share={slice.share}
                  color={slice.kind === 'liquid' ? colors.good : colors.accent}
                />
              ))}
              {mix.debt > 0 ? <Meta>Owed {formatUsd(mix.debt)}. That is not part of the mix above.</Meta> : null}
              <Meta>
                Reserved can spend cash only. Retirement and brokerage grow at the expected return you typed
                {mix.expectedReturn != null ? `, about ${Math.round(mix.expectedReturn * 1000) / 10}%` : ''}. A ticker
                is a label.
              </Meta>
            </Card>

            <Card>
              <Headline>Net worth to the hired date</Headline>
              <ChartChoices
                value={pathView}
                onChange={(view) => {
                  setPickedMonth(null);
                  setPathView(view);
                }}
                options={pathViews}
              />
              <PathChart
                months={chartMonths}
                mode="netWorth"
                view={pathView}
                accent={colors.accent}
                markMonth={hiredMonth}
                onSelectMonth={setPickedMonth}
              />
              <Meta>
                {hiredMonth != null
                  ? `Hired date ${forecastMonthLabel(hiredMonth)}.`
                  : 'The date is not set, so nothing is marked.'}{' '}
                {chartFocus
                  ? `About ${formatUsd(chartFocus.netWorth)} in ${forecastMonthLabel(chartFocus.month)}.`
                  : ''}{' '}
                {settings.showNominal ? 'Future dollars.' : 'Today’s dollars.'}
              </Meta>
              <Meta>Drag across the chart for another month.</Meta>
              <Button label="Open Forecast" tone="ghost" onPress={() => router.push('/(tabs)/forecast')} />
            </Card>

            <Card>
              <Headline>Why spending changed</Headline>
              <Body>
                {gapUnknown
                  ? 'This bank needs a refresh. Missing transactions are unknown, not zero spending.'
                  : changeLine(deltas)}
              </Body>
              {deltas.map((row) => (
                <Meta key={row.category}>
                  {row.label}: {formatUsd(row.thisMonth)} this month, {formatUsd(row.lastMonth)} last month
                </Meta>
              ))}
              <Button label="Open spending" tone="ghost" onPress={() => setReport('spending')} />
            </Card>
          </>
        ) : null}

        {report === 'spending' ? (
          <>
            <Card>
              <Headline>This month by category</Headline>
              <Body>
                {gapUnknown
                  ? 'This bank needs a refresh. Missing transactions are unknown, not zero spending.'
                  : changeLine(deltas)}
              </Body>
              {tracks.length === 0 ? <Meta>No plan and no filed spending yet.</Meta> : null}
              {tracks.map((row) => (
                <CategoryRow key={row.category} row={row} gapUnknown={gapUnknown} />
              ))}
            </Card>

            {tags.length > 0 ? (
              <Card>
                <Headline>By tag</Headline>
                <Meta>A tag groups charges. It does not change the plan.</Meta>
                {tags.map((row) => (
                  <Meta key={row.tag}>
                    {row.tag} {formatUsd(row.amount)}
                  </Meta>
                ))}
              </Card>
            ) : null}

            <Card>
              <Headline>If this month is the plan</Headline>
              {draft == null ? (
                <Body>This bank needs a refresh. A stale link cannot move the hired date.</Body>
              ) : draft.applied.length === 0 && draft.skipped.length === 0 ? (
                <Body>No filed spending this month to write onto the plan.</Body>
              ) : (
                <>
                  {draft.applied.length > 0 && afterPlan ? (
                    <Body>{dateMove(standingView.hiredDate, afterPlan.hiredDate)}</Body>
                  ) : null}
                  {draft.skipped.length > 0 ? (
                    <Meta>
                      Left alone, because more than one bill shares the category:{' '}
                      {draft.skipped.map((category) => BUDGET_CATEGORY_LABELS[category]).join(', ')}.
                    </Meta>
                  ) : null}
                  {draft.applied.length > 0 ? (
                    <Button label="Use this month on the hired date" onPress={() => setHousehold(draft.household)} />
                  ) : null}
                </>
              )}
            </Card>

            {monthRows.length > 0 ? (
              <Card>
                <Headline>This month’s spend</Headline>
                <Meta>Rename, tag, or remember the merchant. A split keeps both parts in the month the date can use.</Meta>
                {monthRows.map((row) => (
                  <SpendTools key={row.id} row={row} />
                ))}
              </Card>
            ) : null}

            {(household.categoryOverrides ?? []).length > 0 ? (
              <Card>
                <Headline>Merchant rules</Headline>
                {(household.categoryOverrides ?? []).map((rule) => (
                  <Meta key={rule.merchant}>
                    {rule.merchant} → {BUDGET_CATEGORY_LABELS[rule.category]}
                  </Meta>
                ))}
              </Card>
            ) : null}
          </>
        ) : null}

        {report === 'cash' ? (
          <>
            <Card>
              <Headline>Upcoming cash</Headline>
              <Meta>
                Pay and the bills the hired date already counts. A found bill is listed first and stays out of the
                total until you add it.
              </Meta>
              {upcoming.map((month) => (
                <View key={month.monthIndex} style={{ gap: 4 }}>
                  <Body>
                    {month.label}
                    {hiredMonth === month.monthIndex ? ' · hired date' : ''}
                  </Body>
                  <Meta>
                    In {formatUsd(month.income)} · Bills {formatUsd(month.total)}
                  </Meta>
                  {month.seen.map((bill) => (
                    <Meta key={`${month.monthIndex}-seen-${bill.name}`}>
                      {bill.name} {bill.cadence && bill.cadence !== 'monthly' ? 'about ' : ''}
                      {formatUsd(bill.amount)} · {dayLabel(bill.day)} · not on the hired date
                    </Meta>
                  ))}
                  {month.bills.map((bill) => (
                    <Meta key={`${month.monthIndex}-${bill.name}`}>
                      {bill.name} {formatUsd(bill.amount)}
                    </Meta>
                  ))}
                </View>
              ))}
            </Card>

            <Card>
              <Headline>Bills found</Headline>
              {bills.length === 0 ? (
                <Meta>A merchant has to show up in most months of a three-month span before it is a bill.</Meta>
              ) : null}
              {bills.map((bill) => (
                <View key={bill.merchant} style={{ gap: 8 }}>
                  <Hairline />
                  <Body>
                    {bill.name} · {bill.cadence && bill.cadence !== 'monthly' ? 'about ' : ''}
                    {formatUsd(bill.amount)} a month
                  </Body>
                  <Meta>
                    {BUDGET_CATEGORY_LABELS[bill.category]} ·{' '}
                    {bill.months === 0
                      ? `the bank lists this · ${dayLabel(bill.day)}`
                      : `seen in ${bill.months} months · ${dayLabel(bill.day)}`}
                    {bill.cadence === 'annual' ? ' · once a year, counted as a month' : ''}
                    {bill.institutions > 1 ? ` · ${bill.institutions} institutions` : ''}
                    {bill.onPlan ? ' · already on the hired date' : ''}
                  </Meta>
                  {bill.onPlan ? null : (
                    <>
                      <Meta>{dateMove(standingView.hiredDate, billDates.get(bill.merchant))}</Meta>
                      <Button
                        label="Put this bill on the hired date"
                        onPress={() => updateHousehold((current) => addBillToPlan(current, bill.merchant))}
                      />
                    </>
                  )}
                </View>
              ))}
            </Card>
          </>
        ) : null}

        {report === 'holdings' ? (
          <>
            <Card>
              <Headline>Balances</Headline>
              {linked && !current ? (
                <Body>This bank needs a refresh. Balances stay at the last sync. A stale link is not zero.</Body>
              ) : null}
              {!linked ? <Meta>No bank linked. These are the balances on the books.</Meta> : null}
              {balances.map((row) => (
                <View key={row.id} style={{ gap: 2 }}>
                  <Body>
                    {row.name} · {row.owed ? 'owed ' : ''}
                    {formatUsd(row.amount)}
                  </Body>
                  <Meta>
                    {row.typeLabel} · {syncLabel(row)}
                  </Meta>
                </View>
              ))}
            </Card>

            <Card>
              <Headline>Recorded net worth</Headline>
              {gapUnknown ? (
                <Body>The change since the last sync is unknown. These amounts are the last balances, not zeros.</Body>
              ) : (
                <Body>{balanceChangeLine(balanceChange)}</Body>
              )}
              {marks.map((mark) => (
                <ShareBar
                  key={mark.month}
                  label={`${monthLabel(mark.month)} ${formatUsd(mark.net)}`}
                  share={
                    Math.max(...marks.map((item) => Math.abs(item.net)), 1) > 0
                      ? Math.abs(mark.net) / Math.max(...marks.map((item) => Math.abs(item.net)), 1)
                      : 0
                  }
                  color={colors.accent}
                />
              ))}
              <Meta>One mark per month, from the balances on the books. Not a market price.</Meta>
            </Card>

            <Card>
              <Headline>Mix</Headline>
              {mix.slices.map((slice) => (
                <ShareBar
                  key={slice.id}
                  label={`${slice.label} ${formatUsd(slice.amount)} · ${Math.round(slice.share * 100)}%`}
                  share={slice.share}
                  color={slice.kind === 'liquid' ? colors.good : colors.accent}
                />
              ))}
              {mix.debt > 0 ? <Meta>Owed {formatUsd(mix.debt)}.</Meta> : null}
              <Meta>
                Expected return on retirement and brokerage
                {mix.expectedReturn != null ? ` about ${Math.round(mix.expectedReturn * 1000) / 10}%` : ' is not set'}.
                A ticker is a label.
              </Meta>
            </Card>

            {linked ? (
              <Card>
                <Headline>Linked institutions</Headline>
                {(household.plaidItems ?? []).map((item) => (
                  <BankRow key={item.itemId} itemId={item.itemId} name={item.institutionName ?? 'Bank'} />
                ))}
              </Card>
            ) : null}
          </>
        ) : null}
    </Screen>
  );
}

function ShareBar({ label, share, color }: { label?: string; share: number; color: string }) {
  const colors = useColors();
  return (
    <View style={{ gap: 4 }}>
      {label ? <Meta>{label}</Meta> : null}
      <View style={{ height: 8, backgroundColor: colors.bgMuted, borderRadius: 4 }}>
        <View
          style={{
            height: 8,
            width: `${Math.max(2, Math.min(100, Math.round(share * 100)))}%`,
            backgroundColor: color,
            borderRadius: 4,
          }}
        />
      </View>
    </View>
  );
}

function CategoryRow({ row, gapUnknown }: { row: CategoryTrack; gapUnknown: boolean }) {
  const colors = useColors();
  const { household, updateHousehold } = useHousehold();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [planError, setPlanError] = useState<string | null>(null);
  if (!household) return null;
  const scale = Math.max(row.planned, row.spent, 1);
  const fill = row.spent / scale;
  return (
    <View style={{ gap: 4 }}>
      <Hairline />
      <Body>{row.label}</Body>
      <Meta>
        {gapUnknown
          ? row.spent === 0
            ? `Plan ${formatUsd(row.planned)} · Spent unknown`
            : `Plan ${formatUsd(row.planned)} · Spent ${formatUsd(row.spent)} recorded · the rest of this month is unknown`
          : `Plan ${formatUsd(row.planned)} · Spent ${formatUsd(row.spent)} · Left ${formatUsd(row.left)}`}
      </Meta>
      {gapUnknown ? null : (
        <Meta>
          Last month {formatUsd(row.lastMonth)}
          {row.delta === 0 ? '' : ` · ${formatUsd(Math.abs(row.delta))} ${row.delta > 0 ? 'higher' : 'lower'}`}
        </Meta>
      )}
      {gapUnknown ? null : (
        <ShareBar label="" share={fill} color={row.left < 0 ? colors.danger : colors.accent} />
      )}
      {row.editable && open ? (
        <>
          <Field
            accessibilityLabel={`Monthly plan for ${row.label}`}
            value={draft}
            onChangeText={(next) => {
              setPlanError(null);
              setDraft(next);
            }}
            keyboardType="decimal-pad"
            placeholder="400 or $1,200"
          />
          {planError ? <Meta>{planError}</Meta> : null}
          <Button
            label="Save plan"
            onPress={() => {
              const amount = parseMoney(draft);
              if (amount == null) {
                setPlanError('The plan has to be a number, like 400 or $1,200.');
                return;
              }
              setPlanError(null);
              updateHousehold((current) => setCategoryPlan(current, row.category, amount));
              setOpen(false);
            }}
          />
        </>
      ) : null}
      {row.editable && !open ? (
        <Button
          label="Edit plan"
          tone="ghost"
          onPress={() => {
            setDraft(row.planned ? String(row.planned) : '');
            setOpen(true);
          }}
        />
      ) : null}
      {row.editable ? null : (
        <Meta>More than one bill shares this category. Change those bills on the budget.</Meta>
      )}
    </View>
  );
}

function SpendTools({ row }: { row: LedgerRow }) {
  const { household, setHousehold, updateHousehold } = useHousehold();
  const choices = BUDGET_CATEGORIES.filter((item) => item !== row.category);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [name, setName] = useState(row.merchant);
  const [tag, setTag] = useState('');
  const [category, setCategory] = useState<BudgetCategory>(choices[0] ?? 'other_living');
  const [splitError, setSplitError] = useState<string | null>(null);
  if (!household) return null;
  const currentTag = (household.merchantTags ?? []).find((item) => merchantKey(item.merchant) === merchantKey(row.merchant));

  return (
    <View style={{ gap: 8 }}>
      <Hairline />
      <Body>
        {row.merchant} · {formatUsd(row.amount)}
        {row.category ? ` · ${BUDGET_CATEGORY_LABELS[row.category]}` : ''}
        {currentTag ? ` · ${currentTag.tag}` : ''}
      </Body>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {choices.map((item) => (
          <Chip
            key={item}
            label={BUDGET_CATEGORY_LABELS[item]}
            selected={category === item}
            onPress={() => setCategory(item)}
          />
        ))}
      </View>
      {open ? (
        <>
          <Field
            value={amount}
            onChangeText={(next) => {
              setSplitError(null);
              setAmount(next);
            }}
            keyboardType="decimal-pad"
            placeholder="Amount for the other category"
          />
          {splitError ? <Meta>{splitError}</Meta> : null}
          <Button
            label="Split"
            onPress={() => {
              const part = parseMoney(amount);
              if (part == null) {
                setSplitError('The split has to be a number, like 12 or $12.');
                return;
              }
              setSplitError(null);
              const next = splitSpend(household, row.id, category, part);
              if (next) setHousehold(next);
              setOpen(false);
            }}
          />
        </>
      ) : (
        <Button label="Split this charge" tone="ghost" onPress={() => setOpen(true)} />
      )}
      <Button
        label={`Remember ${row.merchant} as ${BUDGET_CATEGORY_LABELS[category]}`}
        tone="ghost"
        onPress={() => updateHousehold((current) => setMerchantRule(current, row.merchant, category))}
      />
      <Field value={name} onChangeText={setName} placeholder="Merchant name" />
      <Button
        label="Rename merchant"
        tone="ghost"
        onPress={() => {
          const next = name.trim();
          if (!next || next === row.merchant) return;
          updateHousehold((current) => renameMerchant(current, row.merchant, next));
        }}
      />
      <Field value={tag} onChangeText={setTag} placeholder={currentTag ? `Tag · ${currentTag.tag}` : 'Tag'} />
      {tag.trim() ? (
        <Button
          label="Save tag"
          tone="ghost"
          onPress={() => updateHousehold((current) => setMerchantTag(current, row.merchant, tag))}
        />
      ) : null}
      {currentTag ? (
        <Button
          label="Clear tag"
          tone="ghost"
          onPress={() => {
            setTag('');
            updateHousehold((current) => setMerchantTag(current, row.merchant, ''));
          }}
        />
      ) : null}
    </View>
  );
}

function BankRow({ itemId, name }: { itemId: string; name: string }) {
  const { household, setHousehold, readHousehold } = useHousehold();
  const [note, setNote] = useState<string | null>(null);
  if (!household) return null;

  return (
    <View style={{ gap: 8 }}>
      <Body>{name}</Body>
      {note ? <Meta>{note}</Meta> : null}
      <Button
        label="Disconnect"
        tone="danger"
        onPress={() => {
          confirm('Disconnect this bank?', 'The books stay. The link does not.', () => {
          void disconnectInstitution(itemId).then((result) => {
            const current = readHousehold();
            if (!current) return;
            setHousehold(forgetPlaidItem(current, itemId));
            setNote(
              result === 'removed'
                ? 'Disconnected. The books and the hired date are still here.'
                : 'Removed on this phone. The bank token could not be reached.',
            );
          });
          });
        }}
      />
    </View>
  );
}
