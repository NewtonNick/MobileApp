import { useEffect, useRef, useState, type ReactNode } from 'react';
import { PanResponder, PixelRatio, StyleSheet, View } from 'react-native';
import Svg, { Circle, Line, Text as SvgText } from 'react-native-svg';

import { useColors } from '@/ui/appearance';

import { axisTicks, compactUsd, yearMarks, type Domain } from './scale';
import { CHART_HEIGHT } from './types';

const PAD = { left: 52, right: 12, top: 22, bottom: 22 };

function chartHeight(width: number): number {
  if (width <= 0) return CHART_HEIGHT;
  return Math.min(280, Math.max(180, Math.round(width * 0.55)));
}

export type Geom = {
  left: number;
  top: number;
  plotW: number;
  plotH: number;
  x: (index: number) => number;
  y: (value: number) => number;
};

export function chartGeom(
  width: number,
  height: number,
  count: number,
  domain: Domain,
  pad: { left: number; right: number; top: number; bottom: number } = PAD,
): Geom {
  const left = pad.left;
  const top = pad.top;
  const plotW = Math.max(1, width - pad.left - pad.right);
  const plotH = Math.max(1, height - pad.top - pad.bottom);
  return {
    left,
    top,
    plotW,
    plotH,
    x: (index) => left + (count <= 1 ? plotW / 2 : (index / (count - 1)) * plotW),
    y: (value) => top + plotH - ((value - domain.min) / domain.span) * plotH,
  };
}

export function linePoints(values: number[], geom: Geom): string {
  return values.map((value, index) => `${geom.x(index)},${geom.y(value)}`).join(' ');
}

/** Hold each amount until the next month, then step. A balance does not glide between months. */
export function stepPoints(values: number[], geom: Geom): string {
  if (!values.length) return '';
  const parts = [`${geom.x(0)},${geom.y(values[0] ?? 0)}`];
  for (let index = 1; index < values.length; index++) {
    parts.push(`${geom.x(index)},${geom.y(values[index - 1] ?? 0)}`);
    parts.push(`${geom.x(index)},${geom.y(values[index] ?? 0)}`);
  }
  return parts.join(' ');
}

export function areaPoints(values: number[], geom: Geom, baseline: number): string {
  if (!values.length) return '';
  const edge = values.map((value, index) => `${geom.x(index)},${geom.y(value)}`);
  const last = values.length - 1;
  return [...edge, `${geom.x(last)},${geom.y(baseline)}`, `${geom.x(0)},${geom.y(baseline)}`].join(' ');
}

export function stackedLabelYs(ys: number[], minY: number, maxY: number, gap = 14): number[] {
  const order = ys.map((y, index) => ({ y, index })).sort((a, b) => a.y - b.y);
  const placed = order.map((item) => item.y);
  for (let i = 1; i < placed.length; i++) {
    const prev = placed[i - 1] ?? 0;
    const current = placed[i] ?? prev;
    if (current - prev < gap) placed[i] = prev + gap;
  }
  const overflow = (placed[placed.length - 1] ?? 0) - maxY;
  if (overflow > 0) {
    for (let i = 0; i < placed.length; i++) placed[i] = (placed[i] ?? 0) - overflow;
  }
  const out = new Array<number>(ys.length);
  order.forEach((item, i) => {
    const y = placed[i] ?? item.y;
    out[item.index] = Math.max(minY, Math.min(maxY, y));
  });
  return out;
}

