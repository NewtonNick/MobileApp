import { useEffect, useRef, useState } from 'react';
import { Alert, TextInput, View } from 'react-native';

import {
  ACCOUNT_TYPE_LABELS,
  PAYCHECK_CADENCE_LABELS,
  PAYCHECK_CADENCES,
  SURPLUS_POLICIES,
  SURPLUS_POLICY_LABELS,
  dismissDuplicateGuess,
  findOwnershipDuplicateGuesses,
  linkDuplicateBills,
  isInvestment,
  isLiability,
  parseMileage,
  parseMoney,
  parsePercentInput,
  parseYear,
  setEmergencyBuffer,
  type AccountInput,
  type AccountType,
  type AssetInput,
  type ExpenseInput,
  type ExteriorResponsibility,
  type HouseholdInput,
  type LeaseEndChoice,
  type VehicleClass,
} from '@asset-aware/forecast-engine';
import { duplicateGuesses } from '@/state/household';
import { DuplicateGuessCard } from '@/ui/duplicate-guess-card';
import { useHousehold } from '@/state/context';
import { ForecastMonthField, monthKeyOrLegacy } from '@/ui/month-field';
import { TaxLots } from '@/ui/tax-lots';
import { PercentField } from '@/ui/percent-field';
import { Body, Button, Card, Chip, Meta, Screen, Title, useFieldStyle } from '@/ui/primitives';

const VEHICLE_CLASSES: VehicleClass[] = ['car', 'suv', 'truck', 'van', 'ev', 'motorcycle', 'rv'];

const BOOK_SECTIONS = [
  ['pay', 'Pay'],
  ['accounts', 'Accounts'],
  ['bills', 'Bills'],
  ['property', 'House and car'],
  ['later', 'Later'],
] as const;

type BookSection = (typeof BOOK_SECTIONS)[number][0];

const TYPES: AccountType[] = [
  'checking',
  'savings',
  'cash',
  'brokerage',
  'retirement_401k',
  'retirement_ira',
  'mortgage',
  'auto_loan',
  'student_loan',
  'credit_card',
  'other_liability',
  'other',
];

function moneyOrNull(raw: string): number | null {
  if (!raw.trim()) return null;
  return parseMoney(raw);
}

function ageYears(raw: string): number | null {
  if (!raw.trim()) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1 || n > 120) return null;
  return Math.round(n);
}

