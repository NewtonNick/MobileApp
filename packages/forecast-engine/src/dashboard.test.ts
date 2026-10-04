import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  addBillToPlan,
  bookBalances,
  categoryTrack,
  draftMonthAsPlan,
  forgetPlaidItem,
  foundBills,
  holdingAllocation,
  observeNetWorth,
  recordedBalanceChange,
  renameMerchant,
  setMerchantRule,
  setMerchantTag,
  spendingByTag,
  spendingChange,
  splitSpend,
  upcomingCash,
} from './dashboard';
import { normalizeHousehold } from './preview';
import { expenseMonth } from './engine';
import { emptyRealHousehold } from './preview';
import { standing } from './standing';
import type { HouseholdInput, LedgerRow } from './types';
import type { SeedBundle } from './seed-types';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../../data/seed');

function loadSeed(): SeedBundle {
  return {
    home: JSON.parse(readFileSync(join(root, 'home_v1.json'), 'utf8')),
    vehicle: JSON.parse(readFileSync(join(root, 'vehicle_v1.json'), 'utf8')),
    macro: JSON.parse(readFileSync(join(root, 'macro_v1.json'), 'utf8')),
  };
}

const NOW = new Date(2026, 8, 15);

function spend(partial: Partial<LedgerRow> & Pick<LedgerRow, 'id' | 'merchant' | 'amount' | 'date'>): LedgerRow {
  return {
    category: 'groceries',
    role: 'spend',
    source: 'typed',
    confidence: 'high',
    reviewed: true,
    ...partial,
  };
}

function books(): HouseholdInput {
  const household = emptyRealHousehold('10001');
  household.monthlyIncome = 6000;
  household.jobClass = 'work_optional';
  household.expenses = [
    { id: 'living', name: 'Living', monthlyAmount: 3000, variable: false, budgetCategory: 'other_living' },
    { id: 'food', name: 'Groceries', monthlyAmount: 400, variable: true, budgetCategory: 'groceries' },
  ];
  household.accounts = [
    { id: 'chk', type: 'checking', name: 'Checking', balance: 4000, lastEditedAt: '2026-01-01T00:00:00.000Z' },
    {
      id: '401k',
      type: 'retirement_401k',
      name: '401k',
      balance: 80000,
      expectedReturn: 0.06,
      lastEditedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'loan',
      type: 'auto_loan',
      name: 'Car loan',
      balance: 8000,
      minPayment: 250,
      lastEditedAt: '2026-01-01T00:00:00.000Z',
    },
  ];
  household.assets = [
    { id: 'car', type: 'vehicle', name: 'Civic', value: 12000, lastEditedAt: '2026-01-01T00:00:00.000Z', fuelMonthly: 160 },
  ];
  return household;
}

