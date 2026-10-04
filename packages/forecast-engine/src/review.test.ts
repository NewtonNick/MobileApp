import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { dismissDuplicateGuess, linkDuplicateBills } from './debt';
import { partnerOnlyIncomeHousehold } from './fixtures/households';
import { householdHasIncome } from './jobs';
import { emptyRealHousehold } from './preview';
import type { DuplicateGuess } from './types';

const guess: DuplicateGuess = {
  expenseId: 'e',
  liabilityId: 'a',
  expenseName: 'Car payment',
  liabilityName: 'Auto',
  expenseAmount: 350,
  liabilityPayment: 350,
};

function books() {
  const household = emptyRealHousehold('10001');
  household.expenses = [{ id: 'e', name: 'Car payment', monthlyAmount: 350, variable: false }];
  household.accounts = [
    {
      id: 'a',
      type: 'auto_loan',
      name: 'Auto',
      balance: 8000,
      minPayment: 350,
      lastEditedAt: '2024-06-01T00:00:00.000Z',
    },
  ];
  return household;
}

describe('duplicate review', () => {
  it('same bill links both rows', () => {
    const linked = linkDuplicateBills(books(), guess);
    assert.equal(linked.expenses[0]?.linkedLiabilityId, 'a');
    assert.equal(linked.accounts[0]?.linkedExpenseId, 'e');
  });

  it('not sure only marks the guess reviewed', () => {
    const dismissed = dismissDuplicateGuess(books(), guess);
    assert.equal(dismissed.expenses[0]?.linkedLiabilityId, undefined);
    assert.equal(dismissed.accounts[0]?.linkedExpenseId, undefined);
    assert.equal(dismissed.expenses[0]?.duplicateReviewed, true);
    assert.equal(dismissed.accounts[0]?.duplicateReviewed, true);
  });
});

describe('income presence', () => {
  it('counts partner pay and a monthly extra when own pay is empty', () => {
    assert.equal(householdHasIncome(partnerOnlyIncomeHousehold()), true);
    const extra = emptyRealHousehold('10001');
    extra.monthlyIncome = null;
    extra.extraIncomes = [{ id: 'side', name: 'Side', amount: 200, schedule: 'monthly' }];
    assert.equal(householdHasIncome(extra), true);
    const annual = emptyRealHousehold('10001');
    annual.extraIncomes = [{ id: 'bonus', name: 'Bonus', amount: 1000, schedule: 'annual' }];
    assert.equal(householdHasIncome(annual), false);
  });
});
