import { useState } from 'react';
import { useRouter } from 'expo-router';

import {
  Z_MOVE_LABELS,
  Z_MOVES,
  applyZMove,
  compareZMove,
  formatUsd,
  projectZMove,
  type DownsizeLoanChoice,
} from '@asset-aware/forecast-engine';
import { seedBundle } from '@/lib/seed';
import { useHousehold } from '@/state/context';
import { NotAdviceNote } from '@/ui/not-advice-note';
import { Body, Button, Card, Meta, Screen, Title } from '@/ui/primitives';

export default function MovesScreen() {
  const router = useRouter();
  const { household, settings, updateHousehold } = useHousehold();
  const [loanChoice, setLoanChoice] = useState<DownsizeLoanChoice | null>(null);
  if (!household) {
    return (
      <Screen>
        <Title>No household</Title>
        <Button label="Start" onPress={() => router.replace('/job-pick')} />
      </Screen>
    );
  }

  const hasHome = household.assets.some((a) => a.type === 'home');
  const downsize = projectZMove(household, 'downsize', loanChoice);
  const delay = projectZMove(household, 'delay_replace');

  return (
    <Screen>
        <Title>Keep, delay, or downsize</Title>
        <NotAdviceNote />
        <Body>
          Moves on the featured house only. We will not shop a different address. Delay pushes known system years out
          five years. Downsize is 70% of the value you already entered.
        </Body>
        {delay.note ? <Meta>{delay.note}</Meta> : null}
        {downsize.note ? <Meta>{downsize.note}</Meta> : null}
        {downsize.note ? (
          <>
            <Button
              label="Keep this loan"
              tone={loanChoice === 'keep_loan' ? 'accent' : 'ghost'}
              onPress={() => setLoanChoice('keep_loan')}
            />
            <Button
              label="Pay the loan down with the value cut"
              tone={loanChoice === 'pay_down' ? 'accent' : 'ghost'}
              onPress={() => setLoanChoice('pay_down')}
            />
          </>
        ) : null}
        {!hasHome ? <Meta>Add this house first. We will not invent one to downsize.</Meta> : null}
        {Z_MOVES.map((move) => {
          const { moved, diff } = compareZMove(household, seedBundle, settings.scenario, move);
          return (
            <Card key={move}>
              <Title style={{ fontSize: 18 }}>{Z_MOVE_LABELS[move]}</Title>
              <Body>{moved.sentence}</Body>
              <Meta>
                Reserved {formatUsd(moved.reserved)} · free {formatUsd(moved.leftover)}
              </Meta>
              {move !== 'keep' ? <Meta>{diff.line}</Meta> : null}
              {move === 'delay_replace' && hasHome && delay.applied ? (
                <Button label="Apply delay the next replacement" onPress={() => updateHousehold((current) => applyZMove(current, move))} />
              ) : null}
              {move === 'downsize' && hasHome && (loanChoice != null || downsize.applied) ? (
                <Button
                  label="Apply downsize this house"
                  tone="ghost"
                  onPress={() => updateHousehold((current) => applyZMove(current, move, loanChoice))}
                />
              ) : null}
            </Card>
          );
        })}
        <Button label="Decision lab" tone="ghost" onPress={() => router.push('/decide')} />
        <Button label="Back to standing" onPress={() => router.back()} />
    </Screen>
  );
}
