import { Fragment } from 'react';
import { View } from 'react-native';
import { Polygon, Polyline, Circle, Line, Rect, Text as SvgText } from 'react-native-svg';

import { formatUsd } from '@asset-aware/forecast-engine';
import { useColors } from '@/ui/appearance';
import { Meta } from '@/ui/primitives';

import { ChartSvg, areaPoints, linePoints, plotStyles, stackedLabelYs, stepPoints, type Geom } from './plot';
import {
  alignValues,
  compactUsd,
  dipMarks,
  domainOf,
  extremeIndex,
  fractionalIndex,
  fromToday,
  periodChanges,
  plottedSeries,
  rangeSpans,
  widestSpread,
  type RangeSpan,
} from './scale';
import {
  type FanChartProps,
  type OverlayCompareChartProps,
  type PathChartProps,
  type ScenarioLinesChartProps,
} from './types';

function baselineOf(domain: { min: number; max: number }): number {
  return domain.min <= 0 && domain.max >= 0 ? 0 : domain.min;
}

function EndValue({
  geom,
  index,
  value,
  color,
  y,
}: {
  geom: Geom;
  index: number;
  value: number;
  color: string;
  y?: number;
}) {
  const x = geom.x(index);
  const pointY = y ?? geom.y(value);
  return (
    <SvgText x={x} y={pointY} fill={color} fontSize={11} fontWeight="600" textAnchor="end">
      {compactUsd(value)}
    </SvgText>
  );
}

function Swatches({ items }: { items: Array<{ color: string; label: string }> }) {
  return (
    <View style={plotStyles.legend}>
      {items.map((item) => (
        <View key={item.label} style={plotStyles.swatchRow}>
          <View style={[plotStyles.swatch, { backgroundColor: item.color }]} />
          <Meta>{item.label}</Meta>
        </View>
      ))}
    </View>
  );
}

function MarkLine({
  geom,
  at,
  color,
  label,
}: {
  geom: Geom;
  at: number;
  color: string;
  label: string;
}) {
  const x = geom.x(at);
  const anchor = x > geom.left + geom.plotW * 0.8 ? 'end' : 'middle';
  return (
    <>
      <Line
        x1={x}
        x2={x}
        y1={geom.top}
        y2={geom.top + geom.plotH}
        stroke={color}
        strokeWidth={1.25}
        strokeDasharray="3 3"
      />
      <SvgText x={x} y={geom.top - 2} fill={color} fontSize={10} textAnchor={anchor}>
        {label}
      </SvgText>
    </>
  );
}

function ColumnBars({
  values,
  months: barMonths,
  geom,
  baseline,
  selected,
  accent,
  danger,
}: {
  values: number[];
  months: number[];
  geom: Geom;
  baseline: number;
  selected: number | null;
  accent: string;
  danger: string;
}) {
  const slot = geom.plotW / Math.max(1, values.length);
  const barW = Math.max(3, Math.min(slot - 2, slot * 0.62));
  return (
    <>
      {values.map((value, index) => {
        const top = Math.min(geom.y(value), geom.y(baseline));
        const barH = Math.max(value === baseline ? 0 : 1, Math.abs(geom.y(value) - geom.y(baseline)));
        return (
          <Rect
            key={barMonths[index] ?? index}
            x={geom.left + slot * index + (slot - barW) / 2}
            y={top}
            width={barW}
            height={barH}
            rx={2}
            fill={value < 0 ? danger : accent}
            opacity={selected == null || selected === index ? 1 : 0.45}
          />
        );
      })}
    </>
  );
}

