import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Scenario } from '@asset-aware/forecast-engine';
import { radius, type Palette } from '@/lib/theme';
import { useColors } from '@/ui/appearance';

const OPTIONS: { key: Scenario; label: string }[] = [
  { key: 'liberal', label: 'Liberal' },
  { key: 'realistic', label: 'Realistic' },
  { key: 'conservative', label: 'Conservative' },
];

export function ScenarioControl({
  value,
  onChange,
}: {
  value: Scenario;
  onChange: (s: Scenario) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.row} accessibilityRole="tablist">
      {OPTIONS.map((o) => {
        const on = value === o.key;
        return (
          <Pressable
            key={o.key}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.key)}
            style={[styles.chip, on && styles.chipOn]}>
            <Text
              adjustsFontSizeToFit
              numberOfLines={1}
              minimumFontScale={0.8}
              style={[styles.label, on && styles.labelOn]}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function createStyles(colors: Palette) {
  return StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    backgroundColor: colors.bgMuted,
    borderRadius: radius.pill,
    padding: 4,
    gap: 4,
  },
  chip: {
    flex: 1,
    minHeight: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  chipOn: {
    backgroundColor: colors.surface,
  },
  label: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '600',
  },
  labelOn: {
    color: colors.text,
  },
  });
}
