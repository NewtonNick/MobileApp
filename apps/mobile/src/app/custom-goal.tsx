import { useMemo, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { type Href, useLocalSearchParams, useRouter } from 'expo-router';

import {
  DEFAULT_BUFFER_MONTHS,
  defaultReservedPolicy,
  emptyRealHousehold,
  isLiability,
  isOutlineReady,
  parseMoney,
  upsertCustomGoal,
  type GoalAmountBucket,
  type GoalReservedPolicy,
  type GoalSpec,
  type GoalTarget,
} from '@asset-aware/forecast-engine';
import { useHousehold } from '@/state/context';
import { CalendarMonthField } from '@/ui/month-field';
import { Body, Button, Meta, Screen, Title, useFieldStyle } from '@/ui/primitives';
import { space } from '@/lib/theme';
import { useColors } from '@/ui/appearance';

type TargetKind = Exclude<GoalTarget['kind'], 'work_optional' | 'afloat'>;

const TARGETS: { id: TargetKind; label: string }[] = [
  { id: 'amount', label: 'Reach an amount' },
  { id: 'date', label: 'By a date' },
  { id: 'debt_zero', label: 'Pay off a loan' },
  { id: 'runway', label: 'Months of bills' },
  { id: 'afford', label: 'Afford a bill' },
];

const BUCKETS: { id: GoalAmountBucket; label: string }[] = [
  { id: 'liquid', label: 'Cash' },
  { id: 'investments', label: 'Investments' },
  { id: 'named_account', label: 'A named account' },
  { id: 'net_worth', label: 'Net worth' },
];

const RESERVED: { id: GoalReservedPolicy; label: string }[] = [
  { id: 'ownership', label: 'House and car' },
  { id: 'n_months_living', label: 'A few months of bills' },
  { id: 'paycheck_year', label: 'A year without pay' },
  { id: 'none', label: 'Nothing extra' },
];

function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return <Button tone={selected ? 'accent' : 'ghost'} label={label} onPress={onPress} />;
}

