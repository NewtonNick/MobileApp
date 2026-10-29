import { useMemo, useState } from 'react';
import { TextInput, View } from 'react-native';
import { type Href, useRouter } from 'expo-router';

import {
  HOUSING_TENURE_LABELS,
  HOUSING_TENURES,
  PAYCHECK_CADENCE_LABELS,
  PAYCHECK_CADENCES,
  applyLiquidTotal,
  firstLoanMissingApr,
  hasMortgageAccount,
  isInvestment,
  isLiquid,
  monthKeyFromIndex,
  nextBest,
  parseIsoDate,
  parseMileage,
  parseMoney,
  parsePercentInput,
  parseYear,
  searchVehicles,
  vehicleIdentityFromQuery,
  typicalAprPercent,
  type AccountType,
  type HouseholdInput,
  type VehicleClass,
} from '@asset-aware/forecast-engine';
import { seedBundle } from '@/lib/seed';
import { useColors } from '@/ui/appearance';
import { useHousehold } from '@/state/context';
import { ForecastMonthField } from '@/ui/month-field';
import { PercentField } from '@/ui/percent-field';
import { Body, Button, Card, Chip, Meta, Screen, Title, useFieldStyle } from '@/ui/primitives';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const VEHICLE_CLASSES: VehicleClass[] = ['car', 'suv', 'truck', 'van', 'ev', 'motorcycle', 'rv'];

