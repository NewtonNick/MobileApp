import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { incomeForMonth } from './cadence';
import { findDuplicateGuesses, findOwnershipDuplicateGuesses, monthlyOutflows } from './debt';
import { walkForecast } from './drivers';
import { expenseMonth, plannedEvents, reservedFromHits, runForecast } from './engine';
import { presetGoalSpec, setEmergencyBuffer } from './goals';
import { nextBest } from './jobs';
import { emptyRealHousehold, normalizeHousehold, previewHousehold } from './preview';
import { parsePercentInput, readPercentInput } from './rates';
import { applyZMove, compareSequence, projectZMove } from './sequence';
import { annualSpendable, standing } from './standing';
import { calendarFromMonthOffset, forecastMonthLabel, hiredDateMoveLine, monthOffsetFromCalendar } from './calendar';
import { formatMoneyDraft, parseMileage, parseMoney, parseYear } from './validate';
import type { HouseholdInput } from './types';
import type { SeedBundle } from './seed-types';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../../data/seed');

function loadSeed(): SeedBundle {
  return {
    home: JSON.parse(readFileSync(join(root, 'home_v1.json'), 'utf8')),
    vehicle: JSON.parse(readFileSync(join(root, 'vehicle_v1.json'), 'utf8')),
    macro: JSON.parse(readFileSync(join(root, 'macro_v1.json'), 'utf8')),
  };
}

function base(now = new Date().toISOString()): HouseholdInput {
  const h = emptyRealHousehold('10001');
  h.housingTenure = 'own';
  h.hasVehicle = false;
  h.hasMortgage = false;
  h.monthlyIncome = 6000;
  h.paycheckCadence = 'monthly';
  h.expenses = [{ id: 'exp-living', name: 'Living', monthlyAmount: 3000, variable: false }];
  h.accounts = [{ id: 'cash-1', type: 'cash', name: 'Cash', balance: 20000, lastEditedAt: now }];
  return h;
}

