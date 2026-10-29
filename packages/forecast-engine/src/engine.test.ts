import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { monthlyOutflows, findDuplicateGuesses } from './debt';
import { applyLiquidTotal, plannedEvents, reservedFromHits, runAllScenarios, runForecast, runMonteCarloFan, runOverlay } from './engine';
import { householdIncomeForMonth, incomeForMonth } from './cadence';
import { monthlyRate } from './rates';
import { availableOverlays, leftoverAtMonth } from './overlays';
import { intakeGap, nextBest, nextBestQuestion } from './jobs';
import { notificationAllowed } from './outliers';
import { emptyRealHousehold, normalizeHousehold, previewHousehold } from './preview';
import { applyZMove, compareSequence, extraMonthly, otherJobStandings, withDebtFirst } from './sequence';
import { projectCollision, standing } from './standing';
import { livingBriefing } from './briefing';
import { leadingVehicleYear, resolveVehicleQuery, searchVehicles, vehicleIdentityFromQuery, vehicleMaintMultiplier } from './lookups';
import { vehicleRunningCost } from './drivers';
import { DEFAULT_BUFFER_MONTHS, DEFAULT_JOB_CLASS, PREVIEW_HOUSEHOLD_ID } from './types';
import type { SeedBundle } from './seed-types';
import type { HouseholdInput } from './types';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../../data/seed');

function loadSeed(): SeedBundle {
  return {
    home: JSON.parse(readFileSync(join(root, 'home_v1.json'), 'utf8')),
    vehicle: JSON.parse(readFileSync(join(root, 'vehicle_v1.json'), 'utf8')),
    macro: JSON.parse(readFileSync(join(root, 'macro_v1.json'), 'utf8')),
  };
}

describe('preview isolation', () => {
  it('preview id never equals real household id', () => {
    const preview = previewHousehold();
    const real = emptyRealHousehold('10001');
    assert.equal(preview.id, PREVIEW_HOUSEHOLD_ID);
    assert.notEqual(preview.id, real.id);
    assert.equal(preview.kind, 'preview');
    assert.equal(real.kind, 'real');
  });
});

describe('scenarios', () => {
  it('liberal house cost is below conservative', () => {
    const seed = loadSeed();
    const all = runAllScenarios(previewHousehold(), seed);
    assert.ok(all.liberal.houseCost5y <= all.realistic.houseCost5y);
    assert.ok(all.realistic.houseCost5y <= all.conservative.houseCost5y);
    assert.ok(all.liberal.netWorthNow === all.realistic.netWorthNow);
  });

  it('preview net worth is about 500k', () => {
    const seed = loadSeed();
    const r = runForecast(previewHousehold(), seed, 'realistic');
    assert.ok(r.netWorthNow > 490000 && r.netWorthNow < 510000);
    assert.equal(r.liquidNow, 80000);
  });

  it('retirement is not emergency cash', () => {
    const seed = loadSeed();
    const h = previewHousehold();
    h.accounts.push({
      id: '401k',
      type: 'retirement_401k',
      name: '401k',
      balance: 200000,
      expectedReturn: 0.07,
      lastEditedAt: new Date().toISOString(),
    });
    h.accounts.find((a) => a.type === 'cash')!.balance = 0;
    const r = runForecast(h, seed, 'realistic');
    assert.ok(r.emergencyGap > 0);
    assert.equal(r.liquidNow, 0);
    assert.equal(r.cashCoversConservative, false);
  });

  it('roof year narrows uncertainty via completeness', () => {
    const seed = loadSeed();
    const open = previewHousehold();
    const closed = previewHousehold();
    closed.assets[0].roofYear = 2018;
    closed.assets[0].hvacYear = 2016;
    const a = runForecast(open, seed, 'realistic');
    const b = runForecast(closed, seed, 'realistic');
    assert.ok(b.completeness > a.completeness);
  });
});

describe('debt linking', () => {
  it('linked mortgage plus housing expense counts once', () => {
    const expenses = [
      { id: 'e1', name: 'Housing', monthlyAmount: 2100, variable: false, linkedLiabilityId: 'm1' },
    ];
    const accounts = [
      {
        id: 'm1',
        type: 'mortgage' as const,
        name: 'Mortgage',
        balance: 300000,
        minPayment: 2100,
        lastEditedAt: new Date().toISOString(),
      },
    ];
    assert.equal(monthlyOutflows(expenses, accounts), 2100);
    const unlinked = [{ ...expenses[0], linkedLiabilityId: null }];
    const guesses = findDuplicateGuesses(unlinked, accounts);
    assert.equal(guesses.length, 1);
    assert.equal(monthlyOutflows(unlinked, accounts), 4200);
  });
});