export default function ImproveScreen() {
  const colors = useColors();
  const field = useFieldStyle();
  const router = useRouter();
  const { household, setHousehold } = useHousehold();
  const probe = household ? nextBest(household) : null;

  const home = household?.assets.find((a) => a.type === 'home');
  const vehicle = household?.assets.find((a) => a.type === 'vehicle');
  const cash = household?.accounts.find((a) => isLiquid(a.type));
  const missingApr = household ? firstLoanMissingApr(household.accounts) : null;
  const now = () => new Date().toISOString();

  const [text, setText] = useState('');
  const [carQuery, setCarQuery] = useState('');
  const [carClass, setCarClass] = useState<VehicleClass>('car');
  const [picked, setPicked] = useState<(typeof hits)[0] | null>(null);
  const [loanType, setLoanType] = useState<AccountType>('student_loan');
  const [loanName, setLoanName] = useState('Loan');
  const [loanPay, setLoanPay] = useState('');
  const [loanApr, setLoanApr] = useState('');
  const [error, setError] = useState<string | null>(null);

  const hits = useMemo(() => searchVehicles(seedBundle.vehicle, carQuery, 6), [carQuery]);

  if (!household) {
    return (
      <Screen>
        <Title>Nothing to improve</Title>
        <Button label="Start" onPress={() => router.replace('/job-pick' as Href)} />
      </Screen>
    );
  }

  if (!probe) {
    return (
      <Screen>
        <Title>This job is tight enough</Title>
        <Body>Standing already has the facts it needs. Change a number from This looks wrong if something is off.</Body>
        <Button label="Back to standing" onPress={() => router.replace('/(tabs)')} />
      </Screen>
    );
  }

  const books = household;
  const done = () => router.replace('/(tabs)');
  const rememberSkip = () => {
    const skipped = new Set(household.skippedQuestions ?? []);
    skipped.add(probe.key);
    patch({ ...household, skippedQuestions: [...skipped] });
  };

  const patch = (next: HouseholdInput) => {
    setHousehold(next);
    done();
  };

  const upsertAsset = (type: 'home' | 'vehicle', fields: Record<string, unknown>) => {
    const existing = books.assets.find((a) => a.type === type);
    const id = existing?.id ?? `${type}-1`;
    const nextAsset = {
      ...(existing ?? {
        id,
        type,
        name: type === 'home' ? 'House' : 'Vehicle',
        value: null,
        lastEditedAt: now(),
      }),
      ...fields,
      id,
      type,
      lastEditedAt: now(),
    };
    const assets = existing
      ? books.assets.map((a) => (a.id === existing.id ? { ...existing, ...nextAsset } : a))
      : [...books.assets, nextAsset];
    patch({ ...books, assets });
  };

  const upsertAccount = (
    match: (a: HouseholdInput['accounts'][0]) => boolean,
    row: HouseholdInput['accounts'][0],
  ) => {
    const existing = books.accounts.find(match);
    const accounts = existing
      ? books.accounts.map((a) => (a.id === existing.id ? { ...existing, ...row, id: existing.id } : a))
      : [...books.accounts, row];
    patch({ ...books, accounts });
  };

  const saveNumber = (apply: (n: number) => void) => {
    const n = parseMoney(text);
    if (n == null) {
      setError('That has to be a number, like 400 or $1,200.');
      return;
    }
    setError(null);
    apply(n);
  };

  return (
    <Screen>
        <Title>Improve this plan</Title>
        <Body>{probe.question}</Body>
        {error ? <Meta>{error}</Meta> : null}

        {probe.key === 'tenure' ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {HOUSING_TENURES.map((id) => (
              <Button
                key={id}
                tone="ghost"
                label={HOUSING_TENURE_LABELS[id]}
                onPress={() =>
                  patch({
                    ...household,
                    housingTenure: id,
                    hasMortgage: id === 'own' ? household.hasMortgage : null,
                  })
                }
              />
            ))}
          </View>
        ) : null}

        {probe.key === 'vehicle_yesno' ? (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button label="Yes" onPress={() => patch({ ...household, hasVehicle: true })} />
            <Button
              label="No"
              tone="ghost"
              onPress={() =>
                patch({
                  ...household,
                  hasVehicle: false,
                  assets: household.assets.filter((a) => a.type !== 'vehicle'),
                })
              }
            />
          </View>
        ) : null}

        {probe.key === 'mortgage_yn' ? (
          <View style={{ gap: 8 }}>
            <Button label="Paid off" onPress={() => patch({ ...household, hasMortgage: false })} />
            <Button label="Still have a mortgage" tone="ghost" onPress={() => patch({ ...household, hasMortgage: true })} />
          </View>
        ) : null}

        {probe.key === 'car' ? (
          <View style={{ gap: 10 }}>
            <Meta>Year, make, model</Meta>
            <TextInput
              value={carQuery}
              onChangeText={(v) => {
                setCarQuery(v);
                setPicked(null);
                setCarClass('car');
              }}
              placeholderTextColor={colors.muted}
              style={field}
            />
            {hits.slice(0, 4).map((hit) => (
              <Card key={`${hit.year}-${hit.make}-${hit.model}`}>
                <Button
                  tone="ghost"
                  label={`${hit.year} ${hit.make} ${hit.model}`}
                  onPress={() => {
                    setPicked(hit);
                    setCarQuery(`${hit.year} ${hit.make} ${hit.model}`);
                    setCarClass(hit.class);
                  }}
                />
              </Card>
            ))}
            <Meta>Vehicle value</Meta>
            <TextInput value={text} onChangeText={setText} keyboardType="decimal-pad" placeholder="14000" style={field} />
            <Button
              label="Add the car"
              onPress={() => {
                const value = text.trim() ? parseMoney(text) : null;
                if (text.trim() && value == null) {
                  setError('That has to be a number, like 400 or $1,200.');
                  return;
                }
                const identity = vehicleIdentityFromQuery(seedBundle.vehicle, carQuery, picked, carClass);
                upsertAsset('vehicle', {
                  name: identity.name,
                  value,
                  vehicleYear: identity.vehicleYear,
                  make: identity.make,
                  model: identity.model,
                  vehicleClass: identity.vehicleClass,
                  mpg: identity.mpg,
                  kwhPerMile: identity.kwhPerMile,
                });
              }}
            />
          </View>
        ) : null}

        {probe.key === 'house' || probe.key === 'house_value' || probe.key === 'zip' ? (
          <View style={{ gap: 10 }}>
            {probe.key === 'zip' || !household.zip ? (
              <>
                <Meta>ZIP</Meta>
                <TextInput
                  value={probe.key === 'zip' ? text : household.zip}
                  onChangeText={setText}
                  keyboardType="number-pad"
                  placeholder="10001"
                  style={field}
                />
              </>
            ) : null}
            {probe.key !== 'zip' ? (
              <>
                <Meta>{probe.key === 'house' ? 'House value' : 'House value'}</Meta>
                <TextInput value={text} onChangeText={setText} keyboardType="decimal-pad" placeholder="400000" style={field} />
              </>
            ) : null}
            <Button
              label="Save"
              onPress={() => {
                if (probe.key === 'zip') {
                  patch({ ...household, zip: text.trim() });
                  return;
                }
                saveNumber((n) => {
                  const target = household.assets.find((a) => a.type === 'home' && a.value == null) ?? home;
                  const assets = target
                    ? household.assets.map((a) =>
                        a.id === target.id ? { ...a, value: n, lastEditedAt: now() } : a,
                      )
                    : [
                        ...household.assets,
                        { id: 'home-1', type: 'home' as const, name: 'House', value: n, lastEditedAt: now() },
                      ];
                  patch({ ...household, zip: household.zip || text.trim(), assets });
                });
              }}
            />
          </View>
        ) : null}

        {probe.key === 'roof' || probe.key === 'hvac' || probe.key === 'mileage' ? (
          <View style={{ gap: 10 }}>
            <TextInput
              value={text}
              onChangeText={setText}
              keyboardType="number-pad"
              placeholder={probe.key === 'mileage' ? '72000' : '2014'}
              style={field}
            />
            <Button
              label="Save"
              onPress={() => {
                if (probe.key === 'mileage') {
                  const n = parseMileage(text);
                  const target = household.assets.find((a) => a.type === 'vehicle' && a.mileage == null) ?? vehicle;
                  if (n == null || !target) {
                    setError(n == null ? 'Mileage has to be a number, like 72000.' : 'Add the car before saving mileage.');
                    return;
                  }
                  setError(null);
                  patch({
                    ...household,
                    assets: household.assets.map((a) =>
                      a.id === target.id ? { ...a, mileage: n, lastEditedAt: now() } : a,
                    ),
                  });
                  return;
                }
                const year = parseYear(text);
                const fieldName = probe.key === 'roof' ? 'roofYear' : 'hvacYear';
                const target =
                  household.assets.find((a) => a.type === 'home' && a[fieldName] == null) ?? home;
                if (year == null || !target) {
                  setError(year == null ? 'That year has to look like 2014.' : 'Add the house before saving this year.');
                  return;
                }
                setError(null);
                patch({
                  ...household,
                  assets: household.assets.map((a) =>
                    a.id === target.id ? { ...a, [fieldName]: year, lastEditedAt: now() } : a,
                  ),
                });
              }}
            />
            <Button label="Not sure — skip for now" tone="ghost" onPress={rememberSkip} />
          </View>
        ) : null}

        {probe.key === 'income' || probe.key === 'spend' || probe.key === 'rent' || probe.key === 'cash' || probe.key === 'investments' || probe.key === 'partner' ? (
          <View style={{ gap: 10 }}>
            {probe.key === 'investments' ? (
              <>
                <Meta>Balance</Meta>
                <TextInput value={text} onChangeText={setText} keyboardType="decimal-pad" placeholder="180000" style={field} />
                <Meta>Expected annual return, percent</Meta>
                <TextInput value={loanApr} onChangeText={setLoanApr} keyboardType="decimal-pad" placeholder="7" style={field} />
              </>
            ) : (
              <TextInput
                value={text}
                onChangeText={setText}
                keyboardType="decimal-pad"
                placeholder={
                  probe.key === 'cash' ? String(cash?.balance ?? 18000) : probe.key === 'partner' ? '0' : '3200'
                }
                style={field}
              />
            )}
            <Button
              label="Save"
              onPress={() => {
                if (probe.key === 'investments' && loanApr.trim() && parsePercentInput(loanApr) == null) {
                  setError('Confirm the expected return before saving.');
                  return;
                }
                saveNumber((n) => {
                  if (probe.key === 'income') {
                    patch({ ...household, monthlyIncome: n });
                    return;
                  }
                  if (probe.key === 'partner') {
                    patch({ ...household, partnerMonthlyIncome: n });
                    return;
                  }
                  if (probe.key === 'cash') {
                    patch(applyLiquidTotal(household, n, now()));
                    return;
                  }
                  if (probe.key === 'investments') {
                    const inv = household.accounts.find((a) => isInvestment(a.type));
                    upsertAccount(
                      (a) => isInvestment(a.type),
                      {
                        id: inv?.id ?? 'inv-1',
                        type: 'retirement_401k',
                        name: '401k / IRA / brokerage',
                        balance: n,
                        expectedReturn: parsePercentInput(loanApr) ?? 0.07,
                        lastEditedAt: now(),
                      },
                    );
                    return;
                  }
                  const name = probe.key === 'rent' ? 'Rent' : 'Living';
                  const id = probe.key === 'rent' ? 'exp-rent' : 'exp-living';
                  const existing = household.expenses.find((e) => e.id === id || e.name.toLowerCase() === name.toLowerCase());
                  const expenses = existing
                    ? household.expenses.map((e) =>
                        e.id === existing.id ? { ...e, monthlyAmount: n, variable: probe.key !== 'rent' } : e,
                      )
                    : [
                        ...household.expenses,
                        { id, name, monthlyAmount: n, variable: probe.key !== 'rent' },
                      ];
                  patch({ ...household, expenses });
                });
              }}
            />
          </View>
        ) : null}

        {probe.key === 'apr' && missingApr ? (
          <View style={{ gap: 10 }}>
            <Meta>
              Annual rate, like {typicalAprPercent(missingApr.type)}. Leave blank only if you want the typical.
            </Meta>
            <TextInput value={text} onChangeText={setText} keyboardType="decimal-pad" placeholder={String(typicalAprPercent(missingApr.type))} style={field} />
            <Button
              label="Save rate"
              onPress={() => {
                if (text.trim() && parsePercentInput(text) == null) {
                  setError('Confirm the interest rate before saving.');
                  return;
                }
                const parsed = parsePercentInput(text);
                patch({
                  ...household,
                  accounts: household.accounts.map((a) =>
                    a.id === missingApr.id ? { ...a, apr: parsed, lastEditedAt: now() } : a,
                  ),
                });
              }}
            />
          </View>
        ) : null}

        {probe.key === 'mortgage' || probe.key === 'debts' ? (
          <View style={{ gap: 10 }}>
            {probe.key === 'debts' ? (
              <>
                <Meta>What kind of loan</Meta>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {(
                    [
                      ['mortgage', 'Mortgage'],
                      ['auto_loan', 'Auto'],
                      ['student_loan', 'Student'],
                      ['credit_card', 'Card'],
                      ['other_liability', 'Other'],
                    ] as const
                  ).map(([id, label]) => (
                    <Button
                      key={id}
                      tone={loanType === id ? 'accent' : 'ghost'}
                      label={label}
                      onPress={() => {
                        setLoanType(id);
                        setLoanName(label);
                      }}
                    />
                  ))}
                </View>
                <Meta>Name</Meta>
                <TextInput value={loanName} onChangeText={setLoanName} style={field} />
              </>
            ) : null}
            <Meta>Balance</Meta>
            <TextInput value={text} onChangeText={setText} keyboardType="decimal-pad" placeholder="24000" style={field} />
            <Meta>Minimum payment, monthly</Meta>
            <TextInput value={loanPay} onChangeText={setLoanPay} keyboardType="decimal-pad" placeholder="450" style={field} />
            <Meta>Interest rate, percent</Meta>
            <TextInput
              value={loanApr}
              onChangeText={setLoanApr}
              keyboardType="decimal-pad"
              placeholder={String(typicalAprPercent(probe.key === 'mortgage' ? 'mortgage' : loanType))}
              style={field}
            />
            <Button
              label="Add loan"
              onPress={() => {
                const balance = parseMoney(text);
                const payment = loanPay.trim() ? parseMoney(loanPay) : null;
                if (balance == null || balance <= 0) {
                  setError('The balance has to be a number, like 24000 or $24,000.');
                  return;
                }
                if (loanPay.trim() && payment == null) {
                  setError('The payment has to be a number, like 450 or $450.');
                  return;
                }
                if (loanApr.trim() && parsePercentInput(loanApr) == null) {
                  setError('Confirm the interest rate before saving.');
                  return;
                }
                const type: AccountType = probe.key === 'mortgage' ? 'mortgage' : loanType;
                upsertAccount(
                  (a) => a.type === type && probe.key === 'mortgage',
                  {
                    id: `debt-${Date.now()}`,
                    type,
                    name: probe.key === 'mortgage' ? 'Mortgage' : loanName || 'Loan',
                    balance,
                    minPayment: payment,
                    apr: parsePercentInput(loanApr),
                    lastEditedAt: now(),
                  },
                );
              }}
            />
          </View>
        ) : null}

        {probe.key === 'ss_age' || probe.key === 'pension_age' || probe.key === 'partner_ss_age' || probe.key === 'partner_age' ? (
          <View style={{ gap: 10 }}>
            <TextInput
              accessibilityLabel="Age"
              value={text}
              onChangeText={setText}
              keyboardType="number-pad"
              placeholder="67"
              placeholderTextColor={colors.muted}
              style={field}
            />
            <Button
              label="Save age"
              onPress={() => {
                const age = Number(text.trim());
                if (!Number.isInteger(age) || age < 1 || age > 120) {
                  setError('Age has to be a whole number from 1 to 120.');
                  return;
                }
                setError(null);
                if (probe.key === 'ss_age') {
                  patch({ ...household, socialSecurity: { ...household.socialSecurity, monthlyAmount: household.socialSecurity?.monthlyAmount ?? null, startAge: age } });
                  return;
                }
                if (probe.key === 'pension_age') {
                  patch({ ...household, pension: { ...household.pension, monthlyAmount: household.pension?.monthlyAmount ?? null, startAge: age } });
                  return;
                }
                if (probe.key === 'partner_ss_age') {
                  patch({
                    ...household,
                    partnerSocialSecurity: {
                      ...household.partnerSocialSecurity,
                      monthlyAmount: household.partnerSocialSecurity?.monthlyAmount ?? null,
                      startAge: age,
                    },
                  });
                  return;
                }
                patch({ ...household, partnerAge: age });
              }}
            />
          </View>
        ) : null}

        {probe.key === 'extra_month' ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {MONTHS.map((label, index) => (
              <Button
                key={label}
                tone="ghost"
                label={label}
                onPress={() => {
                  const month = index + 1;
                  patch({
                    ...household,
                    extraIncomes: (household.extraIncomes ?? []).map((row) =>
                      row.schedule === 'annual' && (row.monthOfYear == null || row.monthOfYear < 1 || row.monthOfYear > 12)
                        ? { ...row, monthOfYear: month }
                        : row,
                    ),
                  });
                }}
              />
            ))}
          </View>
        ) : null}

        {probe.key === 'payday' ? (
          <View style={{ gap: 10 }}>
            <TextInput
              accessibilityLabel="Next payday"
              value={text}
              onChangeText={setText}
              placeholder="2026-10-03"
              placeholderTextColor={colors.muted}
              style={field}
            />
            <Button
              label="Save payday"
              onPress={() => {
                if (!parseIsoDate(text.trim())) {
                  setError('Use a date like 2026-10-03.');
                  return;
                }
                setError(null);
                patch({ ...household, nextPayday: text.trim() });
              }}
            />
          </View>
        ) : null}

        {probe.key === 'mortgage_match' ? (
          <Button
            label="Match the loans on the books"
            onPress={() => patch({ ...household, hasMortgage: hasMortgageAccount(household) })}
          />
        ) : null}

        {probe.key === 'lease' ? (
          <View style={{ gap: 8 }}>
            <Button
              label="Yes, it is a lease"
              onPress={() =>
                upsertAccount(
                  (account) => account.type === 'auto_lease',
                  {
                    id: `lease-${Date.now()}`,
                    type: 'auto_lease',
                    name: 'Lease',
                    balance: 0,
                    minPayment: null,
                    lastEditedAt: now(),
                  },
                )
              }
            />
            <Button label="No, we own it" tone="ghost" onPress={rememberSkip} />
          </View>
        ) : null}

        {probe.key === 'lease_end' ? (
          <ForecastMonthField
            label="Lease ends"
            value={household.accounts.find((account) => account.type === 'auto_lease' && !account.endsAt)?.endsAt ?? null}
            onChange={(next) => {
              const target = household.accounts.find((account) => account.type === 'auto_lease' && !account.endsAt);
              if (!target) return;
              patch({
                ...household,
                accounts: household.accounts.map((account) =>
                  account.id === target.id ? { ...account, endsAt: next, lastEditedAt: now() } : account,
                ),
              });
            }}
          />
        ) : null}

        {probe.key === 'arm' ? (
          <View style={{ gap: 10 }}>
            <Button
              label="Fixed rate"
              onPress={() => {
                const target = household.accounts.find((account) => account.type === 'mortgage' && account.balance > 0 && !account.rateFixedUntil && account.indexMargin == null);
                if (!target) return;
                patch({
                  ...household,
                  accounts: household.accounts.map((account) =>
                    account.id === target.id ? { ...account, indexMargin: 0, lastEditedAt: now() } : account,
                  ),
                });
              }}
            />
            <Meta>If it adjusts, set the month the fixed period ends and the margin.</Meta>
            <ForecastMonthField
              label="Fixed period ends"
              value={null}
              onChange={(next) => {
                const target = household.accounts.find((account) => account.type === 'mortgage' && account.balance > 0);
                if (!target || !next) return;
                const margin = parsePercentInput(loanApr, { bareFractionMeans: 'decimal', allowZero: true });
                if (loanApr.trim() && margin == null) {
                  setError('Confirm the margin before saving.');
                  return;
                }
                setError(null);
                patch({
                  ...household,
                  accounts: household.accounts.map((account) =>
                    account.id === target.id
                      ? { ...account, rateFixedUntil: next, indexMargin: loanApr.trim() ? margin : 0, lastEditedAt: now() }
                      : account,
                  ),
                });
              }}
            />
            <PercentField label="Margin added to the index" value={loanApr} onChangeText={setLoanApr} bareFractionMeans="decimal" allowZero />
          </View>
        ) : null}

        {probe.key === 'promo' || probe.key === 'promo_end' ? (
          <View style={{ gap: 10 }}>
            {probe.key === 'promo' ? (
              <Button label="No intro rate" tone="ghost" onPress={rememberSkip} />
            ) : null}
            <PercentField label="Intro rate" value={loanApr} onChangeText={setLoanApr} bareFractionMeans="decimal" allowZero />
            <ForecastMonthField
              label="Intro rate ends"
              value={household.accounts.find((account) => account.promoApr != null && !account.promoEndsAt)?.promoEndsAt ?? null}
              onChange={(next) => {
                const target =
                  household.accounts.find((account) => account.promoApr != null && !account.promoEndsAt) ??
                  household.accounts.find((account) => account.type === 'credit_card' && account.balance > 0);
                if (!target || !next) return;
                const intro = parsePercentInput(loanApr, { bareFractionMeans: 'decimal', allowZero: true });
                if (probe.key === 'promo' && intro == null) {
                  setError('Confirm the intro rate before saving.');
                  return;
                }
                setError(null);
                patch({
                  ...household,
                  accounts: household.accounts.map((account) =>
                    account.id === target.id
                      ? { ...account, promoEndsAt: next, promoApr: intro ?? account.promoApr ?? 0, lastEditedAt: now() }
                      : account,
                  ),
                });
              }}
            />
          </View>
        ) : null}

        {probe.key === 'interest_only' ? (
          <View style={{ gap: 10 }}>
            <Button
              label="It amortizes"
              onPress={() => {
                const target = household.accounts.find(
                  (account) =>
                    (account.type === 'mortgage' || account.type === 'auto_loan' || account.type === 'other_liability') &&
                    account.balance > 0 &&
                    !account.interestOnlyUntil,
                );
                if (!target) return;
                patch({
                  ...household,
                  accounts: household.accounts.map((account) =>
                    account.id === target.id
                      ? { ...account, interestOnlyUntil: monthKeyFromIndex(0, new Date()), lastEditedAt: now() }
                      : account,
                  ),
                });
              }}
            />
            <ForecastMonthField
              label="Interest-only through"
              value={null}
              onChange={(next) => {
                const target = household.accounts.find(
                  (account) =>
                    (account.type === 'mortgage' || account.type === 'auto_loan' || account.type === 'other_liability') &&
                    account.balance > 0 &&
                    !account.interestOnlyUntil,
                );
                if (!target || !next) return;
                patch({
                  ...household,
                  accounts: household.accounts.map((account) =>
                    account.id === target.id ? { ...account, interestOnlyUntil: next, lastEditedAt: now() } : account,
                  ),
                });
              }}
            />
          </View>
        ) : null}

        {probe.key === 'deferment' ? (
          <View style={{ gap: 10 }}>
            <Meta>Minimum payment, if it is in repayment</Meta>
            <TextInput
              accessibilityLabel="Payment"
              value={loanPay}
              onChangeText={setLoanPay}
              keyboardType="decimal-pad"
              placeholder="250"
              placeholderTextColor={colors.muted}
              style={field}
            />
            <Button
              label="Save payment"
              onPress={() => {
                const payment = parseMoney(loanPay);
                const target = household.accounts.find(
                  (account) => account.type === 'student_loan' && account.balance > 0 && (account.minPayment == null || account.minPayment <= 0) && !account.deferredUntil,
                );
                if (!target || payment == null || payment <= 0) {
                  setError('The payment has to be a number, like 250.');
                  return;
                }
                setError(null);
                patch({
                  ...household,
                  accounts: household.accounts.map((account) =>
                    account.id === target.id ? { ...account, minPayment: payment, lastEditedAt: now() } : account,
                  ),
                });
              }}
            />
            <ForecastMonthField
              label="Payments start again"
              value={null}
              onChange={(next) => {
                const target = household.accounts.find((account) => account.type === 'student_loan' && !account.deferredUntil);
                if (!target || !next) return;
                patch({
                  ...household,
                  accounts: household.accounts.map((account) =>
                    account.id === target.id ? { ...account, deferredUntil: next, subsidized: false, lastEditedAt: now() } : account,
                  ),
                });
              }}
            />
          </View>
        ) : null}

        {probe.key === 'income_end' ? (
          <View style={{ gap: 8 }}>
            <Button label="Stop pay at that date" onPress={() => patch({ ...household, retireAtHiredDate: true })} />
            <Button label="Keep pay after that date" tone="ghost" onPress={() => patch({ ...household, retireAtHiredDate: false })} />
          </View>
        ) : null}

        {probe.key === 'partner_benefits' ? (
          <View style={{ gap: 8 }}>
            <Button
              label="No partner benefits"
              onPress={() =>
                patch({
                  ...household,
                  partnerSocialSecurity: { monthlyAmount: 0, startAge: null },
                  partnerPension: { monthlyAmount: 0, startAge: null },
                })
              }
            />
            <Meta>Or type a monthly Social Security amount. You can add the start age next.</Meta>
            <TextInput
              accessibilityLabel="Partner Social Security per month"
              value={text}
              onChangeText={setText}
              keyboardType="decimal-pad"
              placeholder="1800"
              placeholderTextColor={colors.muted}
              style={field}
            />
            <Button
              label="Save benefit"
              onPress={() =>
                saveNumber((amount) =>
                  patch({
                    ...household,
                    partnerSocialSecurity: { monthlyAmount: amount, startAge: household.partnerSocialSecurity?.startAge ?? null },
                  }),
                )
              }
            />
          </View>
        ) : null}

        {probe.key === 'income_volatility' ? (
          <View style={{ gap: 10 }}>
            <Button label="Steady" onPress={() => patch({ ...household, incomeVolatility: 0 })} />
            <PercentField label="How much it can swing" value={loanApr} onChangeText={setLoanApr} allowZero />
            <Button
              label="Save swing"
              onPress={() => {
                const swing = parsePercentInput(loanApr, { allowZero: true });
                if (swing == null) {
                  setError('Confirm the percent before saving.');
                  return;
                }
                setError(null);
                patch({ ...household, incomeVolatility: swing });
              }}
            />
          </View>
        ) : null}

        {probe.key === 'rental' ? (
          <View style={{ gap: 10 }}>
            <Button
              label="No rent collected"
              tone="ghost"
              onPress={() => {
                const target = household.assets.find((asset) => asset.type === 'home' && asset.rentalIncomeMonthly == null);
                if (!target) return;
                patch({
                  ...household,
                  assets: household.assets.map((asset) =>
                    asset.id === target.id ? { ...asset, rentalIncomeMonthly: 0, lastEditedAt: now() } : asset,
                  ),
                });
              }}
            />
            <TextInput
              accessibilityLabel="Rent collected per month"
              value={text}
              onChangeText={setText}
              keyboardType="decimal-pad"
              placeholder="1500"
              placeholderTextColor={colors.muted}
              style={field}
            />
            <Button
              label="Save rent"
              onPress={() =>
                saveNumber((amount) => {
                  const target = household.assets.find((asset) => asset.type === 'home' && asset.rentalIncomeMonthly == null) ?? home;
                  if (!target) return;
                  patch({
                    ...household,
                    assets: household.assets.map((asset) =>
                      asset.id === target.id ? { ...asset, rentalIncomeMonthly: amount, lastEditedAt: now() } : asset,
                    ),
                  });
                })
              }
            />
          </View>
        ) : null}

        {probe.key === 'exterior' ? (
          <View style={{ gap: 8 }}>
            <Button
              label="We pay for the exterior"
              onPress={() => {
                const target = household.assets.find((asset) => asset.type === 'home' && asset.exteriorResponsibility == null) ?? home;
                if (!target) return;
                patch({
                  ...household,
                  assets: household.assets.map((asset) =>
                    asset.id === target.id ? { ...asset, exteriorResponsibility: 'owner', lastEditedAt: now() } : asset,
                  ),
                });
              }}
            />
            <Button
              label="The HOA pays for the exterior"
              tone="ghost"
              onPress={() => {
                const target = household.assets.find((asset) => asset.type === 'home' && asset.exteriorResponsibility == null) ?? home;
                if (!target) return;
                patch({
                  ...household,
                  assets: household.assets.map((asset) =>
                    asset.id === target.id ? { ...asset, exteriorResponsibility: 'hoa', lastEditedAt: now() } : asset,
                  ),
                });
              }}
            />
          </View>
        ) : null}

        {probe.key === 'vehicle_class' ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {VEHICLE_CLASSES.map((item) => (
              <Chip
                key={item}
                label={item}
                selected={false}
                onPress={() => {
                  const target = household.assets.find((asset) => asset.type === 'vehicle' && !asset.vehicleClass) ?? vehicle;
                  if (!target) return;
                  patch({
                    ...household,
                    assets: household.assets.map((asset) =>
                      asset.id === target.id ? { ...asset, vehicleClass: item, lastEditedAt: now() } : asset,
                    ),
                  });
                }}
              />
            ))}
          </View>
        ) : null}

        {probe.key === 'cadence' ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {PAYCHECK_CADENCES.map((id) => (
              <Button
                key={id}
                tone="ghost"
                label={PAYCHECK_CADENCE_LABELS[id]}
                onPress={() => patch({ ...books, paycheckCadence: id })}
              />
            ))}
          </View>
        ) : null}

        <Button
          label="Skip for now"
          tone="ghost"
          onPress={rememberSkip}
        />
    </Screen>
  );
}
