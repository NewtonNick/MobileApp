import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  BANK_ANNUAL_ID,
  BANK_MONTHLY_ID,
  availabilityFrom,
  bankLinkAllowed,
  hasBankPlan,
  listedPlan,
  offerTokenFor,
} from './plans';

describe('bank link billing', () => {
  it('keeps the bank open until Play lists a price', () => {
    assert.equal(bankLinkAllowed({ envLocked: false, availability: 'unknown', subscribed: false }), true);
    assert.equal(bankLinkAllowed({ envLocked: false, availability: 'unavailable', subscribed: false }), true);
    assert.equal(bankLinkAllowed({ envLocked: false, availability: 'unpriced', subscribed: false }), true);
  });

  it('locks the bank when Play has a price and this phone has no plan', () => {
    assert.equal(bankLinkAllowed({ envLocked: false, availability: 'ready', subscribed: false }), false);
    assert.equal(bankLinkAllowed({ envLocked: false, availability: 'ready', subscribed: true }), true);
    assert.equal(bankLinkAllowed({ envLocked: true, availability: 'ready', subscribed: true }), false);
  });

  it('ignores a missing Play product and a blank price', () => {
    assert.equal(
      listedPlan({ id: BANK_ANNUAL_ID, displayPrice: '', productStatusAndroid: 'ok' }, BANK_ANNUAL_ID),
      null,
    );
    assert.equal(
      listedPlan(
        { id: BANK_ANNUAL_ID, displayPrice: '$12.00', productStatusAndroid: 'not-found' },
        BANK_ANNUAL_ID,
      ),
      null,
    );
    const listed = listedPlan(
      { id: BANK_MONTHLY_ID, displayPrice: 'US$4.00', offerToken: 'offer-1' },
      BANK_MONTHLY_ID,
    );
    assert.equal(listed?.displayPrice, 'US$4.00');
    assert.equal(offerTokenFor(listed), 'offer-1');
    assert.equal(offerTokenFor({ id: BANK_ANNUAL_ID, displayPrice: '$1', offerToken: '  ' }), null);
  });

  it('is ready only after a query returns a priced plan', () => {
    const annual = { id: BANK_ANNUAL_ID, displayPrice: '$40.00' };
    assert.equal(availabilityFrom({ queried: false, connected: true, annual, monthly: null }), 'unknown');
    assert.equal(availabilityFrom({ queried: true, connected: false, annual, monthly: null }), 'unavailable');
    assert.equal(availabilityFrom({ queried: true, connected: true, annual: null, monthly: null }), 'unpriced');
    assert.equal(availabilityFrom({ queried: true, connected: true, annual, monthly: null }), 'ready');
  });

  it('counts only an active bank-link plan', () => {
    assert.equal(hasBankPlan([{ productId: BANK_ANNUAL_ID, isActive: true }]), true);
    assert.equal(hasBankPlan([{ productId: BANK_ANNUAL_ID, isActive: false }]), false);
    assert.equal(hasBankPlan([{ productId: 'other', isActive: true }]), false);
  });
});
