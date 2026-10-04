import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, it } from 'node:test';

import { addTypedSpend, categorySpent } from '@asset-aware/forecast-engine';
import { emptyRealHousehold } from '@asset-aware/forecast-engine';
import type { HouseholdInput } from '@asset-aware/forecast-engine';
import {
  applySidecarPage,
  fetchHealth,
  fetchSyncPage,
  pullLinkedBooks,
  syncWritesHousehold,
  type BankCursorUpdate,
  type SidecarSync,
} from './sync-decision';

const NOW = new Date('2026-09-26T15:00:00.000Z');
const TOKEN = 'test-token';

function books(): HouseholdInput {
  const household = emptyRealHousehold('10001');
  household.createdAt = '2026-08-01T00:00:00.000Z';
  household.monthlyIncome = 5000;
  household.accounts = [
    { id: 'chk', type: 'checking', name: 'Checking', balance: 2000, lastEditedAt: '2026-08-01T00:00:00.000Z' },
  ];
  household.plaidItems = [
    {
      itemId: 'item-1',
      institutionName: 'First Bank',
      lastSyncedAt: '2026-09-01T00:00:00.000Z',
      loginRequired: false,
      accounts: [{ plaidAccountId: 'acc-chk', localAccountId: 'chk', name: 'Checking', kind: 'checking' }],
    },
  ];
  return addTypedSpend(household, { merchant: 'Cafe', amount: 6, category: 'groceries', date: '2026-09-08' });
}

function page(partial: Partial<SidecarSync> = {}): SidecarSync {
  return {
    item_id: 'item-1',
    next_cursor: 'cursor-2',
    login_required: false,
    accounts: [{ plaid_account_id: 'acc-chk', name: 'Checking', kind: 'checking', current: 1500 }],
    added: [
      {
        id: 'bank-1',
        amount: 6,
        merchant: 'CAFE',
        date: '2026-09-10',
        pending: false,
        pending_transaction_id: null,
        account_id: 'acc-chk',
        primary: 'FOOD_AND_DRINK',
        detailed: 'FOOD_AND_DRINK_GROCERIES',
        confidence: 'HIGH',
        legacy_category: [],
      },
    ],
    modified: [],
    removed: [],
    ...partial,
  };
}

function listen(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<{ base: string; close: () => Promise<void> }> {
  const server = createServer(handler);
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      resolve({
        base: `http://127.0.0.1:${address.port}`,
        close: () =>
          new Promise((done, fail) => {
            server.close((error) => (error ? fail(error) : done()));
          }),
      });
    });
    server.on('error', reject);
  });
}

function accept(
  household: HouseholdInput,
  pulled: { household: HouseholdInput; cursors: BankCursorUpdate[] } | null,
  cursors: Record<string, string>,
): HouseholdInput {
  if (!pulled) return household;
  for (const update of pulled.cursors) cursors[update.itemId] = update.cursor;
  return pulled.household;
}