export default function AccountsScreen() {
  const field = useFieldStyle();
  const { household, setHousehold, updateHousehold } = useHousehold();
  const clearedSkips = useRef(false);
  const [income, setIncome] = useState(household?.monthlyIncome?.toString() ?? '');
  const [partner, setPartner] = useState(household?.partnerMonthlyIncome?.toString() ?? '');
  const [payday, setPayday] = useState(household?.nextPayday ?? '');
  const [partnerPayday, setPartnerPayday] = useState(household?.partnerNextPayday ?? '');
  const [name, setName] = useState('Checking');
  const [type, setType] = useState<AccountType>('checking');
  const [balance, setBalance] = useState('');
  const [payment, setPayment] = useState('');
  const [apr, setApr] = useState('');
  const [investReturn, setInvestReturn] = useState('7');
  const [expenseName, setExpenseName] = useState('Food');
  const [expenseAmt, setExpenseAmt] = useState('');
  const [expenseStart, setExpenseStart] = useState<string | null>(null);
  const [expenseEnd, setExpenseEnd] = useState<string | null>(null);
  const [section, setSection] = useState<BookSection>('pay');
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (clearedSkips.current || !household?.skippedQuestions?.length) return;
    clearedSkips.current = true;
    setHousehold({ ...household, skippedQuestions: [] });
  }, [household, setHousehold]);

  if (!household) return <Screen><Title>No household</Title></Screen>;

  const guesses = duplicateGuesses(household);
  const ownershipGuesses = findOwnershipDuplicateGuesses(household.expenses, household.assets);
  const books = household;

  const saveBooks = (next: HouseholdInput) => {
    setFormError(null);
    setHousehold(next);
  };

  const saveIncome = () => {
    const own = income.trim() ? parseMoney(income) : null;
    const other = partner.trim() ? parseMoney(partner) : books.partnerMonthlyIncome;
    if (income.trim() && own == null) {
      setFormError('Take-home has to be a positive number.');
      return;
    }
    if (partner.trim() && other == null) {
      setFormError('Partner take-home has to be a positive number.');
      return;
    }
    saveBooks({
      ...books,
      monthlyIncome: income.trim() ? own : null,
      partnerMonthlyIncome: partner.trim() ? other : null,
    });
  };

  const savePaydays = () => {
    saveBooks({
      ...books,
      nextPayday: payday.trim() || null,
      partnerNextPayday: partnerPayday.trim() || null,
    });
  };

  return (
    <Screen>
        <Title>Improve this job</Title>
        <Meta>These books feed the hired date. Cash home stays the sentence — this is not a ledger app.</Meta>
        {formError ? <Meta>{formError}</Meta> : null}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {BOOK_SECTIONS.map(([key, label]) => (
            <Chip key={key} label={label} selected={section === key} onPress={() => setSection(key)} />
          ))}
        </View>

        {section === 'pay' ? (
          <>
        <Meta>Take-home pay (your stream)</Meta>
        <TextInput accessibilityLabel="Take-home pay" value={income} onChangeText={setIncome} onEndEditing={saveIncome} keyboardType="decimal-pad" style={field} />
        <Meta>Partner take-home (same household, not a second login)</Meta>
        <TextInput accessibilityLabel="Partner take-home" value={partner} onChangeText={setPartner} onEndEditing={saveIncome} keyboardType="decimal-pad" style={field} />

        <Meta>Your paycheck cadence</Meta>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {PAYCHECK_CADENCES.map((c) => (
            <Button
              key={c}
              tone={books.paycheckCadence === c ? 'accent' : 'ghost'}
              label={PAYCHECK_CADENCE_LABELS[c]}
              onPress={() => saveBooks({ ...books, paycheckCadence: c })}
            />
          ))}
        </View>
        <Meta>Next payday (YYYY-MM-DD)</Meta>
        <TextInput accessibilityLabel="Next payday" value={payday} onChangeText={setPayday} onEndEditing={savePaydays} style={field} />
        <Meta>Partner cadence</Meta>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {PAYCHECK_CADENCES.map((c) => (
            <Button
              key={`p-${c}`}
              tone={(books.partnerPaycheckCadence ?? books.paycheckCadence) === c ? 'accent' : 'ghost'}
              label={PAYCHECK_CADENCE_LABELS[c]}
              onPress={() => saveBooks({ ...books, partnerPaycheckCadence: c })}
            />
          ))}
        </View>
        <Meta>Partner next payday</Meta>
        <TextInput accessibilityLabel="Partner next payday" value={partnerPayday} onChangeText={setPartnerPayday} onEndEditing={savePaydays} style={field} />

        <Meta>Where leftover goes</Meta>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {SURPLUS_POLICIES.map((policy) => (
            <Button
              key={policy}
              tone={(books.surplusPolicy ?? 'cash') === policy ? 'accent' : 'ghost'}
              label={SURPLUS_POLICY_LABELS[policy]}
              onPress={() => saveBooks({ ...books, surplusPolicy: policy })}
            />
          ))}
        </View>

        <Meta>Emergency fund length</Meta>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {([3, 6] as const).map((months) => (
            <Button
              key={months}
              tone={(books.bufferMonths === 6 ? 6 : 3) === months ? 'accent' : 'ghost'}
              label={`${months} months`}
              onPress={() => saveBooks(setEmergencyBuffer(books, months))}
            />
          ))}
        </View>
          </>
        ) : null}

        {section === 'accounts' ? (
          <>
        {books.accounts.map((account) => (
          <View key={account.id}>
            <AccountEditor
              key={`${account.id}-${account.lastEditedAt ?? ''}`}
              account={account}
              onSave={(next) =>
                saveBooks({ ...books, accounts: books.accounts.map((row) => (row.id === account.id ? next : row)) })
              }
              onDelete={() =>
                Alert.alert('Remove this account?', account.name, [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Remove',
                    style: 'destructive',
                    onPress: () =>
                      saveBooks({
                        ...books,
                        accounts: books.accounts.filter((row) => row.id !== account.id),
                        taxLots: (books.taxLots ?? []).filter((lot) => lot.accountId !== account.id),
                      }),
                  },
                ])
              }
            />
            <TaxLots books={books} account={account} onChange={saveBooks} />
          </View>
        ))}

        <Meta>Add account</Meta>
        <Meta>Name</Meta>
        <TextInput accessibilityLabel="Account name" value={name} onChangeText={setName} style={field} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {TYPES.map((t) => (
            <Button key={t} tone={t === type ? 'accent' : 'ghost'} label={ACCOUNT_TYPE_LABELS[t]} onPress={() => setType(t)} />
          ))}
        </View>
        <Meta>Balance</Meta>
        <TextInput accessibilityLabel="Balance" value={balance} onChangeText={setBalance} keyboardType="decimal-pad" style={field} />
        <Meta>Minimum payment</Meta>
        <TextInput accessibilityLabel="Minimum payment" value={payment} onChangeText={setPayment} keyboardType="decimal-pad" style={field} />
        {isLiability(type) ? (
          <PercentField label="Interest rate" value={apr} onChangeText={setApr} bareFractionMeans="decimal" />
        ) : null}
        {isInvestment(type) ? (
          <>
            <PercentField label="Expected return" value={investReturn} onChangeText={setInvestReturn} />
            <Meta>Contributions are not inside take-home.</Meta>
          </>
        ) : null}
        <Button
          label="Add account"
          onPress={() => {
            if (!balance.trim()) {
              setFormError('Enter a balance.');
              return;
            }
            const parsedBalance = parseMoney(balance);
            if (parsedBalance == null) {
              setFormError('Balance has to be a number like 1,250.');
              return;
            }
            const rate = isLiability(type) ? parsePercentInput(apr) : null;
            if (isLiability(type) && apr.trim() && rate == null) {
              setFormError('Confirm the interest rate before saving.');
              return;
            }
            const expected = isInvestment(type) ? parsePercentInput(investReturn) : null;
            if (isInvestment(type) && investReturn.trim() && expected == null) {
              setFormError('Confirm the expected return before saving.');
              return;
            }
            saveBooks({
              ...books,
              accounts: [
                ...books.accounts,
                {
                  id: `acc-${Date.now()}`,
                  type,
                  name: name.trim() || ACCOUNT_TYPE_LABELS[type],
                  balance: parsedBalance,
                  minPayment: payment.trim() ? moneyOrNull(payment) : null,
                  apr: rate,
                  expectedReturn: isInvestment(type) ? expected ?? 0.07 : null,
                  lastEditedAt: new Date().toISOString(),
                },
              ],
            });
            setBalance('');
          }}
        />
          </>
        ) : null}

        {section === 'bills' ? (
          <>
        {books.expenses.map((expense) => (
          <ExpenseEditor
            key={`${expense.id}-${expense.monthlyAmount ?? ''}-${expense.name}`}
            expense={expense}
            onSave={(next) =>
              saveBooks({ ...books, expenses: books.expenses.map((row) => (row.id === expense.id ? next : row)) })
            }
            onDelete={() =>
              Alert.alert('Remove this expense?', expense.name, [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Remove',
                  style: 'destructive',
                  onPress: () => saveBooks({ ...books, expenses: books.expenses.filter((row) => row.id !== expense.id) }),
                },
              ])
            }
          />
        ))}

        <Meta>Expense name</Meta>
        <TextInput accessibilityLabel="Expense name" value={expenseName} onChangeText={setExpenseName} style={field} />
        <Meta>Monthly amount</Meta>
        <TextInput accessibilityLabel="Monthly amount" value={expenseAmt} onChangeText={setExpenseAmt} keyboardType="decimal-pad" style={field} />
        <ForecastMonthField label="Starts" value={expenseStart} onChange={setExpenseStart} />
        <ForecastMonthField label="Ends" value={expenseEnd} onChange={setExpenseEnd} />
        <Button
          label="Add expense"
          onPress={() => {
            const amount = expenseAmt.trim() ? parseMoney(expenseAmt) : null;
            if (expenseAmt.trim() && amount == null) {
              setFormError('The bill has to be a positive number.');
              return;
            }
            saveBooks({
              ...books,
              expenses: [
                ...books.expenses,
                {
                  id: `exp-${Date.now()}`,
                  name: expenseName.trim() || 'Expense',
                  monthlyAmount: amount,
                  variable: !['housing', 'mortgage', 'rent'].includes(expenseName.toLowerCase()),
                  startAt: expenseStart,
                  endAt: expenseEnd,
                  startMonth: null,
                  endMonth: null,
                },
              ],
            });
            setExpenseAmt('');
            setExpenseStart(null);
            setExpenseEnd(null);
          }}
        />
          </>
        ) : null}

        {section === 'property' ? (
          <>
        {books.assets.filter((asset) => asset.type === 'home' || asset.type === 'vehicle').map((asset) => (
          <AssetEditor
            key={`${asset.id}-${asset.lastEditedAt ?? ''}`}
            asset={asset}
            featured={books.featuredHomeId === asset.id || (!books.featuredHomeId && asset.id === books.assets.find((row) => row.type === 'home')?.id)}
            onSave={(next) => saveBooks({ ...books, assets: books.assets.map((row) => (row.id === asset.id ? next : row)) })}
            onFeature={() => saveBooks({ ...books, featuredHomeId: asset.id })}
            onDelete={() =>
              Alert.alert('Remove this?', asset.name, [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Remove',
                  style: 'destructive',
                  onPress: () => saveBooks({ ...books, assets: books.assets.filter((row) => row.id !== asset.id) }),
                },
              ])
            }
          />
        ))}
        <Button
          label="Add another house"
          tone="ghost"
          onPress={() =>
            saveBooks({
              ...books,
              housingTenure: 'own',
              assets: [
                ...books.assets,
                { id: `home-${Date.now()}`, type: 'home', name: 'House', value: null, lastEditedAt: new Date().toISOString() },
              ],
            })
          }
        />
        <Button
          label="Add another car"
          tone="ghost"
          onPress={() =>
            saveBooks({
              ...books,
              hasVehicle: true,
              assets: [
                ...books.assets,
                { id: `car-${Date.now()}`, type: 'vehicle', name: 'Vehicle', value: null, vehicleClass: 'car', lastEditedAt: new Date().toISOString() },
              ],
            })
          }
        />
          </>
        ) : null}

        {section === 'later' ? <PlanEditor household={books} onSave={saveBooks} /> : null}

        {guesses.map((g) => (
          <DuplicateGuessCard
            key={`${g.expenseId}-${g.liabilityId}`}
            guess={g}
            detailed
            onSame={() => updateHousehold((current) => linkDuplicateBills(current, g))}
            onSeparate={() => updateHousehold((current) => dismissDuplicateGuess(current, g))}
            onUnsure={() => updateHousehold((current) => dismissDuplicateGuess(current, g))}
          />
        ))}
        {ownershipGuesses.map((g) => (
          <Card key={`${g.expenseId}-${g.lineKey}`}>
            <Body>
              {g.expenseName} looks like the {g.lineLabel.toLowerCase()} line. Count it once?
            </Body>
            <Button
              label="Same bill"
              onPress={() =>
                saveBooks({
                  ...books,
                  expenses: books.expenses.map((e) =>
                    e.id === g.expenseId ? { ...e, linkedAssetKey: g.lineKey, duplicateReviewed: true } : e,
                  ),
                })
              }
            />
            <Button
              label="Not sure"
              tone="ghost"
              onPress={() =>
                saveBooks({
                  ...books,
                  expenses: books.expenses.map((e) =>
                    e.id === g.expenseId ? { ...e, linkedAssetKey: g.lineKey, duplicateReviewed: true } : e,
                  ),
                })
              }
            />
          </Card>
        ))}
    </Screen>
  );
}

