import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { walkForecast } from './drivers';
import { emptyRealHousehold, normalizeHousehold } from './preview';
import { standing } from './standing';
import { applyTaxLotSale, holdingTerm, quoteTaxLotSale } from './taxlots';
import type { HouseholdInput, TaxLot } from './types';
import type { SeedBundle } from './seed-types';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../../data/seed');

function loadSeed(): SeedBundle {
  return {
    home: JSON.parse(readFileSync(join(root, 'home_v1.json'), 'utf8')),
    vehicle: JSON.parse(readFileSync(join(root, 'vehicle_v1.json'), 'utf8')),
    macro: JSON.parse(readFileSync(join(root, 'macro_v1.json'), 'utf8')),
  };
}

function lot(overrides: Partial<TaxLot> = {}): TaxLot {
  return {
    id: 'lot-1',
    accountId: 'brk',
    symbol: 'VTI',
    acquiredOn: '2010-01-04',
    shares: 10,
    costBasis: 200,
    pricePerShare: 50,
    ...overrides,
  };
}

describe('tax lot holding period', () => {
  it('treats the one-year anniversary as short-term and the next day as long-term', () => {
    assert.equal(holdingTerm('2024-09-29', '2025-09-29'), 'short');
    assert.equal(holdingTerm('2024-09-29', '2025-09-30'), 'long');
  });

  it('counts a February 29 purchase as long-term on March 1 of the next non-leap year', () => {
    assert.equal(holdingTerm('2020-02-29', '2021-02-28'), 'short');
    assert.equal(holdingTerm('2020-02-29', '2021-03-01'), 'long');
  });
});

describe('tax lot sale quote', () => {
  it('allocates basis on a partial sale and taxes the long-term gain', () => {
    const quoted = quoteTaxLotSale(
      [lot()],
      [{ lotId: 'lot-1', shares: 4 }],
      { shortTerm: 0.22, longTerm: 0.15 },
      '2026-01-02',
    );
    assert.equal(quoted.ok, true);
    if (!quoted.ok) return;
    assert.equal(quoted.value.proceeds, 200);
    assert.equal(quoted.value.basis, 80);
    assert.equal(quoted.value.longGain, 120);
    assert.equal(quoted.value.tax, 18);
    assert.equal(quoted.value.afterTaxProceeds, 182);
  });

  it('sells the lot you name, not the other shares of the same symbol', () => {
    const lots = [
      lot({ id: 'low', costBasis: 100, shares: 10, pricePerShare: 50 }),
      lot({ id: 'high', costBasis: 400, shares: 10, pricePerShare: 50 }),
    ];
    const quoted = quoteTaxLotSale(lots, [{ lotId: 'high', shares: 10 }], { shortTerm: 0.22, longTerm: 0.15 }, '2026-01-02');
    assert.equal(quoted.ok, true);
    if (!quoted.ok) return;
    assert.equal(quoted.value.longGain, 100);
    assert.equal(quoted.value.lines.length, 1);
  });

  it('nets a long-term loss against a short-term gain before tax', () => {
    const lots = [
      lot({ id: 'st', acquiredOn: '2026-06-01', shares: 10, costBasis: 100, pricePerShare: 50 }),
      lot({ id: 'lt', acquiredOn: '2010-01-04', shares: 10, costBasis: 900, pricePerShare: 50 }),
    ];
    const quoted = quoteTaxLotSale(
      lots,
      [
        { lotId: 'st', shares: 10 },
        { lotId: 'lt', shares: 10 },
      ],
      { shortTerm: 0.22, longTerm: 0.15 },
      '2026-08-01',
    );
    assert.equal(quoted.ok, true);
    if (!quoted.ok) return;
    assert.equal(quoted.value.shortGain, 400);
    assert.equal(quoted.value.longGain, -400);
    assert.equal(quoted.value.netShort, 0);
    assert.equal(quoted.value.netLong, 0);
    assert.equal(quoted.value.tax, 0);
  });

  it('caps the ordinary deduction at $3,000 and carries the rest', () => {
    const quoted = quoteTaxLotSale(
      [lot({ shares: 10, costBasis: 8_000, pricePerShare: 50 })],
      [{ lotId: 'lot-1', shares: 10 }],
      { shortTerm: null, longTerm: null },
      '2026-01-02',
    );
    assert.equal(quoted.ok, true);
    if (!quoted.ok) return;
    assert.equal(quoted.value.longGain, -7_500);
    assert.equal(quoted.value.ordinaryDeduction, 3_000);
    assert.equal(quoted.value.carryforward, 4_500);
    assert.equal(quoted.value.tax, 0);
    assert.equal(quoted.value.unpriced, false);
    assert.equal(quoted.value.afterTaxProceeds, 500);
  });

  it('leaves tax unpriced when a gain has no rate', () => {
    const quoted = quoteTaxLotSale([lot()], [{ lotId: 'lot-1', shares: 10 }], { shortTerm: null, longTerm: null }, '2026-01-02');
    assert.equal(quoted.ok, true);
    if (!quoted.ok) return;
    assert.equal(quoted.value.longGain, 300);
    assert.equal(quoted.value.unpriced, true);
    assert.equal(quoted.value.tax, null);
  });

  it('records a priced sale onto cash and the remaining lot', () => {
    const household: HouseholdInput = {
      ...emptyRealHousehold('10001'),
      shortTermGainRate: 0.22,
      longTermGainRate: 0.15,
      accounts: [
        { id: 'cash', type: 'checking', name: 'Checking', balance: 1000, lastEditedAt: '2026-01-01T00:00:00.000Z' },
        { id: 'brk', type: 'brokerage', name: 'Brokerage', balance: 500, lastEditedAt: '2026-01-01T00:00:00.000Z' },
      ],
      taxLots: [lot()],
    };
    const sold = applyTaxLotSale(household, [{ lotId: 'lot-1', shares: 4 }], '2026-01-02');
    assert.equal(sold.ok, true);
    if (!sold.ok) return;
    const cash = sold.value.accounts.find((account) => account.id === 'cash');
    const brokerage = sold.value.accounts.find((account) => account.id === 'brk');
    const remain = (sold.value.taxLots ?? [])[0];
    assert.equal(cash?.balance, 1182);
    assert.equal(brokerage?.balance, 300);
    assert.equal(remain.shares, 6);
    assert.equal(remain.costBasis, 120);
  });

  it('refuses to record a gain when the rates are blank', () => {
    const household: HouseholdInput = {
      ...emptyRealHousehold('10001'),
      accounts: [{ id: 'brk', type: 'brokerage', name: 'Brokerage', balance: 500, lastEditedAt: '2026-01-01T00:00:00.000Z' }],
      taxLots: [lot()],
    };
    const sold = applyTaxLotSale(household, [{ lotId: 'lot-1', shares: 10 }], '2026-01-02');
    assert.equal(sold.ok, false);
  });
});