describe('vehicle search', () => {
  it('does not list a default make before anyone types', () => {
    const seed = loadSeed();
    assert.deepEqual(searchVehicles(seed.vehicle, ''), []);
    assert.deepEqual(searchVehicles(seed.vehicle, '   '), []);
  });

  it('finds 2018 civic and a 2000 model with a class and an economy figure', () => {
    const seed = loadSeed();
    const recent = searchVehicles(seed.vehicle, '2018 civic');
    assert.ok(recent.some((hit) => hit.year === 2018 && hit.model.toLowerCase().includes('civic') && hit.class === 'car'));
    const old = searchVehicles(seed.vehicle, '2000 honda civic');
    const civic = old.find((hit) => hit.year === 2000 && hit.make === 'Honda' && hit.model === 'Civic');
    assert.ok(civic);
    assert.equal(civic.class, 'car');
    assert.ok((civic.mpg ?? 0) > 0);
  });

  it('ranks a typed year ahead of newer model years', () => {
    const seed = loadSeed();
    const newest = searchVehicles(seed.vehicle, 'camry', 6);
    assert.ok(newest.length >= 2);
    for (let i = 1; i < newest.length; i++) assert.ok(newest[i - 1].year >= newest[i].year);
    assert.ok(newest[0].year >= 2020);
    const exact = searchVehicles(seed.vehicle, '2000 camry', 6);
    assert.equal(exact[0].year, 2000);
    assert.ok(exact[0].year < newest[0].year);
  });

  it('keeps the motorcycle and rv samples searchable', () => {
    const seed = loadSeed();
    assert.ok(searchVehicles(seed.vehicle, 'harley').some((hit) => hit.class === 'motorcycle'));
    assert.ok(searchVehicles(seed.vehicle, 'winnebago').some((hit) => hit.class === 'rv'));
  });

  it('resolves one catalog row and still reads a leading year on a miss', () => {
    const seed = loadSeed();
    const civic = resolveVehicleQuery(seed.vehicle, '2000 Honda Civic');
    assert.equal(civic?.year, 2000);
    assert.equal(civic?.make, 'Honda');
    assert.equal(resolveVehicleQuery(seed.vehicle, 'civic'), null);
    assert.equal(leadingVehicleYear('2004 not a listed model'), 2004);
    assert.equal(leadingVehicleYear('camry'), null);
    const identity = vehicleIdentityFromQuery(seed.vehicle, '2004 not a listed model', null);
    assert.equal(identity.vehicleYear, 2004);
    assert.equal(identity.make, null);
    assert.equal(identity.vehicleClass, 'car');
    assert.equal(identity.mpg, null);
  });
});

describe('vehicle estimates', () => {
  it('a 2000 car uses the age band instead of the unknown-age bump', () => {
    const seed = loadSeed();
    const year = 2000;
    const h = emptyRealHousehold('10001');
    h.hasVehicle = true;
    h.assets = [
      {
        id: 'car-1',
        type: 'vehicle',
        name: '2000 car',
        value: 2000,
        vehicleYear: year,
        vehicleClass: 'car',
        mileage: null,
        lastEditedAt: new Date().toISOString(),
      },
    ];
    const events = plannedEvents(h, seed, 'realistic');
    const maint = events.find((event) => event.key === 'vehicle:car-1:maint');
    assert.ok(maint);
    const age = new Date().getFullYear() - year;
    const aged = vehicleMaintMultiplier(seed.vehicle, age, null);
    const unknown = vehicleMaintMultiplier(seed.vehicle, null, null);
    assert.ok(aged > unknown);
    assert.equal(aged, 1.55 * 1.1);
    const annual = 1950 * aged;
    assert.ok(Math.abs(maint.cost * 12 - annual) < 0.05);
  });

  it('an electricity-only row uses catalog kWh instead of the flat fuel fallback', () => {
    const seed = loadSeed();
    const row = seed.vehicle.catalog.find(
      (item) => item.class === 'ev' && item.kwhPerMile != null && Math.abs(item.kwhPerMile - 0.3) > 0.02,
    );
    assert.ok(row);
    assert.ok(row.kwhPerMile);
    const identity = vehicleIdentityFromQuery(seed.vehicle, `${row.year} ${row.make} ${row.model}`, null);
    assert.equal(identity.vehicleClass, 'ev');
    assert.equal(identity.kwhPerMile, row.kwhPerMile);
    const cost = vehicleRunningCost(
      {
        id: 'car-ev',
        type: 'vehicle',
        name: identity.name,
        value: 20000,
        vehicleYear: row.year,
        make: row.make,
        model: row.model,
        vehicleClass: 'ev',
        lastEditedAt: new Date().toISOString(),
      },
      seed,
    );
    const price = seed.macro.electricityPricePerKwh ?? 0.16;
    const expected = (12_000 * row.kwhPerMile * price) / 12;
    const fallback = (12_000 * 0.3 * price) / 12;
    assert.ok(Math.abs(cost.fuelMonthly - expected) < 0.05);
    assert.ok(Math.abs(cost.fuelMonthly - fallback) > 1);
    assert.ok(Math.abs(cost.fuelMonthly - 160) > 1);
  });
});

