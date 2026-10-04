import { useEffect, useMemo, useState } from 'react';
import {
  availableOverlays,
  cashFloor,
  formatUsd,
  leftoverOf,
  runOverlay,
  standing,
  type ForecastResult,
  type HouseholdInput,
  type OverlayId,
} from '@asset-aware/forecast-engine';
import {
  ChartChoices,
  FanChart,
  OverlayCompareChart,
  ScenarioLinesChart,
  overlayViews,
  scenarioViews,
  type OverlayView,
  type ScenarioView,
} from '@/charts';
import { useForecasts, useHousehold } from '@/state/context';
import { fan } from '@/state/household';
import { seedBundle } from '@/lib/seed';
import { useColors } from '@/ui/appearance';
import { NotAdviceNote } from '@/ui/not-advice-note';
import { Body, Button, Card, Meta, Screen, Title } from '@/ui/primitives';

function overlayCollisionLine(
  household: HouseholdInput,
  overlay: ForecastResult,
  base: ForecastResult,
  label: string,
): string {
  const view = standing(household, seedBundle, 'realistic');
  const reserved = view.reserved;
  const baseFloor = cashFloor(base);
  const overlayFloor = cashFloor(overlay);
  const baseLeft = leftoverOf(baseFloor, reserved);
  const overlayLeft = leftoverOf(overlayFloor, reserved);
  const leftoverClaimed = overlayLeft < baseLeft || overlayLeft === 0;
  const claimBit = leftoverClaimed
    ? `leftover is reserved (${formatUsd(overlayLeft)} free after ${formatUsd(reserved)} reserved)`
    : `leftover stays about ${formatUsd(overlayLeft)}`;
  const overlayHired =
    leftoverOf(overlay.liquidNow, reserved) > 0 || reserved <= 0
      ? 0
      : overlay.months.find((m) => m.cash >= reserved)?.month ?? null;
  const hiredMonthDelta =
    view.hiredMonth == null || overlayHired == null ? null : overlayHired - view.hiredMonth;
  const dateBit =
    hiredMonthDelta == null
      ? 'the hired date is outside the horizon'
      : hiredMonthDelta === 0
        ? 'the hired date holds'
        : hiredMonthDelta > 0
          ? `the hired date moves later by about ${hiredMonthDelta} month${hiredMonthDelta === 1 ? '' : 's'}`
          : `the hired date moves earlier by about ${Math.abs(hiredMonthDelta)} month${Math.abs(hiredMonthDelta) === 1 ? '' : 's'}`;
  return `${label}: ${claimBit}, and ${dateBit}. Cash floor ${formatUsd(overlayFloor)} vs realistic ${formatUsd(baseFloor)}.`;
}

function runOverlayPlot(
  household: HouseholdInput,
  id: OverlayId,
  base: ForecastResult,
  label: string,
): { path: number[]; line: string } | null {
  const overlay = runOverlay(household, seedBundle, id);
  const path = overlay.months.map((m) => m.netWorth);
  if (!path.length) return null;
  return { path, line: overlayCollisionLine(household, overlay, base, label) };
}