function AccountEditor({
  account,
  onSave,
  onDelete,
}: {
  account: AccountInput;
  onSave: (next: AccountInput) => void;
  onDelete: () => void;
}) {
  const field = useFieldStyle();
  const [name, setName] = useState(account.name);
  const [type, setType] = useState<AccountType>(account.type);
  const [balance, setBalance] = useState(String(account.balance));
  const [payment, setPayment] = useState(account.minPayment == null ? '' : String(account.minPayment));
  const [apr, setApr] = useState(account.apr == null ? '' : String(account.apr * 100));
  const [expected, setExpected] = useState(account.expectedReturn == null ? '' : String(account.expectedReturn * 100));
  const [escrow, setEscrow] = useState(account.escrowMonthly == null ? '' : String(account.escrowMonthly));
  const [contribution, setContribution] = useState(
    account.employeeContributionMonthly == null ? '' : String(account.employeeContributionMonthly),
  );
  const [match, setMatch] = useState(account.employerMatchPercent == null ? '' : String(account.employerMatchPercent * 100));
  const [forgiveness, setForgiveness] = useState<string | null>(
    monthKeyOrLegacy(account.forgivenessAt, account.forgivenessMonth),
  );
  const [leaseEnd, setLeaseEnd] = useState<string | null>(account.endsAt ?? null);
  const [mileageCap, setMileageCap] = useState(account.mileageCap == null ? '' : String(account.mileageCap));
  const [overage, setOverage] = useState(account.overageRate == null ? '' : String(account.overageRate));
  const [endChoice, setEndChoice] = useState<LeaseEndChoice>(account.endChoice === 'buy' ? 'buy' : 'return');
  const [residual, setResidual] = useState(account.residual == null ? '' : String(account.residual));
  const [promoApr, setPromoApr] = useState(account.promoApr == null ? '' : String(account.promoApr * 100));
  const [promoEnd, setPromoEnd] = useState<string | null>(account.promoEndsAt ?? null);
  const [interestOnlyUntil, setInterestOnlyUntil] = useState<string | null>(account.interestOnlyUntil ?? null);
  const [deferredUntil, setDeferredUntil] = useState<string | null>(account.deferredUntil ?? null);
  const [subsidized, setSubsidized] = useState(account.subsidized === true);
  const [rateFixedUntil, setRateFixedUntil] = useState<string | null>(account.rateFixedUntil ?? null);
  const [margin, setMargin] = useState(account.indexMargin == null ? '' : String(account.indexMargin * 100));
  const [capPeriodic, setCapPeriodic] = useState(account.capPeriodic == null ? '' : String(account.capPeriodic * 100));
  const [capLifetime, setCapLifetime] = useState(account.capLifetime == null ? '' : String(account.capLifetime * 100));
  const [error, setError] = useState<string | null>(null);

  const commit = (overrides: Partial<AccountInput> = {}, nextForgiveness: string | null = forgiveness) => {
    const nextBalance = parseMoney(balance);
    if (nextBalance == null) {
      setError('Balance has to be a positive number.');
      return;
    }
    const rate = parsePercentInput(apr);
    if (apr.trim() && rate == null) {
      setError('Confirm the interest rate before saving.');
      return;
    }
    const ret = parsePercentInput(expected);
    if (expected.trim() && ret == null) {
      setError('Confirm the expected return before saving.');
      return;
    }
    const matchRate = parsePercentInput(match);
    if (match.trim() && matchRate == null) {
      setError('Confirm the match before saving.');
      return;
    }
    const nextCap = mileageCap.trim() ? parseMileage(mileageCap) : null;
    if (type === 'auto_lease' && mileageCap.trim() && nextCap == null) {
      setError('Mileage cap has to be between 0 and 500,000.');
      return;
    }
    const nextOverage = overage.trim() ? parseMoney(overage) : null;
    if (type === 'auto_lease' && overage.trim() && nextOverage == null) {
      setError('The overage rate has to be a positive number.');
      return;
    }
    const nextResidual = residual.trim() ? parseMoney(residual) : null;
    if (type === 'auto_lease' && endChoice === 'buy' && nextResidual == null) {
      setError('A buyout needs a residual.');
      return;
    }
    const promoRate = parsePercentInput(promoApr, { bareFractionMeans: 'decimal', allowZero: true });
    if (type === 'credit_card' && promoApr.trim() && promoRate == null) {
      setError('Confirm the intro rate before saving.');
      return;
    }
    const marginRate = parsePercentInput(margin, { bareFractionMeans: 'decimal', allowZero: true });
    const periodicRate = parsePercentInput(capPeriodic, { bareFractionMeans: 'decimal', allowZero: true });
    const lifetimeRate = parsePercentInput(capLifetime, { bareFractionMeans: 'decimal', allowZero: true });
    if (type === 'mortgage' && ((margin.trim() && marginRate == null) || (capPeriodic.trim() && periodicRate == null) || (capLifetime.trim() && lifetimeRate == null))) {
      setError('Confirm the adjustable-rate percents before saving.');
      return;
    }
    setError(null);
    const nextPromoEnd = overrides.promoEndsAt !== undefined ? overrides.promoEndsAt : promoEnd;
    const nextInterestOnly = overrides.interestOnlyUntil !== undefined ? overrides.interestOnlyUntil : interestOnlyUntil;
    const nextDeferred = overrides.deferredUntil !== undefined ? overrides.deferredUntil : deferredUntil;
    const nextFixed = overrides.rateFixedUntil !== undefined ? overrides.rateFixedUntil : rateFixedUntil;
    const nextLeaseEnd = overrides.endsAt !== undefined ? overrides.endsAt : leaseEnd;
    const nextSubsidized = overrides.subsidized !== undefined ? overrides.subsidized === true : subsidized;
    onSave({
      ...account,
      name: name.trim() || account.name,
      type,
      balance: nextBalance,
      minPayment: payment.trim() ? moneyOrNull(payment) : null,
      apr: apr.trim() ? rate : null,
      expectedReturn: isInvestment(type) ? ret ?? account.expectedReturn ?? 0.07 : null,
      escrowMonthly: type === 'mortgage' && escrow.trim() ? moneyOrNull(escrow) : type === 'mortgage' ? null : account.escrowMonthly,
      employeeContributionMonthly: contribution.trim() ? moneyOrNull(contribution) : null,
      employerMatchPercent: match.trim() ? matchRate : null,
      forgivenessAt: type === 'student_loan' ? nextForgiveness : null,
      forgivenessMonth: null,
      endsAt: type === 'auto_lease' ? nextLeaseEnd : null,
      mileageCap: type === 'auto_lease' ? nextCap : null,
      overageRate: type === 'auto_lease' ? nextOverage : null,
      endChoice: type === 'auto_lease' ? endChoice : null,
      residual: type === 'auto_lease' ? nextResidual : null,
      promoApr: type === 'credit_card' && promoApr.trim() ? promoRate : null,
      promoEndsAt: type === 'credit_card' ? nextPromoEnd : null,
      interestOnlyUntil: isLiability(type) && type !== 'credit_card' && type !== 'auto_lease' ? nextInterestOnly : null,
      deferredUntil: type === 'student_loan' ? nextDeferred : null,
      subsidized: type === 'student_loan' ? nextSubsidized : null,
      rateFixedUntil: type === 'mortgage' ? nextFixed : null,
      indexMargin: type === 'mortgage' && margin.trim() ? marginRate : null,
      capPeriodic: type === 'mortgage' && capPeriodic.trim() ? periodicRate : null,
      capLifetime: type === 'mortgage' && capLifetime.trim() ? lifetimeRate : null,
      lastEditedAt: new Date().toISOString(),
    });
  };

  return (
    <Card>
      <Body>{ACCOUNT_TYPE_LABELS[account.type]}</Body>
      <Meta>Name</Meta>
      <TextInput accessibilityLabel="Account name" value={name} onChangeText={setName} onEndEditing={() => commit()} style={field} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {TYPES.map((item) => (
          <Button key={item} tone={item === type ? 'accent' : 'ghost'} label={ACCOUNT_TYPE_LABELS[item]} onPress={() => setType(item)} />
        ))}
      </View>
      <Meta>Balance</Meta>
      <TextInput accessibilityLabel="Balance" value={balance} onChangeText={setBalance} onEndEditing={() => commit()} keyboardType="decimal-pad" style={field} />
      {isLiability(type) ? (
        <>
          <Meta>Payment</Meta>
          <TextInput accessibilityLabel="Payment" value={payment} onChangeText={setPayment} onEndEditing={() => commit()} keyboardType="decimal-pad" style={field} />
          <PercentField label="Interest rate" value={apr} onChangeText={setApr} bareFractionMeans="decimal" />
        </>
      ) : null}
      {type === 'mortgage' ? (
        <>
          <Meta>Escrow (tax and insurance inside the payment)</Meta>
          <TextInput accessibilityLabel="Escrow" value={escrow} onChangeText={setEscrow} onEndEditing={() => commit()} keyboardType="decimal-pad" style={field} />
          {escrow.trim() === '' ? <Meta>Payoff assumes the whole payment is principal and interest until you split escrow.</Meta> : null}
          <ForecastMonthField
            label="Fixed rate ends"
            value={rateFixedUntil}
            onChange={(next) => {
              setRateFixedUntil(next);
              commit({ rateFixedUntil: next });
            }}
          />
          <PercentField label="Margin added to the index" value={margin} onChangeText={setMargin} bareFractionMeans="decimal" allowZero />
          <PercentField label="Cap on one reset" value={capPeriodic} onChangeText={setCapPeriodic} bareFractionMeans="decimal" allowZero />
          <PercentField label="Cap over the starting rate" value={capLifetime} onChangeText={setCapLifetime} bareFractionMeans="decimal" allowZero />
          <ForecastMonthField
            label="Interest-only through"
            value={interestOnlyUntil}
            onChange={(next) => {
              setInterestOnlyUntil(next);
              commit({ interestOnlyUntil: next });
            }}
          />
        </>
      ) : null}
      {type === 'credit_card' ? (
        <>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <Button
            label="Revolving"
            tone={account.payoffStyle === 'paid_monthly' ? 'ghost' : 'accent'}
            onPress={() => onSave({ ...account, payoffStyle: 'revolving', lastEditedAt: new Date().toISOString() })}
          />
          <Button
            label="Paid monthly"
            tone={account.payoffStyle === 'paid_monthly' ? 'accent' : 'ghost'}
            onPress={() => onSave({ ...account, payoffStyle: 'paid_monthly', lastEditedAt: new Date().toISOString() })}
          />
        </View>
        <PercentField label="Intro rate" value={promoApr} onChangeText={setPromoApr} bareFractionMeans="decimal" allowZero />
        <ForecastMonthField
          label="Intro rate ends"
          value={promoEnd}
          onChange={(next) => {
            setPromoEnd(next);
            commit({ promoEndsAt: next });
          }}
        />
        </>
      ) : null}
      {type === 'student_loan' ? (
        <>
          <ForecastMonthField
            label="Forgiveness"
            value={forgiveness}
            onChange={(next) => {
              setForgiveness(next);
              commit({}, next);
            }}
          />
          <ForecastMonthField
            label="Payments start again"
            value={deferredUntil}
            onChange={(next) => {
              setDeferredUntil(next);
              commit({ deferredUntil: next });
            }}
          />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Button
              label="Subsidized"
              tone={subsidized ? 'accent' : 'ghost'}
              onPress={() => {
                setSubsidized(true);
                commit({ subsidized: true });
              }}
            />
            <Button
              label="Interest accrues"
              tone={subsidized ? 'ghost' : 'accent'}
              onPress={() => {
                setSubsidized(false);
                commit({ subsidized: false });
              }}
            />
          </View>
        </>
      ) : null}
      {type === 'auto_loan' || type === 'other_liability' ? (
        <ForecastMonthField
          label="Interest-only through"
          value={interestOnlyUntil}
          onChange={(next) => {
            setInterestOnlyUntil(next);
            commit({ interestOnlyUntil: next });
          }}
        />
      ) : null}
      {type === 'auto_lease' ? (
        <>
          <ForecastMonthField
            label="Lease ends"
            value={leaseEnd}
            onChange={(next) => {
              setLeaseEnd(next);
            }}
          />
          <Meta>Mileage cap</Meta>
          <TextInput accessibilityLabel="Mileage cap" value={mileageCap} onChangeText={setMileageCap} keyboardType="number-pad" style={field} />
          <Meta>Dollars per mile over the cap</Meta>
          <TextInput accessibilityLabel="Overage per mile" value={overage} onChangeText={setOverage} keyboardType="decimal-pad" style={field} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Button label="Return" tone={endChoice === 'return' ? 'accent' : 'ghost'} onPress={() => setEndChoice('return')} />
            <Button label="Buy" tone={endChoice === 'buy' ? 'accent' : 'ghost'} onPress={() => setEndChoice('buy')} />
          </View>
          {endChoice === 'buy' ? (
            <>
              <Meta>Residual</Meta>
              <TextInput accessibilityLabel="Residual" value={residual} onChangeText={setResidual} keyboardType="decimal-pad" style={field} />
            </>
          ) : null}
        </>
      ) : null}
      {isInvestment(type) ? (
        <>
          <PercentField label="Expected return" value={expected} onChangeText={setExpected} />
          <Meta>Employee contribution per month. This is not inside take-home.</Meta>
          <TextInput accessibilityLabel="Employee contribution per month" value={contribution} onChangeText={setContribution} onEndEditing={() => commit()} keyboardType="decimal-pad" style={field} />
          <PercentField label="Employer match percent of that contribution" value={match} onChangeText={setMatch} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Button
              label="Traditional"
              tone={account.taxTreatment === 'roth' ? 'ghost' : 'accent'}
              onPress={() => onSave({ ...account, taxTreatment: 'traditional', lastEditedAt: new Date().toISOString() })}
            />
            <Button
              label="Roth"
              tone={account.taxTreatment === 'roth' ? 'accent' : 'ghost'}
              onPress={() => onSave({ ...account, taxTreatment: 'roth', lastEditedAt: new Date().toISOString() })}
            />
          </View>
        </>
      ) : null}
      {error ? <Meta>{error}</Meta> : null}
      <Button label="Save account" onPress={() => commit()} />
      <Button label="Remove" tone="ghost" onPress={onDelete} />
    </Card>
  );
}

