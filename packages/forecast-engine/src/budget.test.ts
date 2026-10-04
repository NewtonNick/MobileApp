import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  acceptMonthAsPlan,
  addTypedSpend,
  applyBankSync,
  billsFromStreams,
  budgetLines,
  categorySpent,
  classifyTransaction,
  countsAsSpend,
  fileAsSpend,
  isInboxRow,
  linkGapUnknown,
  linkIsCurrent,
  looksRecurring,
  markThisMonthOnly,
  monthKey,
  reconcileMonth,
  showEmptyMonth,
  spreadAcrossYear,
} from './budget';
import type { BankSyncPayload, BankTransaction } from './budget';
import { walkForecast } from './drivers';
import { expenseCountsInLiving } from './expenses';
import { emptyRealHousehold, normalizeHousehold, previewHousehold } from './preview';
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

const NOW = new Date('2026-09-26T15:00:00');

function books(): HouseholdInput {
  const household = emptyRealHousehold('10001');
  household.createdAt = '2026-08-01T00:00:00.000Z';
  household.monthlyIncome = 5000;
  household.expenses = [
    { id: 'exp-food', name: 'Groceries', monthlyAmount: 400, variable: true, budgetCategory: 'groceries' },
    { id: 'exp-rent', name: 'Rent', monthlyAmount: 1800, variable: false, budgetCategory: 'housing' },
  ];
  household.accounts = [
    { id: 'chk', type: 'checking', name: 'Checking', balance: 2000, lastEditedAt: '2026-08-01T00:00:00.000Z' },
    { id: 'sav', type: 'savings', name: 'Savings', balance: 8000, lastEditedAt: '2026-08-01T00:00:00.000Z' },
  ];
  household.assets = [
    {
      id: 'car',
      type: 'vehicle',
      name: 'Civic',
      value: 12000,
      lastEditedAt: '2026-08-01T00:00:00.000Z',
      fuelMonthly: 160,
    },
  ];
  household.plaidItems = [
    {
      itemId: 'item-1',
      institutionName: 'First Bank',
      lastSyncedAt: NOW.toISOString(),
      loginRequired: false,
      accounts: [{ plaidAccountId: 'acc-chk', localAccountId: 'chk', name: 'Checking', kind: 'checking' }],
    },
  ];
  return household;
}

function txn(partial: Partial<BankTransaction> & Pick<BankTransaction, 'id' | 'amount' | 'merchant'>): BankTransaction {
  return {
    date: '2026-09-10',
    pending: false,
    accountId: 'acc-chk',
    confidence: 'HIGH',
    ...partial,
  };
}

function payload(partial: Partial<BankSyncPayload> & Pick<BankSyncPayload, 'added'>): BankSyncPayload {
  return {
    itemId: 'item-1',
    removed: [],
    modified: [],
    accounts: [{ plaidAccountId: 'acc-chk', name: 'Checking', kind: 'checking', current: 1500 }],
    ...partial,
  };
}