export default function CompareScreen() {
  const colors = useColors();
  const { household } = useHousehold();
  const results = useForecasts();
  const [scenarioView, setScenarioView] = useState<ScenarioView>('together');
  const [overlayView, setOverlayView] = useState<OverlayView>('paths');
  const [advanced, setAdvanced] = useState(false);
  const [fanBusy, setFanBusy] = useState(false);
  const [series, setSeries] = useState<ReturnType<typeof fan> | null>(null);
  const [overlayId, setOverlayId] = useState<OverlayId | null>(null);
  const overlays = useMemo(() => (household ? availableOverlays(household) : []), [household]);

  useEffect(() => {
    if (!advanced || !household) {
      setSeries(null);
      setFanBusy(false);
      return;
    }
    setFanBusy(true);
    const timer = setTimeout(() => {
      setSeries(fan(household));
      setFanBusy(false);
    }, 0);
    return () => clearTimeout(timer);
  }, [advanced, household]);

  if (!household || !results) return <Screen><Title>Nothing to compare</Title></Screen>;

  const rows = [
    ['House, 5 years', results.liberal.houseCost5y, results.realistic.houseCost5y, results.conservative.houseCost5y],
    ['Vehicle, 5 years', results.liberal.carCost5y, results.realistic.carCost5y, results.conservative.carCost5y],
    ['Reserve target', results.liberal.emergencyFundTargets.liberal, results.realistic.emergencyFundTargets.realistic, results.conservative.emergencyFundTargets.conservative],
    ['Cash now', results.liberal.liquidNow, results.realistic.liquidNow, results.conservative.liquidNow],
  ] as const;

  const months = results.realistic.months.map((m) => m.month);
  const overlayMeta = overlays.find((o) => o.id === overlayId);
  const overlayPlot =
    overlayId && overlayMeta
      ? runOverlayPlot(household, overlayId, results.realistic, overlayMeta.label)
      : null;

  return (
    <Screen>
        <Title>Liberal · Realistic · Conservative</Title>
        <NotAdviceNote />
        <Meta>Conservative uses higher repair costs and slower home growth. Liberal is the better year.</Meta>
        <ChartChoices
          value={scenarioView}
          onChange={setScenarioView}
          options={scenarioViews}
        />
        <ScenarioLinesChart
          months={months}
          view={scenarioView}
          liberal={results.liberal.months.map((m) => m.netWorth)}
          realistic={results.realistic.months.map((m) => m.netWorth)}
          conservative={results.conservative.months.map((m) => m.netWorth)}
          colors={{ liberal: colors.preview, realistic: colors.accent, conservative: colors.text }}
        />
        <Meta>Net worth in today’s dollars.</Meta>
        {rows.map(([label, a, b, c]) => (
          <Card key={label}>
            <Body>{label}</Body>
            <Meta>Liberal {formatUsd(a)}</Meta>
            <Meta>Realistic {formatUsd(b)}</Meta>
            <Meta>Conservative {formatUsd(c)}</Meta>
          </Card>
        ))}

        {overlays.length ? (
          <Card>
            <Body>Hard year and better year</Body>
            <Meta>Only overlays that apply to this household.</Meta>
            {overlays.map((item) => (
              <Button
                key={item.id}
                tone={overlayId === item.id ? 'accent' : 'ghost'}
                label={item.label}
                onPress={() => setOverlayId((cur) => (cur === item.id ? null : item.id))}
              />
            ))}
            {overlayPlot && overlayMeta ? (
              <>
                <ChartChoices
                  value={overlayView}
                  onChange={setOverlayView}
                  options={overlayViews}
                />
                <OverlayCompareChart
                  months={months.slice(0, overlayPlot.path.length)}
                  base={results.realistic.months.map((m) => m.netWorth).slice(0, overlayPlot.path.length)}
                  overlay={overlayPlot.path}
                  baseLabel="Realistic"
                  overlayLabel={overlayMeta.label}
                  view={overlayView}
                />
                <Meta>{overlayPlot.line}</Meta>
              </>
            ) : null}
          </Card>
        ) : null}

        <Button
          label={advanced ? 'Hide advanced fan' : 'Advanced net-worth fan'}
          tone="ghost"
          onPress={() => setAdvanced((v) => !v)}
        />
        {advanced && fanBusy ? <Meta>Filling the range…</Meta> : null}
        {series ? (
          <>
            <FanChart
              months={series.months}
              liberal={series.liberal}
              realistic={series.realistic}
              conservative={series.conservative}
            />
            <Meta>Most paths land in this band. The line is the middle path, in today’s dollars.</Meta>
          </>
        ) : null}
    </Screen>
  );
}