function SpanPath({
  spans,
  yearly,
  accent,
  markColor,
  tick,
  markMonth,
  onSelectMonth,
  noun,
}: {
  spans: RangeSpan[];
  yearly: boolean;
  accent: string;
  markColor: string;
  tick: string;
  markMonth?: number | null;
  onSelectMonth?: (month: number) => void;
  noun: string;
}) {
  const spanMonths = spans.map((span) => span.month);
  const domain = domainOf([spans.flatMap((span) => [span.low, span.high, span.close])]);
  const markAt = markMonth == null ? null : fractionalIndex(spanMonths, markMonth);
  return (
    <View style={plotStyles.stack}>
      <ChartSvg
        months={spanMonths}
        domain={domain}
        onSelectMonth={onSelectMonth}
        cursor={{ values: spans.map((span) => span.close), color: accent }}
        accessibilityLabel={`${noun} high and low`}>
        {(geom, selected) => (
          <>
            {spans.map((span, index) => {
              const x = geom.x(index);
              const faded = selected != null && selected !== index;
              return (
                <Fragment key={span.month}>
                  <Line
                    x1={x}
                    x2={x}
                    y1={geom.y(span.low)}
                    y2={geom.y(span.high)}
                    stroke={accent}
                    strokeWidth={2}
                    opacity={faded ? 0.35 : 1}
                  />
                  <Line
                    x1={x - 6}
                    x2={x + 6}
                    y1={geom.y(span.close)}
                    y2={geom.y(span.close)}
                    stroke={tick}
                    strokeWidth={2}
                    opacity={faded ? 0.35 : 1}
                  />
                </Fragment>
              );
            })}
            {markAt != null ? <MarkLine geom={geom} at={markAt} color={markColor} label="Hired" /> : null}
          </>
        )}
      </ChartSvg>
      <Meta>
        {yearly
          ? 'Each line runs from the low month to the high month in that year. The tick is the year-end amount.'
          : 'Each line runs from the low month to the high month in that quarter. The tick is the ending amount.'}
      </Meta>
    </View>
  );
}