describe('budget roles', () => {
  it('counts only spend rows, and a refund reduces that category', () => {
    const household = books();
    const coffee = classifyTransaction(
      txn({
        id: 'coffee',
        amount: 6,
        merchant: 'Cafe',
        primary: 'FOOD_AND_DRINK',
        detailed: 'FOOD_AND_DRINK_COFFEE',
        confidence: 'HIGH',
      }),
      household,
    );
    const refund = classifyTransaction(
      txn({
        id: 'refund',
        amount: -20,
        merchant: 'Market',
        primary: 'FOOD_AND_DRINK',
        detailed: 'FOOD_AND_DRINK_GROCERIES',
        confidence: 'HIGH',
      }),
      household,
    );
    const transfer = classifyTransaction(
      txn({
        id: 'xfer',
        amount: 400,
        merchant: 'Savings transfer',
        primary: 'TRANSFER_OUT',
        detailed: 'TRANSFER_OUT_SAVINGS',
        confidence: 'HIGH',
      }),
      household,
    );
    const card = classifyTransaction(
      txn({
        id: 'card',
        amount: 900,
        merchant: 'Card payment',
        primary: 'LOAN_PAYMENTS',
        detailed: 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT',
      }),
      household,
    );
    const pending = classifyTransaction(
      txn({ id: 'hold', amount: 80, merchant: 'Hotel', pending: true, confidence: 'HIGH' }),
      household,
    );
    const paycheck = classifyTransaction(
      txn({
        id: 'pay',
        amount: -5000,
        merchant: 'Payroll',
        primary: 'INCOME',
        detailed: 'INCOME_WAGES',
        confidence: 'HIGH',
      }),
      household,
    );
    assert.ok(coffee && countsAsSpend(coffee) && !isInboxRow(coffee));
    assert.equal(coffee?.category, 'other_living');
    assert.equal(refund?.role, 'spend');
    assert.equal(transfer?.role, 'transfer');
    assert.equal(transfer?.confidence, 'high');
    assert.equal(card?.role, 'transfer');
    assert.equal(pending?.role, 'pending');
    assert.equal(paycheck?.role, 'income');
    assert.ok(paycheck && isInboxRow(paycheck));
    const rows = [coffee, refund, transfer, card, pending, paycheck].filter((row): row is LedgerRow => !!row);
    assert.equal(categorySpent(rows, '2026-09', 'other_living'), 6);
    assert.equal(categorySpent(rows, '2026-09', 'groceries'), -20);
  });

  it('leaves low-confidence charges and unsure transfers in the inbox', () => {
    const household = books();
    const fuzzy = classifyTransaction(
      txn({
        id: 'fuzzy',
        amount: 40,
        merchant: 'Shop',
        primary: 'FOOD_AND_DRINK',
        detailed: 'FOOD_AND_DRINK_GROCERIES',
        confidence: 'LOW',
      }),
      household,
    );
    const unsure = classifyTransaction(
      txn({
        id: 'unsure',
        amount: 75,
        merchant: 'Somewhere',
        primary: 'TRANSFER_OUT',
        detailed: 'TRANSFER_OUT_OTHER',
        confidence: 'LOW',
      }),
      household,
    );
    assert.ok(fuzzy && isInboxRow(fuzzy) && !countsAsSpend(fuzzy));
    assert.ok(unsure && unsure.role === 'transfer' && isInboxRow(unsure));
  });

  it('does not file fuel or a loan payment as living', () => {
    const household = books();
    const before = household.expenses.filter((expense) => expenseCountsInLiving(expense, 1)).length;
    const fuel = classifyTransaction(
      txn({
        id: 'fuel',
        amount: 48,
        merchant: 'Shell',
        primary: 'TRANSPORTATION',
        detailed: 'TRANSPORTATION_GAS',
        confidence: 'HIGH',
      }),
      household,
    );
    assert.equal(fuel?.role, 'already_counted');
    assert.ok(fuel && isInboxRow(fuel));
    const synced = applyBankSync(
      household,
      payload({
        added: [
          txn({
            id: 'fuel',
            amount: 48,
            merchant: 'Shell',
            primary: 'TRANSPORTATION',
            detailed: 'TRANSPORTATION_GAS',
          }),
          txn({
            id: 'loan',
            amount: 320,
            merchant: 'Auto loan',
            primary: 'LOAN_PAYMENTS',
            detailed: 'LOAN_PAYMENTS_CAR_PAYMENT',
          }),
        ],
      }),
      { now: NOW },
    ).household;
    assert.equal(synced.expenses.filter((expense) => expenseCountsInLiving(expense, 1)).length, before);
    assert.ok(synced.ledger?.every((row) => row.role === 'already_counted'));
    assert.equal(categorySpent(synced.ledger ?? [], '2026-09', 'transport'), 0);
  });
});

