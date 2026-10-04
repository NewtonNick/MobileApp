import { useRouter } from 'expo-router';

import {
  assessSecurity,
  formatUsd,
  resolveHasVehicle,
  resolveHousingTenure,
  vehicleRunningCost,
} from '@asset-aware/forecast-engine';
import { seedBundle } from '@/lib/seed';
import { useForecasts, useHousehold } from '@/state/context';
import { useColors } from '@/ui/appearance';
import { Amount, Body, Button, Card, Headline, Kicker, Meta, Screen, Title } from '@/ui/primitives';
import { LooksWrong, MoneySentence, SourceLine } from '@/ui/money';
import { ScenarioControl } from '@/ui/scenario-control';

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

export default function RiskScreen() {
  const colors = useColors();
  const router = useRouter();
  const { household, settings, setHousehold, patchSettings } = useHousehold();
  const results = useForecasts();
  if (!household || !results) return <Screen><Title>No assets yet</Title></Screen>;
  const view = results[settings.scenario];
  const vintageOld = results.seedStale;
  const tenure = resolveHousingTenure(household);
  const wantsCar = resolveHasVehicle(household);
  const hasHome = household.assets.some((a) => a.type === 'home');
  const hasCar = household.assets.some((a) => a.type === 'vehicle');
  const security = assessSecurity(household, seedBundle, settings.scenario);
  const securityColor =
    security.band === 'secure'
      ? colors.good
      : security.band === 'fragile'
        ? colors.danger
        : security.band === 'exposed'
          ? colors.preview
          : colors.accent;

  const markDone = (key: string) => {
    if (household.realizedEventKeys.includes(key)) return;
    setHousehold({ ...household, realizedEventKeys: [...household.realizedEventKeys, key] });
  };

  return (
    <Screen>
        <Title>Ownership risk</Title>
        <ScenarioControl value={settings.scenario} onChange={(s) => patchSettings({ scenario: s })} />
        {vintageOld ? <Meta>Cost tables may be outdated.</Meta> : null}

        <Card>
          <Kicker>Security rating</Kicker>
          <Amount style={{ color: securityColor }}>{security.score}</Amount>
          <Headline style={{ color: securityColor }}>{security.title}</Headline>
          <Meta>Level: {security.band}</Meta>
          <Body>{security.summary}</Body>
          <Meta>
            The score uses cash on hand against the largest repair, months of bills that cash covers, and whether
            monthly leftover still covers the chance-weighted repair cost.
          </Meta>
        </Card>

        {security.risks.length ? (
          security.risks.map((risk) => (
            <Card key={risk.key}>
              <Headline>{risk.label}</Headline>
              <Meta>Chance in 5 years</Meta>
              <Headline>{pct(risk.likelihood5y)}</Headline>
              <Meta>If it happens</Meta>
              <Headline>{formatUsd(risk.repairCost)}</Headline>
              <Meta>Chance-weighted monthly cost</Meta>
              <Headline>{formatUsd(risk.monthlyCost)}</Headline>
              {risk.assumed ? (
                <Meta>Year or mileage unknown, so this uses a typical age. It is not a failed system.</Meta>
              ) : null}
              <Button label="I already replaced this" tone="quiet" onPress={() => markDone(risk.key)} />
            </Card>
          ))
        ) : (
          <Meta>
            {tenure === 'rent'
              ? 'No house on this plan — rent is the housing line.'
              : 'No house or car repairs to price.'}
          </Meta>
        )}

        {hasHome ? (
          <Card>
            <Body>House</Body>
            <MoneySentence
              scenario={settings.scenario}
              text={`5-year house cost: about ${formatUsd(view.houseCost5y)}.`}
            />
            <Meta>
              Routine upkeep uses a capped home value, not the full price of an expensive house. Major jobs above are
              a chance, not a bill due this month.
            </Meta>
            <SourceLine result={view} />
            <LooksWrong onPress={() => router.push({ pathname: '/looks-wrong', params: { focus: 'home' } })} />
          </Card>
        ) : (
          <Meta>{tenure === 'rent' ? 'No house on this plan — rent is the housing line.' : 'No house on this plan.'}</Meta>
        )}

        {hasCar || wantsCar === true ? (
          <Card>
            <Body>Vehicle</Body>
            <MoneySentence
              scenario={settings.scenario}
              text={`5-year vehicle cost: about ${formatUsd(view.carCost5y)}.`}
            />
            <Meta>
              Class averages from {seedBundle.vehicle.sources[0]?.source} · {seedBundle.vehicle.vintage}. A transmission
              job is listed by its chance, not added in full.
            </Meta>
            {household.assets
              .filter((asset) => asset.type === 'vehicle')
              .map((car) => {
                const running = vehicleRunningCost(car, seedBundle, household.fuelPricePerGallon);
                return (
                  <Meta key={car.id}>
                    {car.name}: insurance {formatUsd(running.insuranceMonthly)}
                    {running.insuranceEstimated ? ' (estimate)' : ''}, fuel {formatUsd(running.fuelMonthly)}
                    {running.fuelEstimated ? ' (estimate)' : ''}, registration {formatUsd(running.registrationMonthly * 12)}
                    {running.registrationEstimated ? ' a year (estimate)' : ' a year'}.
                  </Meta>
                );
              })}
            <LooksWrong onPress={() => router.push({ pathname: '/looks-wrong', params: { focus: 'vehicle' } })} />
          </Card>
        ) : (
          <Meta>No car on this plan.</Meta>
        )}
    </Screen>
  );
}