export function PathChart({ months, mode, accent, markMonth, onSelectMonth, view = 'line' }: PathChartProps) {
  const colors = useColors();
  const rawMonths = months.map((month) => month.month);
  const rawValues = months.map((month) => (mode === 'cash' ? month.cash : month.netWorth));
  if (rawMonths.length < 2) return <Meta>Not enough months to draw this yet.</Meta>;

  if (view === 'change') {
    const changes = periodChanges(rawMonths, rawValues);
    if (changes.length < 1) return <Meta>Not enough months to draw this yet.</Meta>;
    const changeMonths = changes.map((point) => point.month);
    const changeValues = changes.map((point) => point.value);
    const domain = domainOf([changeValues], { pinZero: true });
    const markAt = markMonth == null ? null : fractionalIndex(changeMonths, markMonth);
    const noun = mode === 'cash' ? 'Cash' : 'Net worth';
    return (
      <View style={plotStyles.stack}>
        <ChartSvg
          months={changeMonths}
          domain={domain}
          onSelectMonth={onSelectMonth}
          cursor={{ values: changeValues, color: accent }}
          accessibilityLabel={`${noun} change`}>
          {(geom, selected) => (
            <>
              <ColumnBars
                values={changeValues}
                months={changeMonths}
                geom={geom}
                baseline={0}
                selected={selected}
                accent={accent}
                danger={colors.danger}
              />
              {markAt != null ? <MarkLine geom={geom} at={markAt} color={colors.preview} label="Hired" /> : null}
            </>
          )}
        </ChartSvg>
        <Meta>
          {rawMonths.length > 18
            ? 'Each bar is how much the balance moved by the end of that year.'
            : 'Each bar is how much the balance moved since the previous month.'}{' '}
          Above zero is a gain.
        </Meta>
      </View>
    );
  }

  if (view === 'span') {
    const spans = rangeSpans(rawMonths, rawValues);
    if (spans.length < 1) return <Meta>Not enough months to draw this yet.</Meta>;
    return (
      <SpanPath
        spans={spans}
        yearly={rawMonths.length > 18}
        accent={accent}
        markColor={colors.preview}
        tick={colors.text}
        markMonth={markMonth}
        onSelectMonth={onSelectMonth}
        noun={mode === 'cash' ? 'Cash' : 'Net worth'}
      />
    );
  }

  const leveled = view === 'fromToday' ? fromToday(rawValues) : rawValues;
  const coarseAfter = view === 'columns' ? 18 : 72;
  const pins = markMonth != null ? [markMonth] : [];
  const plotted = plottedSeries(rawMonths, leveled, pins, coarseAfter);
  const dips =
    view === 'columns' ? [] : dipMarks(rawMonths, leveled, Math.max(...leveled) - Math.min(...leveled));
  const domain = domainOf(
    [plotted.map((point) => point.value), dips.map((dip) => dip.value)],
    view === 'fromToday' ? { pinZero: true } : undefined,
  );
  const values = plotted.map((point) => point.value);
  const plotMonths = plotted.map((point) => point.month);
  const baseline = baselineOf(domain);
  const markAt = markMonth == null ? null : fractionalIndex(plotMonths, markMonth);
  const first = leveled[0] ?? 0;
  const last = leveled[leveled.length - 1] ?? 0;
  const noun =
    view === 'fromToday'
      ? `${mode === 'cash' ? 'Cash' : 'Net worth'} since today`
      : mode === 'cash'
        ? 'Cash'
        : 'Net worth';
  const yearly = rawMonths.length > coarseAfter;

  return (
    <View style={plotStyles.stack}>
      <ChartSvg
        months={plotMonths}
        domain={domain}
        onSelectMonth={onSelectMonth}
        cursor={{ values, color: accent }}
        accessibilityLabel={`${noun} from ${formatUsd(first)} to ${formatUsd(last)}`}>
        {(geom, selected) => (
          <>
            {view === 'area' || view === 'fromToday' ? (
              <Polygon points={areaPoints(values, geom, baseline)} fill={accent} opacity={0.16} />
            ) : null}
            {view === 'columns' ? (
              <ColumnBars
                values={values}
                months={plotMonths}
                geom={geom}
                baseline={baseline}
                selected={selected}
                accent={accent}
                danger={colors.danger}
              />
            ) : (
              <Polyline
                points={view === 'steps' ? stepPoints(values, geom) : linePoints(values, geom)}
                fill="none"
                stroke={accent}
                strokeWidth={2.5}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            )}
            {dips.map((dip) => {
              const at = fractionalIndex(plotMonths, dip.month);
              if (at == null) return null;
              return <Circle key={dip.month} cx={geom.x(at)} cy={geom.y(dip.value)} r={3.5} fill={colors.danger} />;
            })}
            {markAt != null ? <MarkLine geom={geom} at={markAt} color={colors.preview} label="Hired" /> : null}
            {selected == null && values.length ? (
              <EndValue
                geom={geom}
                index={values.length - 1}
                value={values[values.length - 1] ?? 0}
                color={accent}
                y={Math.max(geom.top + 11, geom.y(values[values.length - 1] ?? 0) - 8)}
              />
            ) : null}
          </>
        )}
      </ChartSvg>
      {view === 'fromToday' ? <Meta>Zero is today’s balance. Above zero is a gain since then.</Meta> : null}
      {yearly && view === 'columns' ? (
        <Meta>The first column is this month. The rest are year-end amounts.</Meta>
      ) : null}
      {yearly && (view === 'line' || view === 'area' || view === 'steps' || view === 'fromToday') ? (
        <Meta>
          {dips.length
            ? 'Points are year-end amounts. Dots mark a low month inside the year.'
            : 'Points are year-end amounts.'}
        </Meta>
      ) : null}
    </View>
  );
}

