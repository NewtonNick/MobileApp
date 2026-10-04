import type { HouseholdInput } from '@asset-aware/forecast-engine';
import { isOutlineReady, openGoalSpecs } from '@asset-aware/forecast-engine';
import type { Href } from 'expo-router';

export function nextRoute(household: HouseholdInput | null): Href {
  if (household?.kind === 'preview' && household.assets.length) return '/(tabs)';
  if (household && isOutlineReady(household)) return '/(tabs)';
  if (household?.kind === 'real' && openGoalSpecs(household).length === 0) return '/job-pick';
  if (household?.kind === 'real') return '/onboarding';
  return '/job-pick';
}

/** Replay a link that arrived before the gate, once the outline can leave setup. */
export function destinationAfterGate(household: HouseholdInput | null, pending: string | null): Href {
  const next = nextRoute(household);
  if (!pending || pending === '/' || pending === '/disclaimer' || pending === '/recovery') return next;
  if (household && (household.kind === 'preview' || isOutlineReady(household))) return pending as Href;
  return next;
}
