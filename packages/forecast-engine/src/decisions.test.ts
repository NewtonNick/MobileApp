import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { walkForecast } from './drivers';
import { monthlyRate } from './rates';
import {
  EMPTY_LAB,
  acceptPensionPair,
  acceptSocialPair,
  applyDecision,
  cappedRest,
  compareRank,
  crashShocks,
  otherGoalMonths,
  overlayApplies,
  rankDecisions,
  scoreDecisions,
  splitGrid,
  stressLeaders,
  type Decision,
  type RankRow,
} from './decisions';
import { emptyRealHousehold } from './preview';
import { annualSpendable, sequencedSpendable, standing } from './standing';
import type { SeedBundle } from './seed-types';
import type { HouseholdInput } from './types';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../../data/seed');
const now = '2026-09-29T00:00:00.000Z';

function loadSeed(): SeedBundle {
  return {
    home: JSON.parse(readFileSync(join(root, 'home_v1.json'), 'utf8')),
    vehicle: JSON.parse(readFileSync(join(root, 'vehicle_v1.json'), 'utf8')),
    macro: JSON.parse(readFileSync(join(root, 'macro_v1.json'), 'utf8')),
  };
}

function books(): HouseholdInput {
  const household = emptyRealHousehold('10001');
  household.monthlyIncome = 6000;
  household.jobClass = 'debt_free';
  household.housingTenure = 'rent';
  household.hasVehicle = false;
  household.expenses = [{ id: 'rent', name: 'Rent', monthlyAmount: 1500, variable: false }];
  household.accounts = [
    { id: 'cash', type: 'checking', name: 'Checking', balance: 4000, lastEditedAt: now },
    {
      id: 'car',
      type: 'auto_loan',
      name: 'Car',
      balance: 12000,
      apr: 0.1,
      minPayment: 150,
      lastEditedAt: now,
    },
  ];
  return household;
}