function SeriesLines({
  geom,
  series,
}: {
  geom: Geom;
  series: Array<{ values: number[]; color: string; width: number }>;
}) {
  const last = (series[0]?.values.length ?? 1) - 1;
  const labelYs = stackedLabelYs(
    series.map((item) => geom.y(item.values[last] ?? 0) - 8),
    geom.top + 10,
    geom.top + geom.plotH,
  );
  return (
    <>
      {series.map((item) => (
        <Polyline
          key={item.color}
          points={linePoints(item.values, geom)}
          fill="none"
          stroke={item.color}
          strokeWidth={item.width}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ))}
      {series.map((item, index) => (
        <EndValue
          key={`end-${item.color}`}
          geom={geom}
          index={last}
          value={item.values[last] ?? 0}
          color={item.color}
          y={labelYs[index]}
        />
      ))}
    </>
  );
}

export function ScenarioLinesChart({
  liberal,
  realistic,
  conservative,
  months,
  colors: lineColors,
  view = 'together',
}: ScenarioLinesChartProps) {
  if (months.length < 2) return <Meta>Not enough months to draw this yet.</Meta>;
  const gap = widestSpread([liberal, realistic, conservative]);
  const level = Math.max(...realistic.map((value) => Math.abs(value)), 1);
  const close = gap <= level * 0.05;
  const legend = (
    <Swatches
      items={
        view === 'gap'
          ? [
              { color: lineColors.liberal, label: 'Liberal vs Realistic' },
              { color: lineColors.conservative, label: 'Conservative vs Realistic' },
            ]
          : [
              { color: lineColors.liberal, label: 'Liberal' },
              { color: lineColors.realistic, label: 'Realistic' },
              { color: lineColors.conservative, label: 'Conservative' },
            ]
      }
    />
  );
  const closeLine = close ? <Meta>These three stay within about {formatUsd(gap)}.</Meta> : null;

  if (view === 'slope') {
    const plotMonths = [months[0] ?? 1, months[months.length - 1] ?? 1];
    const series = [
      { values: [liberal[0] ?? 0, liberal[liberal.length - 1] ?? 0], color: lineColors.liberal, width: 2 },
      {
        values: [conservative[0] ?? 0, conservative[conservative.length - 1] ?? 0],
        color: lineColors.conservative,
        width: 2,
      },
      {
        values: [realistic[0] ?? 0, realistic[realistic.length - 1] ?? 0],
        color: lineColors.realistic,
        width: 2.5,
      },
    ];
    const domain = domainOf(series.map((item) => item.values));
    return (
      <View style={plotStyles.stack}>
        <ChartSvg months={plotMonths} domain={domain} accessibilityLabel="Net worth from today to the end">
          {(geom) => <SeriesLines geom={geom} series={series} />}
        </ChartSvg>
        <Meta>Each line runs from today to the end of this path.</Meta>
        {legend}
        {closeLine}
      </View>
    );
  }

  if (view === 'separate') {
    const domain = domainOf([liberal, realistic, conservative]);
    const rows = [
      { label: 'Liberal', values: liberal, color: lineColors.liberal },
      { label: 'Realistic', values: realistic, color: lineColors.realistic },
      { label: 'Conservative', values: conservative, color: lineColors.conservative },
    ];
    return (
      <View style={plotStyles.stack}>
        {rows.map((row) => (
          <View key={row.label} style={plotStyles.stack}>
            <Meta>{row.label}</Meta>
            <ChartSvg
              months={months}
              domain={domain}
              height={132}
              accessibilityLabel={`${row.label} net worth`}>
              {(geom) => (
                <Polyline
                  points={linePoints(row.values, geom)}
                  fill="none"
                  stroke={row.color}
                  strokeWidth={2.5}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              )}
            </ChartSvg>
          </View>
        ))}
        {legend}
        {closeLine}
      </View>
    );
  }

  if (view === 'gap') {
    const liberalGap = liberal.map((value, index) => value - (realistic[index] ?? 0));
    const conservativeGap = conservative.map((value, index) => value - (realistic[index] ?? 0));
    const domain = domainOf([liberalGap, conservativeGap], { pinZero: true });
    return (
      <View style={plotStyles.stack}>
        <ChartSvg months={months} domain={domain} accessibilityLabel="Gap versus Realistic">
          {(geom) => (
            <SeriesLines
              geom={geom}
              series={[
                { values: liberalGap, color: lineColors.liberal, width: 2 },
                { values: conservativeGap, color: lineColors.conservative, width: 2 },
              ]}
            />
          )}
        </ChartSvg>
        <Meta>Above zero is higher than Realistic.</Meta>
        {legend}
        {closeLine}
      </View>
    );
  }

  const plotted = plottedSeries(months, realistic);
  const plotMonths = plotted.map((point) => point.month);
  const series = [
    { values: alignValues(months, liberal, plotMonths), color: lineColors.liberal, width: 1.75 },
    { values: alignValues(months, conservative, plotMonths), color: lineColors.conservative, width: 1.75 },
    { values: alignValues(months, realistic, plotMonths), color: lineColors.realistic, width: 2.5 },
  ];
  const domain = domainOf(series.map((item) => item.values));
  return (
    <View style={plotStyles.stack}>
      <ChartSvg
        months={plotMonths}
        domain={domain}
        accessibilityLabel="Liberal, Realistic, and Conservative net worth">
        {(geom) => <SeriesLines geom={geom} series={series} />}
      </ChartSvg>
      {legend}
      {closeLine}
    </View>
  );
}

