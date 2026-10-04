import { View } from 'react-native';

import { Chip } from '@/ui/primitives';

import type { OverlayView, PathView, ScenarioView, WaterfallView } from './types';

export const pathViews: ReadonlyArray<{ id: PathView; label: string }> = [
  { id: 'line', label: 'Line' },
  { id: 'area', label: 'Area' },
  { id: 'steps', label: 'Steps' },
  { id: 'columns', label: 'Columns' },
  { id: 'change', label: 'Change' },
  { id: 'fromToday', label: 'From today' },
  { id: 'span', label: 'Year span' },
];

export const scenarioViews: ReadonlyArray<{ id: ScenarioView; label: string }> = [
  { id: 'together', label: 'Together' },
  { id: 'separate', label: 'Separate' },
  { id: 'gap', label: 'Versus Realistic' },
  { id: 'slope', label: 'Start and end' },
];

export const overlayViews: ReadonlyArray<{ id: OverlayView; label: string }> = [
  { id: 'paths', label: 'Both paths' },
  { id: 'difference', label: 'The difference' },
  { id: 'ends', label: 'Start and end' },
];

export const waterfallViews: ReadonlyArray<{ id: WaterfallView; label: string }> = [
  { id: 'dollars', label: 'Dollars' },
  { id: 'share', label: 'Share' },
];

export function ChartChoices<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: ReadonlyArray<{ id: T; label: string }>;
  onChange: (id: T) => void;
}) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {options.map((option) => (
        <Chip
          key={option.id}
          label={option.label}
          selected={value === option.id}
          onPress={() => onChange(option.id)}
        />
      ))}
    </View>
  );
}
