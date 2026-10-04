import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { plannedEvents, reservedFromHits } from './engine';
import { hiredGoalSpec, presetGoalSpec } from './goals';
import { intakeGap } from './jobs';
import { emptyRealHousehold, normalizeHousehold, previewHousehold } from './preview';
import { openGoalBoard, standing } from './standing';
import type { SeedBundle } from './seed-types';
import type { GoalSpec, HouseholdInput } from './types';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../../data/seed');

function loadSeed(): SeedBundle {
  return {
    home: JSON.parse(readFileSync(join(root, 'home_v1.json'), 'utf8')),
    vehicle: JSON.parse(readFileSync(join(root, 'vehicle_v1.json'), 'utf8')),
    macro: JSON.parse(readFileSync(join(root, 'macro_v1.json'), 'utf8')),
  };
}

function customSpec(patch: Partial<GoalSpec> & Pick<GoalSpec, 'target'>): GoalSpec {
  return {
    id: patch.id ?? 'goal-custom',
    name: patch.name ?? 'Honda paid off',
    source: 'custom',
    reserved: patch.reserved ?? 'ownership',
    target: patch.target,
  };
}

function withCustom(h: HouseholdInput, spec: GoalSpec): HouseholdInput {
  return { ...h, jobClass: 'custom', goalSpec: spec, openGoals: [spec] };
}

describe('GoalSpec presets', () => {
  it('preview Stay Afloat still works via standing()', () => {
    const seed = loadSeed();
    const h = previewHousehold();
    const spec = hiredGoalSpec(h);
    assert.equal(spec.source, 'preset');
    assert.equal(spec.target.kind, 'afloat');
    const view = standing(h, seed, 'realistic');
    assert.equal(view.jobClass, 'keep_house_car');
    assert.equal(view.hiredMonth, 0);
    assert.match(view.sentence, /Stay Afloat/);
  });

  it('presetGoalSpec maps each hire', () => {
    const h = previewHousehold();
    assert.equal(presetGoalSpec(h, 'work_optional').target.kind, 'work_optional');
    assert.equal(presetGoalSpec(h, 'debt_free').target.kind, 'debt_zero');
    assert.equal(presetGoalSpec(h, 'cash_buffer').target.kind, 'runway');
    assert.equal(presetGoalSpec(h, 'keep_house_car').target.kind, 'afloat');
    assert.equal(presetGoalSpec(h, 'survive_paycheck').reserved, 'paycheck_year');
  });
});

