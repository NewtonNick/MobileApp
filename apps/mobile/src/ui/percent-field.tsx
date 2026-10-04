import { TextInput, View } from 'react-native';

import { readPercentInput, type PercentReadOptions } from '@asset-aware/forecast-engine';
import { Button, Meta, useFieldStyle } from '@/ui/primitives';

/** Percent entry. A value between 0 and 1 waits for a confirmation, unless an APR field treats it as a decimal. */
export function PercentField({
  label,
  value,
  onChangeText,
  bareFractionMeans,
  allowZero,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  bareFractionMeans?: PercentReadOptions['bareFractionMeans'];
  allowZero?: boolean;
}) {
  const field = useFieldStyle();
  const read = readPercentInput(value, { bareFractionMeans, allowZero });
  return (
    <View style={{ gap: 6 }}>
      <Meta>{label}</Meta>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        keyboardType="decimal-pad"
        placeholderTextColor="#8A8478"
        style={field}
      />
      {read.status === 'rejected' ? <Meta>{read.message}</Meta> : null}
      {read.status === 'ambiguous' ? (
        <View style={{ gap: 6 }}>
          <Meta>Did you mean {read.percentLabel} or {read.decimalLabel}?</Meta>
          <Button label={`Use ${read.decimalLabel}`} onPress={() => onChangeText(read.decimalLabel)} />
          <Button label={`Use ${read.percentLabel}`} tone="ghost" onPress={() => onChangeText(read.percentLabel)} />
        </View>
      ) : null}
    </View>
  );
}

export function confirmedPercent(
  value: string,
  opts: PercentReadOptions = {},
): { rate: number | null; blocked: boolean } {
  const read = readPercentInput(value, opts);
  if (read.status === 'empty') return { rate: null, blocked: false };
  if (read.status === 'rejected' || read.status === 'ambiguous') return { rate: null, blocked: true };
  return { rate: read.rate, blocked: false };
}
