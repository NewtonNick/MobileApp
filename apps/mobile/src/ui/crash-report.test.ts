import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { formatCrashReport } from './crash-report';

describe('crash report', () => {
  it('keeps the message and drops nothing the caller did not pass', () => {
    const text = formatCrashReport('Cannot read balance', '\n    at CashHome');
    assert.match(text, /^Asset Aware stopped\./);
    assert.match(text, /Cannot read balance/);
    assert.match(text, /at CashHome/);
    assert.equal(text.includes('household'), false);
  });

  it('caps a huge stack', () => {
    const text = formatCrashReport('boom', 'x'.repeat(8000));
    assert.equal(text.length, 4000);
  });
});