describe('custom GoalSpec standing', () => {
  it('custom amount $10k liquid: 12k cash is hired now; 0 cash may date later', () => {
    const seed = loadSeed();
    const spec = customSpec({
      name: 'June trip',
      target: { kind: 'amount', dollars: 10000, bucket: 'liquid' },
    });
    const funded = withCustom(previewHousehold(), spec);
    funded.accounts[0].balance = 12000;
    const yes = standing(funded, seed, 'realistic');
    assert.equal(yes.hiredMonth, 0);
    assert.match(yes.sentence, /June trip/);

    const empty = withCustom(previewHousehold(), spec);
    empty.accounts[0].balance = 0;
    empty.monthlyIncome = 8000;
    const later = standing(empty, seed, 'realistic');
    assert.ok(later.hiredMonth == null || later.hiredMonth >= 1);
  });

  it('custom debt_zero one loan: hired when that loan is ~0', () => {
    const seed = loadSeed();
    const now = new Date().toISOString();
    const h = emptyRealHousehold('10001');
    h.housingTenure = 'rent';
    h.hasVehicle = false;
    h.monthlyIncome = 5000;
    h.expenses = [{ id: 'exp-rent', name: 'Rent', monthlyAmount: 1200, variable: false }];
    h.accounts = [
      { id: 'cash-1', type: 'cash', name: 'Cash', balance: 2000, lastEditedAt: now },
      { id: 'auto-1', type: 'auto_loan', name: 'Honda', balance: 3000, minPayment: 1000, apr: 0, lastEditedAt: now },
      { id: 'stu-1', type: 'student_loan', name: 'School', balance: 40000, minPayment: 50, apr: 0, lastEditedAt: now },
    ];
    const spec = customSpec({
      name: 'Honda paid off',
      target: { kind: 'debt_zero', accountIds: ['auto-1'] },
    });
    const view = standing(withCustom(h, spec), seed, 'realistic');
    assert.equal(intakeGap(withCustom(h, spec)), null);
    assert.equal(view.hiredMonth, 1);
    assert.match(view.sentence, /Honda paid off/);
  });

  it('401k is not reserved on custom amount liquid', () => {
    const seed = loadSeed();
    const h = previewHousehold();
    h.accounts[0].balance = 5000;
    h.accounts.push({
      id: '401k',
      type: 'retirement_401k',
      name: '401k',
      balance: 200000,
      expectedReturn: 0.07,
      lastEditedAt: new Date().toISOString(),
    });
    const spec = customSpec({
      name: 'Cash cushion',
      reserved: 'ownership',
      target: { kind: 'amount', dollars: 10000, bucket: 'liquid' },
    });
    const view = standing(withCustom(h, spec), seed, 'realistic');
    const hits = plannedEvents(h, seed, 'conservative');
    assert.equal(view.liquid, 5000);
    assert.equal(view.reserved, reservedFromHits(hits));
    assert.ok(view.reserved < 200000);
    assert.ok(view.reserved !== 200000);
  });

  it('a named account does not hire from cash sitting in another account', () => {
    const seed = loadSeed();
    const now = new Date().toISOString();
    const spec = customSpec({
      name: 'Trip fund',
      reserved: 'none',
      target: { kind: 'amount', dollars: 5000, bucket: 'named_account', accountId: 'trip' },
    });
    const h = withCustom(emptyRealHousehold('10001'), spec);
    h.housingTenure = 'none';
    h.hasVehicle = false;
    h.monthlyIncome = 8000;
    h.expenses = [];
    h.assets = [];
    h.accounts = [
      { id: 'checking', type: 'checking', name: 'Checking', balance: 20000, lastEditedAt: now },
      { id: 'trip', type: 'savings', name: 'Trip', balance: 1000, expectedReturn: 0, lastEditedAt: now },
    ];
    const view = standing(h, seed, 'realistic');
    assert.equal(view.hiredMonth, null);
  });

  it('renter custom does not invent a house', () => {
    const seed = loadSeed();
    const now = new Date().toISOString();
    const h = emptyRealHousehold();
    h.housingTenure = 'rent';
    h.hasVehicle = false;
    h.monthlyIncome = 4000;
    h.accounts = [{ id: 'cash-1', type: 'cash', name: 'Cash', balance: 15000, lastEditedAt: now }];
    h.expenses = [{ id: 'exp-rent', name: 'Rent', monthlyAmount: 1800, variable: false }];
    const spec = customSpec({
      name: 'June trip',
      reserved: 'n_months_living',
      target: { kind: 'amount', dollars: 10000, bucket: 'liquid' },
    });
    const hired = withCustom(h, spec);
    assert.equal(
      hired.assets.some((a) => a.type === 'home'),
      false,
    );
    const hits = plannedEvents(hired, seed, 'conservative');
    assert.equal(
      hits.some((e) => e.key.includes('home')),
      false,
    );
    assert.equal(intakeGap(hired), null);
    assert.equal(/house|mortgage|ZIP/i.test(intakeGap(hired) ?? ''), false);
    const view = standing(hired, seed, 'realistic');
    assert.equal(view.hiredMonth, 0);
    assert.equal(/invent a house/i.test(view.sentence), false);
  });
});