describe('budget month', () => {
  it('keeps the open month, drops pending when the posted charge replaces it, and ignores older history as lines', () => {
    const household = books();
    household.ledger = [
      {
        id: 'pend-1',
        amount: 30,
        merchant: 'Hotel',
        date: '2026-09-02',
        category: null,
        role: 'pending',
        source: 'plaid',
        confidence: 'low',
        itemId: 'item-1',
        pendingId: 'pend-1',
      },
    ];
    const result = applyBankSync(
      household,
      payload({
        added: [
          txn({ id: 'old', amount: 12, merchant: 'Cafe', date: '2026-08-02', detailed: 'FOOD_AND_DRINK_COFFEE', primary: 'FOOD_AND_DRINK' }),
          txn({
            id: 'posted',
            amount: 30,
            merchant: 'Hotel',
            pendingTransactionId: 'pend-1',
            detailed: 'TRAVEL_LODGING',
            primary: 'TRAVEL',
            confidence: 'LOW',
          }),
        ],
        accounts: [{ plaidAccountId: 'acc-chk', name: 'Checking', kind: 'checking', current: 1400 }],
      }),
      { now: NOW },
    ).household;
    assert.equal(result.ledger?.some((row) => row.id === 'pend-1'), false);
    assert.equal(result.ledger?.some((row) => row.id === 'old'), false);
    assert.ok(result.merchantSightings?.some((row) => row.merchant === 'cafe' && row.month === '2026-08'));
    assert.equal(result.accounts.find((account) => account.id === 'chk')?.balance, 1400);
    assert.equal(result.accounts.find((account) => account.id === 'sav')?.balance, 8000);
  });

  it('reconciles bank outflow against categorized spend', () => {
    const rows: LedgerRow[] = [
      { id: 'a', amount: 100, merchant: 'Market', date: '2026-09-04', category: 'groceries', role: 'spend', source: 'plaid', confidence: 'high' },
      { id: 'b', amount: 40, merchant: 'Shell', date: '2026-09-05', category: null, role: 'already_counted', source: 'plaid', confidence: 'low' },
      { id: 'c', amount: 10, merchant: 'Transfer', date: '2026-09-06', category: null, role: 'transfer', source: 'plaid', confidence: 'high' },
    ];
    const rec = reconcileMonth(rows, '2026-09');
    assert.equal(rec.outflow, 150);
    assert.equal(rec.transfers, 10);
    assert.equal(rec.spent, 100);
    assert.equal(rec.gap, 40);
  });

  it('does not let unaccepted spend move the forecast', () => {
    const household = books();
    const seed = loadSeed();
    const before = walkForecast(household, seed, 'realistic').months[0].livingExpenses;
    const withSpend = addTypedSpend(household, { merchant: 'Market', amount: 80, category: 'groceries', date: '2026-09-12' });
    const after = walkForecast(withSpend, seed, 'realistic').months[0].livingExpenses;
    assert.equal(after, before);
    const lines = budgetLines(withSpend, NOW);
    const groceries = lines.find((line) => line.category === 'groceries');
    assert.equal(groceries?.planned, 400);
    assert.equal(groceries?.spent, 80);
    assert.equal(groceries?.left, 320);
  });
});