describe('consumer gaps', () => {
  it('treats 7 as 7% and holds 0.07 until confirmed', () => {
    assert.equal(parsePercentInput('7'), 0.07);
    assert.equal(parsePercentInput('0.07'), null);
    assert.equal(parsePercentInput('120'), null);
    const ambiguous = readPercentInput('0.07');
    assert.equal(ambiguous.status, 'ambiguous');
    const rejected = readPercentInput('120');
    assert.equal(rejected.status, 'rejected');
  });

  it('rejects negative pay, a roof year of 12, and a huge mileage', () => {
    assert.equal(parseMoney('-200'), null);
    assert.equal(parseMoney('10.50'), 10.5);
    assert.equal(parseMoney('$4,200'), 4200);
    assert.equal(parseMoney('4,200.50'), 4200.5);
    assert.equal(parseMoney('$ 1,200'), 1200);
    assert.equal(formatMoneyDraft(4200), '4,200');
    assert.equal(formatMoneyDraft(10.5), '10.50');
    const september = new Date(2026, 8, 27);
    assert.equal(forecastMonthLabel(1, september), 'Sep 2026');
    assert.equal(forecastMonthLabel(2, september), 'Oct 2026');
    assert.equal(monthOffsetFromCalendar(2026, 8, september), 1);
    assert.deepEqual(calendarFromMonthOffset(1, september), { year: 2026, monthIndex: 8 });
    assert.equal(
      hiredDateMoveLine('Retire early', '2034-06-01', 'Retire early', '2034-08-01'),
      'Retire early moved from Jun 2034 to Aug 2034.',
    );
    assert.equal(hiredDateMoveLine('Retire early', '2034-06-01', 'Retire early', '2034-06-01'), 'Retire early stays Jun 2034.');
    assert.equal(
      hiredDateMoveLine('Retire early', '2034-06-01', 'Debt Free', null),
      'Debt Free is now the featured goal, and it is not dated yet.',
    );
    assert.equal(parseYear('12'), null);
    assert.equal(parseYear('2014'), 2014);
    assert.equal(parseMileage('1000000000'), null);
    assert.equal(parseMileage('72000'), 72000);
  });

  it('asks for a missing Social Security start age before later questions', () => {
    const h = previewHousehold();
    h.socialSecurity = { monthlyAmount: 1800, startAge: null };
    assert.equal(nextBest(h)?.key, 'ss_age');
  });

  it('asks which month a yearly bonus is paid', () => {
    const h = previewHousehold();
    h.extraIncomes = [{ id: 'bonus', name: 'Bonus', amount: 1000, schedule: 'annual', monthOfYear: null }];
    assert.equal(nextBest(h)?.key, 'extra_month');
  });

  it('remembers a skipped roof question', () => {
    const h = previewHousehold();
    h.assets[0].roofYear = null;
    h.assets[0].hvacYear = 2010;
    assert.equal(nextBest(h)?.key, 'roof');
    h.skippedQuestions = ['roof'];
    assert.notEqual(nextBest(h)?.key, 'roof');
  });

  it('switches the emergency fund from 3 months to 6', () => {
    const seed = loadSeed();
    const h = base();
    h.jobClass = 'cash_buffer';
    h.openGoals = undefined;
    const three = standing(setEmergencyBuffer(h, 3), seed, 'realistic', 'cash_buffer');
    const six = standing(setEmergencyBuffer(h, 6), seed, 'realistic', 'cash_buffer');
    assert.ok(six.reserved > three.reserved);
    assert.match(six.sentence, /6 months/);
  });

  it('does not downsize a mortgaged house until the user chooses the loan', () => {
    const now = new Date().toISOString();
    const h = base(now);
    h.assets = [{ id: 'home-1', type: 'home', name: 'House', value: 400000, lastEditedAt: now }];
    h.accounts.push({
      id: 'mtg',
      type: 'mortgage',
      name: 'Mortgage',
      balance: 300000,
      minPayment: 1800,
      apr: 0.06,
      lastEditedAt: now,
    });
    const silent = applyZMove(h, 'downsize');
    assert.equal(silent.assets[0].value, 400000);
    assert.equal(silent.accounts.find((a) => a.id === 'mtg')?.balance, 300000);
    const kept = applyZMove(h, 'downsize', 'keep_loan');
    assert.equal(kept.assets[0].value, 280000);
    assert.equal(kept.accounts.find((a) => a.id === 'mtg')?.balance, 300000);
    const paid = applyZMove(h, 'downsize', 'pay_down');
    assert.equal(paid.assets[0].value, 280000);
    assert.ok((paid.accounts.find((a) => a.id === 'mtg')?.balance ?? 0) < 300000);
    assert.equal(projectZMove(h, 'delay_replace').applied, false);
  });

  it('anchors biweekly pay on a Friday and still matches annual take-home', () => {
    const now = new Date(2026, 0, 15);
    let sum = 0;
    let sawThree = false;
    for (let m = 1; m <= 12; m++) {
      const amount = incomeForMonth(4000, 'biweekly', m, '2026-01-02', now);
      sum += amount;
      const checks = Math.round(amount / ((4000 * 12) / 26));
      if (checks >= 3) sawThree = true;
    }
    assert.ok(Math.abs(sum - 4000 * 12) < 1);
    assert.equal(sawThree, true);
    const january = new Date(2026, 0, 15);
    assert.ok(incomeForMonth(4000, 'biweekly', 3, null, january) > incomeForMonth(4000, 'biweekly', 1, null, january));
  });

  it('pays a mortgage on principal after escrow, and escrow still leaves cash', () => {
    const seed = loadSeed();
    const h = base();
    h.hasMortgage = true;
    h.accounts.push({
      id: 'mtg',
      type: 'mortgage',
      name: 'Mortgage',
      balance: 200000,
      minPayment: 1800,
      escrowMonthly: 600,
      apr: 0.06,
      lastEditedAt: new Date().toISOString(),
    });
    const split = walkForecast(h, seed, 'realistic', { horizonMonths: 2 });
    h.accounts[1].escrowMonthly = null;
    const whole = walkForecast(h, seed, 'realistic', { horizonMonths: 2 });
    assert.ok(split.months[0].liabilities > whole.months[0].liabilities);
    assert.ok(split.months[0].cash < split.months[0].cash + 1);
    const principalOnly = walkForecast(
      {
        ...h,
        accounts: h.accounts.map((account) =>
          account.id === 'mtg' ? { ...account, minPayment: 1200, escrowMonthly: null } : account,
        ),
      },
      seed,
      'realistic',
      { horizonMonths: 2 },
    );
    assert.ok(principalOnly.months[0].cash - split.months[0].cash > 400);
  });

  it('does not amortize a card that is paid monthly', () => {
    const seed = loadSeed();
    const h = base();
    h.accounts.push({
      id: 'card',
      type: 'credit_card',
      name: 'Card',
      balance: 2000,
      minPayment: 40,
      apr: 0.22,
      payoffStyle: 'paid_monthly',
      lastEditedAt: new Date().toISOString(),
    });
    const paid = runForecast(h, seed, 'realistic');
    h.accounts[1].payoffStyle = 'revolving';
    const revolving = runForecast(h, seed, 'realistic');
    assert.ok(paid.months[11].liabilities < revolving.months[11].liabilities);
    assert.ok(paid.months[2].liabilities < 1);
  });

  it('keeps interest on a loan that outlasts month 60', () => {
    const seed = loadSeed();
    const h = base();
    h.jobClass = 'debt_free';
    h.monthlyIncome = 2500;
    h.expenses = [{ id: 'exp-living', name: 'Living', monthlyAmount: 2000, variable: false }];
    h.accounts.push({
      id: 'loan',
      type: 'other_liability',
      name: 'Loan',
      balance: 20000,
      minPayment: 250,
      apr: 0.1,
      lastEditedAt: new Date().toISOString(),
    });
    const dated = standing(h, seed, 'realistic', 'debt_free');
    const straight = Math.ceil(20000 / 250);
    assert.ok(dated.hiredMonth != null && dated.hiredMonth > 60 && dated.hiredMonth > straight);
  });

  it('drops cash when a known roof replacement lands after year 5', () => {
    const seed = loadSeed();
    const nowYear = new Date().getFullYear();
    const h = base();
    h.assets = [
      {
        id: 'home-1',
        type: 'home',
        name: 'House',
        value: 400000,
        roofYear: nowYear - 19,
        hvacYear: nowYear,
        waterHeaterYear: nowYear,
        lastEditedAt: new Date().toISOString(),
      },
    ];
    const events = plannedEvents(h, seed, 'realistic');
    const roof = events.find((event) => event.key.endsWith(':roof'));
    assert.equal(roof?.month, 72);
    const before = walkForecast(h, seed, 'realistic', { horizonMonths: 80 });
    const quiet = before.months[70].cash;
    const hit = before.months[71].cash;
    assert.ok(quiet - hit > 5000);
    h.assets[0].roofYear = nowYear - 24;
    const near = reservedFromHits(plannedEvents(h, seed, 'conservative'));
    h.realizedEventKeys = [`home:home-1:roof`];
    const cleared = reservedFromHits(plannedEvents(h, seed, 'conservative'));
    assert.ok(near > cleared);
  });

  it('adds a 401k contribution and match without raising take-home', () => {
    const seed = loadSeed();
    const h = base();
    h.monthlyIncome = 5000;
    h.expenses = [{ id: 'exp-living', name: 'Living', monthlyAmount: 5000, variable: false }];
    h.accounts.push({
      id: '401k',
      type: 'retirement_401k',
      name: '401k',
      balance: 0,
      expectedReturn: 0,
      employeeContributionMonthly: 500,
      employerMatchPercent: 0.5,
      lastEditedAt: new Date().toISOString(),
    });
    const walked = walkForecast(h, seed, 'realistic', { horizonMonths: 1 });
    assert.ok(walked.months[0].investments > 730 && walked.months[0].investments < 760);
    assert.ok(walked.months[0].cash < 20000 + 100);
  });

  it('uses one surplus path for the retire date and the chart', () => {
    const seed = loadSeed();
    const nowYear = new Date().getFullYear();
    const h = base();
    h.jobClass = 'work_optional';
    h.fireFlavor = 'standard';
    h.surplusPolicy = 'retirement';
    h.monthlyIncome = 4000;
    h.expenses = [{ id: 'exp-living', name: 'Living', monthlyAmount: 3500, variable: false }];
    h.assets = [
      {
        id: 'home-1',
        type: 'home',
        name: 'House',
        value: 300000,
        roofYear: nowYear - 19,
        lastEditedAt: new Date().toISOString(),
      },
    ];
    h.accounts.push({
      id: '401k',
      type: 'retirement_401k',
      name: '401k',
      balance: 50000,
      expectedReturn: 0.05,
      lastEditedAt: new Date().toISOString(),
    });
    const dated = standing(h, seed, 'realistic', 'work_optional');
    const walked = walkForecast(h, seed, 'realistic', { horizonMonths: 360 });
    const events = plannedEvents(h, seed, 'realistic');
    const ownership = events.filter((event) => event.month === -1).reduce((sum, event) => sum + event.cost * 12, 0);
    let crossed: number | null = null;
    for (const point of walked.months) {
      const need = point.livingExpenses * 12 + ownership;
      const spendable = annualSpendable(point.traditional, point.roth, point.brokerage, 0.04, null);
      if (spendable >= need) {
        crossed = point.month;
        break;
      }
    }
    assert.equal(dated.hiredMonth, crossed);
    h.fireFlavor = 'coast';
    const coast = walkForecast(h, seed, 'realistic', { horizonMonths: 12 });
    const saving = walkForecast({ ...h, fireFlavor: 'standard' }, seed, 'realistic', { horizonMonths: 12 });
    assert.ok(coast.months[11].investments < saving.months[11].investments);
  });

  it('lets a planned raise and a March bonus hit the base path', () => {
    const seed = loadSeed();
    const now = new Date(2026, 0, 15);
    const h = base();
    h.monthlyIncome = 5000;
    h.plannedRaiseMonth = 12;
    h.plannedRaisePercent = 0.1;
    const raised = walkForecast(h, seed, 'realistic', { horizonMonths: 14, now });
    assert.ok(raised.months[11].income > raised.months[0].income * 1.05);
    h.plannedRaiseMonth = null;
    h.plannedRaisePercent = null;
    h.monthlyIncome = 0;
    h.extraIncomes = [{ id: 'bonus', name: 'Bonus', amount: 6000, schedule: 'annual', monthOfYear: 3 }];
    const bonus = walkForecast(h, seed, 'realistic', { horizonMonths: 4, now });
    assert.ok(bonus.months[2].income > 5000);
    assert.ok(bonus.months[0].income < 1);
    assert.ok(bonus.months[1].income < 1);
  });

  it('ends childcare and moves the retire date when spending falls', () => {
    const seed = loadSeed();
    const h = base();
    h.jobClass = 'work_optional';
    h.surplusPolicy = 'retirement';
    h.monthlyIncome = 8000;
    h.expenses = [
      { id: 'exp-living', name: 'Living', monthlyAmount: 3000, variable: false },
      { id: 'care', name: 'Childcare', monthlyAmount: 1500, variable: false, endMonth: 48 },
    ];
    h.accounts.push({
      id: '401k',
      type: 'retirement_401k',
      name: '401k',
      balance: 200000,
      expectedReturn: 0.06,
      lastEditedAt: new Date().toISOString(),
    });
    const walked = walkForecast(h, seed, 'realistic', { horizonMonths: 50 });
    assert.ok(walked.months[47].livingExpenses > walked.months[48].livingExpenses + 1000);
    const withCare = standing(h, seed, 'realistic', 'work_optional');
    h.expenses = h.expenses.filter((e) => e.id !== 'care');
    const without = standing(h, seed, 'realistic', 'work_optional');
    assert.ok(without.hiredMonth != null && withCare.hiredMonth != null);
    assert.ok(without.hiredMonth <= withCare.hiredMonth);
  });

  it('taxes traditional withdrawals and leaves Roth alone', () => {
    const seed = loadSeed();
    const h = base();
    h.jobClass = 'work_optional';
    h.monthlyIncome = 1000;
    h.expenses = [{ id: 'exp-living', name: 'Living', monthlyAmount: 3000, variable: false }];
    h.withdrawalTaxRate = 0.2;
    h.accounts.push({
      id: '401k',
      type: 'retirement_401k',
      name: '401k',
      balance: 900000,
      expectedReturn: 0.04,
      taxTreatment: 'traditional',
      lastEditedAt: new Date().toISOString(),
    });
    const traditional = standing(h, seed, 'realistic', 'work_optional');
    h.accounts[1].taxTreatment = 'roth';
    const roth = standing(h, seed, 'realistic', 'work_optional');
    assert.ok(roth.hiredMonth != null && traditional.hiredMonth != null);
    assert.ok(roth.hiredMonth < traditional.hiredMonth);
  });

  it('stops a student loan at forgiveness', () => {
    const seed = loadSeed();
    const h = base();
    h.accounts.push({
      id: 'stu',
      type: 'student_loan',
      name: 'Student',
      balance: 80000,
      minPayment: 200,
      apr: 0.06,
      forgivenessMonth: 120,
      lastEditedAt: new Date().toISOString(),
    });
    const forgiven = walkForecast(h, seed, 'realistic', { horizonMonths: 130 });
    assert.ok(forgiven.months[119].liabilities < 1);
    h.accounts[1].forgivenessMonth = null;
    const open = walkForecast(h, seed, 'realistic', { horizonMonths: 130 });
    assert.ok(open.months[119].liabilities > 1000);
  });

  it('counts insurance once when the expense is the same bill', () => {
    const h = base();
    h.assets = [
      {
        id: 'home-1',
        type: 'home',
        name: 'House',
        value: 400000,
        insuranceMonthly: 200,
        lastEditedAt: new Date().toISOString(),
      },
    ];
    h.expenses.push({ id: 'ins', name: 'Insurance', monthlyAmount: 200, variable: false });
    const guesses = findOwnershipDuplicateGuesses(h.expenses, h.assets);
    assert.equal(guesses.length, 1);
    h.expenses[1].linkedAssetKey = guesses[0].lineKey;
    const once = monthlyOutflows(h.expenses, h.accounts);
    const twice = monthlyOutflows(
      h.expenses.map((e) => ({ ...e, linkedAssetKey: null })),
      h.accounts,
    );
    assert.ok(once < twice);
    assert.equal(findDuplicateGuesses(h.expenses, h.accounts).length >= 0, true);
  });

  it('matches debt-first payoff to the forecast path', () => {
    const seed = loadSeed();
    const h = base();
    h.jobClass = 'debt_free';
    h.surplusPolicy = 'debt';
    h.monthlyIncome = 7000;
    h.expenses = [{ id: 'exp-living', name: 'Living', monthlyAmount: 2000, variable: false }];
    h.accounts.push({
      id: 'card',
      type: 'credit_card',
      name: 'Card',
      balance: 4000,
      minPayment: 100,
      apr: 0.22,
      lastEditedAt: new Date().toISOString(),
    });
    const lab = compareSequence(h, seed, 'realistic');
    const walked = walkForecast({ ...h, surplusPolicy: 'debt' }, seed, 'realistic', { horizonMonths: 360 });
    const zero = walked.months.find((month) => month.liabilities <= 0.5)?.month ?? null;
    assert.equal(lab.debtFirst.hiredMonth, zero);
    assert.ok(lab.extraMonthly > 0);
    assert.equal(lab.targetLoanName, 'Card');
  });

  it('moves the retire date earlier when Social Security is typed', () => {
    const seed = loadSeed();
    const h = base();
    h.jobClass = 'work_optional';
    h.surplusPolicy = 'cash';
    h.currentAge = 60;
    h.monthlyIncome = 2000;
    h.expenses = [{ id: 'exp-living', name: 'Living', monthlyAmount: 4000, variable: false }];
    h.accounts.push({
      id: '401k',
      type: 'retirement_401k',
      name: '401k',
      balance: 700000,
      expectedReturn: 0.05,
      taxTreatment: 'roth',
      lastEditedAt: new Date().toISOString(),
    });
    const blank = standing(h, seed, 'realistic', 'work_optional');
    h.socialSecurity = { monthlyAmount: 2000, startAge: 67 };
    const withBenefit = standing(h, seed, 'realistic', 'work_optional');
    assert.match(blank.sentence, /Benefits are not included/);
    assert.ok(blank.hiredMonth != null && withBenefit.hiredMonth != null);
    assert.ok(withBenefit.hiredMonth < blank.hiredMonth);
  });

  it('keeps a second vehicle when books add one', () => {
    const h = previewHousehold();
    const first = h.assets.find((asset) => asset.type === 'vehicle');
    h.assets = [
      ...h.assets,
      {
        id: 'car-2',
        type: 'vehicle',
        name: 'Second',
        value: 9000,
        vehicleClass: 'car',
        lastEditedAt: new Date().toISOString(),
      },
    ];
    const round = normalizeHousehold(h);
    assert.equal(round.assets.filter((asset) => asset.type === 'vehicle').length, 2);
    assert.ok(round.assets.some((asset) => asset.id === first?.id));
    assert.equal(expenseMonth(round, 'realistic') >= 0, true);
  });

  it('keeps a hired-date override on the focused goal only', () => {
    const seed = loadSeed();
    const h = base();
    h.jobClass = 'cash_buffer';
    h.openGoals = [presetGoalSpec(h, 'cash_buffer'), presetGoalSpec(h, 'debt_free')];
    h.targetDate = '2031-06-15';
    h.accounts.push({
      id: 'loan',
      type: 'other_liability',
      name: 'Loan',
      balance: 5000,
      minPayment: 100,
      apr: 0.08,
      lastEditedAt: new Date().toISOString(),
    });
    const focused = standing(h, seed, 'realistic', 'cash_buffer');
    const other = standing(h, seed, 'realistic', 'debt_free', { spec: presetGoalSpec(h, 'debt_free') });
    assert.equal(focused.hiredDate, '2031-06-15');
    assert.notEqual(other.hiredDate, '2031-06-15');
  });

  it('treats a full emergency fund as on track now and can date cash past month 60', () => {
    const seed = loadSeed();
    const h = base();
    h.jobClass = 'cash_buffer';
    const first = standing(h, seed, 'realistic', 'cash_buffer');
    h.accounts[0].balance = first.reserved;
    const exact = standing(h, seed, 'realistic', 'cash_buffer');
    assert.equal(exact.hiredMonth, 0);
    h.accounts[0].balance = 100;
    h.monthlyIncome = 4000;
    h.expenses = [{ id: 'exp-living', name: 'Living', monthlyAmount: 3900, variable: false }];
    h.surplusPolicy = 'cash';
    const spec = {
      id: 'pad',
      name: 'Pad',
      source: 'custom' as const,
      target: { kind: 'amount' as const, dollars: 20000, bucket: 'liquid' as const },
      reserved: 'none' as const,
    };
    h.jobClass = 'custom';
    h.goalSpec = spec;
    const later = standing(h, seed, 'realistic', 'custom', { spec });
    assert.ok((later.hiredMonth ?? 0) > 60);
  });

  it('does not count Social Security until an age is known', () => {
    const seed = loadSeed();
    const h = base();
    h.jobClass = 'work_optional';
    h.currentAge = null;
    h.birthYear = null;
    h.socialSecurity = { monthlyAmount: 2000, startAge: 67 };
    const view = standing(h, seed, 'realistic', 'work_optional');
    assert.match(view.sentence, /add your age/i);
  });

  it('stops new 401k contributions on coast', () => {
    const seed = loadSeed();
    const h = base();
    h.fireFlavor = 'coast';
    h.accounts.push({
      id: '401k',
      type: 'retirement_401k',
      name: '401k',
      balance: 10000,
      expectedReturn: 0,
      employeeContributionMonthly: 500,
      employerMatchPercent: 1,
      lastEditedAt: new Date().toISOString(),
    });
    const coast = walkForecast(h, seed, 'realistic', { horizonMonths: 2 });
    const standard = walkForecast({ ...h, fireFlavor: 'standard' }, seed, 'realistic', { horizonMonths: 2 });
    assert.ok(coast.months[0].investments < 11000);
    assert.ok(standard.months[0].investments > coast.months[0].investments + 400);
  });

  it('keeps charging a card that is paid in full each month', () => {
    const seed = loadSeed();
    const h = base();
    h.accounts.push({
      id: 'card',
      type: 'credit_card',
      name: 'Card',
      balance: 2000,
      minPayment: 40,
      apr: 0.22,
      payoffStyle: 'paid_monthly',
      typicalMonthlySpend: 2000,
      lastEditedAt: new Date().toISOString(),
    });
    const paid = walkForecast(h, seed, 'realistic', { horizonMonths: 4 });
    const plain = walkForecast(base(), seed, 'realistic', { horizonMonths: 4 });
    assert.ok(paid.months[2].liabilities < 1);
    assert.ok(paid.months[2].livingExpenses > plain.months[2].livingExpenses + 1500);
  });

  it('asks when car insurance is only an estimate and an expense uses the same name', () => {
    const h = base();
    h.hasVehicle = true;
    h.assets = [
      {
        id: 'car-1',
        type: 'vehicle',
        name: 'Car',
        value: 12000,
        vehicleClass: 'car',
        lastEditedAt: new Date().toISOString(),
      },
    ];
    h.expenses.push({ id: 'ins', name: 'Car insurance', monthlyAmount: 180, variable: false });
    const guesses = findOwnershipDuplicateGuesses(h.expenses, h.assets);
    assert.equal(guesses.length, 1);
    assert.equal(guesses[0].lineKey, 'vehicle:car-1:insurance');
  });

  it('does not bill house tax again when escrow already covers it', () => {
    const seed = loadSeed();
    const h = base();
    h.assets = [
      {
        id: 'home-1',
        type: 'home',
        name: 'House',
        value: 300000,
        taxMonthly: 400,
        insuranceMonthly: 150,
        lastEditedAt: new Date().toISOString(),
      },
    ];
    h.accounts.push({
      id: 'mtg',
      type: 'mortgage',
      name: 'Mortgage',
      balance: 200000,
      minPayment: 1800,
      escrowMonthly: 550,
      escrowCoversHousing: true,
      apr: 0.06,
      lastEditedAt: new Date().toISOString(),
    });
    const events = plannedEvents(h, seed, 'realistic');
    assert.equal(events.some((event) => event.key.endsWith(':tax') || event.key.endsWith(':insurance')), false);
  });

  it('counts loan payments in the liberal emergency target', () => {
    const seed = loadSeed();
    const h = emptyRealHousehold('10001');
    h.housingTenure = 'none';
    h.hasVehicle = false;
    h.monthlyIncome = 5000;
    h.expenses = [{ id: 'exp', name: 'Living', monthlyAmount: 2000, variable: false }];
    h.accounts = [
      { id: 'cash', type: 'cash', name: 'Cash', balance: 1000, lastEditedAt: new Date().toISOString() },
      {
        id: 'loan',
        type: 'other_liability',
        name: 'Loan',
        balance: 5000,
        minPayment: 400,
        apr: 0.1,
        lastEditedAt: new Date().toISOString(),
      },
    ];
    const view = runForecast(h, seed, 'liberal');
    assert.ok(view.emergencyFundTargets.liberal >= 3 * (2000 + 400));
  });
});
