import { Pressable, StyleSheet, View, type DimensionValue } from 'react-native';

import { formatUsd } from '@asset-aware/forecast-engine';
import { useColors } from '@/ui/appearance';
import { Meta } from '@/ui/primitives';

import { HORIZON_MONTHS, type EventTimelineProps, type WaterfallChartProps } from './types';

export function WaterfallChart({ slices, accent, onSelect, view = 'dollars' }: WaterfallChartProps) {
  const colors = useColors();
  const ranked = slices
    .filter((slice) => slice.amount !== 0)
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  const head = ranked.length > 6 ? ranked.slice(0, 5) : ranked;
  const rest = ranked.length > 6 ? ranked.slice(5) : [];
  const restAmount = rest.reduce((sum, slice) => sum + slice.amount, 0);
  const shown = rest.length
    ? [...head, { key: 'rest', label: 'Everything else', amount: restAmount }]
    : head;
  const max = Math.max(...shown.map((slice) => Math.abs(slice.amount)), 1);
  const total = Math.max(
    ranked.reduce((sum, slice) => sum + Math.abs(slice.amount), 0),
    1,
  );
  return (
    <View style={styles.stack}>
      {shown.map((slice) => {
        const scale = view === 'share' ? total : max;
        const width = `${(Math.abs(slice.amount) / scale) * 100}%` as DimensionValue;
        const pct = (Math.abs(slice.amount) / total) * 100;
        const share = pct > 0 && pct < 0.5 ? 'under 1%' : `${Math.round(pct)}%`;
        const bar = (
          <View style={[styles.barTrack, { backgroundColor: colors.bgMuted }]}>
            <View
              style={{
                height: 8,
                width,
                borderRadius: 4,
                backgroundColor: slice.amount < 0 ? colors.danger : accent,
              }}
            />
          </View>
        );
        const copy = (
          <Meta>
            {slice.label} · about {formatUsd(slice.amount)}
            {view === 'share' ? ` · ${share}` : ''}
          </Meta>
        );
        if (slice.key === 'rest' || !onSelect) {
          return (
            <View key={slice.key} style={styles.stack}>
              {copy}
              {bar}
            </View>
          );
        }
        return (
          <Pressable
            key={slice.key}
            accessibilityRole="button"
            accessibilityLabel={`${slice.label}, about ${formatUsd(slice.amount)}`}
            onPress={() => onSelect(slice.key)}
            style={styles.stack}>
            {copy}
            {bar}
          </Pressable>
        );
      })}
      {view === 'share' ? <Meta>Each share is of these ownership amounts.</Meta> : null}
    </View>
  );
}

export function EventTimeline({ events, horizon = HORIZON_MONTHS, onSelect }: EventTimelineProps) {
  const colors = useColors();
  const recurring = events.some((e) => e.month === -1);
  const discrete = events.filter((e) => e.month >= 1 && e.month <= horizon);
  return (
    <View style={styles.stack}>
      {recurring ? <View style={[styles.dash, { borderColor: colors.muted }]} /> : null}
      <View style={[styles.track, { borderBottomColor: colors.line }]}>
        {Array.from({ length: horizon }, (_, i) => {
          const month = i + 1;
          const hit = discrete.find((e) => e.month === month);
          return (
            <Pressable
              key={month}
              onPress={() => hit && onSelect?.(hit.key)}
              style={styles.slot}
            >
              <View
                style={[
                  styles.dot,
                  hit ? { backgroundColor: hit.cost > 0 ? colors.danger : colors.muted } : styles.dotOff,
                ]}
              />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 6 },
  barTrack: { height: 8, width: '100%', borderRadius: 4, overflow: 'hidden' },
  track: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 28,
    borderBottomWidth: 1,
  },
  slot: { flex: 1, alignItems: 'center', justifyContent: 'center', height: 28 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  dotOff: { backgroundColor: 'transparent' },
  dash: {
    height: 1,
    borderWidth: 1,
    borderStyle: 'dashed',
    opacity: 0.5,
  },
});