describe('accept as plan', () => {
  it('writes the plan only from spend rows, and only while the link is current', () => {
    const household = books();
    household.ledger = [
      {
        id: 'g',
        amount: 250,
        merchant: 'Market',
        date: '2026-09-08',
        category: 'groceries',
        role: 'spend',
        source: 'plaid',
        confidence: 'high',
      },
      {
        id: 'xfer',
        amount: 900,
        merchant: 'Card',
        date: '2026-09-08',
        category: null,
        role: 'transfer',
        source: 'plaid',
        confidence: 'high',
      },
    ];
    const accepted = acceptMonthAsPlan(household, NOW);
    assert.equal(accepted?.expenses.find((expense) => expense.id === 'exp-food')?.monthlyAmount, 250);
    assert.equal(accepted?.expenses.find((expense) => expense.id === 'exp-rent')?.monthlyAmount, 1800);
    const stale = {
      ...household,
      plaidItems: household.plaidItems?.map((item) => ({ ...item, lastSyncedAt: '2026-07-01T00:00:00.000Z' })),
    };
    assert.equal(linkIsCurrent(stale.plaidItems, NOW.getTime()), false);
    assert.equal(acceptMonthAsPlan(stale, NOW), null);
    const dead = {
      ...household,
      plaidItems: household.plaidItems?.map((item) => ({ ...item, loginRequired: true })),
    };
    assert.equal(acceptMonthAsPlan(dead, NOW), null);
  });

  it('keeps a this-month charge out of the plan and spreads a year bill to one twelfth', () => {
    const household = books();
    household.ledger = [
      {
        id: 'annual',
        amount: 1200,
        merchant: 'Insurance bill',
        date: '2026-09-03',
        category: 'subscriptions',
        role: 'spend',
        source: 'typed',
        confidence: 'low',
      },
    ];
    const only = markThisMonthOnly(household, 'annual');
    assert.equal(only.expenses.find((expense) => expense.budgetCategory === 'subscriptions'), undefined);
    assert.equal(only.ledger?.find((row) => row.id === 'annual')?.thisMonthOnly, true);
    assert.equal(acceptMonthAsPlan(only, NOW)?.expenses.find((expense) => expense.budgetCategory === 'subscriptions'), undefined);
    const spread = spreadAcrossYear(household, 'annual');
    assert.equal(spread?.expenses.find((expense) => expense.budgetCategory === 'subscriptions')?.monthlyAmount, 100);
    assert.notEqual(spread?.expenses.find((expense) => expense.budgetCategory === 'subscriptions')?.monthlyAmount, 1200);
  });

  it('does not create a budget line per merchant', () => {
    const household = books();
    const synced = applyBankSync(
      household,
      payload({
        added: [
          txn({ id: 's1', amount: 5, merchant: 'Starbucks', primary: 'FOOD_AND_DRINK', detailed: 'FOOD_AND_DRINK_COFFEE' }),
          txn({ id: 's2', amount: 6, merchant: 'Other Cafe', primary: 'FOOD_AND_DRINK', detailed: 'FOOD_AND_DRINK_COFFEE' }),
        ],
      }),
      { now: NOW },
    ).household;
    assert.equal(synced.expenses.some((expense) => /starbucks/i.test(expense.name)), false);
    assert.equal(synced.expenses.length, household.expenses.length);
    const filed = fileAsSpend(synced, 's1', 'other_living');
    const accepted = acceptMonthAsPlan(filed, NOW);
    const created = accepted?.expenses.filter((expense) => expense.budgetCategory === 'other_living') ?? [];
    assert.equal(created.length, 1);
    assert.equal(created[0].name, 'Other living');
  });
});