describe('notifications', () => {
  it('caps one per day and three all-clears', () => {
    const day = new Date('2026-09-05T12:00:00Z');
    const first = notificationAllowed({
      lastNotificationAt: null,
      allClearCount: 0,
      hasOutlier: false,
      now: day,
    });
    assert.equal(first.kind, 'all_clear');
    const same = notificationAllowed({
      lastNotificationAt: day.toISOString(),
      allClearCount: 1,
      hasOutlier: true,
      now: day,
    });
    assert.equal(same.send, false);
    const silenced = notificationAllowed({
      lastNotificationAt: '2026-09-04T12:00:00Z',
      allClearCount: 3,
      hasOutlier: false,
      now: day,
    });
    assert.equal(silenced.kind, 'silent');
  });
});

describe('stale cash', () => {
  it('flags cash older than 30 days', () => {
    const seed = loadSeed();
    const h: HouseholdInput = previewHousehold();
    h.accounts[0].lastEditedAt = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    const r = runForecast(h, seed, 'realistic');
    assert.equal(r.staleCash, true);
  });
});

describe('event hits', () => {
  it('exports walker hits without attaching them to the household', () => {
    const seed = loadSeed();
    const h = previewHousehold();
    const before = JSON.stringify(h);
    const hits = plannedEvents(h, seed, 'realistic');
    assert.ok(hits.length > 0);
    assert.ok(hits.every((hit) => typeof hit.key === 'string' && typeof hit.cost === 'number'));
    assert.ok(hits.some((hit) => hit.month === -1));
    assert.equal(JSON.stringify(h), before);
    assert.equal('hits' in h, false);
    assert.equal('reservedCash' in h, false);
  });
});

describe('jobClass', () => {
  it('preview household has a default jobClass and no IAP fields', () => {
    const preview = previewHousehold();
    const real = emptyRealHousehold('10001');
    assert.equal(preview.jobClass, DEFAULT_JOB_CLASS);
    assert.equal(real.jobClass, DEFAULT_JOB_CLASS);
    assert.equal(preview.targetDate, null);
    const json = JSON.stringify(preview);
    assert.equal(json.includes('reservedCash'), false);
    assert.equal(json.includes('plus'), false);
    assert.equal(json.includes('entitlement'), false);
  });

  it('round-trips jobClass and strips Plus fields', () => {
    const h = previewHousehold();
    h.jobClass = 'work_optional';
    const dirty = { ...h, reservedCash: 999, plus: true, entitlements: { standing: false } };
    const round = normalizeHousehold(dirty);
    assert.equal(round.jobClass, 'work_optional');
    assert.equal('reservedCash' in round, false);
    assert.equal('plus' in round, false);
    assert.equal('entitlements' in round, false);
  });
});

