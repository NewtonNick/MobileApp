export type PathMonth = { month: number; cash: number; netWorth: number };

export type PathView = 'line' | 'area' | 'steps' | 'columns' | 'change' | 'fromToday' | 'span';

export type PathChartProps = {
  months: PathMonth[];
  mode: 'cash' | 'netWorth';
  accent: string;
  markMonth?: number | null;
  onSelectMonth?: (month: number) => void;
  view?: PathView;
};

export type WaterfallSlice = { key: string; label: string; amount: number };

export type WaterfallView = 'dollars' | 'share';

export type WaterfallChartProps = {
  slices: WaterfallSlice[];
  accent: string;
  onSelect?: (key: string) => void;
  view?: WaterfallView;
};

export type TimelineEvent = { key: string; month: number; cost: number; label: string };

export type EventTimelineProps = {
  events: TimelineEvent[];
  horizon?: number;
  onSelect?: (key: string) => void;
};

export type ScenarioView = 'together' | 'separate' | 'gap' | 'slope';

export type ScenarioLinesChartProps = {
  liberal: number[];
  realistic: number[];
  conservative: number[];
  months: number[];
  colors: { liberal: string; realistic: string; conservative: string };
  view?: ScenarioView;
};

export type FanChartProps = {
  months: number[];
  liberal: number[];
  realistic: number[];
  conservative: number[];
};

export type OverlayView = 'paths' | 'difference' | 'ends';

export type OverlayCompareChartProps = {
  base: number[];
  overlay: number[];
  months: number[];
  baseLabel: string;
  overlayLabel: string;
  view?: OverlayView;
};

export const CHART_HEIGHT = 208;
export const HORIZON_MONTHS = 60;
