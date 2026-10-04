import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';

import {
  applyDecision,
  cappedRest,
  compareRank,
  decisionLabel,
  formatUsd,
  isLiability,
  monthGapLine,
  otherGoalMonths,
  parseMoney,
  rankDecisions,
  readPercentInput,
  scoreDecisions,
  splitGrid,
  stressLeaders,
  type LabInputs,
  type RankRow,
  type StressReport,
} from '@asset-aware/forecast-engine';
import { FanChart } from '@/charts';
import { seedBundle } from '@/lib/seed';
import { fan } from '@/state/household';
import { useHousehold } from '@/state/context';
import { confirm } from '@/ui/confirm';
import { NotAdviceNote } from '@/ui/not-advice-note';
import { Body, Button, Card, Field, Meta, Screen, Title } from '@/ui/primitives';

const SHOW = 40;

function whole(raw: string): number | null {
  const value = parseMoney(raw);
  if (value == null || !Number.isInteger(value)) return null;
  return value;
}

export default function DecideScreen() {
  const router = useRouter();
  const { household, settings, updateHousehold } = useHousehold();
  const [lump, setLump] = useState('');
  const [socialAge, setSocialAge] = useState('');
  const [socialCheck, setSocialCheck] = useState('');
  const [pensionAge, setPensionAge] = useState('');
  const [pensionCheck, setPensionCheck] = useState('');
  const [carPrice, setCarPrice] = useState('');
  const [carYear, setCarYear] = useState('');
  const [pay, setPay] = useState('');
  const [partnerStops, setPartnerStops] = useState(false);
  const [refiLoan, setRefiLoan] = useState<string | null>(null);
  const [refiApr, setRefiApr] = useState('');
  const [refiPayment, setRefiPayment] = useState('');
  const [rows, setRows] = useState<RankRow[]>([]);
  const [pending, setPending] = useState(false);
  const [capped, setCapped] = useState(false);
  const [stress, setStress] = useState<StressReport | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [fanBusy, setFanBusy] = useState(false);
  const [fans, setFans] = useState<{ current: ReturnType<typeof fan>; leading: ReturnType<typeof fan> } | null>(null);

  const loans = useMemo(
    () =>
      (household?.accounts ?? []).filter(
        (account) => isLiability(account.type) && account.balance > 0 && account.payoffStyle !== 'paid_monthly',
      ),
    [household],
  );

  const lab = useMemo<LabInputs>(() => {
    const apr = readPercentInput(refiApr);
    const payment = parseMoney(refiPayment);
    const loanId = refiLoan ?? loans[0]?.id ?? null;
    const socialAgeN = whole(socialAge);
    const socialAmount = parseMoney(socialCheck);
    const pensionAgeN = whole(pensionAge);
    const pensionAmount = parseMoney(pensionCheck);
    const price = parseMoney(carPrice);
    const year = whole(carYear);
    return {
      lumpAmount: parseMoney(lump),
      socialPairs:
        socialAgeN != null && socialAmount != null && socialAmount > 0
          ? [{ startAge: socialAgeN, monthlyAmount: socialAmount }]
          : [],
      pensionPairs:
        pensionAgeN != null && pensionAmount != null && pensionAmount > 0
          ? [{ startAge: pensionAgeN, monthlyAmount: pensionAmount }]
          : [],
      car: price != null && price > 0 && year != null ? { price, vehicleYear: year } : null,
      payMonthly: parseMoney(pay),
      partnerToZero: partnerStops,
      refinance:
        loanId && apr.status === 'ok' && payment != null
          ? { loanId, apr: apr.rate, minPayment: payment }
          : null,
    };
  }, [
    lump,
    socialAge,
    socialCheck,
    pensionAge,
    pensionCheck,
    carPrice,
    carYear,
    pay,
    partnerStops,
    refiApr,
    refiPayment,
    refiLoan,
    loans,
  ]);

  useEffect(() => {
    if (!household) return;
    let cancel = false;
    const grid = splitGrid(household, lab);
    const first = rankDecisions(household, seedBundle, settings.scenario, grid.singles);
    setRows(first);
    setCapped(grid.capped);
    setStress(null);
    setPending(true);
    const queue = grid.capped ? cappedRest(household, lab, first) : grid.rest;
    let index = 0;
    const acc = [...first];
    const step = () => {
      if (cancel) return;
      if (index >= queue.length) {
        const ranked = [...acc].sort(compareRank).map((row, rowIndex) => {
          if (rowIndex !== 0 && row.decision.id !== 'current') return row;
          return {
            ...row,
            otherGoals: otherGoalMonths(applyDecision(household, row.decision), seedBundle, settings.scenario),
          };
        });
        setRows(ranked);
        setStress(stressLeaders(household, seedBundle, ranked));
        setPending(false);
        return;
      }
      const slice = queue.slice(index, index + 25);
      index += slice.length;
      acc.push(...scoreDecisions(household, seedBundle, settings.scenario, slice));
      setTimeout(step, 0);
    };
    const timer = setTimeout(step, 0);
    return () => {
      cancel = true;
      clearTimeout(timer);
    };
  }, [household, settings.scenario, lab]);

  const leading = rows[0] ?? null;

  useEffect(() => {
    if (!advanced || !household || !leading) {
      setFans(null);
      setFanBusy(false);
      return;
    }
    const decision = leading.decision;
    setFanBusy(true);
    const timer = setTimeout(() => {
      setFans({
        current: fan(household),
        leading: fan(applyDecision(household, decision)),
      });
      setFanBusy(false);
    }, 0);
    return () => clearTimeout(timer);
  }, [advanced, household, leading]);

  if (!household) {
    return (
      <Screen>
        <Title>No household</Title>
        <Button label="Start" onPress={() => router.replace('/job-pick')} />
      </Screen>
    );
  }

  const hasSocial = (household.socialSecurity?.monthlyAmount ?? 0) > 0;
  const hasPension = (household.pension?.monthlyAmount ?? 0) > 0;
  const hasCar = household.assets.some((asset) => asset.type === 'vehicle');
  const partnerPay = household.partnerMonthlyIncome ?? 0;
  const aprRead = readPercentInput(refiApr);
  const visible = rows.slice(0, SHOW);

  return (
    <Screen>
        <Title>Decision lab</Title>
        <NotAdviceNote />
        <Body>
          Same books. Each row is one walk of the featured goal. A typed amount is included only after you enter it.
        </Body>
        <Card>
          <Meta>Lump from cash</Meta>
          <Field accessibilityLabel="Lump amount" value={lump} onChangeText={setLump} keyboardType="decimal-pad" placeholder="Amount" />
          {hasSocial ? (
            <View style={{ gap: 6 }}>
              <Meta>Another Social Security age and check</Meta>
              <Field accessibilityLabel="Social Security age" value={socialAge} onChangeText={setSocialAge} keyboardType="number-pad" placeholder="Age 62 to 70" />
              <Field accessibilityLabel="Social Security check" value={socialCheck} onChangeText={setSocialCheck} keyboardType="decimal-pad" placeholder="Monthly check" />
            </View>
          ) : null}
          {hasPension ? (
            <View style={{ gap: 6 }}>
              <Meta>Another pension age and check</Meta>
              <Field accessibilityLabel="Pension age" value={pensionAge} onChangeText={setPensionAge} keyboardType="number-pad" placeholder="Age" />
              <Field accessibilityLabel="Pension check" value={pensionCheck} onChangeText={setPensionCheck} keyboardType="decimal-pad" placeholder="Monthly check" />
            </View>
          ) : null}
          {hasCar ? (
            <View style={{ gap: 6 }}>
              <Meta>Replace the car</Meta>
              <Field accessibilityLabel="Replacement price" value={carPrice} onChangeText={setCarPrice} keyboardType="decimal-pad" placeholder="Price" />
              <Field accessibilityLabel="Replacement year" value={carYear} onChangeText={setCarYear} keyboardType="number-pad" placeholder="Model year" />
            </View>
          ) : null}
          <Meta>Alternate take-home</Meta>
          <Field accessibilityLabel="Alternate take-home" value={pay} onChangeText={setPay} keyboardType="decimal-pad" placeholder="Monthly take-home" />
          {partnerPay > 0 ? (
            <Button
              label={partnerStops ? 'Partner pay stays' : 'Partner pay stops'}
              tone={partnerStops ? 'accent' : 'ghost'}
              onPress={() => setPartnerStops((value) => !value)}
            />
          ) : null}
          {loans.length ? (
            <View style={{ gap: 6 }}>
              <Meta>Refinance</Meta>
              {loans.map((loan) => (
                <Button
                  key={loan.id}
                  label={loan.name}
                  tone={(refiLoan ?? loans[0].id) === loan.id ? 'accent' : 'ghost'}
                  onPress={() => setRefiLoan(loan.id)}
                />
              ))}
              <Field accessibilityLabel="Refinance APR" value={refiApr} onChangeText={setRefiApr} keyboardType="decimal-pad" placeholder="APR" />
              {aprRead.status === 'rejected' ? <Meta>{aprRead.message}</Meta> : null}
              {aprRead.status === 'ambiguous' ? <Meta>Add a percent sign so this rate is unambiguous.</Meta> : null}
              <Field accessibilityLabel="Refinance payment" value={refiPayment} onChangeText={setRefiPayment} keyboardType="decimal-pad" placeholder="Payment" />
            </View>
          ) : null}
        </Card>
        {pending ? <Meta>Scoring the rest of the combinations.</Meta> : null}
        {capped ? <Meta>This list is the capped set.</Meta> : null}
        {stress && stress.stretchCount > 0 ? (
          <Card>
            <Body>
              The order holds on {stress.holdCount} of {stress.stretchCount} harder years.
            </Body>
            {stress.reversed.length ? (
              <Meta>The order changes under {stress.reversed.map((stretch) => stretch.label).join(', ')}.</Meta>
            ) : null}
          </Card>
        ) : null}
        {visible.map((row) => (
          <Card key={row.decision.id}>
            <Meta>{decisionLabel(row.decision, household)}</Meta>
            <Body>{monthGapLine(row.monthGap)}</Body>
            <Meta>
              Reserved {formatUsd(row.reserved)} · free {formatUsd(row.leftover)}
            </Meta>
            {row.otherGoals.map((goal) => (
              <Meta key={goal.name}>
                {goal.name}: {goal.hiredMonth == null ? 'not dated' : goal.hiredMonth === 0 ? 'on track now' : `about ${goal.hiredMonth} months`}
              </Meta>
            ))}
            <Button
              label="Use this scenario in my plan"
              tone="ghost"
              onPress={() =>
                confirm('Use this scenario in my plan?', 'This writes the scenario into your plan.', () =>
                  updateHousehold((current) => applyDecision(current, row.decision)),
                )
              }
            />
          </Card>
        ))}
        {rows.length > SHOW ? <Meta>Showing the earliest {SHOW} rows of this ranking.</Meta> : null}
        <Button
          label={advanced ? 'Hide the range' : 'Show the range'}
          tone="ghost"
          onPress={() => setAdvanced((value) => !value)}
        />
        {advanced && fanBusy ? <Meta>Filling the range…</Meta> : null}
        {fans ? (
          <View style={{ gap: 8 }}>
            <Meta>Current books</Meta>
            <FanChart months={fans.current.months} liberal={fans.current.liberal} realistic={fans.current.realistic} conservative={fans.current.conservative} />
            <Meta>{rows[0] ? decisionLabel(rows[0].decision, household) : 'This row'}</Meta>
            <FanChart months={fans.leading.months} liberal={fans.leading.liberal} realistic={fans.leading.realistic} conservative={fans.leading.conservative} />
            <Meta>Most paths land in this band. The line is the middle path, in today’s dollars.</Meta>
          </View>
        ) : null}
        <Button label="Back to standing" onPress={() => router.back()} />
    </Screen>
  );
}
