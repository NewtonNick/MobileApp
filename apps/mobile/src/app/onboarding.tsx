import { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';

import {
  DEFAULT_JOB_CLASS,
  FIRE_FLAVOR_LABELS,
  FIRE_FLAVORS,
  HOUSING_TENURE_LABELS,
  HOUSING_TENURES,
  PAYCHECK_CADENCE_LABELS,
  PAYCHECK_CADENCES,
  emptyRealHousehold,
  hiredJobTitle,
  intakeBlocksForHousehold,
  isInvestment,
  isLiability,
  isLiquid,
  openGoalSpecs,
  parseMoney,
  parsePercentInput,
  parseYear,
  searchVehicles,
  typicalAprPercent,
  type AccountType,
  type FireFlavor,
  type HousingTenure,
  type PaycheckCadence,
  type VehicleClass,
} from '@asset-aware/forecast-engine';
import { clearOnboardingDraft, loadOnboardingDraft, saveOnboardingDraft } from '@/onboarding/draft';
import { FIRE_FLAVOR_BLURB, HIRE_COPY } from '@/onboarding/spec';
import { requestNotifyPermission } from '@/notifications';
import { seedBundle } from '@/lib/seed';
import { useColors } from '@/ui/appearance';
import { useHousehold } from '@/state/context';
import { confirm } from '@/ui/confirm';
import { Body, Button, Card, FormField as Field, Meta, Screen, Title } from '@/ui/primitives';

const DEBT_TYPES: { id: AccountType; label: string }[] = [
  { id: 'mortgage', label: 'Mortgage' },
  { id: 'auto_loan', label: 'Auto' },
  { id: 'student_loan', label: 'Student' },
  { id: 'credit_card', label: 'Card' },
  { id: 'other_liability', label: 'Other' },
];

type DraftLoan = {
  id: string;
  name: string;
  type: AccountType;
  balance: string;
  payment: string;
  apr: string;
};

let loanSeq = 1;
function newLoan(type: AccountType, name: string): DraftLoan {
  return { id: `debt-${loanSeq++}`, name, type, balance: '', payment: '', apr: '' };
}

export default function OnboardingScreen() {
  const colors = useColors();
  const router = useRouter();
  const { household, setHousehold, patchSettings } = useHousehold();
  const saved = useRef(loadOnboardingDraft()).current;
  const scrollRef = useRef<ScrollView>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const job = household?.jobClass ?? DEFAULT_JOB_CLASS;
  const goals = household ? openGoalSpecs(household) : [];
  const jobTitle =
    goals.length > 1
      ? `${goals.length} goals`
      : job === 'custom' && household?.goalSpec?.name
        ? household.goalSpec.name
        : hiredJobTitle(job, household?.fireFlavor, household?.goalSpec);
  const copy = HIRE_COPY[job];
  const existingHome = household?.assets.find((a) => a.type === 'home');
  const existingCar = household?.assets.find((a) => a.type === 'vehicle');
  const existingCash = household?.accounts.find((a) => isLiquid(a.type));
  const existingInv = household?.accounts.find((a) => isInvestment(a.type));
  const existingRent = household?.expenses.find((e) => e.name.trim().toLowerCase() === 'rent');
  const existingSpend = household?.expenses.find((e) => e.name.trim().toLowerCase() !== 'rent');
  const existingLoans = household?.accounts.filter((a) => isLiability(a.type)) ?? [];

  const [tenure, setTenure] = useState<HousingTenure | null>(saved?.tenure ?? household?.housingTenure ?? null);
  const [hasVehicle, setHasVehicle] = useState<boolean | null>(saved?.hasVehicle ?? household?.hasVehicle ?? null);
  const [hasMortgage, setHasMortgage] = useState<boolean | null>(saved?.hasMortgage ?? household?.hasMortgage ?? null);
  const [zip, setZip] = useState(saved?.zip ?? household?.zip ?? '');
  const [houseValue, setHouseValue] = useState(saved?.houseValue ?? (existingHome?.value != null ? String(existingHome.value) : ''));
  const [yearBuilt, setYearBuilt] = useState(saved?.yearBuilt ?? (existingHome?.yearBuilt != null ? String(existingHome.yearBuilt) : ''));
  const [roofYear, setRoofYear] = useState(saved?.roofYear ?? (existingHome?.roofYear != null ? String(existingHome.roofYear) : ''));
  const [skipHouse, setSkipHouse] = useState(saved?.skipHouse ?? false);
  const [carQuery, setCarQuery] = useState(
    saved?.carQuery ??
      (existingCar ? [existingCar.vehicleYear, existingCar.make, existingCar.model].filter(Boolean).join(' ') : ''),
  );
  const [carValue, setCarValue] = useState(saved?.carValue ?? (existingCar?.value != null ? String(existingCar.value) : ''));
  const [carClass, setCarClass] = useState<VehicleClass>(saved?.carClass ?? existingCar?.vehicleClass ?? 'car');
  const [picked, setPicked] = useState<(typeof hits)[0] | null>(null);
  const [skipCar, setSkipCar] = useState(saved?.skipCar ?? household?.hasVehicle === false);
  const [cash, setCash] = useState(saved?.cash ?? (existingCash ? String(existingCash.balance) : ''));
  const [income, setIncome] = useState(saved?.income ?? (household?.monthlyIncome != null ? String(household.monthlyIncome) : ''));
  const [partner, setPartner] = useState(
    saved?.partner ?? (household?.partnerMonthlyIncome != null ? String(household.partnerMonthlyIncome) : ''),
  );
  const [cadence, setCadence] = useState<PaycheckCadence>(saved?.cadence ?? household?.paycheckCadence ?? 'monthly');
  const [fireFlavor, setFireFlavor] = useState<FireFlavor>(saved?.fireFlavor ?? household?.fireFlavor ?? 'standard');
  const [spend, setSpend] = useState(saved?.spend ?? (existingSpend?.monthlyAmount != null ? String(existingSpend.monthlyAmount) : ''));
  const [investments, setInvestments] = useState(saved?.investments ?? (existingInv ? String(existingInv.balance) : ''));
  const [investReturn, setInvestReturn] = useState(
    saved?.investReturn ?? (existingInv?.expectedReturn != null ? String(existingInv.expectedReturn * 100) : '7'),
  );
  const [rent, setRent] = useState(saved?.rent ?? (existingRent?.monthlyAmount != null ? String(existingRent.monthlyAmount) : ''));
  const [alerts, setAlerts] = useState<'daily' | 'outliers' | 'off'>(saved?.alerts ?? 'off');
  const [loans, setLoans] = useState<DraftLoan[]>(
    saved?.loans?.length
      ? saved.loans
      :
    existingLoans.length
      ? existingLoans.map((a) => ({
          id: a.id,
          name: a.name,
          type: a.type,
          balance: String(a.balance),
          payment: a.minPayment != null ? String(a.minPayment) : '',
          apr: a.apr != null ? String(a.apr * 100) : '',
        }))
      : [newLoan('student_loan', 'Loan')],
  );

  const blocks = intakeBlocksForHousehold(
    household ?? emptyRealHousehold(zip.trim()),
    tenure,
    hasVehicle,
    hasMortgage,
  );
  const hits = useMemo(() => searchVehicles(seedBundle.vehicle, carQuery, 6), [carQuery]);
  const tracksFire = job === 'work_optional' || goals.some((s) => s.id === 'preset:work_optional');

  useEffect(() => {
    const handle = setTimeout(() => {
      saveOnboardingDraft({
        tenure,
        hasVehicle,
        hasMortgage,
        zip,
        houseValue,
        yearBuilt,
        roofYear,
        skipHouse,
        carQuery,
        carValue,
        carClass,
        skipCar,
        cash,
        income,
        partner,
        cadence,
        fireFlavor,
        spend,
        investments,
        investReturn,
        rent,
        loans,
        alerts,
      });
    }, 400);
    return () => clearTimeout(handle);
  }, [
    tenure,
    hasVehicle,
    hasMortgage,
    zip,
    houseValue,
    yearBuilt,
    roofYear,
    skipHouse,
    carQuery,
    carValue,
    carClass,
    skipCar,
    cash,
    income,
    partner,
    cadence,
    fireFlavor,
    spend,
    investments,
    investReturn,
    rent,
    loans,
    alerts,
  ]);

  const allowedDebtTypes = DEBT_TYPES.filter((t) => {
    if (t.id === 'mortgage') return tenure === 'own' && hasMortgage !== false;
    return true;
  });

  const setPaidOff = () => {
    setHasMortgage(false);
    setLoans((prev) => {
      const rest = prev.filter((l) => l.type !== 'mortgage');
      return rest.length ? rest : [newLoan(hasVehicle ? 'auto_loan' : 'student_loan', hasVehicle ? 'Auto loan' : 'Loan')];
    });
  };

  const setStillMortgage = () => {
    setHasMortgage(true);
    setLoans((prev) => {
      if (prev.some((l) => l.type === 'mortgage')) return prev;
      return [newLoan('mortgage', 'Mortgage'), ...prev.filter((l) => l.balance || l.payment)];
    });
  };

  const patchLoan = (id: string, patch: Partial<DraftLoan>) => {
    setLoans((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  };

  const fail = (message: string) => {
    setFormError(message);
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  };

  const finish = () => {
    void finishAsync();
  };

  const finishAsync = async () => {
    if (investReturn.trim() && parsePercentInput(investReturn) == null) {
      fail('Expected return has to be a percent, like 7.');
      return;
    }
    if (loans.some((loan) => loan.apr.trim() && parsePercentInput(loan.apr) == null)) {
      fail('A loan rate has to be a percent, like 6.5.');
      return;
    }
    if (yearBuilt.trim() && parseYear(yearBuilt) == null) {
      fail('Year built has to look like 1998.');
      return;
    }
    if (roofYear.trim() && parseYear(roofYear) == null) {
      fail('Roof year has to look like 2014.');
      return;
    }
    if ([houseValue, carValue, cash, income, spend, rent, partner, investments].some((raw) => raw.trim() && parseMoney(raw) == null)) {
      fail('Money fields have to be numbers, like 1800 or $1,800.');
      return;
    }
    if (loans.some((loan) => (loan.balance.trim() && parseMoney(loan.balance) == null) || (loan.payment.trim() && parseMoney(loan.payment) == null))) {
      fail('Loan balance and payment have to be numbers.');
      return;
    }
    setFormError(null);
    const now = new Date().toISOString();
    const base = household?.kind === 'real' ? household : emptyRealHousehold(zip.trim());
    let assets = [...base.assets];
    let accounts = [...base.accounts];
    let expenses = [...base.expenses];

    if (tenure !== 'own' || skipHouse) {
      assets = assets.filter((a) => a.type !== 'home');
    } else if (blocks.includes('house')) {
      const prev = assets.find((a) => a.type === 'home');
      const next = {
        id: prev?.id ?? 'home-1',
        type: 'home' as const,
        name: prev?.name ?? 'House',
        value: houseValue ? parseMoney(houseValue) : prev?.value ?? null,
        yearBuilt: yearBuilt ? parseYear(yearBuilt) : prev?.yearBuilt ?? null,
        roofYear: roofYear ? parseYear(roofYear) : prev?.roofYear ?? null,
        hvacYear: prev?.hvacYear ?? null,
        waterHeaterYear: prev?.waterHeaterYear ?? null,
        sqft: prev?.sqft ?? null,
        lastEditedAt: now,
        costOverrides: prev?.costOverrides,
      };
      assets = prev ? assets.map((a) => (a.id === prev.id ? next : a)) : [...assets, next];
    }

    if (hasVehicle === false || skipCar) {
      assets = assets.filter((a) => a.type !== 'vehicle');
    } else if (blocks.includes('car') && hasVehicle) {
      const prev = assets.find((a) => a.type === 'vehicle');
      const next = {
        id: prev?.id ?? 'car-1',
        type: 'vehicle' as const,
        name: picked ? `${picked.year} ${picked.make} ${picked.model}` : carQuery || prev?.name || 'Vehicle',
        value: carValue ? parseMoney(carValue) : prev?.value ?? null,
        vehicleYear: picked?.year ?? prev?.vehicleYear ?? null,
        make: picked?.make ?? null,
        model: picked?.model ?? null,
        vehicleClass: picked?.class ?? carClass,
        mileage: prev?.mileage ?? null,
        lastEditedAt: now,
        costOverrides: prev?.costOverrides,
      };
      assets = prev ? assets.map((a) => (a.id === prev.id ? { ...prev, ...next } : a)) : [...assets, next];
    }

    if (blocks.includes('cash') || cash) {
      const prev = accounts.find((a) => isLiquid(a.type));
      const next = {
        id: prev?.id ?? 'cash-1',
        type: 'cash' as const,
        name: prev?.name ?? 'Cash and savings',
        balance: cash ? parseMoney(cash) ?? prev?.balance ?? 0 : prev?.balance ?? 0,
        lastEditedAt: now,
      };
      accounts = prev ? accounts.map((a) => (a.id === prev.id ? { ...prev, ...next } : a)) : [...accounts, next];
    }

    if (blocks.includes('investments') && investments) {
      const prev = accounts.find((a) => isInvestment(a.type));
      const next = {
        id: prev?.id ?? 'inv-1',
        type: 'retirement_401k' as const,
        name: prev?.name ?? '401k / IRA / brokerage',
        balance: parseMoney(investments) ?? 0,
        expectedReturn: parsePercentInput(investReturn) ?? 0.07,
        lastEditedAt: now,
      };
      accounts = prev ? accounts.map((a) => (a.id === prev.id ? { ...prev, ...next } : a)) : [...accounts, next];
    }

    if (blocks.includes('debts') || blocks.includes('mortgage')) {
      const keptIds = new Set(loans.map((l) => l.id));
      accounts = accounts.filter((a) => !isLiability(a.type) || keptIds.has(a.id));
      for (const loan of loans) {
        const balance = parseMoney(loan.balance);
        if (balance == null || balance <= 0) {
          accounts = accounts.filter((a) => a.id !== loan.id);
          continue;
        }
        const prev = accounts.find((a) => a.id === loan.id);
        const next = {
          id: loan.id,
          type: loan.type,
          name: loan.name || 'Loan',
          balance,
          minPayment: loan.payment ? parseMoney(loan.payment) : null,
          apr: parsePercentInput(loan.apr),
          lastEditedAt: now,
        };
        accounts = prev ? accounts.map((a) => (a.id === prev.id ? { ...prev, ...next } : a)) : [...accounts, next];
      }
    }

    if (blocks.includes('rent')) {
      expenses = expenses.filter((e) => e.name.trim().toLowerCase() !== 'rent');
      if (rent) {
        expenses.push({ id: 'exp-rent', name: 'Rent', monthlyAmount: parseMoney(rent) ?? 0, variable: false });
      }
    }
    if (blocks.includes('spend') && spend) {
      const prev = expenses.find((e) => e.name.trim().toLowerCase() !== 'rent');
      const next = { id: prev?.id ?? 'exp-living', name: prev?.name ?? 'Living', monthlyAmount: parseMoney(spend) ?? 0, variable: true };
      expenses = prev
        ? expenses.map((e) => (e.id === prev.id ? { ...e, ...next } : e))
        : [...expenses, next];
    }

    clearOnboardingDraft();
    let mode = alerts;
    if (alerts !== 'off') {
      const granted = await requestNotifyPermission(
        'A short note when something in the plan changes. Next, the phone asks permission to show it.',
      );
      if (!granted) mode = 'off';
    }
    patchSettings({ notificationMode: mode });
    setHousehold({
      ...base,
      zip: zip.trim() || base.zip,
      jobClass: job,
      fireFlavor: tracksFire ? fireFlavor : household?.fireFlavor ?? 'standard',
      goalSpec: job === 'custom' ? base.goalSpec ?? null : null,
      openGoals: household?.openGoals ?? base.openGoals,
      targetDate: job === 'custom' && base.goalSpec?.target.kind === 'date' ? base.goalSpec.target.by : base.targetDate ?? null,
      housingTenure: tenure,
      hasVehicle,
      hasMortgage: tenure === 'own' ? hasMortgage : null,
      monthlyIncome: income ? parseMoney(income) ?? base.monthlyIncome : base.monthlyIncome,
      partnerMonthlyIncome: partner.trim() === '' ? null : parseMoney(partner),
      paycheckCadence: cadence,
      assets,
      accounts,
      expenses,
    });
    router.replace('/(tabs)');
  };

  return (
    <Screen scrollRef={scrollRef}>
          {formError ? <Meta>{formError}</Meta> : null}
          <Title>{jobTitle}</Title>
          <Body>
            Take-home pay is the load-bearing number — leftover and dates are a guess without it. Skip anything else
            you do not know. Ranges get wider; the form never blocks.
          </Body>
          {goals.length > 1 ? (
            <Meta>{goals.map((s) => s.name).join(' · ')}</Meta>
          ) : (
            <Meta>{copy.blurb}</Meta>
          )}

          <Field
            label="Take-home pay, monthly"
            hint="What hits the bank after tax. Cadence below can add a three-paycheck month."
            value={income}
            onChange={setIncome}
            keyboardType="decimal-pad"
            placeholder="5200"
          />
          <View style={{ gap: 8 }}>
            <Meta>How often are you paid?</Meta>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {PAYCHECK_CADENCES.map((id) => (
                <Button
                  key={id}
                  tone={id === cadence ? 'accent' : 'ghost'}
                  label={PAYCHECK_CADENCE_LABELS[id]}
                  onPress={() => setCadence(id)}
                />
              ))}
            </View>
            <Field
              label="Partner take-home, monthly (optional)"
              hint="Same household. Not a second login."
              value={partner}
              onChange={setPartner}
              keyboardType="decimal-pad"
              placeholder="0"
            />
          </View>

          <View style={{ gap: 8 }}>
            <Meta>Where you live</Meta>
            <Body style={{ fontSize: 14, lineHeight: 20, color: colors.muted }}>
              Own, rent, or neither. We will not invent a house.
            </Body>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {HOUSING_TENURES.map((id) => (
                <Button
                  key={id}
                  tone={id === tenure ? 'accent' : 'ghost'}
                  label={HOUSING_TENURE_LABELS[id]}
                  onPress={() => {
                    setTenure(id);
                    if (id !== 'own') {
                      setHasMortgage(null);
                      setSkipHouse(true);
                      setLoans((prev) => {
                        const rest = prev.filter((l) => l.type !== 'mortgage');
                        return rest.length ? rest : [newLoan('student_loan', 'Loan')];
                      });
                    }
                  }}
                />
              ))}
            </View>
          </View>

          <View style={{ gap: 8 }}>
            <Meta>Do you have a car?</Meta>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <Button tone={hasVehicle === true ? 'accent' : 'ghost'} label="Yes" onPress={() => setHasVehicle(true)} />
              <Button
                tone={hasVehicle === false ? 'accent' : 'ghost'}
                label="No"
                onPress={() => {
                  setHasVehicle(false);
                  setSkipCar(true);
                }}
              />
            </View>
          </View>

          {tracksFire ? (
            <View style={{ gap: 8 }}>
              <Meta>Retire early flavor</Meta>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {FIRE_FLAVORS.map((id) => (
                  <Button
                    key={id}
                    tone={id === fireFlavor ? 'accent' : 'ghost'}
                    label={FIRE_FLAVOR_LABELS[id]}
                    onPress={() => setFireFlavor(id)}
                  />
                ))}
              </View>
              <Meta>{FIRE_FLAVOR_BLURB[fireFlavor]}</Meta>
            </View>
          ) : null}

          {blocks.includes('spend') ? (
            <Field
              label={tenure === 'rent' ? 'Typical monthly spending besides rent' : 'Typical monthly spending'}
              hint="Leave mortgage and other loan payments out if you list them below."
              value={spend}
              onChange={setSpend}
              keyboardType="decimal-pad"
              placeholder="3200"
            />
          ) : null}

          {blocks.includes('rent') ? (
            <Field
              label="Rent, monthly"
              hint="Named as rent so it is not mixed into coffee."
              value={rent}
              onChange={setRent}
              keyboardType="decimal-pad"
              placeholder="1800"
            />
          ) : null}

          {blocks.includes('investments') ? (
            <Field
              label="Invested (401k, IRA, brokerage)"
              hint="Not checking or savings. Those are cash, below."
              value={investments}
              onChange={setInvestments}
              keyboardType="decimal-pad"
              placeholder="180000"
            />
          ) : null}

          {blocks.includes('investments') ? (
            <Field
              label="Expected annual return, percent"
              hint="7 means 7%. Leave blank to use 7% as a labeled typical, not a forecast of your funds."
              value={investReturn}
              onChange={setInvestReturn}
              keyboardType="decimal-pad"
              placeholder="7"
            />
          ) : null}

          {blocks.includes('mortgage') ? (
            <View style={{ gap: 8 }}>
              <Meta>Is the house paid off?</Meta>
              <Body style={{ fontSize: 14, lineHeight: 20, color: colors.muted }}>
                We will not assume the house is paid off. If a mortgage is still there, it belongs on this date.
              </Body>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                <Button tone={hasMortgage === false ? 'accent' : 'ghost'} label="Paid off" onPress={setPaidOff} />
                <Button
                  tone={hasMortgage === true ? 'accent' : 'ghost'}
                  label="Still have a mortgage"
                  onPress={setStillMortgage}
                />
              </View>
            </View>
          ) : null}

          {blocks.includes('debts') ? (
            <View style={{ gap: 12 }}>
              <Meta>{job === 'debt_free' ? 'Every loan we should pay off' : 'Loans still on the books'}</Meta>
              <Body style={{ fontSize: 14, lineHeight: 20, color: colors.muted }}>
                {job === 'debt_free'
                  ? 'Add each loan — mortgage, student, car, card. Interest rate matters as much as the balance.'
                  : 'A mortgage, student loan, or car loan still takes a turn on the Retire early date. Include the rate.'}
              </Body>
              {loans.map((loan, index) => (
                <View key={loan.id} style={{ gap: 10, paddingTop: index ? 8 : 0 }}>
                  <Field
                    label={loans.length > 1 ? `Loan ${index + 1}` : 'Loan'}
                    value={loan.name}
                    onChange={(name) => patchLoan(loan.id, { name })}
                    placeholder="Mortgage"
                  />
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {allowedDebtTypes.map((t) => (
                      <Button
                        key={t.id}
                        tone={t.id === loan.type ? 'accent' : 'ghost'}
                        label={t.label}
                        onPress={() =>
                          patchLoan(loan.id, {
                            type: t.id,
                            name: loan.name === 'Loan' || loan.name === 'Mortgage' ? t.label : loan.name,
                          })
                        }
                      />
                    ))}
                  </View>
                  <Field
                    label="Balance"
                    value={loan.balance}
                    onChange={(balance) => patchLoan(loan.id, { balance })}
                    keyboardType="decimal-pad"
                    placeholder="24000"
                  />
                  <Field
                    label="Minimum payment, monthly"
                    value={loan.payment}
                    onChange={(payment) => patchLoan(loan.id, { payment })}
                    keyboardType="decimal-pad"
                    placeholder="450"
                  />
                  <Field
                    label="Interest rate, percent"
                    hint={`Annual rate, like ${typicalAprPercent(loan.type)}. Leave blank and we will use a typical ${typicalAprPercent(loan.type)}% — not your lender.`}
                    value={loan.apr}
                    onChange={(apr) => patchLoan(loan.id, { apr })}
                    keyboardType="decimal-pad"
                    placeholder={String(typicalAprPercent(loan.type))}
                  />
                  {loans.length > 1 ? (
                    <Button
                      tone="ghost"
                      label="Remove this loan"
                      onPress={() =>
                        confirm('Remove this loan?', 'It will not be saved with the household.', () =>
                          setLoans((prev) => prev.filter((l) => l.id !== loan.id)),
                        )
                      }
                    />
                  ) : null}
                </View>
              ))}
              <Button
                tone="ghost"
                label="Add another loan"
                onPress={() =>
                  setLoans((prev) => [
                    ...prev,
                    newLoan(hasVehicle ? 'auto_loan' : 'student_loan', hasVehicle ? 'Auto loan' : 'Loan'),
                  ])
                }
              />
            </View>
          ) : null}

          {blocks.includes('house') ? (
            <View style={{ gap: 10 }}>
              <Meta>The house (only if you own it)</Meta>
              {skipHouse ? (
                <Body>House skipped. We will not use national averages as if you owned one. Add it when you can.</Body>
              ) : (
                <>
                  <Field label="ZIP" value={zip} onChange={setZip} keyboardType="number-pad" placeholder="10001" />
                  <Field label="House value" value={houseValue} onChange={setHouseValue} keyboardType="decimal-pad" placeholder="400000" />
                  <Field label="Year built" value={yearBuilt} onChange={setYearBuilt} keyboardType="number-pad" placeholder="1998" />
                  <Field
                    label="Roof year, if you know it"
                    hint="Leave blank if not sure. We will not pretend the house was re-roofed the year it was built."
                    value={roofYear}
                    onChange={setRoofYear}
                    keyboardType="number-pad"
                    placeholder="2014"
                  />
                </>
              )}
              <Button
                tone="ghost"
                label={skipHouse ? 'Add the house' : 'Not sure — skip the house for now'}
                onPress={() => setSkipHouse((v) => !v)}
              />
            </View>
          ) : null}

          {blocks.includes('car') ? (
            <View style={{ gap: 10 }}>
              <Meta>The car</Meta>
              {skipCar ? (
                <Body>Car skipped. You can add it from Improve this job.</Body>
              ) : (
                <>
                  <Field
                    label="Year, make, model"
                    hint="One search box. No catalog match is fine — we will treat it as a class."
                    value={carQuery}
                    onChange={(v) => {
                      setCarQuery(v);
                      setPicked(null);
                    }}
                    placeholder="2018 Civic"
                  />
                  {hits.map((hit) => (
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
                  {!hits.length && carQuery ? <Meta>No catalog match. Treating this as a {carClass}.</Meta> : null}
                  <Field label="Vehicle value" value={carValue} onChange={setCarValue} keyboardType="decimal-pad" placeholder="14000" />
                </>
              )}
              <Button
                tone="ghost"
                label={skipCar ? 'Add the car' : 'Not sure — skip the car for now'}
                onPress={() => setSkipCar((v) => !v)}
              />
            </View>
          ) : null}

          {blocks.includes('cash') ? (
            <Field
              label="Cash on hand"
              hint="Checking, savings, cash. Not the 401k."
              value={cash}
              onChange={setCash}
              keyboardType="decimal-pad"
              placeholder="18000"
            />
          ) : null}

          <View style={{ gap: 8 }}>
            <Meta>Reminders stay off unless you turn them on.</Meta>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <Button tone={alerts === 'off' ? 'accent' : 'ghost'} label="Off" onPress={() => setAlerts('off')} />
              <Button tone={alerts === 'outliers' ? 'accent' : 'ghost'} label="Outliers only" onPress={() => setAlerts('outliers')} />
              <Button tone={alerts === 'daily' ? 'accent' : 'ghost'} label="Daily brief" onPress={() => setAlerts('daily')} />
            </View>
          </View>
          <Button label="Show my goals" onPress={finish} />
    </Screen>
  );
}