function ExpenseEditor({
  expense,
  onSave,
  onDelete,
}: {
  expense: ExpenseInput;
  onSave: (next: ExpenseInput) => void;
  onDelete: () => void;
}) {
  const field = useFieldStyle();
  const [name, setName] = useState(expense.name);
  const [amount, setAmount] = useState(expense.monthlyAmount == null ? '' : String(expense.monthlyAmount));
  const [start, setStart] = useState<string | null>(monthKeyOrLegacy(expense.startAt, expense.startMonth));
  const [end, setEnd] = useState<string | null>(monthKeyOrLegacy(expense.endAt, expense.endMonth));
  const [error, setError] = useState<string | null>(null);

  const commit = (nextStart = start, nextEnd = end) => {
    const next = amount.trim() ? parseMoney(amount) : null;
    if (amount.trim() && next == null) {
      setError('The bill has to be a positive number.');
      return;
    }
    setError(null);
    onSave({
      ...expense,
      name: name.trim() || expense.name,
      monthlyAmount: next,
      startAt: nextStart,
      endAt: nextEnd,
      startMonth: null,
      endMonth: null,
    });
  };

  return (
    <Card>
      <Meta>Expense name</Meta>
      <TextInput accessibilityLabel="Expense name" value={name} onChangeText={setName} onEndEditing={() => commit()} style={field} />
      <Meta>Monthly amount</Meta>
      <TextInput accessibilityLabel="Monthly amount" value={amount} onChangeText={setAmount} onEndEditing={() => commit()} keyboardType="decimal-pad" style={field} />
      <ForecastMonthField
        label="Starts"
        value={start}
        onChange={(next) => {
          setStart(next);
          commit(next, end);
        }}
      />
      <ForecastMonthField
        label="Ends"
        value={end}
        onChange={(next) => {
          setEnd(next);
          commit(start, next);
        }}
      />
      {error ? <Meta>{error}</Meta> : null}
      <Button label="Save expense" onPress={() => commit()} />
      <Button label="Remove" tone="ghost" onPress={onDelete} />
    </Card>
  );
}