describe('normalize GoalSpec', () => {
  it('strips Plus and round-trips a custom spec', () => {
    const spec = customSpec({
      name: 'June trip',
      target: { kind: 'amount', dollars: 15000, bucket: 'liquid' },
    });
    const h = withCustom(previewHousehold(), spec);
    const dirty = { ...h, reservedCash: 999, plus: true, entitlements: { standing: false } };
    const round = normalizeHousehold(dirty);
    assert.equal(round.jobClass, 'custom');
    assert.deepEqual(round.goalSpec, spec);
    assert.equal('reservedCash' in round, false);
    assert.equal('plus' in round, false);
    assert.equal('entitlements' in round, false);
  });

  it('custom without spec falls back to Stay Afloat; presets drop a stale spec', () => {
    const spec = customSpec({ target: { kind: 'amount', dollars: 10000, bucket: 'liquid' } });
    const missing = normalizeHousehold({ ...previewHousehold(), jobClass: 'custom' });
    assert.equal(missing.jobClass, 'keep_house_car');
    assert.equal(missing.goalSpec, null);

    const preset = normalizeHousehold({ ...previewHousehold(), jobClass: 'debt_free', goalSpec: spec, openGoals: undefined });
    assert.equal(preset.jobClass, 'debt_free');
    assert.equal(preset.goalSpec, null);
    assert.equal(preset.openGoals?.[0]?.id, 'preset:debt_free');
  });
});

describe('open goals board', () => {
  it('preview elects Stay Afloat and Emergency Fund', () => {
    const seed = loadSeed();
    const h = previewHousehold();
    assert.ok((h.openGoals?.length ?? 0) >= 2);
    const board = openGoalBoard(h, seed, 'realistic');
    assert.ok(board.some((c) => c.jobClass === 'keep_house_car'));
    assert.ok(board.some((c) => c.jobClass === 'cash_buffer'));
    assert.ok(board.every((c) => c.headline.length > 0));
  });

  it('old books with only jobClass synthesize one open goal', () => {
    const h = previewHousehold();
    const round = normalizeHousehold({ ...h, jobClass: 'work_optional', openGoals: undefined, goalSpec: null });
    assert.equal(round.jobClass, 'work_optional');
    assert.equal(round.openGoals?.length, 1);
    assert.equal(round.openGoals?.[0]?.id, 'preset:work_optional');
  });

  it('without take-home pay, dates are a guess', () => {
    const h = previewHousehold();
    h.monthlyIncome = null;
    assert.match(intakeGap(h, 'keep_house_car') ?? '', /take-home/);
  });
});

describe('consumer calculator guards', () => {
  it('a blank APR on one named loan is a typical rate, not 0%', () => {
    const seed = loadSeed();
    const now = new Date().toISOString();
    const base = emptyRealHousehold('10001');
    base.housingTenure = 'rent';
    base.hasVehicle = false;
    base.monthlyIncome = 1600;
    base.expenses = [{ id: 'exp-rent', name: 'Rent', monthlyAmount: 1200, variable: false }];
    base.accounts = [
      { id: 'cash-1', type: 'cash', name: 'Cash', balance: 2000, lastEditedAt: now },
      { id: 'card-1', type: 'credit_card', name: 'Card', balance: 8000, minPayment: 200, apr: null, lastEditedAt: now },
    ];
    const spec = customSpec({
      name: 'Card gone',
      target: { kind: 'debt_zero', accountIds: ['card-1'] },
    });
    const blank = standing(withCustom(base, spec), seed, 'realistic');
    const zero = standing(
      withCustom(
        {
          ...base,
          accounts: base.accounts.map((a) => (a.id === 'card-1' ? { ...a, apr: 0 } : a)),
        },
        spec,
      ),
      seed,
      'realistic',
    );
    assert.ok(blank.hiredMonth != null && zero.hiredMonth != null);
    assert.ok((blank.hiredMonth ?? 0) > (zero.hiredMonth ?? 0));
  });

  it('a bad date override does not mark a dated goal as already hired', () => {
    const seed = loadSeed();
    const h = emptyRealHousehold('10001');
    h.housingTenure = 'rent';
    h.monthlyIncome = 4000;
    h.targetDate = 'soon';
    h.expenses = [{ id: 'exp-rent', name: 'Rent', monthlyAmount: 1500, variable: false }];
    const spec = customSpec({
      name: 'Trip',
      target: { kind: 'date', by: '2030-06-01' },
    });
    const view = standing(withCustom(h, spec), seed, 'realistic');
    assert.equal(view.hiredDate, '2030-06-01');
    assert.ok((view.hiredMonth ?? 0) > 0);
  });
});