describe('dashboard', () => {
  it('allocates balances and leaves the mortgage out of the mix', () => {
    const household = books();
    household.accounts.push({
      id: 'home-loan',
      type: 'mortgage',
      name: 'Mortgage',
      balance: 200000,
      minPayment: 1400,
      lastEditedAt: '2026-01-01T00:00:00.000Z',
    });
    household.assets.push({
      id: 'house',
      type: 'home',
      name: 'House',
      value: 320000,
      lastEditedAt: '2026-01-01T00:00:00.000Z',
    });
    const mix = holdingAllocation(household);
    const share = mix.slices.reduce((sum, slice) => sum + slice.share, 0);
    assert.ok(Math.abs(share - 1) < 0.001);
    assert.equal(mix.slices.find((slice) => slice.kind === 'retirement')?.amount, 80000);
    assert.equal(mix.slices.find((slice) => slice.kind === 'liquid')?.amount, 4000);
    assert.equal(mix.debt, 208000);
    assert.ok(mix.net < mix.slices.reduce((sum, slice) => sum + slice.amount, 0));
    assert.ok(Math.abs((mix.expectedReturn ?? 0) - 0.06) < 0.0001);
  });

  it('names the category that moved versus last month', () => {
    const household = books();
    household.ledger = [
      spend({ id: 'a', merchant: 'Market', amount: 200, date: '2026-08-04', category: 'groceries' }),
      spend({ id: 'b', merchant: 'Market', amount: 280, date: '2026-09-04', category: 'groceries' }),
      spend({ id: 'c', merchant: 'Netflix', amount: 16, date: '2026-08-02', category: 'subscriptions' }),
    ];
    const deltas = spendingChange(household, NOW);
    const food = deltas.find((row) => row.category === 'groceries');
    const subs = deltas.find((row) => row.category === 'subscriptions');
    assert.equal(food?.delta, 80);
    assert.equal(subs?.delta, -16);
  });

  it('adds a repeating merchant as a bill and moves the hired date later', () => {
    const seed = loadSeed();
    const household = books();
    household.housingTenure = 'none';
    household.surplusPolicy = 'retirement';
    household.monthlyIncome = 8000;
    household.accounts = household.accounts.map((account) =>
      account.id === '401k' ? { ...account, balance: 200000 } : account,
    );
    household.ledger = ['2026-07-03', '2026-08-03', '2026-09-03'].map((date, index) =>
      spend({
        id: `nf-${index}`,
        merchant: 'Netflix',
        amount: 400,
        date,
        category: 'subscriptions',
      }),
    );
    const found = foundBills(household);
    assert.equal(found.length, 1);
    assert.equal(found[0].onPlan, false);
    assert.equal(found[0].name, 'Netflix');
    const before = standing(household, seed, 'realistic', 'work_optional');
    const next = addBillToPlan(household, 'Netflix');
    assert.equal(next.expenses.some((expense) => expense.name === 'Netflix' && expense.monthlyAmount === 400), true);
    assert.equal(addBillToPlan(next, 'netflix'), next);
    assert.ok(expenseMonth(next, 'realistic', 1) > expenseMonth(household, 'realistic', 1));
    const after = standing(next, seed, 'realistic', 'work_optional');
    assert.ok(before.hiredMonth != null && after.hiredMonth != null);
    assert.ok(after.hiredMonth > before.hiredMonth);
  });

  it('writes this month onto the plan when there is no bank, and refuses a stale link', () => {
    const household = books();
    household.ledger = [
      spend({ id: 'g', merchant: 'Market', amount: 520, date: '2026-09-08', category: 'groceries' }),
    ];
    const drafted = draftMonthAsPlan(household, NOW);
    assert.ok(drafted);
    assert.deepEqual(drafted?.applied, ['groceries']);
    assert.equal(
      drafted?.household.expenses.find((expense) => expense.id === 'food')?.monthlyAmount,
      520,
    );
    household.plaidItems = [
      {
        itemId: 'item-1',
        institutionName: 'First Bank',
        lastSyncedAt: '2026-01-01T00:00:00.000Z',
        loginRequired: false,
        accounts: [],
      },
    ];
    assert.equal(draftMonthAsPlan(household, NOW), null);
    assert.equal(household.expenses.find((expense) => expense.id === 'food')?.monthlyAmount, 400);
  });

  it('does not collapse two bills in one category', () => {
    const household = books();
    household.expenses.push({
      id: 'market',
      name: 'Corner market',
      monthlyAmount: 100,
      variable: true,
      budgetCategory: 'groceries',
    });
    household.ledger = [spend({ id: 'g', merchant: 'Market', amount: 90, date: '2026-09-08', category: 'groceries' })];
    const drafted = draftMonthAsPlan(household, NOW);
    assert.deepEqual(drafted?.skipped, ['groceries']);
    assert.equal(drafted?.household.expenses.find((expense) => expense.id === 'food')?.monthlyAmount, 400);
  });

  it('splits a spend and files a merchant rule without touching pay', () => {
    const household = books();
    household.ledger = [
      spend({ id: 'row', merchant: 'Costco', amount: 180, date: '2026-09-02', category: 'groceries' }),
      {
        id: 'pay',
        merchant: 'Costco',
        amount: 50,
        date: '2026-09-02',
        category: null,
        role: 'income',
        source: 'typed',
        confidence: 'high',
        reviewed: true,
      },
    ];
    const split = splitSpend(household, 'row', 'transport', 40);
    assert.ok(split);
    const parts = (split?.ledger ?? []).filter((row) => row.merchant === 'Costco' && row.role === 'spend');
    assert.equal(parts.reduce((sum, row) => sum + row.amount, 0), 180);
    assert.equal(parts.find((row) => row.category === 'transport')?.amount, 40);
    const ruled = setMerchantRule(split ?? household, 'Costco', 'subscriptions');
    assert.equal(ruled.categoryOverrides?.[0].category, 'subscriptions');
    assert.ok((ruled.ledger ?? []).filter((row) => row.role === 'spend').every((row) => row.category === 'subscriptions'));
    assert.equal((ruled.ledger ?? []).find((row) => row.id === 'pay')?.role, 'income');
  });

  it('drops a linked institution and keeps the books', () => {
    const household = books();
    household.plaidItems = [
      {
        itemId: 'item-1',
        institutionName: 'First Bank',
        lastSyncedAt: NOW.toISOString(),
        loginRequired: false,
        accounts: [],
      },
    ];
    const next = forgetPlaidItem(household, 'item-1');
    assert.equal(next.plaidItems?.length, 0);
    assert.equal(next.accounts.length, household.accounts.length);
    assert.equal(next.expenses.length, household.expenses.length);
    assert.equal(next.monthlyIncome, 6000);
  });

  it('lists the next months of pay and bills the date already uses', () => {
    const household = books();
    household.extraIncomes = [{ id: 'bonus', name: 'Bonus', amount: 1000, schedule: 'once', onceMonth: 2 }];
    const months = upcomingCash(household, NOW, 2);
    assert.equal(months[0].label, 'Sep 2026');
    assert.equal(months[0].income, 6000);
    assert.ok(months[0].bills.some((bill) => bill.name === 'Living' && bill.amount === 3000));
    assert.ok(months[0].bills.some((bill) => bill.name === 'Car loan' && bill.amount === 250));
    assert.ok(months[0].bills.some((bill) => bill.name === 'Civic fuel'));
    assert.equal(months[1].income, 7000);
    assert.equal(months[1].label, 'Oct 2026');
    assert.deepEqual(months[0].seen, []);
  });

  it('tracks this month against the plan and leaves a shared category unedited', () => {
    const household = books();
    household.ledger = [
      spend({ id: 'g', merchant: 'Market', amount: 120, date: '2026-09-04', category: 'groceries' }),
    ];
    const food = categoryTrack(household, NOW).find((row) => row.category === 'groceries');
    assert.equal(food?.planned, 400);
    assert.equal(food?.spent, 120);
    assert.equal(food?.left, 280);
    assert.equal(food?.editable, true);
    household.expenses.push({
      id: 'market',
      name: 'Corner market',
      monthlyAmount: 50,
      variable: true,
      budgetCategory: 'groceries',
    });
    const shared = categoryTrack(household, NOW).find((row) => row.category === 'groceries');
    assert.equal(shared?.planned, 450);
    assert.equal(shared?.editable, false);
  });

  it('lists each balance and the institution that last wrote it', () => {
    const household = books();
    household.accounts = household.accounts.map((account) =>
      account.id === 'chk' ? { ...account, lastSyncedAt: '2026-09-10T00:00:00.000Z' } : account,
    );
    household.plaidItems = [
      {
        itemId: 'item-1',
        institutionName: 'First Bank',
        lastSyncedAt: '2026-09-10T00:00:00.000Z',
        loginRequired: false,
        accounts: [{ plaidAccountId: 'p1', localAccountId: 'chk', name: 'Checking', kind: 'checking' }],
      },
    ];
    const rows = bookBalances(household);
    const checking = rows.find((row) => row.id === 'chk');
    const loan = rows.find((row) => row.id === 'loan');
    assert.equal(checking?.institution, 'First Bank');
    assert.equal(checking?.syncedAt, '2026-09-10T00:00:00.000Z');
    assert.equal(checking?.owed, false);
    assert.equal(loan?.owed, true);
    assert.equal(loan?.institution, null);
    assert.ok(rows.some((row) => row.id === 'car' && row.typeLabel === 'Vehicle'));
  });

  it('records one net worth mark per month and compares a later month', () => {
    const household = books();
    const first = observeNetWorth(household, new Date(2026, 7, 2));
    assert.equal(first.netWorthMarks?.length, 1);
    assert.equal(observeNetWorth(first, new Date(2026, 7, 20)), first);
    const later = observeNetWorth(
      {
        ...first,
        accounts: first.accounts.map((account) =>
          account.id === 'chk' ? { ...account, balance: 5000 } : account,
        ),
      },
      NOW,
    );
    assert.equal(later.netWorthMarks?.length, 2);
    const change = recordedBalanceChange(later, NOW);
    assert.equal(change?.fromMonth, '2026-08');
    assert.equal(change?.delta, 1000);
    assert.equal(recordedBalanceChange(first, new Date(2026, 7, 2)), null);
  });

  it('shows a found bill on the cash list without adding it to the total', () => {
    const household = books();
    household.ledger = ['2026-07-03', '2026-08-03', '2026-09-03'].map((date, index) =>
      spend({
        id: `nf-${index}`,
        merchant: 'Netflix',
        amount: 16,
        date,
        category: 'subscriptions',
        itemId: index === 2 ? 'item-2' : 'item-1',
      }),
    );
    household.merchantSightings = [
      { merchant: 'netflix', amount: 16, month: '2026-07', itemId: 'item-1' },
      { merchant: 'netflix', amount: 16, month: '2026-08', itemId: 'item-1' },
      { merchant: 'netflix', amount: 16, month: '2026-09', itemId: 'item-2' },
    ];
    const found = foundBills(household);
    assert.equal(found[0]?.day, 3);
    assert.equal(found[0]?.institutions, 2);
    const month = upcomingCash(household, NOW, 1)[0];
    assert.equal(month.seen.length, 1);
    assert.equal(month.seen[0]?.name, 'Netflix');
    assert.equal(month.bills.some((bill) => bill.name === 'Netflix'), false);
    const withBill = upcomingCash(addBillToPlan(household, 'Netflix'), NOW, 1)[0];
    assert.equal(withBill.seen.length, 0);
    assert.ok(withBill.bills.some((bill) => bill.name === 'Netflix'));
    assert.ok(withBill.total > month.total);
  });

  it('lists a bank stream before any local charge and keeps it out of the cash total', () => {
    const household = books();
    household.ledger = [];
    household.bankBills = [
      {
        merchant: 'Netflix',
        amount: 15.99,
        day: 3,
        itemId: 'item-1',
        category: 'subscriptions',
        cadence: 'monthly',
      },
    ];
    const found = foundBills(household);
    assert.equal(found.length, 1);
    assert.equal(found[0]?.months, 0);
    assert.equal(found[0]?.day, 3);
    assert.equal(found[0]?.onPlan, false);
    const month = upcomingCash(household, NOW, 1)[0];
    assert.equal(month.seen[0]?.name, 'Netflix');
    assert.equal(month.bills.some((bill) => bill.name === 'Netflix'), false);
    const ignored = { ...household, ignoredMerchants: ['netflix'] };
    assert.equal(foundBills(ignored).length, 0);
    const added = addBillToPlan(household, 'Netflix');
    assert.equal(added.expenses.some((expense) => expense.name === 'Netflix' && expense.monthlyAmount === 15.99), true);
    assert.equal(upcomingCash(added, NOW, 1)[0]?.seen.length, 0);
    const restored = normalizeHousehold(household);
    assert.equal(restored.bankBills?.[0]?.amount, 15.99);
    assert.equal(restored.bankBills?.[0]?.day, 3);
    const dropped = forgetPlaidItem(household, 'item-1');
    assert.equal(dropped.bankBills?.length, 0);
  });

  it('renames a merchant and tags spend without moving the plan', () => {
    const household = books();
    household.ledger = [
      spend({ id: 'row', merchant: 'Netflix', amount: 16, date: '2026-09-03', category: 'subscriptions' }),
    ];
    household.categoryOverrides = [{ merchant: 'netflix', category: 'subscriptions' }];
    const plan = household.expenses.find((expense) => expense.id === 'food')?.monthlyAmount;
    const tagged = setMerchantTag(household, 'Netflix', 'Streaming');
    assert.equal(tagged.expenses.find((expense) => expense.id === 'food')?.monthlyAmount, plan);
    assert.equal(tagged.ledger?.[0]?.category, 'subscriptions');
    assert.deepEqual(spendingByTag(tagged, NOW), [{ tag: 'Streaming', amount: 16 }]);
    const renamed = renameMerchant(tagged, 'Netflix', 'Netflix.com');
    assert.equal(renamed.ledger?.[0]?.merchant, 'Netflix.com');
    assert.equal(renamed.categoryOverrides?.[0]?.merchant, 'netflix.com');
    assert.equal(renamed.merchantTags?.[0]?.merchant, 'netflix.com');
    assert.equal(setMerchantTag(renamed, 'Netflix.com', '  ').merchantTags?.length, 0);
    const restored = normalizeHousehold(renamed);
    assert.equal(restored.merchantTags?.[0]?.tag, 'Streaming');
    assert.equal(restored.netWorthMarks?.length, 0);
  });
});
