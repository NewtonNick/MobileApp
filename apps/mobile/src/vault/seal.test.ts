import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { looksSealed, openText, sealText } from './seal';

describe('vault seal', () => {
  it('round-trips books and does not store the key or the plaintext', () => {
    const key = 'ab'.repeat(32);
    const plain = JSON.stringify({ monthlyIncome: 5000, accounts: [{ balance: 2000 }] });
    const sealed = sealText(plain, key);
    assert.equal(looksSealed(sealed), true);
    assert.equal(sealed.includes('5000'), false);
    assert.equal(sealed.includes(key), false);
    assert.equal(openText(sealed, key), plain);
  });
});
