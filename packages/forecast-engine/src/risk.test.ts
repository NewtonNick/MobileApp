import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { assessSecurity, plannedEvents } from './engine';
import { rateSecurity } from './risk';
import { HOME_MAINT_VALUE_CAP } from './lookups';
import { emptyRealHousehold, previewHousehold } from './preview';
import { failureChance } from './risk';
import type { SeedBundle } from './seed-types';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../../data/seed');

function loadSeed(): SeedBundle {
  return {
    home: JSON.parse(readFileSync(join(root, 'home_v1.json'), 'utf8')),
    vehicle: JSON.parse(readFileSync(join(root, 'vehicle_v1.json'), 'utf8')),
    macro: JSON.parse(readFileSync(join(root, 'macro_v1.json'), 'utf8')),
  };
}

describe('repair chance', () => {
  it('an old roof is more likely than a new one, and never certain', () => {
    const young = failureChance(2, 25, 5);
    const old = failureChance(35, 25, 5);
    assert.ok(young < 0.2);
    assert.ok(old > young);
    assert.ok(old <= 0.8);
  });

  it('a year of chance-weighted cost is well below the full repair', () => {
    const chance = failureChance(30, 18, 5);
    const full = 14000;
    const monthly = (chance * full) / 60;
    assert.ok(monthly * 12 < full * 0.25);
  });

  it('does not bill an overdue roof as a certain job next month', () => {
    const seed = loadSeed();
    const h = previewHousehold();
    h.assets[0].roofYear = new Date().getFullYear() - 40;
    h.assets[0].value = 1_300_000;
    h.assets[0].yearBuilt = 1970;
    const events = plannedEvents(h, seed, 'conservative');
    const roof = events.find((event) => event.key.endsWith(':roof'));
    assert.ok(roof);
    assert.equal(roof.month, -1);
    assert.ok(roof.cost * 12 <= (22000 * 0.8) / 5 + 1);
    const maint = events.find((event) => event.key.endsWith(':maint') && event.key.includes('home'));
    assert.ok(maint);
    assert.ok(maint.cost * 12 <= HOME_MAINT_VALUE_CAP * 0.02 * 1.01 + 1);
    assert.ok(maint.cost * 12 < 1_300_000 * 0.02);
  });

  it('an old high-mileage car carries a transmission chance', () => {
    const seed = loadSeed();
    const h = previewHousehold();
    h.assets[1].vehicleYear = new Date().getFullYear() - 16;
    h.assets[1].mileage = 180_000;
    const events = plannedEvents(h, seed, 'realistic');
    const job = events.find((event) => event.key.includes('transmission'));
    assert.ok(job);
    assert.equal(job.month, -1);
    assert.ok(job.cost > 0);
    assert.ok(job.cost * 60 < 4500);
  });
});

describe('security rating', () => {
  it('cash that covers the largest repair rates above a household that cannot', () => {
    const seed = loadSeed();
    const covered = previewHousehold();
    const thin = emptyRealHousehold('10001');
    thin.housingTenure = 'own';
    thin.hasVehicle = true;
    thin.monthlyIncome = 3000;
    thin.expenses = [{ id: 'exp', name: 'Living', monthlyAmount: 2800, variable: false }];
    thin.assets = [
      {
        id: 'home-1',
        type: 'home',
        name: 'House',
        value: 400000,
        yearBuilt: 1960,
        roofYear: 1990,
        hvacYear: 2000,
        lastEditedAt: new Date().toISOString(),
      },
      {
        id: 'car-1',
        type: 'vehicle',
        name: 'Truck',
        value: 4000,
        vehicleYear: 2004,
        mileage: 210000,
        vehicleClass: 'truck',
        lastEditedAt: new Date().toISOString(),
      },
    ];
    thin.accounts = [
      { id: 'cash', type: 'cash', name: 'Cash', balance: 400, lastEditedAt: new Date().toISOString() },
    ];
    const strong = assessSecurity(covered, seed, 'realistic');
    const weak = assessSecurity(thin, seed, 'realistic');
    assert.ok(strong.score > weak.score);
    assert.ok(weak.score < 60);
    assert.match(weak.summary, /%/);
    assert.match(weak.summary, /month/);
  });

  it('does not ask leftover to cover chance-weighted repairs a second time', () => {
    const rating = rateSecurity({
      risks: [
        {
          key: 'roof',
          label: 'Roof',
          likelihood5y: 0.2,
          repairCost: 12000,
          monthlyCost: 200,
          assumed: false,
          dueMonth: null,
        },
      ],
      monthlyIncome: 5000,
      monthlyBills: 4900,
      emergencyFund: 15000,
    });
    assert.equal(rating.monthlySurplus, 100);
    assert.equal(rating.expectedMonthly, 200);
    assert.equal(rating.score, 85);
    const short = rateSecurity({
      risks: [
        {
          key: 'roof',
          label: 'Roof',
          likelihood5y: 0.2,
          repairCost: 12000,
          monthlyCost: 200,
          assumed: false,
          dueMonth: null,
        },
      ],
      monthlyIncome: 4000,
      monthlyBills: 4900,
      emergencyFund: 15000,
    });
    assert.ok(rating.score > short.score);
  });
});