export function FanChart({ months, liberal, realistic, conservative }: FanChartProps) {
  const colors = useColors();
  if (months.length < 2) return <Meta>Not enough months to draw this yet.</Meta>;
  const domain = domainOf([liberal, realistic, conservative]);
  const upper = liberal;
  const lower = conservative;
  return (
    <View style={plotStyles.stack}>
      <ChartSvg months={months} domain={domain} accessibilityLabel="Range of net-worth paths">
        {(geom) => {
          const up = upper.map((value, index) => ({ x: geom.x(index), y: geom.y(value) }));
          const down = lower.map((value, index) => ({ x: geom.x(index), y: geom.y(value) }));
          const band = [...up, ...down.slice().reverse()].map((point) => `${point.x},${point.y}`).join(' ');
          const last = realistic.length - 1;
          const [higherY, lowerY] = stackedLabelYs(
            [geom.y(upper[last] ?? 0) - 6, geom.y(lower[last] ?? 0) + 12],
            geom.top + 10,
            geom.top + geom.plotH,
          );
          return (
            <>
              <Polygon points={band} fill={colors.accent} opacity={0.16} />
              <Polyline points={linePoints(upper, geom)} fill="none" stroke={colors.preview} strokeWidth={1.25} />
              <Polyline points={linePoints(lower, geom)} fill="none" stroke={colors.text} strokeWidth={1.25} />
              <Polyline
                points={linePoints(realistic, geom)}
                fill="none"
                stroke={colors.accent}
                strokeWidth={2.5}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              <SvgText x={geom.x(last)} y={higherY} fill={colors.preview} fontSize={11} textAnchor="end">
                Higher
              </SvgText>
              <SvgText x={geom.x(last)} y={lowerY} fill={colors.text} fontSize={11} textAnchor="end">
                Lower
              </SvgText>
            </>
          );
        }}
      </ChartSvg>
      <Swatches
        items={[
          { color: colors.preview, label: 'Higher paths' },
          { color: colors.accent, label: 'Middle' },
          { color: colors.text, label: 'Lower paths' },
        ]}
      />
    </View>
  );
}

