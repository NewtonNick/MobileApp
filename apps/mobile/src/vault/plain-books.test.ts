import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { HouseholdInput } from '@asset-aware/forecast-engine';
import { plainBooks } from './plain-books';

describe('plain books', () => {
  it('writes balances and expenses as text and leaves access material out', () => {
    const household = {
      accounts: [
        {
          id: 'chk',
          type: 'checking',
          name: 'Checking',
          balance: 2000,
          lastEditedAt: '2026-09-01T00:00:00.000Z',
          access_token: 'secret-token',
        },
      ],
      assets: [
        {
          id: 'car',
          type: 'vehicle',
          name: 'Civic',
          value: 12000,
          lastEditedAt: '2026-09-01T00:00:00.000Z',
        },
      ],
      expenses: [{ id: 'rent', name: 'Rent', monthlyAmount: 1800, variable: false }],
      ledger: [
        {
          id: 'row-1',
          amount: 6,
          merchant: 'Cafe',
          date: '2026-09-10',
          category: 'groceries',
          role: 'spend',
          source: 'plaid',
          confidence: 'high',
          itemId: 'item-secret',
        },
      ],
      openGoals: [
        {
          id: 'stay',
          name: 'Stay Afloat',
          source: 'preset',
          target: { kind: 'afloat' },
          reserved: 'ownership',
          accessToken: 'goal-secret',
        },
      ],
      plaidItems: [{ itemId: 'item-1', access_token: 'access-sandbox-secret' }],
      pin: '1234',
      entitlements: { bank: true },
      reservedCash: 500,
      standing: 'Work can stop in June 2032.',
    } as unknown as HouseholdInput;

    const text = plainBooks(household);
    const parsed = JSON.parse(text) as {
      kind: string;
      note: string;
      accounts: { balance: number }[];
      expenses: { monthlyAmount: number }[];
      ledger: { amount: number; merchant: string }[];
      goals: { name: string }[];
      assets: { value: number }[];
    };
    assert.equal(parsed.kind, 'plain-copy');
    assert.match(parsed.note, /does not restore/);
    assert.equal(parsed.accounts[0].balance, 2000);
    assert.equal(parsed.assets[0].value, 12000);
    assert.equal(parsed.expenses[0].monthlyAmount, 1800);
    assert.equal(parsed.ledger[0].amount, 6);
    assert.equal(parsed.ledger[0].merchant, 'Cafe');
    assert.equal(parsed.goals[0].name, 'Stay Afloat');
    assert.equal(text.includes('secret-token'), false);
    assert.equal(text.includes('access-sandbox-secret'), false);
    assert.equal(text.includes('goal-secret'), false);
    assert.equal(text.includes('item-secret'), false);
    assert.equal(text.includes('1234'), false);
    assert.equal(text.includes('entitlement'), false);
    assert.equal(text.includes('reservedCash'), false);
    assert.equal(text.includes('Work can stop'), false);
    assert.equal(text.includes('plaid'), false);
  });
});
