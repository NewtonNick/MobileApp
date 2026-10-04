import type { SeedBundle } from '@asset-aware/forecast-engine';

import home from '../../../../data/seed/home_v1.json';
import macro from '../../../../data/seed/macro_v1.json';
import vehicle from '../../../../data/seed/vehicle_v1.json';

export const seedBundle: SeedBundle = {
  home: home as SeedBundle['home'],
  vehicle: vehicle as SeedBundle['vehicle'],
  macro: macro as SeedBundle['macro'],
};