describe('decision lab', () => {
  const seed = loadSeed();

  it('extra to debt dates sooner than cash', () => {
    const household = books();
    const grid = splitGrid(household);
    const cash = grid.singles.find((decision) => decision.id === 'current');
    const debt = grid.singles.find((decision) => decision.surplusPolicy === 'debt' && decision.surplusLoanId === 'car');
    assert.ok(cash && debt);
    const ranked = rankDecisions(household, seed, 'realistic', [cash, debt]);
    const debtRow = ranked.find((row) => row.decision.id === debt.id);
    const cashRow = ranked.find((row) => row.decision.id === 'current');
    assert.ok(debtRow && cashRow);
    assert.ok(debtRow.hiredMonth != null && cashRow.hiredMonth != null);
    assert.ok(debtRow.hiredMonth < cashRow.hiredMonth);
  });

  it('a system delay moves only that system year', () => {
    const household = books();
    household.housingTenure = 'own';
    household.hasMortgage = false;
    household.assets = [
      {
        id: 'home',
        type: 'home',
        name: 'House',
        value: 300000,
        roofYear: 2018,
        hvacYear: 2016,
        lastEditedAt: now,
      },
    ];
    const grid = splitGrid(household);
    const roof = grid.singles.find((decision) => decision.shifts.roof === 5);
    assert.ok(roof);
    const next = applyDecision(household, roof);
    const home = next.assets.find((asset) => asset.id === 'home');
    assert.equal(home?.roofYear, 2023);
    assert.equal(home?.hvacYear, 2016);
  });

  it('a lump cannot exceed liquid cash and a brokerage lump raises basis one-for-one', () => {
    const household = books();
    household.accounts.push({
      id: 'brok',
      type: 'brokerage',
      name: 'Brokerage',
      balance: 0,
      lastEditedAt: now,
    });
    const tooBig = applyDecision(household, {
      ...splitGrid(household).singles[0],
      lump: { amount: 9000, destination: 'debt', loanId: 'car' },
    });
    const cash = tooBig.accounts.find((account) => account.id === 'cash');
    const loan = tooBig.accounts.find((account) => account.id === 'car');
    assert.equal(cash?.balance, 0);
    assert.equal(loan?.balance, 8000);

    const toBrokerage = applyDecision(household, {
      ...splitGrid(household).singles[0],
      lump: { amount: 1000, destination: 'brokerage', loanId: null },
    });
    const brokerage = toBrokerage.accounts.find((account) => account.id === 'brok');
    const basis = (toBrokerage.taxLots ?? [])
      .filter((lot) => lot.accountId === 'brok')
      .reduce((sum, lot) => sum + lot.costBasis, 0);
    assert.equal(brokerage?.balance, 1000);
    assert.equal(basis, 1000);
    assert.equal(toBrokerage.accounts.find((account) => account.id === 'cash')?.balance, 3000);
  });

  it('paid-monthly cards are not lump targets', () => {
    const household = books();
    household.accounts.push({
      id: 'card',
      type: 'credit_card',
      name: 'Card',
      balance: 400,
      payoffStyle: 'paid_monthly',
      lastEditedAt: now,
    });
    const grid = splitGrid(household, { ...EMPTY_LAB, lumpAmount: 500 });
    assert.equal(
      grid.singles.some((decision) => decision.lump?.loanId === 'card'),
      false,
    );
  });

  it('downsize is refused without a value, and a mortgage downsize needs a loan choice', () => {
    const household = books();
    household.housingTenure = 'own';
    household.assets = [{ id: 'home', type: 'home', name: 'House', value: null, roofYear: 2010, lastEditedAt: now }];
    assert.equal(
      splitGrid(household).singles.some((decision) => decision.zMove === 'downsize'),
      false,
    );
    household.assets[0].value = 200000;
    household.accounts.push({
      id: 'mtg',
      type: 'mortgage',
      name: 'Mortgage',
      balance: 100000,
      minPayment: 800,
      apr: 0.06,
      lastEditedAt: now,
    });
    const bare = splitGrid(household).singles[0];
    const refused = applyDecision(household, { ...bare, zMove: 'downsize', downsizeLoanChoice: null });
    assert.equal(refused.assets[0].value, 200000);
    const choices = splitGrid(household).singles.filter((decision) => decision.zMove === 'downsize');
    assert.ok(choices.every((decision) => decision.downsizeLoanChoice != null));
  });

  it('two loans produce one debt-target row each, and smallest balance is paid before a higher rate', () => {
    const household = books();
    household.accounts.push({
      id: 'card',
      type: 'credit_card',
      name: 'Card',
      balance: 400,
      apr: 0.02,
      minPayment: 25,
      lastEditedAt: now,
    });
    const targets = splitGrid(household).singles.filter((decision) => decision.surplusPolicy === 'debt');
    assert.ok(targets.some((decision) => decision.surplusLoanId === 'car'));
    assert.ok(targets.some((decision) => decision.surplusLoanId === 'card'));

    const base = splitGrid(household).singles[0];
    const snowball = applyDecision(household, {
      ...base,
      surplusPolicy: 'debt',
      debtOrder: 'smallest_balance',
      surplusLoanId: null,
    });
    const avalanche = applyDecision(household, {
      ...base,
      surplusPolicy: 'debt',
      debtOrder: 'highest_rate',
      surplusLoanId: null,
    });
    const snowCard = watchedBalance(snowball, seed, 'card');
    const avaCard = watchedBalance(avalanche, seed, 'card');
    assert.ok(snowCard < avaCard);
  });

  it('twelve months of living reserves more than three', () => {
    const household = books();
    household.jobClass = 'cash_buffer';
    household.bufferMonths = 3;
    const thin = standing({ ...household, bufferMonths: 3 }, seed, 'realistic', 'cash_buffer');
    const thick = standing({ ...household, bufferMonths: 12 }, seed, 'realistic', 'cash_buffer');
    assert.ok(thick.reserved > thin.reserved);
    const grid = splitGrid(household);
    const current = grid.singles.find((decision) => decision.id === 'current');
    assert.equal(current?.bufferMonths, 3);
  });

  it('a Social Security age is scored only with the check typed for that age', () => {
    assert.equal(acceptSocialPair({ startAge: 61, monthlyAmount: 2000 }), false);
    assert.equal(acceptSocialPair({ startAge: 71, monthlyAmount: 2000 }), false);
    assert.equal(acceptSocialPair({ startAge: 67, monthlyAmount: 1800 }), true);
    const household = books();
    household.socialSecurity = { monthlyAmount: 2000, startAge: 67 };
    const missing = splitGrid(household, { ...EMPTY_LAB, socialPairs: [{ startAge: 62, monthlyAmount: 0 }] });
    assert.equal(
      missing.singles.some((decision) => decision.socialSecurity != null),
      false,
    );
    const grid = splitGrid(household, { ...EMPTY_LAB, socialPairs: [{ startAge: 62, monthlyAmount: 1400 }] });
    const early = grid.singles.find((decision) => decision.socialSecurity?.startAge === 62);
    assert.ok(early);
    const next = applyDecision(household, early);
    assert.equal(next.socialSecurity?.monthlyAmount, 1400);
    assert.equal(next.socialSecurity?.startAge, 62);
  });

  it('car replace, partner pay, and refinance stay out until the lab types them', () => {
    const household = books();
    household.assets = [
      { id: 'car-asset', type: 'vehicle', name: 'Civic', value: 12000, vehicleYear: 2014, lastEditedAt: now },
    ];
    household.hasVehicle = true;
    const quiet = splitGrid(household, { ...EMPTY_LAB, partnerToZero: true });
    assert.equal(
      quiet.singles.some((decision) => decision.car != null || decision.pay != null || decision.refinance != null),
      false,
    );
    const refinance = applyDecision(household, {
      ...quiet.singles[0],
      refinance: { loanId: 'car', apr: Number.NaN, minPayment: 200 },
    });
    assert.equal(refinance.accounts.find((account) => account.id === 'car')?.apr, 0.1);
    assert.equal(acceptPensionPair({ startAge: 60, monthlyAmount: 900 }), true);
  });

  it('the blended withdrawal matches today, and a sequenced draw changes the taxed amount', () => {
    const blended = annualSpendable(10000, 10000, 0, 0.04, null, null);
    const sequenced = sequencedSpendable(10000, 10000, 0, 0.04, null, ['roth', 'traditional'], null);
    assert.equal(sequenced, blended);
    const taxedBlend = annualSpendable(10000, 10000, 0, 0.04, 0.25, null);
    const rothFirst = sequencedSpendable(10000, 10000, 0, 0.04, 0.25, ['roth', 'traditional'], null);
    assert.ok(rothFirst > taxedBlend);
  });

  it('missing income leaves every row undated and leftover breaks the tie', () => {
    const household = books();
    household.monthlyIncome = null;
    household.jobClass = 'cash_buffer';
    household.accounts[0].balance = 20000;
    const grid = splitGrid(household);
    const thin = grid.singles.find((decision) => decision.bufferMonths === 3);
    const thick = grid.singles.find((decision) => decision.bufferMonths === 12);
    assert.ok(thin && thick);
    const ranked = rankDecisions(household, seed, 'realistic', [thin, thick]);
    assert.equal(ranked[0].hiredMonth, null);
    assert.equal(ranked[1].hiredMonth, null);
    assert.equal(ranked[0].decision.bufferMonths, 3);
    assert.ok(ranked[0].leftover > ranked[1].leftover);
  });

  it('a renter grid has no house axis', () => {
    const grid = splitGrid(books());
    assert.equal(
      grid.singles.some((decision) => decision.zMove !== 'keep' || decision.shifts.roof !== 0),
      false,
    );
  });

  it('crash shocks use the cited housing crash and the macro jump, then the user return', () => {
    const shocks = crashShocks(seed);
    const crash = seed.home.hpiCrashAnnual.realistic;
    assert.equal(shocks.hpiMonthlyReturn(1, 0.04), monthlyRate(crash));
    assert.equal(shocks.hpiMonthlyReturn(18, 0.04), monthlyRate(crash));
    assert.equal(shocks.hpiMonthlyReturn(19, 0.04), monthlyRate(0.04));
    assert.equal(shocks.investmentMonthlyReturn(1, 0.07), monthlyRate(0.07) + seed.macro.crashJump);
    assert.equal(shocks.investmentMonthlyReturn(2, 0.07), monthlyRate(0.07));
  });

  it('overlay stress skips a home-price crash when there is no house', () => {
    const household = books();
    assert.equal(overlayApplies(household, 'hpi_crash'), false);
    const grid = splitGrid(household);
    const current = grid.singles.find((decision) => decision.id === 'current');
    const debt = grid.singles.find((decision) => decision.surplusPolicy === 'debt');
    assert.ok(current && debt);
    const report = stressLeaders(household, seed, rankDecisions(household, seed, 'realistic', [current, debt]));
    assert.equal(
      report.reversed.some((stretch) => stretch.id === 'hpi_crash'),
      false,
    );
    assert.ok(report.stretchCount >= 2);
    assert.ok(report.holdCount <= report.stretchCount);
  });

  it('other elected goals are reported beside the winner and do not change the sort', () => {
    const left: RankRow = {
      decision: { id: 'b', changedAxes: ['cushion'] } as Decision,
      hiredMonth: 10,
      leftover: 100,
      reserved: 1,
      collisionMonth: null,
      monthGap: 0,
      otherGoals: [{ name: 'Debt free', hiredMonth: 4 }],
      sentence: '',
    };
    const right: RankRow = {
      ...left,
      decision: { ...left.decision, id: 'a' },
      otherGoals: [{ name: 'Retire early', hiredMonth: 80 }],
    };
    assert.ok(compareRank(right, left) < 0);
    const household = books();
    household.jobClass = 'debt_free';
    household.openGoals = [
      {
        id: 'preset:debt_free',
        name: 'Debt free',
        source: 'preset',
        target: { kind: 'debt_zero' },
        reserved: 'ownership',
      },
      {
        id: 'preset:cash_buffer',
        name: 'Emergency fund',
        source: 'preset',
        target: { kind: 'runway', months: 3 },
        reserved: 'n_months_living',
      },
    ];
    const beside = otherGoalMonths(household, seed, 'realistic');
    assert.ok(beside.some((goal) => goal.name === 'Emergency fund'));
    assert.equal(
      beside.some((goal) => goal.name === 'Debt free'),
      false,
    );
  });

  it('a product over the cap keeps every single and can combine the earliest singles', () => {
    const household = books();
    household.housingTenure = 'own';
    household.hasMortgage = true;
    household.assets = [
      {
        id: 'home',
        type: 'home',
        name: 'House',
        value: 300000,
        roofYear: 2010,
        hvacYear: 2012,
        waterHeaterYear: 2014,
        lastEditedAt: now,
      },
    ];
    household.accounts.push(
      { id: 'mtg', type: 'mortgage', name: 'Mortgage', balance: 180000, apr: 0.06, minPayment: 1100, lastEditedAt: now },
      { id: 'card', type: 'credit_card', name: 'Card', balance: 2000, apr: 0.18, minPayment: 60, lastEditedAt: now },
      { id: 'student', type: 'student_loan', name: 'School', balance: 9000, apr: 0.05, minPayment: 80, lastEditedAt: now },
    );
    const grid = splitGrid(household);
    assert.equal(grid.capped, true);
    assert.equal(grid.rest.length, 0);
    assert.ok(grid.singles.some((decision) => decision.shifts.roof === 5));
    assert.ok(grid.singles.every((decision) => decision.changedAxes.length <= 1));
    const scored = grid.singles.map((decision) => {
      const row = {
        decision,
        hiredMonth: decision.id === 'current' ? 40 : 30,
        leftover: 10,
        reserved: 1,
        collisionMonth: null,
        monthGap: 0,
        otherGoals: [],
        sentence: '',
      };
      if (decision.shifts.roof === 5) row.hiredMonth = 5;
      if (decision.bufferMonths === 12) row.hiredMonth = 6;
      return row;
    });
    const rest = cappedRest(household, EMPTY_LAB, scored);
    assert.ok(rest.some((decision) => decision.shifts.roof === 5 && decision.bufferMonths === 12));
    assert.ok(grid.singles.length + rest.length <= 1500);
  });

  it('chunked scoring matches a one-shot ranking', () => {
    const household = books();
    const grid = splitGrid(household);
    const all = [...grid.singles, ...grid.rest];
    const once = rankDecisions(household, seed, 'realistic', all);
    const chunks: RankRow[] = [];
    for (let index = 0; index < all.length; index += 5) {
      chunks.push(...scoreDecisions(household, seed, 'realistic', all.slice(index, index + 5)));
    }
    const chunked = chunks.sort(compareRank);
    assert.deepEqual(
      chunked.map((row) => row.decision.id),
      once.map((row) => row.decision.id),
    );
  });
});

function watchedBalance(household: HouseholdInput, seed: SeedBundle, accountId: string): number {
  const walked = walkForecast(household, seed, 'realistic', { horizonMonths: 1, watchAccountId: accountId });
  return walked.watchedBalances?.[0] ?? 0;
}
