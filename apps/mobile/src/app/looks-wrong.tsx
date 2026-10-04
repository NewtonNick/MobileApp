import { useState } from 'react';
import { TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { DEFAULT_WITHDRAWAL_RATE, FIRE_FLAVOR_LABELS, FIRE_FLAVORS, PAYCHECK_CADENCE_LABELS, PAYCHECK_CADENCES, applyLiquidTotal, featuredHome, formatUsd, hiredJobTitle, isInvestment, isLiability, liquidSum, parseMileage, parseMoney, parsePercentInput, parseYear } from '@asset-aware/forecast-engine';
import { useForecasts, useHousehold } from '@/state/context';
import { PercentField } from '@/ui/percent-field';
import { Body, Button, Meta, Screen, Title, useFieldStyle } from '@/ui/primitives';

function isRentRow(expense: { id: string; name: string }): boolean {
  return expense.id === 'exp-rent' || expense.name.trim().toLowerCase() === 'rent';
}

export default function LooksWrongScreen() {
  const field = useFieldStyle();
  const router = useRouter();
  const { focus } = useLocalSearchParams<{ focus?: string }>();
  const { household, setHousehold, settings, standingView, patchSettings } = useHousehold();
  const results = useForecasts();
  const [roof, setRoof] = useState(household?.assets.find((a) => a.type === 'home')?.roofYear?.toString() ?? '');
  const [hvac, setHvac] = useState('');
  const [miles, setMiles] = useState('');
  const [maint, setMaint] = useState('');
  const [paycheck, setPaycheck] = useState(household?.monthlyIncome?.toString() ?? '');
  const [partner, setPartner] = useState(household?.partnerMonthlyIncome?.toString() ?? '');
  const livingRow = household?.expenses.find((expense) => !isRentRow(expense) && !expense.linkedLiabilityId);
  const rentRow = household?.expenses.find((expense) => isRentRow(expense));
  const [bill, setBill] = useState(livingRow?.monthlyAmount?.toString() ?? '');
  const [rentBill, setRentBill] = useState(rentRow?.monthlyAmount?.toString() ?? '');
  const [error, setError] = useState<string | null>(null);
  const [cashAmt, setCashAmt] = useState(household ? String(liquidSum(household)) : '');
  const [targetDate, setTargetDate] = useState(household?.targetDate ?? '');
  const [rate, setRate] = useState(
    settings.withdrawalRate != null ? String(settings.withdrawalRate * 100) : String(DEFAULT_WITHDRAWAL_RATE * 100),
  );
  const [aprs, setAprs] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      (household?.accounts ?? [])
        .filter((a) => isLiability(a.type))
        .map((a) => [a.id, a.apr == null ? '' : String(a.apr * 100)]),
    ),
  );
  const [investReturns, setInvestReturns] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      (household?.accounts ?? [])
        .filter((a) => isInvestment(a.type))
        .map((a) => [a.id, a.expectedReturn == null ? '' : String(a.expectedReturn * 100)]),
    ),
  );
  if (!household || !results) return <Screen><Title>Nothing to edit</Title></Screen>;
  const view = results[settings.scenario];
  const job = hiredJobTitle(household.jobClass, household.fireFlavor, household.goalSpec);

  const apply = () => {
    const now = new Date().toISOString();
    if (paycheck.trim() && parseMoney(paycheck) == null) {
      setError('Take-home has to be a positive number.');
      return;
    }
    if (partner.trim() && parseMoney(partner) == null) {
      setError('Partner take-home has to be a positive number.');
      return;
    }
    if (bill.trim() && parseMoney(bill) == null) {
      setError('The living bill has to be a positive number.');
      return;
    }
    if (rentBill.trim() && parseMoney(rentBill) == null) {
      setError('Rent has to be a positive number.');
      return;
    }
    if (roof.trim() && parseYear(roof) == null) {
      setError('Roof year has to be 1900 through next year.');
      return;
    }
    if (hvac.trim() && parseYear(hvac) == null) {
      setError('HVAC year has to be 1900 through next year.');
      return;
    }
    if (cashAmt.trim() && parseMoney(cashAmt) == null) {
      setError('Cash has to be a positive number.');
      return;
    }
    if (maint.trim() && parseMoney(maint) == null) {
      setError('Maintenance has to be a positive number.');
      return;
    }
    if (miles.trim() && parseMileage(miles) == null) {
      setError('Mileage has to be between 0 and 500,000.');
      return;
    }
    for (const raw of [...Object.values(aprs), ...Object.values(investReturns), rate]) {
      if (raw.trim() && parsePercentInput(raw) == null) {
        setError('Confirm the rate. A number like 0.07 is not stored until you say whether it is 7% or 0.07%.');
        return;
      }
    }
    const house = featuredHome(household);
    const car = household.assets.find((asset) => asset.type === 'vehicle');
    const assets = household.assets.map((a) => {
      if (house && a.id === house.id && (focus === 'home' || !focus)) {
        return {
          ...a,
          roofYear: roof === '' ? null : parseYear(roof),
          hvacYear: hvac === '' ? a.hvacYear : parseYear(hvac),
          lastEditedAt: now,
        };
      }
      if (car && a.id === car.id && (focus === 'vehicle' || !focus)) {
        return {
          ...a,
          mileage: miles ? parseMileage(miles) : a.mileage,
          costOverrides: maint ? { ...a.costOverrides, annualMaint: parseMoney(maint) ?? undefined } : a.costOverrides,
          lastEditedAt: now,
        };
      }
      return a;
    });
    const cashN = parseMoney(cashAmt);
    const withCash = cashAmt !== '' && cashN != null ? applyLiquidTotal(household, cashN, now) : household;
    const accounts = withCash.accounts.map((a) => {
      if (isLiability(a.type) && a.id in aprs) {
        return { ...a, apr: parsePercentInput(aprs[a.id]), lastEditedAt: now };
      }
      if (isInvestment(a.type) && a.id in investReturns) {
        return { ...a, expectedReturn: parsePercentInput(investReturns[a.id]) ?? a.expectedReturn, lastEditedAt: now };
      }
      return a;
    });
    let expenses = household.expenses;
    if (bill !== '') {
      const amount = parseMoney(bill) ?? 0;
      const current = household.expenses.find((expense) => !isRentRow(expense) && !expense.linkedLiabilityId);
      expenses = current
        ? expenses.map((expense) => (expense.id === current.id ? { ...expense, monthlyAmount: amount } : expense))
        : [...expenses, { id: 'exp-living', name: 'Living', monthlyAmount: amount, variable: true }];
    }
    if (rentBill !== '') {
      const amount = parseMoney(rentBill) ?? 0;
      const current = expenses.find((expense) => isRentRow(expense));
      expenses = current
        ? expenses.map((expense) => (expense.id === current.id ? { ...expense, name: 'Rent', monthlyAmount: amount } : expense))
        : [...expenses, { id: 'exp-rent', name: 'Rent', monthlyAmount: amount, variable: false }];
    }
    setHousehold({
      ...household,
      assets,
      accounts,
      expenses,
      monthlyIncome: paycheck.trim() === '' ? household.monthlyIncome : parseMoney(paycheck),
      partnerMonthlyIncome: partner.trim() === '' ? null : parseMoney(partner),
      targetDate: targetDate.trim() ? targetDate.trim() : null,
    });
    const parsedRate = parsePercentInput(rate, { allowZero: true });
    if (parsedRate != null) {
      patchSettings({ withdrawalRate: parsedRate });
    }
    router.back();
  };

  return (
    <Screen>
        <Title>Adjust the date</Title>
        <Body>
          These change {job}, then standing recomputes. {settings.scenario} house 5-year cost is now about{' '}
          {formatUsd(view.houseCost5y)}.
          {standingView ? ` Standing leftover is about ${formatUsd(standingView.leftover)}.` : ''}
        </Body>

        <Meta>Take-home pay (monthly)</Meta>
        <TextInput accessibilityLabel="Take-home pay" value={paycheck} onChangeText={setPaycheck} keyboardType="decimal-pad" style={field} />
        <Meta>Partner take-home (monthly)</Meta>
        <TextInput accessibilityLabel="Partner take-home" value={partner} onChangeText={setPartner} keyboardType="decimal-pad" style={field} />
        <Meta>Paycheck cadence</Meta>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {PAYCHECK_CADENCES.map((c) => (
            <Button
              key={c}
              tone={household.paycheckCadence === c ? 'accent' : 'ghost'}
              label={PAYCHECK_CADENCE_LABELS[c]}
              onPress={() => setHousehold({ ...household, paycheckCadence: c })}
            />
          ))}
        </View>
        {household.jobClass === 'work_optional' ? (
          <>
            <Meta>Retire early flavor</Meta>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {FIRE_FLAVORS.map((f) => (
                <Button
                  key={f}
                  tone={household.fireFlavor === f ? 'accent' : 'ghost'}
                  label={FIRE_FLAVOR_LABELS[f]}
                  onPress={() => setHousehold({ ...household, fireFlavor: f })}
                />
              ))}
            </View>
          </>
        ) : null}
        {error ? <Meta>{error}</Meta> : null}
        <Meta>{livingRow ? `Living · ${livingRow.name}` : 'Living'}</Meta>
        <TextInput value={bill} onChangeText={setBill} keyboardType="decimal-pad" style={field} />
        <Meta>Rent</Meta>
        <TextInput value={rentBill} onChangeText={setRentBill} keyboardType="decimal-pad" style={field} />
        <PercentField label="Withdrawal rate" value={rate} onChangeText={setRate} />
        <Button
          label="Use 4%"
          tone="ghost"
          onPress={() => {
            setRate('4');
            patchSettings({ withdrawalRate: null });
          }}
        />

        {household.accounts.filter((a) => isLiability(a.type)).map((a) => (
          <View key={a.id}>
            <PercentField
              label={`${a.name} interest rate`}
              value={aprs[a.id] ?? ''}
              onChangeText={(v) => setAprs((prev) => ({ ...prev, [a.id]: v }))}
            />
          </View>
        ))}
        {household.accounts.filter((a) => isInvestment(a.type)).map((a) => (
          <View key={a.id}>
            <PercentField
              label={`${a.name} expected return`}
              value={investReturns[a.id] ?? ''}
              onChangeText={(v) => setInvestReturns((prev) => ({ ...prev, [a.id]: v }))}
            />
          </View>
        ))}
        <Meta>Hired date override (YYYY-MM-DD)</Meta>
        <TextInput value={targetDate} onChangeText={setTargetDate} style={field} />
        <Button label="Clear date override" tone="ghost" onPress={() => setTargetDate('')} />

        <Meta>Cash on hand (checking and savings, combined)</Meta>
        <TextInput value={cashAmt} onChangeText={setCashAmt} keyboardType="decimal-pad" style={field} />
        <Meta>Roof year</Meta>
        <TextInput value={roof} onChangeText={setRoof} keyboardType="number-pad" style={field} />
        <Button label="Not sure on roof" tone="ghost" onPress={() => setRoof('')} />
        <Meta>HVAC year</Meta>
        <TextInput value={hvac} onChangeText={setHvac} keyboardType="number-pad" style={field} />
        <Meta>Mileage</Meta>
        <TextInput value={miles} onChangeText={setMiles} keyboardType="number-pad" style={field} />
        <Meta>Vehicle annual maintenance override</Meta>
        <TextInput value={maint} onChangeText={setMaint} keyboardType="decimal-pad" style={field} />
        <Button label="Update" onPress={apply} />
    </Screen>
  );
}
