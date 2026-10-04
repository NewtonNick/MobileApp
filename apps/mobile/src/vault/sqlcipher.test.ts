import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { sqlcipherKeyPragma } from './sqlcipher';

describe('sqlcipher pragma', () => {
  it('uses a 32-byte hex key and rejects anything else', () => {
    const key = 'cd'.repeat(32);
    assert.equal(sqlcipherKeyPragma(key), `PRAGMA key = "x'${key}'"`);
    assert.throws(() => sqlcipherKeyPragma('not-a-key'));
    assert.throws(() => sqlcipherKeyPragma(`${key}'`));
  });
});
