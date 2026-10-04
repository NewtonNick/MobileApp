import { useRouter } from 'expo-router';

import { SURPLUS_POLICIES, SURPLUS_POLICY_LABELS, compareSequence, formatUsd } from '@asset-aware/forecast-engine';
import { seedBundle } from '@/lib/seed';
import { useHousehold } from '@/state/context';
import { NotAdviceNote } from '@/ui/not-advice-note';
import { Body, Button, Card, Meta, Screen, Title } from '@/ui/primitives';

export default function SequenceScreen() {
  const router = useRouter();
  const { household, settings, setHousehold } = useHousehold();
  if (!household) {
    return (
      <Screen>
        <Title>No household</Title>
        <Button label="Start" onPress={() => router.replace('/job-pick')} />
      </Screen>
    );
  }

  const { debtFirst, fireFirst, diff, extraMonthly, targetLoanName } = compareSequence(
    household,
    seedBundle,
    settings.scenario,
  );

  return (
    <Screen>
        <Title>Debt first vs Retire early</Title>
        <NotAdviceNote />
        <Body>
          Same books. Two allocations. After living, loan payments, and typical ownership, about{' '}
          {formatUsd(extraMonthly)} a month is left
          {targetLoanName ? `. Debt first sends that to ${targetLoanName}` : ''}. Forecast follows the choice you save
          here.
        </Body>
        {SURPLUS_POLICIES.map((policy) => (
          <Button
            key={policy}
            tone={(household.surplusPolicy ?? 'cash') === policy ? 'accent' : 'ghost'}
            label={SURPLUS_POLICY_LABELS[policy]}
            onPress={() => setHousehold({ ...household, surplusPolicy: policy })}
          />
        ))}
        <Card>
          <Meta>Debt first</Meta>
          <Body>{debtFirst.sentence}</Body>
          <Meta>
            Reserved {formatUsd(debtFirst.reserved)} · free {formatUsd(debtFirst.leftover)}
          </Meta>
        </Card>
        <Card>
          <Meta>Retire early first</Meta>
          <Body>{fireFirst.sentence}</Body>
          <Meta>
            Reserved {formatUsd(fireFirst.reserved)} · free {formatUsd(fireFirst.leftover)}
          </Meta>
        </Card>
        <Card>
          <Body>{diff.line}</Body>
        </Card>
        <Button label="Decision lab" tone="ghost" onPress={() => router.push('/decide')} />
        <Button label="Back to standing" onPress={() => router.back()} />
    </Screen>
  );
}
