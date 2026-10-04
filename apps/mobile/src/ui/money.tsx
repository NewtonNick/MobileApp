import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { scenarioLabel, type ForecastResult, type Scenario } from '@asset-aware/forecast-engine';
import { radius, space, type Palette } from '@/lib/theme';
import { useColors } from '@/ui/appearance';
import { Body, Meta } from '@/ui/primitives';

function useMoneyStyles() {
  const colors = useColors();
  return useMemo(() => createStyles(colors), [colors]);
}

export function MoneySentence({
  scenario,
  text,
  onPress,
}: {
  scenario: Scenario;
  text: string;
  onPress?: () => void;
}) {
  const styles = useMoneyStyles();
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={styles.sentenceHit}>
      <Text style={styles.sentence}>
        {scenarioLabel(scenario)} {text}
      </Text>
    </Pressable>
  );
}

export function SourceLine({ result }: { result: ForecastResult }) {
  const first = result.sources[0];
  if (!first) return null;
  return (
    <Meta>
      {first.source} · {first.vintage} · {first.model}
    </Meta>
  );
}

export function LooksWrong({ onPress }: { onPress: () => void }) {
  const styles = useMoneyStyles();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.link}>
      <Text style={styles.linkText}>This looks wrong</Text>
    </Pressable>
  );
}

export function Completeness({
  score,
  chip,
  onPress,
}: {
  score: number;
  chip: string | null;
  onPress?: () => void;
}) {
  const styles = useMoneyStyles();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.block, pressed && onPress ? styles.pressed : null]}
      disabled={!onPress}>
      <View style={styles.blockCopy}>
        <Meta>Forecast completeness</Meta>
        <Body style={styles.score}>{score}%</Body>
        {chip ? <Meta>{chip}</Meta> : null}
      </View>
      {onPress ? <Text style={styles.chevron}>›</Text> : null}
    </Pressable>
  );
}

function createStyles(colors: Palette) {
  return StyleSheet.create({
  sentenceHit: {
    minHeight: 44,
    justifyContent: 'center',
  },
  sentence: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '600',
    letterSpacing: -0.2,
    color: colors.text,
  },
  link: {
    minHeight: 44,
    justifyContent: 'center',
  },
  linkText: {
    color: colors.accent,
    fontWeight: '600',
    fontSize: 15,
  },
  block: {
    minHeight: 64,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  blockCopy: {
    flex: 1,
    gap: 2,
  },
  score: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  chevron: {
    fontSize: 22,
    color: colors.muted,
  },
  pressed: {
    opacity: 0.82,
  },
  });
}

export function useCompare() {
  const router = useRouter();
  return () => router.push('/compare');
}