describe('bank sync safety', () => {
  it('does not let a sandbox sync write the real household', () => {
    const household = books();
    const before = JSON.stringify(household);
    const result = applyBankSync(
      household,
      payload({
        added: [txn({ id: 'sand', amount: 99, merchant: 'Sandbox Store', detailed: 'FOOD_AND_DRINK_GROCERIES', primary: 'FOOD_AND_DRINK' })],
        accounts: [{ plaidAccountId: 'acc-chk', name: 'Checking', kind: 'checking', current: 1 }],
        recurring: [{ merchant: 'Netflix', amount: 15.99, frequency: 'MONTHLY', nextDate: '2026-10-03' }],
      }),
      { now: NOW, sandbox: true },
    );
    assert.equal(JSON.stringify(result.household), before);
    assert.equal(result.sandboxLedger?.length, 1);
    assert.equal(result.sandboxLedger?.[0].source, 'sandbox');
  });

  it('stores a bank stream as a monthly bill and leaves it off the plan', () => {
    const household = books();
    const synced = applyBankSync(
      household,
      payload({
        added: [],
        recurring: [
          {
            merchant: 'Netflix',
            amount: 15.99,
            frequency: 'MONTHLY',
            nextDate: '2026-10-03',
            detailed: 'ENTERTAINMENT_TV_AND_MOVIES',
            primary: 'ENTERTAINMENT',
          },
          { merchant: 'State Farm', amount: 1200, frequency: 'ANNUALLY', lastDate: '2026-01-15' },
          { merchant: 'Mystery', amount: 40, frequency: 'UNKNOWN' },
        ],
      }),
      { now: NOW },
    ).household;
    assert.equal(synced.expenses.some((expense) => expense.name === 'Netflix'), false);
    assert.equal(synced.bankBills?.length, 2);
    const netflix = synced.bankBills?.find((bill) => bill.merchant === 'Netflix');
    const annual = synced.bankBills?.find((bill) => bill.merchant === 'State Farm');
    assert.equal(netflix?.amount, 15.99);
    assert.equal(netflix?.day, 3);
    assert.equal(netflix?.cadence, 'monthly');
    assert.equal(netflix?.category, 'subscriptions');
    assert.equal(annual?.amount, 100);
    assert.equal(annual?.cadence, 'annual');
    assert.equal(annual?.day, 15);
    const cleared = applyBankSync(synced, payload({ added: [], recurring: [] }), { now: NOW }).household;
    assert.equal(cleared.bankBills?.length, 0);
  });

  it('keeps a stored bank bill when the stream list is missing or the login is dead', () => {
    const household = books();
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
    const omitted = applyBankSync(household, payload({ added: [] }), { now: NOW }).household;
    assert.equal(omitted.bankBills?.length, 1);
    const dead = applyBankSync(
      household,
      { itemId: 'item-1', loginRequired: true, added: [], modified: [], removed: [], recurring: [] },
      { now: NOW },
    ).household;
    assert.equal(dead.bankBills?.length, 1);
    assert.equal(dead.accounts.find((account) => account.id === 'chk')?.balance, 2000);
  });

  it('turns a weekly stream into a month', () => {
    const bills = billsFromStreams('item-1', [{ merchant: 'Transit', amount: 15, frequency: 'WEEKLY' }]);
    assert.equal(bills[0]?.amount, 65);
    assert.equal(bills[0]?.cadence, 'weekly');
  });

  it('does not clear balances when the login is dead', () => {
    const household = books();
    const result = applyBankSync(
      household,
      { itemId: 'item-1', loginRequired: true, added: [], modified: [], removed: [] },
      { now: NOW },
    ).household;
    assert.equal(result.accounts.find((account) => account.id === 'chk')?.balance, 2000);
    assert.equal(result.plaidItems?.[0].loginRequired, true);
    assert.equal(result.plaidItems?.[0].lastSyncedAt, NOW.toISOString());
  });

  it('keeps the last good month when a later sync is empty or the login dies', () => {
    const household = books();
    household.targetDate = '2032-06-01';
    const first = applyBankSync(
      household,
      payload({
        added: [
          txn({
            id: 'groceries',
            amount: 40,
            merchant: 'Market',
            primary: 'FOOD_AND_DRINK',
            detailed: 'FOOD_AND_DRINK_GROCERIES',
          }),
        ],
      }),
      { now: NOW },
    ).household;
    assert.equal(categorySpent(first.ledger ?? [], '2026-09', 'groceries'), 40);
    const quiet = applyBankSync(first, payload({ added: [] }), { now: NOW }).household;
    assert.equal(quiet.ledger?.some((row) => row.id === 'groceries'), true);
    assert.equal(categorySpent(quiet.ledger ?? [], '2026-09', 'groceries'), 40);
    assert.equal(quiet.expenses.find((expense) => expense.id === 'exp-rent')?.monthlyAmount, 1800);
    assert.equal(quiet.targetDate, '2032-06-01');
    assert.equal(quiet.accounts.find((account) => account.id === 'chk')?.balance, 1500);
    const dead = applyBankSync(
      quiet,
      { itemId: 'item-1', loginRequired: true, added: [], modified: [], removed: [] },
      { now: NOW },
    ).household;
    assert.equal(dead.ledger?.some((row) => row.id === 'groceries'), true);
    assert.equal(dead.accounts.find((account) => account.id === 'chk')?.balance, 1500);
    assert.equal(dead.expenses.find((expense) => expense.id === 'exp-rent')?.monthlyAmount, 1800);
    assert.equal(dead.targetDate, '2032-06-01');
    assert.equal(dead.plaidItems?.[0].loginRequired, true);
    const stale = {
      ...dead,
      plaidItems: dead.plaidItems?.map((item) => ({ ...item, lastSyncedAt: '2026-07-01T00:00:00.000Z' })),
    };
    assert.equal(linkGapUnknown(stale.plaidItems, NOW.getTime()), true);
    assert.equal(categorySpent(stale.ledger ?? [], '2026-09', 'groceries'), 40);
    assert.equal(linkGapUnknown([], NOW.getTime()), false);
  });

  it('maps a single checking account and leaves an ambiguous pair unmatched', () => {
    const household = books();
    household.plaidItems = [];
    const one = applyBankSync(
      household,
      payload({
        added: [],
        accounts: [{ plaidAccountId: 'acc-chk', name: 'Everyday', kind: 'checking', current: 42 }],
      }),
      { now: NOW },
    ).household;
    assert.equal(one.accounts.find((account) => account.id === 'chk')?.balance, 42);
    const ambiguous = books();
    ambiguous.accounts.push({
      id: 'chk-2',
      type: 'checking',
      name: 'Joint',
      balance: 10,
      lastEditedAt: '2026-08-01T00:00:00.000Z',
    });
    ambiguous.plaidItems = [];
    const skipped = applyBankSync(
      ambiguous,
      payload({
        added: [],
        accounts: [{ plaidAccountId: 'acc-a', name: 'A', kind: 'checking', current: 5 }],
      }),
      { now: NOW },
    ).household;
    assert.equal(skipped.accounts.find((account) => account.id === 'chk')?.balance, 2000);
    assert.equal(skipped.accounts.find((account) => account.id === 'chk-2')?.balance, 10);
    assert.equal(skipped.plaidItems?.[0].accounts[0].localAccountId, null);
  });
});