export function ChartSvg({
  months,
  domain,
  height = CHART_HEIGHT,
  accessibilityLabel,
  onSelectMonth,
  cursor,
  children,
}: {
  months: number[];
  domain: Domain;
  height?: number;
  accessibilityLabel?: string;
  onSelectMonth?: (month: number) => void;
  cursor?: { values: number[]; color: string };
  children: (geom: Geom, selected: number | null) => ReactNode;
}) {
  const colors = useColors();
  const [width, setWidth] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const drawnHeight = chartHeight(width);
  const fontSize = 11 * Math.min(PixelRatio.getFontScale(), 1.4);
  const monthsRef = useRef(months);
  const selectRef = useRef(onSelectMonth);
  const widthRef = useRef(0);
  const padRef = useRef(PAD);
  monthsRef.current = months;
  selectRef.current = onSelectMonth;

  const monthKey = months.join(',');
  useEffect(() => {
    setSelected(null);
  }, [monthKey]);

  const touch = useRef({ x: 0, y: 0 });
  const choose = (x: number) => {
    const list = monthsRef.current;
    const cb = selectRef.current;
    if (!cb || !list.length) return;
    const plotW = Math.max(1, widthRef.current - padRef.current.left - padRef.current.right);
    const t = (x - padRef.current.left) / plotW;
    const idx = Math.max(0, Math.min(list.length - 1, Math.round(t * (list.length - 1))));
    setSelected(idx);
    const month = list[idx];
    if (month != null) cb(month);
  };
  const chooseRef = useRef(choose);
  chooseRef.current = choose;

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gesture) =>
        !!selectRef.current && Math.abs(gesture.dx) > 8 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
      onPanResponderMove: (event) => chooseRef.current(event.nativeEvent.locationX),
      onPanResponderRelease: (event) => chooseRef.current(event.nativeEvent.locationX),
    }),
  ).current;

  const ticks = axisTicks(domain.min, domain.max);
  const longest = ticks.reduce((n, tick) => Math.max(n, compactUsd(tick).length), 1);
  const pad = {
    left: Math.max(44, Math.ceil(longest * fontSize * 0.62) + 10),
    right: PAD.right,
    top: PAD.top,
    bottom: PAD.bottom,
  };
  padRef.current = pad;
  const drawn = width > 0 ? drawnHeight : height;
  const geom = chartGeom(width, drawn, months.length, domain, pad);
  const years = yearMarks(months, new Date(), width);
  const cursorValue = selected != null ? cursor?.values[selected] : undefined;

  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel ?? 'Chart'}
      style={{ height: drawn, width: '100%' }}
      onLayout={(event) => {
        const next = event.nativeEvent.layout.width;
        widthRef.current = next;
        setWidth(next);
      }}
      {...(onSelectMonth ? pan.panHandlers : {})}
      onTouchStart={
        onSelectMonth
          ? (event) => {
              touch.current = { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY };
            }
          : undefined
      }
      onTouchEnd={
        onSelectMonth
          ? (event) => {
              const dx = Math.abs(event.nativeEvent.pageX - touch.current.x);
              const dy = Math.abs(event.nativeEvent.pageY - touch.current.y);
              if (dx < 8 && dy < 8) choose(event.nativeEvent.locationX);
            }
          : undefined
      }>
      {width > 0 ? (
          <Svg width={width} height={drawn}>
            {ticks.map((tick) => (
              <Line
                key={tick}
                x1={geom.left}
                x2={geom.left + geom.plotW}
                y1={geom.y(tick)}
                y2={geom.y(tick)}
                stroke={tick === 0 ? colors.muted : colors.line}
                strokeWidth={tick === 0 ? 1.25 : 1}
              />
            ))}
            {children(geom, selected)}
            {ticks.map((tick) => (
              <SvgText
                key={`y-${tick}`}
                x={geom.left - 6}
                y={geom.y(tick) + 4}
                fill={colors.muted}
                fontSize={fontSize}
                textAnchor="end">
                {compactUsd(tick)}
              </SvgText>
            ))}
            {years.map((mark, index) => {
              const x = geom.x(mark.index);
              const anchor = index === 0 ? 'start' : index === years.length - 1 ? 'end' : 'middle';
              return (
                <SvgText
                  key={`${mark.label}-${mark.index}`}
                  x={x}
                  y={drawn - 4}
                  fill={colors.muted}
                  fontSize={fontSize}
                  textAnchor={anchor}>
                  {mark.label}
                </SvgText>
              );
            })}
            {selected != null && cursorValue != null && cursor ? (
              <>
                <Line
                  x1={geom.x(selected)}
                  x2={geom.x(selected)}
                  y1={geom.top}
                  y2={geom.top + geom.plotH}
                  stroke={colors.muted}
                  strokeWidth={1}
                />
                <Circle cx={geom.x(selected)} cy={geom.y(cursorValue)} r={4} fill={cursor.color} />
                <SvgText
                  x={Math.max(
                    geom.left,
                    Math.min(
                      geom.left + geom.plotW - compactUsd(cursorValue).length * fontSize * 0.62,
                      geom.x(selected) + 8,
                    ),
                  )}
                  y={geom.y(cursorValue) < geom.top + 16 ? geom.y(cursorValue) + 14 : geom.y(cursorValue) - 8}
                  fill={colors.text}
                  fontSize={fontSize}
                  textAnchor="start">
                  {compactUsd(cursorValue)}
                </SvgText>
              </>
            ) : null}
          </Svg>
      ) : null}
    </View>
  );
}

export const plotStyles = StyleSheet.create({
  stack: { gap: 8, width: '100%' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  swatchRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  swatch: { width: 14, height: 3, borderRadius: 2 },
});
