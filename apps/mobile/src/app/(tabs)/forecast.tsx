import { useMemo, useState } from 'react';
import { useRouter } from 'expo-router';

import { formatUsd, forecastMonthLabel, resolveHousingTenure, walkForecast } from '@asset-aware/forecast-engine';
import { ChartChoices, PathChart, WaterfallChart, pathViews, waterfallViews, type PathView, type WaterfallView } from '@/charts';
import { seedBundle } from '@/lib/seed';
import { useForecasts, useHousehold } from '@/state/context';
import { Body, Button, Card, Meta, Screen, Title } from '@/ui/primitives';
import { LooksWrong, MoneySentence, SourceLine } from '@/ui/money';
import { ScenarioControl } from '@/ui/scenario-control';
import { useColors } from '@/ui/appearance';

export default function ForecastScreen() {
  const colors = useColors();
  const router = useRouter();
  const { household, settings, now, standingView, patchSettings } = useHousehold();
  const results = useForecasts();
  const [mode, setMode] = useState<'cash' | 'netWorth'>('cash');
  const [pathView, setPathView] = useState<PathView>('line');
  const [ownershipView, setOwnershipView] = useState<WaterfallView>('dollars');
  const [pickedMonth, setPickedMonth] = useState<number | null>(null);
  const [zoom, setZoom] = useState<'5y' | 'hired'>('5y');
  const hiredMonth = standingView?.hiredMonth ?? null;
  const horizon = zoom === 'hired' ? Math.min(360, Math.max(60, hiredMonth ?? 60)) : 60;
  const walked = useMemo(
    () => (household ? walkForecast(household, seedBundle, settings.scenario, { horizonMonths: horizon, now }) : null),
    [household, settings.scenario, horizon, now],
  );
  if (!household || !results || !walked) return <Screen><Title>No forecast yet</Title></Screen>;
  const view = results[settings.scenario];
  const tenure = resolveHousingTenure(household);
  const ownership = view.waterfall.filter((w) => w.ownership);
  const picked = pickedMonth != null ? walked.months.find((m) => m.month === pickedMonth) : null;
  const shown = picked ?? walked.months[walked.months.length - 1] ?? null;
  const inflOf = (m: (typeof view.months)[number]) =>
    settings.showNominal && m.nominalNetWorth != null && m.netWorth !== 0
      ? m.nominalNetWorth / m.netWorth
      : 1;
  const chartMonths = walked.months.map((m) => ({
    month: m.month,
    cash: m.cash * inflOf(m),
    netWorth: settings.showNominal && m.nominalNetWorth != null ? m.nominalNetWorth : m.netWorth,
  }));
  const shownCash = shown ? shown.cash * inflOf(shown) : null;

  return (
    <Screen>
        <Title>{zoom === 'hired' ? 'Path to the hired date' : 'Five-year picture'}</Title>
        <ScenarioControl value={settings.scenario} onChange={(s) => patchSettings({ scenario: s })} />
        <Meta>
          {tenure === 'rent'
            ? 'Rent stays a constraint on these goals. This tab is not a second planner.'
            : 'House and car stay a constraint on these goals when you have them. This tab is not a second planner.'}
        </Meta>
        {view.houseCost5y > 0 ? (
          <MoneySentence
            scenario={settings.scenario}
            text={`5-year house cost: about ${formatUsd(view.houseCost5y)}.`}
            onPress={() => router.push('/compare')}
          />
        ) : (
          <Meta>No house on this plan — we did not invent one.</Meta>
        )}
        {view.carCost5y > 0 ? (
          <Meta>
            Vehicle over 5 years: about {formatUsd(view.carCost5y)}. Full net worth now:{' '}
            {formatUsd(view.netWorthNow)}.
          </Meta>
        ) : (
          <Meta>No car on this plan. Full net worth now: {formatUsd(view.netWorthNow)}.</Meta>
        )}
        <LooksWrong onPress={() => router.push('/looks-wrong')} />
        <SourceLine result={view} />

        <Card>
          <Body>{mode === 'cash' ? 'Cash path' : 'Including home and retirement'}</Body>
          <ChartChoices
            value={pathView}
            onChange={(view) => {
              setPickedMonth(null);
              setPathView(view);
            }}
            options={pathViews}
          />
          <PathChart
            months={chartMonths}
            mode={mode}
            view={pathView}
            accent={colors.accent}
            markMonth={zoom === 'hired' ? hiredMonth : null}
            onSelectMonth={setPickedMonth}
          />
          {hiredMonth != null && hiredMonth > 60 ? (
            <Button
              tone="ghost"
              label={zoom === '5y' ? `Show the hired date (${forecastMonthLabel(hiredMonth)})` : 'Show 5 years'}
              onPress={() => {
                setPickedMonth(null);
                setZoom((current) => (current === '5y' ? 'hired' : '5y'));
              }}
            />
          ) : null}
          {zoom === 'hired' && hiredMonth != null ? <Meta>Hired date is {forecastMonthLabel(hiredMonth)}.</Meta> : null}
          {shown && shownCash != null ? (
            <Meta>
              {forecastMonthLabel(shown.month)} · about{' '}
              {formatUsd(
                mode === 'cash'
                  ? shownCash
                  : settings.showNominal && shown.nominalNetWorth != null
                    ? shown.nominalNetWorth
                    : shown.netWorth,
              )}
              {mode === 'cash' ? ' in cash' : ' including home and retirement'}
            </Meta>
          ) : null}
          <Meta>Drag across the chart for another month.</Meta>
          <Button
            tone="ghost"
            label={mode === 'cash' ? 'Including home and retirement' : 'Show cash path'}
            onPress={() => setMode((m) => (m === 'cash' ? 'netWorth' : 'cash'))}
          />
        </Card>

        <Card>
          <Body>Where ownership money goes</Body>
          <ChartChoices value={ownershipView} onChange={setOwnershipView} options={waterfallViews} />
          <WaterfallChart
            slices={ownership}
            view={ownershipView}
            accent={colors.accent}
            onSelect={(key) => {
              const focus = key.includes('vehicle') ? 'vehicle' : key.includes('home') ? 'home' : undefined;
              router.push(focus ? { pathname: '/looks-wrong', params: { focus } } : '/looks-wrong');
            }}
          />
          <Meta>Living expenses and investment growth are hidden so a 401k cannot bury the roof.</Meta>
        </Card>

        <Button label="Compare Liberal and Conservative" onPress={() => router.push('/compare')} />
        {settings.showNominal ? <Meta>Showing future (nominal) dollars is on in settings.</Meta> : <Meta>Figures are in today’s dollars.</Meta>}
    </Screen>
  );
}