describe('tax lots on the hired date', () => {
  it('keeps a valid lot through normalize and drops a bad one', () => {
    const round = normalizeHousehold({
      ...emptyRealHousehold('10001'),
      shortTermGainRate: 0.22,
      longTermGainRate: 1.5,
      taxLots: [lot(), { ...lot(), id: 'bad', symbol: 'not a ticker', shares: 0 }],
    });
    assert.equal(round.shortTermGainRate, 0.22);
    assert.equal(round.longTermGainRate, null);
    assert.equal(round.taxLots?.length, 1);
    assert.equal(round.taxLots?.[0].symbol, 'VTI');
  });

  it('taxes a covered brokerage withdrawal and leaves an unmatched balance alone', () => {
    const seed = loadSeed();
    const now = '2026-06-15T12:00:00.000Z';
    const covered: HouseholdInput = {
      ...emptyRealHousehold('10001'),
      housingTenure: 'none',
      hasVehicle: false,
      jobClass: 'work_optional',
      monthlyIncome: 1000,
      expenses: [{ id: 'living', name: 'Living', monthlyAmount: 3000, variable: false }],
      accounts: [
        { id: 'cash', type: 'cash', name: 'Cash', balance: 1000, lastEditedAt: now },
        {
          id: 'brk',
          type: 'brokerage',
          name: 'Brokerage',
          balance: 1_000_000,
          expectedReturn: 0.04,
          lastEditedAt: now,
        },
      ],
      taxLots: [lot({ shares: 1000, costBasis: 0, pricePerShare: 1000 })],
      shortTermGainRate: 0.22,
      longTermGainRate: 0.15,
    };
    const taxed = standing(covered, seed, 'realistic', 'work_optional');
    const untaxed = standing({ ...covered, shortTermGainRate: null, longTermGainRate: null }, seed, 'realistic', 'work_optional');
    assert.equal(untaxed.hiredMonth, 0);
    assert.ok(taxed.hiredMonth == null || taxed.hiredMonth > 0);
    assert.match(taxed.sentence, /taxed on the gain in the lots/);
    assert.match(untaxed.sentence, /untaxed until you set both gain rates/);

    const partial = walkForecast(
      {
        ...covered,
        accounts: covered.accounts.map((account) => (account.id === 'brk' ? { ...account, balance: 1_004_000 } : account)),
      },
      seed,
      'realistic',
      { horizonMonths: 1, now: new Date('2026-06-15T12:00:00.000Z') },
    );
    assert.equal(partial.months[0].brokerageCovered, 0);
  });

  it('keeps basis flat while the balance grows, and ages a short-term lot after a year', () => {
    const seed = loadSeed();
    const asOf = new Date('2026-06-15T12:00:00.000Z');
    const household: HouseholdInput = {
      ...emptyRealHousehold('10001'),
      housingTenure: 'none',
      hasVehicle: false,
      monthlyIncome: 1000,
      accounts: [
        { id: 'cash', type: 'cash', name: 'Cash', balance: 1000, lastEditedAt: asOf.toISOString() },
        {
          id: 'brk',
          type: 'brokerage',
          name: 'Brokerage',
          balance: 200,
          expectedReturn: 0,
          lastEditedAt: asOf.toISOString(),
        },
      ],
      taxLots: [lot({ acquiredOn: '2026-06-01', shares: 1, costBasis: 100, pricePerShare: 200 })],
    };
    const walked = walkForecast(household, seed, 'realistic', { horizonMonths: 13, now: asOf });
    const first = walked.months[0];
    const later = walked.months[12];
    assert.ok(first.brokerageShortGain > 0);
    assert.equal(later.brokerageShortGain, 0);
    assert.ok(Math.abs(later.brokerageLongGain / later.brokerageCovered - 0.5) < 0.02);
    assert.ok(Math.abs(first.brokerageBasis / first.brokerageCovered - 0.5) < 0.02);

    const growing = walkForecast(
      {
        ...household,
        accounts: household.accounts.map((account) =>
          account.id === 'brk' ? { ...account, expectedReturn: 0.12 } : account,
        ),
      },
      seed,
      'realistic',
      { horizonMonths: 2, now: asOf },
    );
    const grown = growing.months[0];
    assert.ok(grown.brokerageBasis / grown.brokerageCovered < 0.5);
  });
});
