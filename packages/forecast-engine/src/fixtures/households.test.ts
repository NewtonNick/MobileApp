import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { EDGE_HOUSEHOLDS } from './households';

describe('edge-case households', () => {
  it('covers the situations later phases assert on', () => {
    const partner = EDGE_HOUSEHOLDS.partnerOnlyIncome();
    assert.equal(partner.monthlyIncome, null);
    assert.equal(partner.partnerMonthlyIncome, 4800);

    const paid = EDGE_HOUSEHOLDS.paidOffLoan();
    assert.equal(paid.accounts[0]?.balance, 0);
    assert.equal(paid.accounts[0]?.type, 'auto_loan');

    const past = EDGE_HOUSEHOLDS.pastGoalDate();
    assert.equal(past.targetDate, '2020-06-01');
    assert.equal(past.goalSpec?.target.kind, 'date');

    const renter = EDGE_HOUSEHOLDS.renterWithHome();
    assert.equal(renter.housingTenure, 'rent');
    assert.equal(renter.assets.some((asset) => asset.type === 'home'), true);

    const newer = EDGE_HOUSEHOLDS.newHomeKnownSystems();
    const house = newer.assets[0];
    assert.equal(house?.roofYear, 2024);
    assert.equal(house?.hvacYear, 2024);
    assert.equal(house?.waterHeaterYear, 2024);

    const deferred = EDGE_HOUSEHOLDS.deferment();
    assert.equal(deferred.accounts[0]?.type, 'student_loan');
    assert.equal(deferred.accounts[0]?.minPayment, 0);

    const promo = EDGE_HOUSEHOLDS.promoCard();
    assert.equal(promo.accounts[0]?.type, 'credit_card');
    assert.equal(promo.accounts[0]?.payoffStyle, 'revolving');

    const homes = EDGE_HOUSEHOLDS.twoHomes();
    assert.equal(homes.assets.filter((asset) => asset.type === 'home').length, 2);
    assert.equal(homes.featuredHomeId, 'home-a');

    const ev = EDGE_HOUSEHOLDS.ev();
    assert.equal(ev.assets[0]?.name, 'EV');
    assert.equal(ev.assets[0]?.mpg, null);

    const lease = EDGE_HOUSEHOLDS.lease();
    assert.equal(lease.accounts[0]?.name, 'Lease');
    assert.equal(lease.accounts[0]?.minPayment, 389);
  });
});
