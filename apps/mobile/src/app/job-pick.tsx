import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { type Href, useRouter } from 'expo-router';

import {
  FIRE_FLAVOR_LABELS,
  FIRE_FLAVORS,
  PRIMARY_JOB_CLASSES,
  emptyRealHousehold,
  isOutlineReady,
  jobClassFromSpec,
  openGoalSpecs,
  presetGoalSpec,
  setEmergencyBuffer,
  setOpenGoals,
  type FireFlavor,
  type JobClass,
} from '@asset-aware/forecast-engine';
import { FIRE_FLAVOR_BLURB, HIRE_COPY } from '@/onboarding/spec';
import { useHousehold } from '@/state/context';
import { Body, Button, Chip, Meta, Screen, SelectCard, Title } from '@/ui/primitives';

const PICKABLE: JobClass[] = [...PRIMARY_JOB_CLASSES, 'survive_paycheck'];

export default function JobPickScreen() {
  const router = useRouter();
  const { household, setHousehold } = useHousehold();
  const base = household ?? emptyRealHousehold('');
  const existing = openGoalSpecs(base);
  const [selected, setSelected] = useState<Set<JobClass>>(() => {
    const jobs = existing.map(jobClassFromSpec).filter((j) => j !== 'custom');
    return new Set(jobs);
  });
  const customs = useMemo(() => existing.filter((s) => s.source === 'custom'), [existing]);
  const [fireFlavor, setFireFlavor] = useState<FireFlavor>(base.fireFlavor ?? 'standard');
  const [bufferMonths, setBufferMonths] = useState<3 | 6>(base.bufferMonths === 6 ? 6 : 3);

  const toggle = (jobClass: JobClass) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(jobClass)) next.delete(jobClass);
      else next.add(jobClass);
      return next;
    });
  };

  const continueWith = () => {
    const books = household ?? emptyRealHousehold(base.zip || '');
    const presets = [...selected].map((job) => presetGoalSpec(books, job));
    const specs = [...presets, ...customs];
    const next = setEmergencyBuffer(
      {
        ...setOpenGoals(books, specs),
        fireFlavor: selected.has('work_optional') ? fireFlavor : books.fireFlavor ?? 'standard',
      },
      bufferMonths,
    );
    setHousehold(next);
    if (isOutlineReady(next)) router.replace('/(tabs)');
    else router.push('/onboarding' as Href);
  };

  const canContinue = selected.size > 0 || customs.length > 0;

  return (
    <Screen>
        <Title>What should this plan track?</Title>
        <Body>
          Pick every date you care about. Real households juggle more than one. You can add or drop goals later.
        </Body>
        {PICKABLE.map((id) => {
          const copy = HIRE_COPY[id];
          const on = selected.has(id);
          return (
            <SelectCard key={id} selected={on} title={copy.title} detail={copy.blurb} onPress={() => toggle(id)}>
              {id === 'work_optional' && on ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {FIRE_FLAVORS.map((flavor) => (
                    <Chip
                      key={flavor}
                      selected={flavor === fireFlavor}
                      label={FIRE_FLAVOR_LABELS[flavor]}
                      onPress={() => {
                        setFireFlavor(flavor);
                        if (!selected.has('work_optional')) toggle('work_optional');
                      }}
                    />
                  ))}
                </View>
              ) : null}
              {id === 'work_optional' && on ? <Meta>{FIRE_FLAVOR_BLURB[fireFlavor]}</Meta> : null}
              {id === 'cash_buffer' && on ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  <Chip label="3 months" selected={bufferMonths === 3} onPress={() => setBufferMonths(3)} />
                  <Chip label="6 months" selected={bufferMonths === 6} onPress={() => setBufferMonths(6)} />
                </View>
              ) : null}
            </SelectCard>
          );
        })}
        {customs.map((spec) => (
          <Meta key={spec.id}>Also tracking: {spec.name}</Meta>
        ))}
        <SelectCard
          title={HIRE_COPY.custom.title}
          detail={HIRE_COPY.custom.blurb}
          onPress={() => router.push('/custom-goal' as Href)}
        />
        <Button label="Continue" onPress={continueWith} disabled={!canContinue} />
        {!canContinue ? <Meta>Pick at least one goal, or add something else.</Meta> : null}
    </Screen>
  );
}