function AssetEditor({
  asset,
  featured,
  onSave,
  onFeature,
  onDelete,
}: {
  asset: AssetInput;
  featured: boolean;
  onSave: (next: AssetInput) => void;
  onFeature: () => void;
  onDelete: () => void;
}) {
  const field = useFieldStyle();
  const [name, setName] = useState(asset.name);
  const [value, setValue] = useState(asset.value == null ? '' : String(asset.value));
  const [tax, setTax] = useState(asset.taxMonthly == null ? '' : String(asset.taxMonthly));
  const [insurance, setInsurance] = useState(asset.insuranceMonthly == null ? '' : String(asset.insuranceMonthly));
  const [hoa, setHoa] = useState(asset.hoaMonthly == null ? '' : String(asset.hoaMonthly));
  const [fuel, setFuel] = useState(asset.fuelMonthly == null ? '' : String(asset.fuelMonthly));
  const [miles, setMiles] = useState(asset.mileage == null ? '' : String(asset.mileage));
  const [year, setYear] = useState(String(asset.type === 'home' ? asset.roofYear ?? '' : asset.vehicleYear ?? ''));
  const [vehicleClass, setVehicleClass] = useState<VehicleClass>(asset.vehicleClass ?? 'car');
  const [rental, setRental] = useState(asset.rentalIncomeMonthly == null ? '' : String(asset.rentalIncomeMonthly));
  const [vacancy, setVacancy] = useState(asset.vacancyRate == null ? '' : String(asset.vacancyRate * 100));
  const [management, setManagement] = useState(asset.managementPct == null ? '' : String(asset.managementPct * 100));
  const [exterior, setExterior] = useState<ExteriorResponsibility>(asset.exteriorResponsibility === 'hoa' ? 'hoa' : 'owner');
  const [error, setError] = useState<string | null>(null);
  const save = () => {
    const nextValue = value.trim() ? parseMoney(value) : null;
    if (value.trim() && nextValue == null) {
      setError('Value has to be a positive number.');
      return;
    }
    const nextYear = year.trim() ? parseYear(year) : null;
    if (year.trim() && nextYear == null) {
      setError('Year has to be 1900 through next year.');
      return;
    }
    const nextMiles = miles.trim() ? parseMileage(miles) : null;
    if (miles.trim() && nextMiles == null) {
      setError('Mileage has to be between 0 and 500,000.');
      return;
    }
    const vacancyRate = parsePercentInput(vacancy, { allowZero: true });
    const managementPct = parsePercentInput(management, { allowZero: true });
    if (asset.type === 'home' && ((vacancy.trim() && vacancyRate == null) || (management.trim() && managementPct == null))) {
      setError('Confirm the percent before saving.');
      return;
    }
    const rentalIncome = rental.trim() ? parseMoney(rental) : null;
    if (asset.type === 'home' && rental.trim() && rentalIncome == null) {
      setError('Rent collected has to be a positive number.');
      return;
    }
    setError(null);
    onSave({
      ...asset,
      name: name.trim() || asset.name,
      value: nextValue,
      roofYear: asset.type === 'home' ? nextYear : asset.roofYear,
      vehicleYear: asset.type === 'vehicle' ? nextYear : asset.vehicleYear,
      vehicleClass: asset.type === 'vehicle' ? vehicleClass : asset.vehicleClass,
      mileage: asset.type === 'vehicle' ? nextMiles : asset.mileage,
      taxMonthly: tax.trim() ? moneyOrNull(tax) : null,
      insuranceMonthly: insurance.trim() ? moneyOrNull(insurance) : null,
      hoaMonthly: hoa.trim() ? moneyOrNull(hoa) : null,
      fuelMonthly: fuel.trim() ? moneyOrNull(fuel) : null,
      rentalIncomeMonthly: asset.type === 'home' ? rentalIncome : asset.rentalIncomeMonthly,
      vacancyRate: asset.type === 'home' && vacancy.trim() ? vacancyRate : asset.type === 'home' ? null : asset.vacancyRate,
      managementPct: asset.type === 'home' && management.trim() ? managementPct : asset.type === 'home' ? null : asset.managementPct,
      exteriorResponsibility: asset.type === 'home' ? exterior : asset.exteriorResponsibility,
      lastEditedAt: new Date().toISOString(),
    });
  };
  return (
    <Card>
      <Body>{asset.type === 'home' ? 'House' : 'Vehicle'}{featured && asset.type === 'home' ? ' · featured' : ''}</Body>
      <Meta>Name</Meta>
      <TextInput accessibilityLabel="Name" value={name} onChangeText={setName} onEndEditing={() => save()} style={field} />
      <Meta>Value</Meta>
      <TextInput accessibilityLabel="Value" value={value} onChangeText={setValue} onEndEditing={() => save()} keyboardType="decimal-pad" style={field} />
      {asset.type === 'home' ? (
        <>
          <Meta>Roof year</Meta>
          <TextInput accessibilityLabel="Roof year" value={year} onChangeText={setYear} onEndEditing={() => save()} keyboardType="number-pad" style={field} />
          <Meta>Property tax per month</Meta>
          <TextInput accessibilityLabel="Property tax per month" value={tax} onChangeText={setTax} onEndEditing={() => save()} keyboardType="decimal-pad" style={field} />
          <Meta>Insurance per month</Meta>
          <TextInput accessibilityLabel="House insurance per month" value={insurance} onChangeText={setInsurance} onEndEditing={() => save()} keyboardType="decimal-pad" style={field} />
          <Meta>HOA per month</Meta>
          <TextInput accessibilityLabel="HOA per month" value={hoa} onChangeText={setHoa} onEndEditing={() => save()} keyboardType="decimal-pad" style={field} />
          <Meta>Repairs stay a percent of value. Tax, insurance, and HOA are separate.</Meta>
          <Meta>Rent collected per month</Meta>
          <TextInput accessibilityLabel="Rent collected per month" value={rental} onChangeText={setRental} onEndEditing={() => save()} keyboardType="decimal-pad" style={field} />
          <PercentField label="Vacancy" value={vacancy} onChangeText={setVacancy} allowZero />
          <PercentField label="Management" value={management} onChangeText={setManagement} allowZero />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Button label="You own the exterior" tone={exterior === 'owner' ? 'accent' : 'ghost'} onPress={() => setExterior('owner')} />
            <Button label="HOA owns the exterior" tone={exterior === 'hoa' ? 'accent' : 'ghost'} onPress={() => setExterior('hoa')} />
          </View>
          {featured ? null : <Button label="Use this house for downsize" tone="ghost" onPress={onFeature} />}
        </>
      ) : (
        <>
          <Meta>Mileage</Meta>
          <TextInput accessibilityLabel="Mileage" value={miles} onChangeText={setMiles} onEndEditing={() => save()} keyboardType="number-pad" style={field} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {VEHICLE_CLASSES.map((item) => (
              <Chip key={item} label={item} selected={vehicleClass === item} onPress={() => setVehicleClass(item)} />
            ))}
          </View>
          <Meta>Insurance per month</Meta>
          <TextInput accessibilityLabel="Vehicle insurance per month" value={insurance} onChangeText={setInsurance} onEndEditing={() => save()} keyboardType="decimal-pad" style={field} />
          <Meta>Fuel per month</Meta>
          <TextInput accessibilityLabel="Fuel per month" value={fuel} onChangeText={setFuel} onEndEditing={() => save()} keyboardType="decimal-pad" style={field} />
        </>
      )}
      {error ? <Meta>{error}</Meta> : null}
      <Button label="Save" onPress={save} />
      <Button label="Remove" tone="ghost" onPress={onDelete} />
    </Card>
  );
}

