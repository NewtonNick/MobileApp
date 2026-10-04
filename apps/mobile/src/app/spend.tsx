import { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';

import {
  BUDGET_CATEGORIES,
  BUDGET_CATEGORY_LABELS,
  addTypedSpend,
  parseMoney,
} from '@asset-aware/forecast-engine';
import type { BudgetCategory } from '@asset-aware/forecast-engine';
import { useHousehold } from '@/state/context';
import { Body, Button, Chip, Field, Meta, Screen, Title } from '@/ui/primitives';

export default function SpendScreen() {
  const router = useRouter();
  const { household, updateHousehold } = useHousehold();
  const [merchant, setMerchant] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<BudgetCategory>('groceries');
  const [message, setMessage] = useState<string | null>(null);

  return (
    <Screen>
      <Title>Add a spend</Title>
      <Body>This counts toward the month. It does not change the plan unless you accept a current bank month.</Body>
      <Field value={merchant} onChangeText={setMerchant} placeholder="Merchant" />
      <Field value={amount} onChangeText={setAmount} placeholder="Amount" keyboardType="decimal-pad" />
      <Meta>Category</Meta>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {BUDGET_CATEGORIES.map((item) => (
          <Chip
            key={item}
            label={BUDGET_CATEGORY_LABELS[item]}
            selected={item === category}
            onPress={() => setCategory(item)}
          />
        ))}
      </View>
      <Button
        label="Save spend"
        onPress={() => {
          if (!household) return;
          const parsed = parseMoney(amount);
          if (parsed == null) {
            setMessage('Enter an amount.');
            return;
          }
          updateHousehold((current) => addTypedSpend(current, { merchant, amount: parsed, category }));
          router.back();
        }}
      />
      {message ? <Meta>{message}</Meta> : null}
    </Screen>
  );
}