describe('standing', () => {
  it('does not treat 401k as reserved or leftover', () => {
    const seed = loadSeed();
    const h = previewHousehold();
    h.accounts.find((a) => a.type === 'cash')!.balance = 0;
    h.accounts.push({
      id: '401k',
      type: 'retirement_401k',
      name: '401k',
      balance: 200000,
      expectedReturn: 0.07,
      lastEditedAt: new Date().toISOString(),
    });
    const view = standing(h, seed, 'realistic', h.jobClass);
    const hits = plannedEvents(h, seed, 'conservative');
    assert.equal(view.liquid, 0);
    assert.equal(view.leftover, 0);
    assert.equal(view.reserved, reservedFromHits(hits));
    assert.ok(view.reserved > 0);
    assert.equal(view.reserved < 200000, true);
    assert.equal('leftover' in h, false);
    assert.equal(JSON.stringify(h).includes('"leftover"'), false);
  });

  it('leftover can be 0 when cash is below reserved', () => {
    const seed = loadSeed();
    const h = previewHousehold();
    h.accounts[0].balance = 0;
    const view = standing(h, seed, 'realistic', 'keep_house_car');
    assert.equal(view.leftover, 0);
    assert.ok(view.reserved > 0);
  });

  it('roof year changes move reserved', () => {
    const seed = loadSeed();
    const open = previewHousehold();
    const due = previewHousehold();
    due.assets[0].roofYear = new Date().getFullYear() - 25;
    const a = standing(open, seed, 'realistic', open.jobClass);
    const b = standing(due, seed, 'realistic', due.jobClass);
    assert.ok(b.reserved > a.reserved);
  });

  it('seed vintage change moves reserved via conservative hits', () => {
    const seed = loadSeed();
    const h = previewHousehold();
    h.assets[0].roofYear = new Date().getFullYear() - 25;
    const base = standing(h, seed, 'realistic', h.jobClass);
    const bumped: SeedBundle = {
      ...seed,
      home: {
        ...seed.home,
        systems: seed.home.systems.map((sys) =>
          sys.key === 'roof'
            ? {
                ...sys,
                replacement: {
                  liberal: sys.replacement.liberal * 2,
                  realistic: sys.replacement.realistic * 2,
                  conservative: sys.replacement.conservative * 2,
                },
              }
            : sys,
        ),
      },
    };
    const next = standing(h, bumped, 'realistic', h.jobClass);
    assert.ok(next.reserved > base.reserved);
  });

  it('realized shock drops out of reserved', () => {
    const seed = loadSeed();
    const h = previewHousehold();
    h.assets[0].roofYear = new Date().getFullYear() - 25;
    const before = standing(h, seed, 'realistic', h.jobClass);
    const roof = plannedEvents(h, seed, 'conservative').find((e) => e.key.includes(':roof'));
    assert.ok(roof);
    h.realizedEventKeys = [roof.key];
    const after = standing(h, seed, 'realistic', h.jobClass);
    assert.ok(after.reserved < before.reserved);
  });

  it('unknown system years do not dump replacements into this month', () => {
    const seed = loadSeed();
    const h = previewHousehold();
    const hits = plannedEvents(h, seed, 'conservative');
    assert.equal(
      hits.some((e) => e.month >= 1 && e.month <= 12 && (e.key.includes('hvac') || e.key.includes('water') || e.key.includes('roof'))),
      false,
    );
    const view = standing(h, seed, 'realistic', 'keep_house_car');
    assert.ok(view.leftover > 0);
    assert.equal(view.hiredMonth, 0);
  });

  it('work-optional does not treat a one-shot roof as annual spending', () => {
    const seed = loadSeed();
    const h = previewHousehold();
    h.jobClass = 'work_optional';
    h.surplusPolicy = 'retirement';
    h.accounts.push({
      id: '401k',
      type: 'retirement_401k',
      name: '401k',
      balance: 80000,
      expectedReturn: 0.07,
      lastEditedAt: new Date().toISOString(),
    });
    const base = standing(h, seed, 'realistic', 'work_optional');
    h.assets[0].roofYear = new Date().getFullYear() - 25;
    const shocked = standing(h, seed, 'realistic', 'work_optional');
    assert.ok(base.hiredMonth != null);
    assert.ok(shocked.hiredMonth != null);
    assert.ok(Math.abs((shocked.hiredMonth ?? 0) - (base.hiredMonth ?? 0)) < 120);
  });

  it('debt-free will not invent a date without income, spend, and a loan', () => {
    const seed = loadSeed();
    const h = previewHousehold();
    assert.ok(intakeGap(h, 'debt_free'));
    const view = standing(h, seed, 'realistic', 'debt_free');
    assert.equal(view.hiredMonth, null);
    assert.match(view.sentence, /loan|take-home|spending/i);
  });

  it('owner Stay Afloat still reserves ownership shocks', () => {
    const seed = loadSeed();
    const h = previewHousehold();
    const hits = plannedEvents(h, seed, 'conservative');
    const view = standing(h, seed, 'realistic', 'keep_house_car');
    assert.equal(view.reserved, reservedFromHits(hits));
    assert.match(view.sentence, /Stay Afloat/);
  });

  it('renter Emergency Fund does not reserve a phantom roof', () => {
    const seed = loadSeed();
    const now = new Date().toISOString();
    const h = emptyRealHousehold();
    h.jobClass = 'cash_buffer';
    h.housingTenure = 'rent';
    h.hasVehicle = false;
    h.monthlyIncome = 4000;
    h.accounts = [{ id: 'cash-1', type: 'cash', name: 'Cash', balance: 12000, lastEditedAt: now }];
    h.expenses = [
      { id: 'exp-rent', name: 'Rent', monthlyAmount: 1800, variable: false },
      { id: 'exp-living', name: 'Living', monthlyAmount: 900, variable: true },
    ];
    assert.equal(intakeGap(h, 'cash_buffer'), null);
    const hits = plannedEvents(h, seed, 'conservative');
    assert.equal(
      hits.some((e) => e.key.includes('home')),
      false,
    );
    const view = standing(h, seed, 'realistic', 'cash_buffer');
    const burn = 1800 + 900 * 1.2;
    assert.equal(view.reserved, burn * DEFAULT_BUFFER_MONTHS);
    assert.notEqual(view.reserved, reservedFromHits(hits));
    assert.match(view.sentence, /Emergency Fund/);
    assert.equal(/house and car/i.test(view.sentence), false);
    const nag = nextBestQuestion(h, 'cash_buffer');
    assert.equal(/mortgage|add the house/i.test(nag ?? ''), false);
  });

  it('Stay Afloat owner without a house does not invent a date', () => {
    const seed = loadSeed();
    const now = new Date().toISOString();
    const h = emptyRealHousehold();
    h.jobClass = 'keep_house_car';
    h.housingTenure = 'own';
    h.hasVehicle = false;
    h.monthlyIncome = 5000;
    h.accounts = [{ id: 'cash-1', type: 'cash', name: 'Cash', balance: 20000, lastEditedAt: now }];
    assert.match(intakeGap(h, 'keep_house_car') ?? '', /ZIP|house/);
    const view = standing(h, seed, 'realistic', 'keep_house_car');
    assert.equal(view.hiredMonth, null);
    assert.match(view.sentence, /invent|ZIP|house/i);
  });

  it('round-trips housingTenure and does not infer rent from a missing house', () => {
    const h = emptyRealHousehold();
    h.jobClass = 'cash_buffer';
    const round = normalizeHousehold({ ...h, reservedCash: 1 });
    assert.equal(round.housingTenure, null);
    assert.equal(round.hasVehicle, null);
    assert.equal(round.hasMortgage, null);
    assert.match(intakeGap(round, 'cash_buffer') ?? '', /own, rent, or neither/);
  });

  it('Retire early does not treat an owned house as paid off by default', () => {
    const now = new Date().toISOString();
    const h = emptyRealHousehold();
    h.jobClass = 'work_optional';
    h.housingTenure = 'own';
    h.hasVehicle = false;
    h.monthlyIncome = 8000;
    h.expenses = [{ id: 'exp-living', name: 'Living', monthlyAmount: 3000, variable: true }];
    h.accounts = [
      {
        id: 'inv-1',
        type: 'retirement_401k',
        name: '401k',
        balance: 400000,
        expectedReturn: 0.07,
        lastEditedAt: now,
      },
    ];
    assert.match(intakeGap(h, 'work_optional') ?? '', /paid off|mortgage/i);
    h.hasMortgage = false;
    assert.equal(intakeGap(h, 'work_optional'), null);
    h.hasMortgage = true;
    assert.match(intakeGap(h, 'work_optional') ?? '', /mortgage/i);
    h.accounts.push({
      id: 'mtg-1',
      type: 'mortgage',
      name: 'Mortgage',
      balance: 220000,
      minPayment: 1800,
      lastEditedAt: now,
    });
    assert.equal(intakeGap(h, 'work_optional'), null);
  });

  it('Debt Free keeps more than one loan on the books', () => {
    const seed = loadSeed();
    const now = new Date().toISOString();
    const h = emptyRealHousehold();
    h.jobClass = 'debt_free';
    h.housingTenure = 'own';
    h.hasMortgage = true;
    h.hasVehicle = false;
    h.monthlyIncome = 6000;
    h.expenses = [{ id: 'exp-living', name: 'Living', monthlyAmount: 2000, variable: true }];
    h.accounts = [
      { id: 'mtg-1', type: 'mortgage', name: 'Mortgage', balance: 200000, minPayment: 1500, lastEditedAt: now },
      { id: 'stu-1', type: 'student_loan', name: 'Student', balance: 40000, minPayment: 400, lastEditedAt: now },
    ];
    assert.equal(intakeGap(h, 'debt_free'), null);
    const r = runForecast(h, seed, 'realistic');
    assert.ok(r.months[0].liabilities > 230000);
    assert.match(nextBestQuestion(h, 'debt_free') ?? '', /interest rate/i);
  });

  it('unknown loan APR is not treated as 0%', () => {
    const seed = loadSeed();
    const now = new Date().toISOString();
    const h = emptyRealHousehold('10001');
    h.housingTenure = 'own';
    h.hasMortgage = true;
    h.monthlyIncome = 8000;
    h.expenses = [{ id: 'exp-living', name: 'Living', monthlyAmount: 2000, variable: false }];
    h.accounts = [
      { id: 'mtg-1', type: 'mortgage', name: 'Mortgage', balance: 200000, minPayment: 1500, lastEditedAt: now },
    ];
    const typical = runForecast(h, seed, 'realistic');
    h.accounts[0].apr = 0;
    const zero = runForecast(h, seed, 'realistic');
    assert.ok(typical.months[11].liabilities > zero.months[11].liabilities);
    h.accounts[0].apr = 0.065;
    const entered = runForecast(h, seed, 'realistic');
    assert.ok(Math.abs(entered.months[0].liabilities - typical.months[0].liabilities) < 50);
  });
});

