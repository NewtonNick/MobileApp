import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { debtWarnings } from './debt';
import { walkForecast } from './drivers';
import { employeeDeferralCap } from './limits';
import { migrateHousehold } from './migrate';
import { monthKeyFromIndex } from './month';
import { normalizeHousehold, previewHousehold } from './preview';
import { repairRisks } from './risk';
import type { SeedBundle } from './seed-types';
import { standing } from './standing';
import { pickLotSale } from './taxlots';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../../data/seed');

function loadSeed(): SeedBundle {
  return {
    home: JSON.parse(readFileSync(join(root, 'home_v1.json'), 'utf8')),
    vehicle: JSON.parse(readFileSync(join(root, 'vehicle_v1.json'), 'utf8')),
    macro: JSON.parse(readFileSync(join(root, 'macro_v1.json'), 'utf8')),
  };
}

const now = new Date(2026, 0, 15);

function books() {
  const household = previewHousehold();
  household.monthlyIncome = 4000;
  household.assets = household.assets.filter((asset) => asset.type === 'vehicle');
  household.housingTenure = 'rent';
  household.expenses = [{ id: 'exp-rent', name: 'Rent', monthlyAmount: 1000, variable: false }];
  return household;
}

describe('schema migration', () => {
  it('turns a raise offset into the calendar month it meant', () => {
    const raw = migrateHousehold({ plannedRaiseMonth: 3, schemaVersion: 1 }, now);
    const books = normalizeHousehold(raw, now);
    assert.equal(books.plannedRaiseAt, monthKeyFromIndex(3, now));
    assert.equal(books.schemaVersion, 2);
  });
});

describe('household models', () => {
  it('stops a lease payment after the end month when the car is returned', () => {
    const seed = loadSeed();
    const household = books();
    household.accounts.push({
      id: 'lease',
      type: 'auto_lease',
      name: 'Lease',
      balance: 0,
      minPayment: 400,
      endsAt: '2026-02',
      endChoice: 'return',
      linkedAssetId: household.assets[0]?.id ?? null,
      lastEditedAt: now.toISOString(),
    });
    const walked = walkForecast(household, seed, 'realistic', { horizonMonths: 4, now });
    assert.ok(walked.months[0].livingExpenses >= 0);
    assert.ok(walked.months[2].cash > walked.months[0].cash - 400 * 4);
  });

  it('flags a promo that is ending and a payment below interest', () => {
    const household = books();
    household.accounts.push({
      id: 'card',
      type: 'credit_card',
      name: 'Card',
      balance: 5000,
      minPayment: 20,
      apr: 0.24,
      promoApr: 0,
      promoEndsAt: '2026-02',
      lastEditedAt: now.toISOString(),
    });
    const warnings = debtWarnings(household, 'realistic', now);
    assert.ok(warnings.some((warning) => warning.code === 'below_interest' || warning.code === 'promo_expiry'));
  });

  it('drops roof risk when the HOA owns the exterior', () => {
    const seed = loadSeed();
    const household = previewHousehold();
    household.assets = household.assets.map((asset) =>
      asset.type === 'home' ? { ...asset, exteriorResponsibility: 'hoa' as const, roofYear: 2000 } : asset,
    );
    const risks = repairRisks(household, seed, 'realistic', 2026);
    assert.equal(risks.some((risk) => risk.key.endsWith(':roof')), false);
  });

  it('stops pay at the hired month when retire-at-hired-date is set', () => {
    const seed = loadSeed();
    const household = books();
    household.jobClass = 'work_optional';
    household.hasVehicle = false;
    household.assets = [];
    household.monthlyIncome = 8000;
    household.expenses = [{ id: 'exp-rent', name: 'Rent', monthlyAmount: 2000, variable: false }];
    household.accounts = [
      {
        id: 'nest',
        type: 'retirement_401k',
        name: '401k',
        balance: 1_200_000,
        expectedReturn: 0.05,
        taxTreatment: 'roth',
        lastEditedAt: now.toISOString(),
      },
    ];
    household.retireAtHiredDate = true;
    const stopped = walkForecast(household, seed, 'realistic', { horizonMonths: 6, now });
    const open = walkForecast({ ...household, retireAtHiredDate: false }, seed, 'realistic', { horizonMonths: 6, now });
    assert.ok(stopped.months[0].income < 100);
    assert.ok(open.months[0].income > 1000);
  });

  it('uses the IRS employee deferral cap for 2026', () => {
    assert.equal(employeeDeferralCap(2026, 40, '401k'), 24500);
    assert.equal(employeeDeferralCap(2026, 61, '401k'), 24500 + 11250);
    assert.equal(employeeDeferralCap(2026, 55, 'ira'), 7500 + 1100);
  });
});

describe('goal status', () => {
  it('marks a past target date overdue', () => {
    const seed = loadSeed();
    const household = previewHousehold();
    household.jobClass = 'custom';
    household.goalSpec = {
      id: 'dated',
      name: 'Old date',
      source: 'custom',
      target: { kind: 'date', by: '2020-01-01' },
      reserved: 'none',
    };
    household.openGoals = [household.goalSpec];
    const view = standing(household, seed, 'realistic', 'custom', { now });
    assert.equal(view.status, 'overdue');
  });
});

describe('tax lot order', () => {
  it('fifo sells the older lot first and hifo sells the higher basis first', () => {
    const lots = [
      {
        id: 'new',
        accountId: 'b',
        symbol: 'VTI',
        acquiredOn: '2024-06-01',
        shares: 2,
        costBasis: 200,
        pricePerShare: 100,
      },
      {
        id: 'old',
        accountId: 'b',
        symbol: 'VTI',
        acquiredOn: '2020-01-01',
        shares: 2,
        costBasis: 80,
        pricePerShare: 40,
      },
    ];
    assert.equal(pickLotSale(lots, 'VTI', 1, 'fifo')[0]?.lotId, 'old');
    assert.equal(pickLotSale(lots, 'VTI', 1, 'hifo')[0]?.lotId, 'new');
  });
});