function PlanEditor({ household, onSave }: { household: HouseholdInput; onSave: (next: HouseholdInput) => void }) {
  const field = useFieldStyle();
  const [raiseMonth, setRaiseMonth] = useState<string | null>(
    monthKeyOrLegacy(household.plannedRaiseAt, household.plannedRaiseMonth),
  );
  const [raisePct, setRaisePct] = useState(household.plannedRaisePercent == null ? '' : String(household.plannedRaisePercent * 100));
  const [rentGrowth, setRentGrowth] = useState(household.rentGrowthAnnual == null ? '' : String(household.rentGrowthAnnual * 100));
  const [bonus, setBonus] = useState('');
  const [age, setAge] = useState(household.currentAge == null ? '' : String(household.currentAge));
  const [ss, setSs] = useState(household.socialSecurity?.monthlyAmount == null ? '' : String(household.socialSecurity.monthlyAmount));
  const [ssAge, setSsAge] = useState(household.socialSecurity?.startAge == null ? '' : String(household.socialSecurity.startAge));
  const [pension, setPension] = useState(household.pension?.monthlyAmount == null ? '' : String(household.pension.monthlyAmount));
  const [pensionAge, setPensionAge] = useState(household.pension?.startAge == null ? '' : String(household.pension.startAge));
  const [health, setHealth] = useState(household.healthAfterWorkMonthly == null ? '' : String(household.healthAfterWorkMonthly));
  const [tax, setTax] = useState(household.withdrawalTaxRate == null ? '' : String(household.withdrawalTaxRate * 100));
  const [incomeEnd, setIncomeEnd] = useState<string | null>(household.incomeEndsAt ?? null);
  const [partnerIncomeEnd, setPartnerIncomeEnd] = useState<string | null>(household.partnerIncomeEndsAt ?? null);
  const [partnerAge, setPartnerAge] = useState(household.partnerAge == null ? '' : String(household.partnerAge));
  const [partnerSs, setPartnerSs] = useState(
    household.partnerSocialSecurity?.monthlyAmount == null ? '' : String(household.partnerSocialSecurity.monthlyAmount),
  );
  const [partnerSsAge, setPartnerSsAge] = useState(
    household.partnerSocialSecurity?.startAge == null ? '' : String(household.partnerSocialSecurity.startAge),
  );
  const [partnerPension, setPartnerPension] = useState(
    household.partnerPension?.monthlyAmount == null ? '' : String(household.partnerPension.monthlyAmount),
  );
  const [partnerPensionAge, setPartnerPensionAge] = useState(
    household.partnerPension?.startAge == null ? '' : String(household.partnerPension.startAge),
  );
  const [volatility, setVolatility] = useState(
    household.incomeVolatility == null ? '' : String(household.incomeVolatility * 100),
  );
  const [retireAtHired, setRetireAtHired] = useState(household.retireAtHiredDate === true);
  const [error, setError] = useState<string | null>(null);

  const save = (
    nextRaise = raiseMonth,
    nextOwnEnd = incomeEnd,
    nextPartnerEnd = partnerIncomeEnd,
    nextRetire = retireAtHired,
  ) => {
    const raise = parsePercentInput(raisePct);
    const rent = parsePercentInput(rentGrowth);
    const withdrawal = parsePercentInput(tax);
    const swing = parsePercentInput(volatility, { allowZero: true });
    if ((raisePct.trim() && raise == null) || (rentGrowth.trim() && rent == null) || (tax.trim() && withdrawal == null) || (volatility.trim() && swing == null)) {
      setError('Confirm the percent before saving.');
      return;
    }
    if ([age, ssAge, pensionAge, partnerAge, partnerSsAge, partnerPensionAge].some((raw) => raw.trim() && ageYears(raw) == null)) {
      setError('Ages have to be between 1 and 120.');
      return;
    }
    const bonusAmount = bonus.trim() ? parseMoney(bonus) : null;
    if (bonus.trim() && bonusAmount == null) {
      setError('The bonus has to be a positive number.');
      return;
    }
    if (ss.trim() && parseMoney(ss) == null) {
      setError('Social Security has to be a positive number.');
      return;
    }
    if (pension.trim() && parseMoney(pension) == null) {
      setError('The pension has to be a positive number.');
      return;
    }
    if (health.trim() && parseMoney(health) == null) {
      setError('Health insurance has to be a positive number.');
      return;
    }
    if (partnerSs.trim() && parseMoney(partnerSs) == null) {
      setError('Partner Social Security has to be a positive number.');
      return;
    }
    if (partnerPension.trim() && parseMoney(partnerPension) == null) {
      setError('The partner pension has to be a positive number.');
      return;
    }
    setError(null);
    const extra = [...(household.extraIncomes ?? [])];
    if (bonusAmount) {
      extra.push({
        id: `income-${Date.now()}`,
        name: 'Bonus',
        amount: bonusAmount,
        schedule: 'annual',
        monthOfYear: new Date().getMonth() + 1,
      });
    }
    onSave({
      ...household,
      plannedRaisePercent: raisePct.trim() ? raise : null,
      plannedRaiseAt: nextRaise,
      plannedRaiseMonth: null,
      incomeEndsAt: nextOwnEnd,
      partnerIncomeEndsAt: nextPartnerEnd,
      rentGrowthAnnual: rentGrowth.trim() ? rent : null,
      currentAge: ageYears(age),
      partnerAge: ageYears(partnerAge),
      socialSecurity: ss.trim() ? { monthlyAmount: parseMoney(ss), startAge: ageYears(ssAge) } : null,
      pension: pension.trim() ? { monthlyAmount: parseMoney(pension), startAge: ageYears(pensionAge) } : null,
      partnerSocialSecurity: partnerSs.trim()
        ? { monthlyAmount: parseMoney(partnerSs), startAge: ageYears(partnerSsAge) }
        : null,
      partnerPension: partnerPension.trim()
        ? { monthlyAmount: parseMoney(partnerPension), startAge: ageYears(partnerPensionAge) }
        : null,
      healthAfterWorkMonthly: health.trim() ? parseMoney(health) : null,
      withdrawalTaxRate: tax.trim() ? withdrawal : null,
      incomeVolatility: volatility.trim() ? swing : null,
      retireAtHiredDate: nextRetire,
      extraIncomes: extra,
    });
    setBonus('');
  };

  return (
    <Card>
      <Body>Pay changes, benefits, and extra income</Body>
      <PercentField label="Planned raise percent" value={raisePct} onChangeText={setRaisePct} />
      <ForecastMonthField
        label="Raise starts"
        value={raiseMonth}
        onChange={(next) => {
          setRaiseMonth(next);
          save(next);
        }}
      />
      <ForecastMonthField
        label="Your pay ends"
        value={incomeEnd}
        onChange={(next) => {
          setIncomeEnd(next);
          save(raiseMonth, next);
        }}
      />
      <ForecastMonthField
        label="Partner pay ends"
        value={partnerIncomeEnd}
        onChange={(next) => {
          setPartnerIncomeEnd(next);
          save(raiseMonth, incomeEnd, next);
        }}
      />
      <PercentField label="Annual rent growth" value={rentGrowth} onChangeText={setRentGrowth} />
      <PercentField label="How much take-home can swing" value={volatility} onChangeText={setVolatility} allowZero />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <Button
          label="Stop pay when Retire early is hired"
          tone={retireAtHired ? 'accent' : 'ghost'}
          onPress={() => {
            setRetireAtHired(true);
            save(raiseMonth, incomeEnd, partnerIncomeEnd, true);
          }}
        />
        <Button
          label="Keep pay after that date"
          tone={retireAtHired ? 'ghost' : 'accent'}
          onPress={() => {
            setRetireAtHired(false);
            save(raiseMonth, incomeEnd, partnerIncomeEnd, false);
          }}
        />
      </View>
      <Meta>Yearly bonus, paid this month</Meta>
      <TextInput accessibilityLabel="Yearly bonus amount" value={bonus} onChangeText={setBonus} onEndEditing={() => save()} keyboardType="decimal-pad" style={field} />
      <Meta>Current age</Meta>
      <TextInput accessibilityLabel="Current age" value={age} onChangeText={setAge} onEndEditing={() => save()} keyboardType="number-pad" style={field} />
      <Meta>Social Security per month</Meta>
      <TextInput accessibilityLabel="Social Security per month" value={ss} onChangeText={setSs} onEndEditing={() => save()} keyboardType="decimal-pad" style={field} />
      <Meta>Social Security start age</Meta>
      <TextInput accessibilityLabel="Social Security start age" value={ssAge} onChangeText={setSsAge} onEndEditing={() => save()} keyboardType="number-pad" style={field} />
      <Meta>Pension per month</Meta>
      <TextInput accessibilityLabel="Pension per month" value={pension} onChangeText={setPension} onEndEditing={() => save()} keyboardType="decimal-pad" style={field} />
      <Meta>Pension start age</Meta>
      <TextInput accessibilityLabel="Pension start age" value={pensionAge} onChangeText={setPensionAge} onEndEditing={() => save()} keyboardType="number-pad" style={field} />
      <Meta>Partner age</Meta>
      <TextInput accessibilityLabel="Partner age" value={partnerAge} onChangeText={setPartnerAge} onEndEditing={() => save()} keyboardType="number-pad" style={field} />
      <Meta>Partner Social Security per month</Meta>
      <TextInput accessibilityLabel="Partner Social Security per month" value={partnerSs} onChangeText={setPartnerSs} onEndEditing={() => save()} keyboardType="decimal-pad" style={field} />
      <Meta>Partner Social Security start age</Meta>
      <TextInput accessibilityLabel="Partner Social Security start age" value={partnerSsAge} onChangeText={setPartnerSsAge} onEndEditing={() => save()} keyboardType="number-pad" style={field} />
      <Meta>Partner pension per month</Meta>
      <TextInput accessibilityLabel="Partner pension per month" value={partnerPension} onChangeText={setPartnerPension} onEndEditing={() => save()} keyboardType="decimal-pad" style={field} />
      <Meta>Partner pension start age</Meta>
      <TextInput accessibilityLabel="Partner pension start age" value={partnerPensionAge} onChangeText={setPartnerPensionAge} onEndEditing={() => save()} keyboardType="number-pad" style={field} />
      <Meta>Health insurance per month after work stops</Meta>
      <TextInput accessibilityLabel="Health insurance per month after work stops" value={health} onChangeText={setHealth} onEndEditing={() => save()} keyboardType="decimal-pad" style={field} />
      <PercentField label="Tax on traditional withdrawals" value={tax} onChangeText={setTax} />
      <Meta>Leave the tax blank and this plan does not tax withdrawals.</Meta>
      {error ? <Meta>{error}</Meta> : null}
      <Button label="Save plan" onPress={() => save()} />
    </Card>
  );
}