describe('next-best', () => {
  it('sends a Stay Afloat owner with unknown roof to the roof field', () => {
    const h = previewHousehold();
    h.assets[0].roofYear = null;
    h.assets[0].hvacYear = null;
    const probe = nextBest(h);
    assert.equal(probe?.key, 'roof');
    assert.match(probe?.question ?? '', /roof year/i);
    assert.equal(nextBestQuestion(h), probe?.question);
  });
});

describe('collision', () => {
  it('bumping a roof override changes the collision line and leaves books unchanged', () => {
    const seed = loadSeed();
    const h = previewHousehold();
    h.assets[0].roofYear = new Date().getFullYear() - 25;
    const books = JSON.stringify(h);
    const base = standing(h, seed, 'realistic', h.jobClass);
    const shockedHousehold: HouseholdInput = {
      ...h,
      assets: h.assets.map((a) =>
        a.id === h.assets[0].id ? { ...a, costOverrides: { ...a.costOverrides, roof: 40000 } } : a,
      ),
    };
    const shocked = standing(shockedHousehold, seed, 'realistic', h.jobClass);
    const diff = projectCollision(base, shocked);
    assert.ok(shocked.reserved > base.reserved);
    assert.ok(diff.reservedDelta > 0);
    assert.ok(diff.line.length > 0);
    assert.match(diff.line, /reserved|leftover|hired date/i);
    assert.equal(JSON.stringify(h), books);
    assert.equal('reservedCash' in h, false);
  });
});

