import { useEffect, useState } from 'react';
import { View } from 'react-native';

import {
  isoFromYearMonth,
  labelFromIso,
  labelFromMonthKey,
  monthIndexFrom,
  monthKeyOf,
  offsetToMonthKey,
  parseMonthKey,
} from '@asset-aware/forecast-engine';
import { Button, Chip, Meta } from '@/ui/primitives';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A stored `YYYY-MM`, or the calendar month a legacy forecast offset still means. */
export function monthKeyOrLegacy(
  at: string | null | undefined,
  legacy: number | null | undefined,
  now = new Date(),
): string | null {
  if (typeof at === 'string' && parseMonthKey(at)) return at.trim();
  if (legacy != null) return offsetToMonthKey(legacy, now);
  return null;
}

/** Calendar month `YYYY-MM`. Blank stays blank. Months outside the forecast stay off. */
export function ForecastMonthField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | null;
  onChange: (next: string | null) => void;
}) {
  const now = new Date();
  const selected = value ? parseMonthKey(value) : null;
  const [year, setYear] = useState(selected?.y ?? now.getFullYear());
  useEffect(() => {
    if (selected?.y != null) setYear(selected.y);
  }, [selected?.y]);

  const allowedKey = (atYear: number, monthIndex: number) => {
    const key = monthKeyOf(atYear, monthIndex + 1);
    const offset = monthIndexFrom(key, now);
    if (offset == null || offset < 1 || offset > 360) return null;
    return key;
  };

  return (
    <View style={{ gap: 8 }}>
      <Meta>
        {label}
        {value && labelFromMonthKey(value) ? ` · ${labelFromMonthKey(value)}` : ' · not set'}
      </Meta>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        <Button label="‹" accessibilityLabel="Earlier year" tone="ghost" onPress={() => setYear(year - 1)} />
        <Meta>{String(year)}</Meta>
        <Button label="›" accessibilityLabel="Later year" tone="ghost" onPress={() => setYear(year + 1)} />
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {MONTHS.map((name, monthIndex) => {
          const key = allowedKey(year, monthIndex);
          const on = selected?.y === year && selected.m === monthIndex + 1;
          return (
            <Chip
              key={name}
              label={name}
              selected={on}
              onPress={() => {
                if (key) onChange(key);
              }}
            />
          );
        })}
      </View>
      {value != null ? <Button label="Clear" tone="ghost" onPress={() => onChange(null)} /> : null}
      <Meta>Past months, and months more than 30 years out, stay off the forecast.</Meta>
    </View>
  );
}

/** A goal date as the first of a chosen month, stored `YYYY-MM-01`. */
export function CalendarMonthField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (iso: string) => void;
}) {
  const now = new Date();
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
  const [year, monthIndex] = parsed
    ? [Number(parsed.slice(0, 4)), Number(parsed.slice(5, 7)) - 1]
    : [now.getFullYear(), now.getMonth()];
  const [shownYear, setShownYear] = useState(year);

  return (
    <View style={{ gap: 8 }}>
      <Meta>
        {label}
        {parsed ? ` · ${labelFromIso(parsed)}` : ' · pick a month'}
      </Meta>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        <Button label="‹" accessibilityLabel="Earlier year" tone="ghost" onPress={() => setShownYear((y) => y - 1)} />
        <Meta>{String(shownYear)}</Meta>
        <Button label="›" accessibilityLabel="Later year" tone="ghost" onPress={() => setShownYear((y) => y + 1)} />
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {MONTHS.map((name, index) => (
          <Chip
            key={name}
            label={name}
            selected={parsed !== '' && year === shownYear && monthIndex === index}
            onPress={() => onChange(isoFromYearMonth(shownYear, index))}
          />
        ))}
      </View>
    </View>
  );
}