describe('typed spend and a later bank row', () => {
  it('counts one $6 when the bank posts the same merchant two days later', () => {
    const typed = addTypedSpend(books(), {
      merchant: 'Cafe',
      amount: 6,
      category: 'groceries',
      date: '2026-09-08',
    });
    typed.ledger = [
      ...(typed.ledger ?? []),
      {
        id: `${typed.ledger?.[0].id}:split`,
        amount: 2,
        merchant: 'Cafe',
        date: '2026-09-08',
        category: 'transport',
        role: 'spend',
        source: 'typed',
        confidence: 'high',
        reviewed: true,
      },
    ];
    const synced = applyBankSync(
      typed,
      payload({
        added: [
          txn({
            id: 'bank-1',
            amount: 6,
            merchant: 'CAFE',
            date: '2026-09-10',
            primary: 'FOOD_AND_DRINK',
            detailed: 'FOOD_AND_DRINK_GROCERIES',
          }),
        ],
      }),
      { now: NOW },
    ).household;
    assert.equal(categorySpent(synced.ledger ?? [], '2026-09', 'groceries'), 6);
    assert.equal(synced.ledger?.some((row) => row.id === 'bank-1'), false);
    const kept = synced.ledger?.find((row) => row.source === 'typed' && row.category === 'groceries');
    assert.equal(kept?.merchant, 'Cafe');
    assert.equal(kept?.reviewed, true);
    assert.equal(synced.ledger?.some((row) => row.id.endsWith(':split')), true);
  });

  it('keeps two bank charges that are both real', () => {
    const synced = applyBankSync(
      books(),
      payload({
        added: [
          txn({
            id: 'a',
            amount: 6,
            merchant: 'Cafe',
            date: '2026-09-08',
            primary: 'FOOD_AND_DRINK',
            detailed: 'FOOD_AND_DRINK_GROCERIES',
          }),
          txn({
            id: 'b',
            amount: 6,
            merchant: 'Cafe',
            date: '2026-09-12',
            primary: 'FOOD_AND_DRINK',
            detailed: 'FOOD_AND_DRINK_GROCERIES',
          }),
        ],
      }),
      { now: NOW },
    ).household;
    assert.equal(categorySpent(synced.ledger ?? [], '2026-09', 'groceries'), 12);
    assert.equal(synced.ledger?.length, 2);
  });

  it('does not match a card payment or a charge four days away', () => {
    const typed = addTypedSpend(books(), {
      merchant: 'Cafe',
      amount: 6,
      category: 'groceries',
      date: '2026-09-08',
    });
    const synced = applyBankSync(
      typed,
      payload({
        added: [
          txn({
            id: 'card',
            amount: 6,
            merchant: 'Cafe',
            date: '2026-09-10',
            primary: 'LOAN_PAYMENTS',
            detailed: 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT',
          }),
          txn({
            id: 'later',
            amount: 6,
            merchant: 'Cafe',
            date: '2026-09-12',
            primary: 'FOOD_AND_DRINK',
            detailed: 'FOOD_AND_DRINK_GROCERIES',
          }),
        ],
      }),
      { now: NOW },
    ).household;
    assert.equal(synced.ledger?.some((row) => row.id === 'card'), true);
    assert.equal(synced.ledger?.some((row) => row.id === 'later'), true);
    assert.equal(categorySpent(synced.ledger ?? [], '2026-09', 'groceries'), 12);
  });

  it('leaves the household byte-for-byte unchanged on a sandbox sync', () => {
    const household = addTypedSpend(books(), {
      merchant: 'Cafe',
      amount: 6,
      category: 'groceries',
      date: '2026-09-08',
    });
    const before = JSON.stringify(household);
    const result = applyBankSync(
      household,
      payload({
        added: [
          txn({
            id: 'bank-1',
            amount: 6,
            merchant: 'Cafe',
            date: '2026-09-10',
            primary: 'FOOD_AND_DRINK',
            detailed: 'FOOD_AND_DRINK_GROCERIES',
          }),
        ],
        accounts: [{ plaidAccountId: 'acc-chk', name: 'Checking', kind: 'checking', current: 1 }],
      }),
      { now: NOW, sandbox: true },
    );
    assert.equal(JSON.stringify(result.household), before);
    assert.equal(result.sandboxLedger?.length, 1);
  });
});