describe('cadence and partner income', () => {
  it('biweekly months sum to the same annual pay', () => {
    let sum = 0;
    for (let m = 1; m <= 12; m++) sum += incomeForMonth(6500, 'biweekly', m);
    assert.ok(Math.abs(sum - 6500 * 12) < 1);
    const january = new Date(2026, 0, 15);
    assert.ok(incomeForMonth(6500, 'biweekly', 3, null, january) > incomeForMonth(6500, 'biweekly', 1, null, january));
  });

  it('partner income adds without a second household', () => {
    const h = previewHousehold();
    h.monthlyIncome = 5000;
    h.partnerMonthlyIncome = 2500;
    h.paycheckCadence = 'monthly';
    assert.equal(householdIncomeForMonth(h, 1), 7500);
    const round = normalizeHousehold({ ...h, plus: true });
    assert.equal(round.partnerMonthlyIncome, 2500);
    assert.equal('plus' in round, false);
  });
});

describe('FIRE flavors and If pay stopped', () => {
  it('coast FIRE is later than standard when they still contribute', () => {
    const seed = loadSeed();
    const h = previewHousehold();
    h.jobClass = 'work_optional';
    h.fireFlavor = 'standard';
    h.surplusPolicy = 'retirement';
    h.housingTenure = 'own';
    h.hasMortgage = false;
    h.monthlyIncome = 8000;
    h.expenses = [{ id: 'exp-living', name: 'Living', monthlyAmount: 4000, variable: true }];
    h.accounts.push({
      id: '401k',
      type: 'retirement_401k',
      name: '401k',
      balance: 120000,
      expectedReturn: 0.07,
      lastEditedAt: new Date().toISOString(),
    });
    const standard = standing(h, seed, 'realistic', 'work_optional');
    h.fireFlavor = 'coast';
    const coast = standing(h, seed, 'realistic', 'work_optional');
    assert.ok(standard.hiredMonth != null);
    assert.ok(coast.hiredMonth == null || (coast.hiredMonth ?? 0) >= (standard.hiredMonth ?? 0));
  });

  it('If pay stopped reserves a year of bills plus ownership, not Stay Afloat', () => {
    const seed = loadSeed();
    const h = previewHousehold();
    h.jobClass = 'survive_paycheck';
    const stay = standing(h, seed, 'realistic', 'keep_house_car');
    const y = standing(h, seed, 'realistic', 'survive_paycheck');
    assert.ok(y.reserved > stay.reserved);
    assert.ok(y.runwayMonths != null);
    assert.match(y.sentence, /pay stopped|If pay stopped/i);
    assert.equal(intakeGap(h, 'survive_paycheck'), null);
  });
});