describe('sidecar sync decision', () => {
  it('writes the balance and keeps one $6 when trial syncs the same merchant', async () => {
    let sentCursor: string | null = null;
    const server = await listen((req, res) => {
      if (req.url === '/health') {
        res.end(JSON.stringify({ ok: true, env: 'trial', paid_production: false }));
        return;
      }
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        sentCursor = JSON.parse(Buffer.concat(chunks).toString()).cursor;
        res.end(JSON.stringify(page()));
      });
    });
    try {
      const household = books();
      const cursors: Record<string, string> = { 'item-1': 'old-cursor' };
      const health = await fetchHealth(server.base);
      assert.equal(syncWritesHousehold(health), true);
      const pulled = await pullLinkedBooks(household, {
        health: () => fetchHealth(server.base),
        syncItem: (itemId, cursor) => fetchSyncPage(server.base, TOKEN, itemId, cursor),
        cursorFor: (itemId) => cursors[itemId] ?? null,
        now: NOW,
      });
      const next = accept(household, pulled, cursors);
      assert.equal(sentCursor, 'old-cursor');
      assert.equal(next.accounts.find((account) => account.id === 'chk')?.balance, 1500);
      assert.equal(categorySpent(next.ledger ?? [], '2026-09', 'groceries'), 6);
      assert.equal(next.ledger?.some((row) => row.id === 'bank-1'), false);
      assert.equal(next.ledger?.some((row) => row.source === 'typed' && row.merchant === 'Cafe'), true);
      assert.equal(cursors['item-1'], 'cursor-2');
    } finally {
      await server.close();
    }
  });

  it('leaves the household unchanged when health is sandbox or down', async () => {
    let syncs = 0;
    const server = await listen((req, res) => {
      if (req.url === '/health') {
        res.end(JSON.stringify({ ok: true, env: 'sandbox', paid_production: false }));
        return;
      }
      syncs += 1;
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => res.end(JSON.stringify(page())));
    });
    try {
      const household = books();
      const before = JSON.stringify(household);
      const health = await fetchHealth(server.base);
      const sandbox = !syncWritesHousehold(health);
      assert.equal(sandbox, true);
      const opened = await pullLinkedBooks(household, {
        health: () => fetchHealth(server.base),
        syncItem: (itemId, cursor) => fetchSyncPage(server.base, TOKEN, itemId, cursor),
        cursorFor: () => null,
        now: NOW,
      });
      assert.equal(opened, null);
      assert.equal(syncs, 0);
      const linked = applySidecarPage(
        household,
        await fetchSyncPage(server.base, TOKEN, 'item-1', null),
        sandbox,
        'item-1',
        NOW,
      );
      assert.equal(JSON.stringify(linked.household), before);
      assert.equal(linked.sandboxLedger?.length, 1);
      assert.equal(linked.cursor, null);
      assert.equal(syncs, 1);
    } finally {
      await server.close();
    }

    const down = await listen((_req, res) => {
      res.statusCode = 500;
      res.end('no');
    });
    try {
      const household = books();
      assert.equal(await fetchHealth(down.base), null);
      assert.equal(syncWritesHousehold(null), false);
      const pulled = await pullLinkedBooks(household, {
        health: () => fetchHealth(down.base),
        syncItem: (itemId, cursor) => fetchSyncPage(down.base, TOKEN, itemId, cursor),
        cursorFor: () => 'old-cursor',
        now: NOW,
      });
      assert.equal(pulled, null);
      assert.equal(household.accounts.find((account) => account.id === 'chk')?.balance, 2000);
    } finally {
      await down.close();
    }
  });

  it('keeps the previous books and cursor when the sidecar fails or dies mid-sync', async () => {
    const failed = await listen((_req, res) => {
      if (_req.url === '/health') {
        res.end(JSON.stringify({ ok: true, env: 'trial', paid_production: false }));
        return;
      }
      res.statusCode = 502;
      res.end(JSON.stringify({ detail: 'Plaid did not finish the sync. Balances were left as they were.' }));
    });
    try {
      const household = books();
      const before = JSON.stringify(household);
      const cursors: Record<string, string> = { 'item-1': 'old-cursor' };
      const pulled = await pullLinkedBooks(household, {
        health: () => fetchHealth(failed.base),
        syncItem: (itemId, cursor) => fetchSyncPage(failed.base, TOKEN, itemId, cursor),
        cursorFor: (itemId) => cursors[itemId] ?? null,
        now: NOW,
      });
      const next = accept(household, pulled, cursors);
      assert.equal(pulled, null);
      assert.equal(JSON.stringify(next), before);
      assert.equal(cursors['item-1'], 'old-cursor');
    } finally {
      await failed.close();
    }

    let calls = 0;
    const dropped = await listen((req, res) => {
      if (req.url === '/health') {
        res.end(JSON.stringify({ ok: true, env: 'trial', paid_production: false }));
        return;
      }
      calls += 1;
      if (calls === 1) {
        const chunks: Buffer[] = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => res.end(JSON.stringify(page({ item_id: 'item-1' }))));
        return;
      }
      req.socket.destroy();
    });
    try {
      const household = books();
      household.plaidItems = [
        ...(household.plaidItems ?? []),
        {
          itemId: 'item-2',
          institutionName: 'Card',
          lastSyncedAt: '2026-09-01T00:00:00.000Z',
          loginRequired: false,
          accounts: [],
        },
      ];
      const before = JSON.stringify(household);
      const cursors: Record<string, string> = { 'item-1': 'old-1', 'item-2': 'old-2' };
      const pulled = await pullLinkedBooks(household, {
        health: () => fetchHealth(dropped.base),
        syncItem: (itemId, cursor) => fetchSyncPage(dropped.base, TOKEN, itemId, cursor),
        cursorFor: (itemId) => cursors[itemId] ?? null,
        now: NOW,
      });
      assert.equal(pulled, null);
      assert.equal(JSON.stringify(household), before);
      assert.equal(cursors['item-1'], 'old-1');
      assert.equal(cursors['item-2'], 'old-2');
      assert.equal(calls, 2);
    } finally {
      await dropped.close();
    }
  });

  it('marks a dead login and keeps the last balance and the typed $6', async () => {
    const server = await listen((req, res) => {
      if (req.url === '/health') {
        res.end(JSON.stringify({ ok: true, env: 'trial', paid_production: false }));
        return;
      }
      res.end(
        JSON.stringify(
          page({
            login_required: true,
            next_cursor: 'should-not-save',
            accounts: [],
            added: [],
          }),
        ),
      );
    });
    try {
      const household = books();
      const cursors: Record<string, string> = { 'item-1': 'old-cursor' };
      const pulled = await pullLinkedBooks(household, {
        health: () => fetchHealth(server.base),
        syncItem: (itemId, cursor) => fetchSyncPage(server.base, TOKEN, itemId, cursor),
        cursorFor: (itemId) => cursors[itemId] ?? null,
        now: NOW,
      });
      const next = accept(household, pulled, cursors);
      assert.equal(next.plaidItems?.[0].loginRequired, true);
      assert.equal(next.accounts.find((account) => account.id === 'chk')?.balance, 2000);
      assert.equal(categorySpent(next.ledger ?? [], '2026-09', 'groceries'), 6);
      assert.equal(cursors['item-1'], 'old-cursor');
    } finally {
      await server.close();
    }
  });
});
