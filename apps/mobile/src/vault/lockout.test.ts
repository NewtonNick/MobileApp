import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { LOCKOUT_BASE_MS, LOCKOUT_CAP_MS, clearLockout, lockoutAfterFailure, registerFailure } from './lockout';

describe('pin lockout', () => {
  it('waits 30s on the 5th failure, then doubles, capped at 1 hour', () => {
    let state = clearLockout();
    const now = 1_000_000;
    for (let i = 0; i < 4; i++) state = lockoutAfterFailure(state, now);
    assert.equal(state.failures, 4);
    assert.equal(state.nextAllowedAt, 0);
    state = lockoutAfterFailure(state, now);
    assert.equal(state.nextAllowedAt, now + LOCKOUT_BASE_MS);
    state = lockoutAfterFailure({ ...state, nextAllowedAt: 0 }, now);
    assert.equal(state.nextAllowedAt, now + LOCKOUT_BASE_MS * 2);
    const capped = lockoutAfterFailure({ failures: 20, nextAllowedAt: 0 }, now);
    assert.equal(capped.nextAllowedAt, now + LOCKOUT_CAP_MS);
  });

  it('does not add a failure while the wait is still running', () => {
    const now = 5_000;
    const waiting = { failures: 5, nextAllowedAt: now + 1_000 };
    const attempt = registerFailure(waiting, now);
    assert.equal(attempt.rejected, true);
    assert.equal(attempt.state.failures, 5);
    const later = registerFailure(waiting, now + 1_000);
    assert.equal(later.rejected, false);
    assert.equal(later.state.failures, 6);
  });
});