describe('sequence and Z moves', () => {
  it('debt-first raises the highest-APR payment and leaves books unchanged', () => {
    const seed = loadSeed();
    const now = new Date().toISOString();
    const h = emptyRealHousehold('10001');
    h.jobClass = 'debt_free';
    h.housingTenure = 'own';
    h.hasMortgage = true;
    h.hasVehicle = false;
    h.monthlyIncome = 7000;
    h.expenses = [{ id: 'exp-living', name: 'Living', monthlyAmount: 2000, variable: true }];
    h.accounts = [
      { id: 'cash-1', type: 'cash', name: 'Cash', balance: 8000, lastEditedAt: now },
      { id: 'mtg-1', type: 'mortgage', name: 'Mortgage', balance: 200000, minPayment: 1500, apr: 0.065, lastEditedAt: now },
      { id: 'card-1', type: 'credit_card', name: 'Card', balance: 8000, minPayment: 200, apr: 0.22, lastEditedAt: now },
    ];
    const books = JSON.stringify(h);
    assert.ok(extraMonthly(h) > 0);
    const clone = withDebtFirst(h);
    const card = clone.accounts.find((a) => a.id === 'card-1');
    assert.ok((card?.minPayment ?? 0) > 200);
    assert.equal(JSON.stringify(h), books);
    const seq = compareSequence(h, seed, 'realistic');
    assert.equal(seq.debtFirst.jobClass, 'debt_free');
    assert.equal(seq.fireFirst.jobClass, 'work_optional');
  });

  it('delay-replace moves the hired collision without writing books', () => {
    const seed = loadSeed();
    const h = previewHousehold();
    h.assets[0].roofYear = new Date().getFullYear() - 25;
    const books = JSON.stringify(h);
    const delayed = applyZMove(h, 'delay_replace');
    const downsized = applyZMove(h, 'downsize');
    assert.equal(delayed.assets[0].roofYear, (h.assets[0].roofYear ?? 0) + 5);
    assert.ok((downsized.assets[0].value ?? 0) < (h.assets[0].value ?? 0));
    assert.equal(JSON.stringify(h), books);
  });

  it('other job standings are not a first-open scoreboard and do not persist', () => {
    const seed = loadSeed();
    const h = previewHousehold();
    const books = JSON.stringify(h);
    const others = otherJobStandings(h, seed, 'realistic');
    assert.ok(others.every((v) => v.jobClass !== h.jobClass));
    assert.ok(others.length >= 4);
    assert.equal(JSON.stringify(h), books);
    const brief = livingBriefing(standing(h, seed, 'realistic'), nextBest(h));
    assert.ok(brief.trail.length > 0);
    assert.ok(brief.exit.includes('reserved'));
  });
});

describe('driver catalog', () => {
  it('two vehicles depreciate independently', () => {
    const seed = loadSeed();
    const now = new Date().toISOString();
    const h = previewHousehold();
    h.hasVehicle = true;
    h.assets = [
      h.assets[0],
      {
        id: 'car-a',
        type: 'vehicle',
        name: 'Civic',
        value: 10000,
        vehicleClass: 'car',
        lastEditedAt: now,
      },
      {
        id: 'truck-a',
        type: 'vehicle',
        name: 'F-150',
        value: 15000,
        vehicleClass: 'truck',
        lastEditedAt: now,
      },
    ];
    const r = runForecast(h, seed, 'realistic');
    const dCar = 0.15 / 12;
    const dTruck = 0.17 / 12;
    const independent = 10000 * (1 - dCar) ** 12 + 15000 * (1 - dTruck) ** 12;
    const buggy = 25000 * (1 - dCar) ** 12 * (1 - dTruck) ** 12;
    const defl = (1 + seed.macro.cpiAnnual / 12) ** 12;
    const actual = r.months[11].vehicles;
    assert.ok(actual > buggy / defl);
    assert.ok(Math.abs(actual - independent / defl) / (independent / defl) < 0.02);
  });

  it('sqft 3000 vs 1000 changes home maint / houseCost5y', () => {
    const seed = loadSeed();
    const small = previewHousehold();
    const large = previewHousehold();
    small.assets[0].sqft = 1000;
    large.assets[0].sqft = 3000;
    const a = runForecast(small, seed, 'realistic');
    const b = runForecast(large, seed, 'realistic');
    assert.ok(b.houseCost5y > a.houseCost5y);
  });

  it('partner + cadence: biweekly year income ≈ (own+partner)*12', () => {
    const h = previewHousehold();
    h.monthlyIncome = 5000;
    h.partnerMonthlyIncome = 2500;
    h.paycheckCadence = 'biweekly';
    let sum = 0;
    for (let m = 1; m <= 12; m++) sum += householdIncomeForMonth(h, m);
    assert.ok(Math.abs(sum - 7500 * 12) < 1);
  });
});

