import type { DuplicateGuess } from '@asset-aware/forecast-engine';
import { Body, Button, Card } from '@/ui/primitives';

export function DuplicateGuessCard({
  guess,
  onSame,
  onUnsure,
  onSeparate,
  detailed = false,
}: {
  guess: DuplicateGuess;
  onSame: () => void;
  onUnsure: () => void;
  onSeparate?: () => void;
  detailed?: boolean;
}) {
  return (
    <Card>
      <Body>
        {detailed
          ? `You already have ${guess.liabilityName} of ${guess.liabilityPayment}. Is ${guess.expenseName} ${guess.expenseAmount} the same bill?`
          : `${guess.expenseName} may be the same bill as ${guess.liabilityName}. Count it once?`}
      </Body>
      <Button label="Same bill" onPress={onSame} />
      {onSeparate ? <Button label="Separate" tone="ghost" onPress={onSeparate} /> : null}
      <Button label="Not sure" tone="ghost" onPress={onUnsure} />
    </Card>
  );
}