export function OverlayCompareChart({
  base,
  overlay,
  months,
  baseLabel,
  overlayLabel,
  view = 'paths',
}: OverlayCompareChartProps) {
  const colors = useColors();
  if (months.length < 2) return <Meta>Not enough months to draw this yet.</Meta>;

  if (view === 'ends') {
    const plotMonths = [months[0] ?? 1, months[months.length - 1] ?? 1];
    const basePair = [base[0] ?? 0, base[base.length - 1] ?? 0];
    const overlayPair = [overlay[0] ?? 0, overlay[overlay.length - 1] ?? 0];
    const domain = domainOf([basePair, overlayPair]);
    return (
      <View style={plotStyles.stack}>
        <ChartSvg months={plotMonths} domain={domain} accessibilityLabel={`${baseLabel} and ${overlayLabel} at the end`}>
          {(geom) => (
            <SeriesLines
              geom={geom}
              series={[
                { values: basePair, color: colors.text, width: 2 },
                { values: overlayPair, color: colors.accent, width: 2.5 },
              ]}
            />
          )}
        </ChartSvg>
        <Meta>From today to the end of this comparison.</Meta>
        <Swatches
          items={[
            { color: colors.text, label: baseLabel },
            { color: colors.accent, label: overlayLabel },
          ]}
        />
      </View>
    );
  }

  if (view === 'difference') {
    const delta = overlay.map((value, index) => value - (base[index] ?? 0));
    const domain = domainOf([delta], { pinZero: true });
    const at = extremeIndex(delta);
    const widest = delta[at] ?? 0;
    return (
      <View style={plotStyles.stack}>
        <ChartSvg
          months={months}
          domain={domain}
          accessibilityLabel={`${overlayLabel} compared with ${baseLabel}`}>
          {(geom) => (
            <>
              <Polyline
                points={linePoints(delta, geom)}
                fill="none"
                stroke={colors.accent}
                strokeWidth={2.5}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              <Circle cx={geom.x(at)} cy={geom.y(widest)} r={4} fill={colors.accent} />
              <SvgText
                x={geom.x(at)}
                y={geom.y(widest) < geom.top + 18 ? geom.y(widest) + 16 : geom.y(widest) - 8}
                fill={colors.text}
                fontSize={11}
                textAnchor={at > delta.length * 0.7 ? 'end' : 'start'}>
                {compactUsd(widest)}
              </SvgText>
            </>
          )}
        </ChartSvg>
        <Meta>
          Above zero means {overlayLabel} is higher than {baseLabel}. The mark is the widest gap, about{' '}
          {formatUsd(Math.abs(widest))} {widest >= 0 ? 'higher' : 'lower'}.
        </Meta>
      </View>
    );
  }

  const domain = domainOf([base, overlay]);
  return (
    <View style={plotStyles.stack}>
      <ChartSvg months={months} domain={domain} accessibilityLabel={`${baseLabel} and ${overlayLabel}`}>
        {(geom) => {
          const basePts = base.map((value, index) => `${geom.x(index)},${geom.y(value)}`);
          const overlayPts = overlay.map((value, index) => `${geom.x(index)},${geom.y(value)}`);
          const band = [...basePts, ...overlayPts.slice().reverse()].join(' ');
          const last = base.length - 1;
          const labelYs = stackedLabelYs(
            [geom.y(base[last] ?? 0) - 8, geom.y(overlay[last] ?? 0) - 8],
            geom.top + 10,
            geom.top + geom.plotH,
          );
          return (
            <>
              <Polygon points={band} fill={colors.accent} opacity={0.14} />
              <Polyline
                points={linePoints(base, geom)}
                fill="none"
                stroke={colors.text}
                strokeWidth={2}
                strokeLinejoin="round"
              />
              <Polyline
                points={linePoints(overlay, geom)}
                fill="none"
                stroke={colors.accent}
                strokeWidth={2.5}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              <EndValue geom={geom} index={last} value={base[last] ?? 0} color={colors.text} y={labelYs[0]} />
              <EndValue geom={geom} index={last} value={overlay[last] ?? 0} color={colors.accent} y={labelYs[1]} />
            </>
          );
        }}
      </ChartSvg>
      <Swatches
        items={[
          { color: colors.text, label: baseLabel },
          { color: colors.accent, label: overlayLabel },
        ]}
      />
    </View>
  );
}

export { WaterfallChart, EventTimeline } from './fallback';