describe('overlays', () => {
  it('paycheck_gap cash at month 6 is below base realistic cash', () => {
    const seed = loadSeed();
    const h = previewHousehold();
    h.monthlyIncome = 6500;
    h.partnerMonthlyIncome = 3000;
    const base = runForecast(h, seed, 'realistic');
    const gap = runOverlay(h, seed, 'paycheck_gap');
    assert.ok(gap.months[5].cash < base.months[5].cash);
  });

  it('raise leftover/cash at month 24 is above base', () => {
    const seed = loadSeed();
    const h = previewHousehold();
    h.monthlyIncome = 6500;
    const base = runForecast(h, seed, 'realistic');
    const raised = runOverlay(h, seed, 'raise');
    const reserved = reservedFromHits(plannedEvents(h, seed, 'conservative'));
    assert.ok(raised.months[23].cash > base.months[23].cash);
    assert.ok(leftoverAtMonth(raised, 24, reserved) > leftoverAtMonth(base, 24, reserved));
  });

  it('no house → availableOverlays does not include hpi_crash/hpi_boom', () => {
    const h = emptyRealHousehold();
    h.housingTenure = 'rent';
    h.hasVehicle = false;
    const ids = availableOverlays(h).map((o) => o.id);
    assert.equal(ids.includes('hpi_crash'), false);
    assert.equal(ids.includes('hpi_boom'), false);
  });
});

describe('monte carlo paths', () => {
  it('seed 42 twice yields identical series', () => {
    const seed = loadSeed();
    const h = previewHousehold();
    const a = runMonteCarloFan(h, seed, 60, 42);
    const b = runMonteCarloFan(h, seed, 60, 42);
    assert.deepEqual(a.liberal, b.liberal);
    assert.deepEqual(a.realistic, b.realistic);
    assert.deepEqual(a.conservative, b.conservative);
  });

  it('path conservative[59] <= realistic[59] <= liberal[59]', () => {
    const seed = loadSeed();
    const fan = runMonteCarloFan(previewHousehold(), seed, 80, 42);
    assert.ok(fan.conservative[59] <= fan.realistic[59]);
    assert.ok(fan.realistic[59] <= fan.liberal[59]);
    assert.ok(Number.isFinite(fan.cashEs12m));
    assert.ok(fan.pCashNegative >= 0 && fan.pCashNegative <= 1);
    assert.ok(fan.pBillClaimsLeftover >= 0 && fan.pBillClaimsLeftover <= 1);
  });
});

describe('real dollars', () => {
  it('months[59].netWorth is real (deflated); nominal != real', () => {
    const seed = loadSeed();
    const r = runForecast(previewHousehold(), seed, 'realistic');
    const last = r.months[59];
    assert.ok(last.nominalNetWorth != null);
    assert.notEqual(last.nominalNetWorth, last.netWorth);
    const factor = (1 + monthlyRate(seed.macro.cpiAnnual)) ** 60;
    assert.ok(Math.abs((last.nominalNetWorth ?? 0) / last.netWorth - factor) < 0.001);
  });
});

describe('applyLiquidTotal', () => {
  it('scales checking and savings instead of copying the total onto both', () => {
    const now = new Date().toISOString();
    const h = emptyRealHousehold('10001');
    h.accounts = [
      { id: 'chk', type: 'checking', name: 'Checking', balance: 4000, lastEditedAt: now },
      { id: 'sav', type: 'savings', name: 'Savings', balance: 6000, lastEditedAt: now },
    ];
    const next = applyLiquidTotal(h, 20000, now);
    const checking = next.accounts.find((a) => a.id === 'chk');
    const savings = next.accounts.find((a) => a.id === 'sav');
    assert.equal(checking?.balance, 8000);
    assert.equal(savings?.balance, 12000);
    assert.equal((checking?.balance ?? 0) + (savings?.balance ?? 0), 20000);
  });
});