export default function CustomGoalScreen() {
  const colors = useColors();
  const fieldStyle = useFieldStyle();
  const router = useRouter();
  const { id: editId } = useLocalSearchParams<{ id?: string }>();
  const { household, setHousehold } = useHousehold();
  const base = household ?? emptyRealHousehold('');
  const editing = (base.openGoals ?? []).find((spec) => spec.id === editId) ?? null;
  const liabilities = base.accounts.filter((a) => isLiability(a.type));
  const namedAccounts = base.accounts.filter((a) => !isLiability(a.type));

  const [name, setName] = useState(editing?.name ?? (editing ?? base.goalSpec)?.name ?? '');
  const [kind, setKind] = useState<TargetKind>(() => {
    const targetKind = (editing ?? base.goalSpec)?.target.kind;
    if (targetKind && targetKind !== 'work_optional' && targetKind !== 'afloat') return targetKind;
    return 'amount';
  });
  const [dollars, setDollars] = useState(() => {
    const t = (editing ?? base.goalSpec)?.target;
    if (t && (t.kind === 'amount' || t.kind === 'afford')) return String(t.dollars);
    return '';
  });
  const [bucket, setBucket] = useState<GoalAmountBucket>(() => {
    const t = (editing ?? base.goalSpec)?.target;
    return t?.kind === 'amount' ? t.bucket : 'liquid';
  });
  const [accountId, setAccountId] = useState<string | null>(() => {
    const t = (editing ?? base.goalSpec)?.target;
    return t?.kind === 'amount' ? t.accountId ?? namedAccounts[0]?.id ?? null : namedAccounts[0]?.id ?? null;
  });
  const [by, setBy] = useState(() => {
    const target = (editing ?? base.goalSpec)?.target;
    return target?.kind === 'date' ? target.by : '';
  });
  const [loanIds, setLoanIds] = useState<string[]>(() => {
    const t = (editing ?? base.goalSpec)?.target;
    if (t?.kind === 'debt_zero' && t.accountIds?.length) return t.accountIds;
    return liabilities.map((a) => a.id);
  });
  const [months, setMonths] = useState(() => {
    const target = (editing ?? base.goalSpec)?.target;
    return target?.kind === 'runway' ? String(target.months) : String(DEFAULT_BUFFER_MONTHS);
  });
  const [note, setNote] = useState('');
  const [reserved, setReserved] = useState<GoalReservedPolicy>(
    (editing ?? base.goalSpec)?.reserved ?? defaultReservedPolicy(base),
  );

  const target: GoalTarget | null = useMemo(() => {
    if (kind === 'amount') {
      const n = parseMoney(dollars);
      if (n == null || n <= 0) return null;
      if (bucket === 'named_account' && !accountId) return null;
      return { kind: 'amount', dollars: n, bucket, accountId: bucket === 'named_account' ? accountId : null };
    }
    if (kind === 'date') {
      const trimmed = by.trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed) || !Number.isFinite(Date.parse(trimmed))) return null;
      return { kind: 'date', by: trimmed };
    }
    if (kind === 'debt_zero') {
      return { kind: 'debt_zero', accountIds: loanIds.length ? loanIds : null };
    }
    if (kind === 'runway') {
      const n = Number(months);
      if (!Number.isFinite(n) || n < 1 || n > 360) return null;
      return { kind: 'runway', months: Math.round(n) };
    }
    const n = parseMoney(dollars);
    if (n == null || n <= 0) return null;
    return { kind: 'afford', dollars: n, eventKey: note.trim() || null };
  }, [kind, dollars, bucket, accountId, by, loanIds, months, note]);

  const ready = !!name.trim() && target != null;

  const hire = () => {
    if (!target || !name.trim()) return;
    const spec: GoalSpec = {
      id: editing?.id ?? `goal-${Date.now().toString(36)}`,
      name: name.trim(),
      source: 'custom',
      target,
      reserved,
    };
    const next = upsertCustomGoal(base, spec);
    next.targetDate = target.kind === 'date' ? target.by : null;
    setHousehold(next);
    if (isOutlineReady(next)) router.replace('/(tabs)' as Href);
    else router.push('/onboarding' as Href);
  };

  const toggleLoan = (id: string) => {
    setLoanIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  return (
    <Screen>
          <Title>Something else</Title>
          <Body>
            Add a date alongside the others. House and car still count when you have them — this is not a shop
            for a different house.
          </Body>

          <View style={{ gap: 6 }}>
            <Meta>Name this date</Meta>
            <TextInput
              accessibilityLabel="Name this date"
              value={name}
              onChangeText={setName}
              placeholder="Honda paid off"
              placeholderTextColor={colors.muted}
              style={fieldStyle}
            />
            <Meta>Or “June trip” — whatever this household is aiming at.</Meta>
          </View>

          <View style={{ gap: 8 }}>
            <Meta>What does hired mean?</Meta>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {TARGETS.map((t) => (
                <Chip key={t.id} label={t.label} selected={kind === t.id} onPress={() => setKind(t.id)} />
              ))}
            </View>
          </View>

          {kind === 'amount' ? (
            <View style={{ gap: 8 }}>
              <Meta>Dollars</Meta>
              <TextInput
                value={dollars}
                onChangeText={setDollars}
                keyboardType="decimal-pad"
                placeholder="15000"
                placeholderTextColor={colors.muted}
                style={fieldStyle}
              />
              <Meta>Where should that amount live?</Meta>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {BUCKETS.map((b) => (
                  <Chip key={b.id} label={b.label} selected={bucket === b.id} onPress={() => setBucket(b.id)} />
                ))}
              </View>
              {bucket === 'named_account' ? (
                namedAccounts.length ? (
                  <View style={{ gap: 8 }}>
                    {namedAccounts.map((a) => (
                      <Pressable
                        key={a.id}
                        onPress={() => setAccountId(a.id)}
                        style={{
                          backgroundColor: colors.surface,
                          borderColor: accountId === a.id ? colors.text : colors.line,
                          borderWidth: 1,
                          padding: space.md,
                          borderRadius: 10,
                        }}>
                        <Title style={{ fontSize: 16 }}>{a.name}</Title>
                        <Meta>{a.type}</Meta>
                      </Pressable>
                    ))}
                  </View>
                ) : (
                  <Meta>Add an account on the books first, then pick it here.</Meta>
                )
              ) : null}
            </View>
          ) : null}

          {kind === 'date' ? (
            <CalendarMonthField label="Date" value={by} onChange={setBy} />
          ) : null}

          {kind === 'debt_zero' ? (
            <View style={{ gap: 8 }}>
              <Meta>Which loans? Default is all of them.</Meta>
              {liabilities.length ? (
                liabilities.map((a) => (
                  <Pressable
                    key={a.id}
                    onPress={() => toggleLoan(a.id)}
                    style={{
                      backgroundColor: colors.surface,
                      borderColor: loanIds.includes(a.id) ? colors.text : colors.line,
                      borderWidth: 1,
                      padding: space.md,
                      borderRadius: 10,
                    }}>
                    <Title style={{ fontSize: 16 }}>
                      {loanIds.includes(a.id) ? 'On · ' : 'Off · '}
                      {a.name}
                    </Title>
                    <Meta>{a.type}</Meta>
                  </Pressable>
                ))
              ) : (
                <Meta>No loans on the books yet — we will ask on the next screen.</Meta>
              )}
            </View>
          ) : null}

          {kind === 'runway' ? (
            <View style={{ gap: 6 }}>
              <Meta>Months of bills</Meta>
              <TextInput
                value={months}
                onChangeText={setMonths}
                keyboardType="decimal-pad"
                placeholder="3"
                placeholderTextColor={colors.muted}
                style={fieldStyle}
              />
            </View>
          ) : null}

          {kind === 'afford' ? (
            <View style={{ gap: 6 }}>
              <Meta>Bill to cover from leftover</Meta>
              <TextInput
                value={dollars}
                onChangeText={setDollars}
                keyboardType="decimal-pad"
                placeholder="1800"
                placeholderTextColor={colors.muted}
                style={fieldStyle}
              />
              <Meta>Optional note</Meta>
              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder="June trip"
                placeholderTextColor={colors.muted}
                style={fieldStyle}
              />
            </View>
          ) : null}

          <View style={{ gap: 8 }}>
            <Meta>What stays reserved while we date this?</Meta>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {RESERVED.map((r) => (
                <Chip key={r.id} label={r.label} selected={reserved === r.id} onPress={() => setReserved(r.id)} />
              ))}
            </View>
          </View>

          <Button label={editing ? 'Save this goal' : 'Add this goal'} onPress={hire} disabled={!ready} />
    </Screen>
  );
}