describe('upkeep and backup', () => {
  it('hides the empty-month ask on the day the books were created', () => {
    const household = books();
    household.plaidItems = [];
    household.createdAt = NOW.toISOString();
    household.ledger = [];
    assert.equal(showEmptyMonth(household, '2027-01-01', NOW), false);
    household.createdAt = '2026-09-01T00:00:00.000Z';
    assert.equal(showEmptyMonth(household, '2027-01-01', NOW), true);
    assert.equal(showEmptyMonth(household, null, NOW), false);
  });

  it('recognizes the same merchant in most months', () => {
    const sightings = [
      { merchant: 'netflix', amount: 16, month: '2026-04' },
      { merchant: 'netflix', amount: 16, month: '2026-05' },
      { merchant: 'netflix', amount: 15, month: '2026-06' },
    ];
    assert.equal(looksRecurring(sightings, 'Netflix', 16), true);
    assert.equal(
      looksRecurring(
        [
          { merchant: 'netflix', amount: 16, month: '2026-01' },
          { merchant: 'netflix', amount: 16, month: '2026-07' },
        ],
        'Netflix',
        16,
      ),
      false,
    );
  });

  it('restores the Plaid user id and drops tokens', () => {
    const household = previewHousehold();
    const dirty = {
      ...household,
      plaidUserId: 'user-restored',
      access_token: 'access-sandbox-secret',
      accessToken: 'also-secret',
      bankLinkUnlocked: true,
      entitlements: { standing: false },
      plus: true,
      ledger: [
        {
          id: 'row-1',
          amount: 12,
          merchant: 'Cafe',
          date: '2026-09-01',
          category: 'other_living',
          role: 'spend',
          source: 'typed',
          confidence: 'high',
        },
        {
          id: 'sand',
          amount: 4,
          merchant: 'Sandbox',
          date: '2026-09-01',
          category: 'groceries',
          role: 'spend',
          source: 'sandbox',
          confidence: 'high',
        },
      ],
      plaidItems: [
        {
          itemId: 'item-9',
          institutionName: 'Bank',
          lastSyncedAt: null,
          loginRequired: false,
          access_token: 'secret-item',
          accounts: [
            { plaidAccountId: 'p1', localAccountId: 'checking', name: 'Checking', kind: 'checking', accessToken: 'nope' },
          ],
        },
      ],
    };
    const round = normalizeHousehold(dirty);
    assert.equal(round.plaidUserId, 'user-restored');
    assert.equal('access_token' in round, false);
    assert.equal('accessToken' in round, false);
    assert.equal('bankLinkUnlocked' in round, false);
    assert.equal('entitlements' in round, false);
    assert.equal(round.ledger?.some((row) => row.source === 'sandbox'), false);
    assert.equal(round.ledger?.length, 1);
    assert.equal(JSON.stringify(round.plaidItems).includes('secret'), false);
    assert.equal(JSON.stringify(round.plaidItems).includes('access'), false);
    assert.equal(monthKey(NOW), '2026-09');
  });
});
