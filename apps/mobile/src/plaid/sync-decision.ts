import { applyBankSync, type BankSyncPayload, type BankTransaction } from '@asset-aware/forecast-engine';
import type { HouseholdInput, LedgerRow } from '@asset-aware/forecast-engine';

/**
 * Sidecar JSON and the write-or-keep decision. No device database and no Plaid SDK.
 * Trial writes the household. Anything else, including a dead health check, does not.
 */

export interface SidecarHealth {
  ok: boolean;
  env: string;
  paid_production: boolean;
}

export interface SidecarAccount {
  plaid_account_id: string;
  name: string;
  kind: 'checking' | 'savings' | 'credit' | 'other';
  current: number | null;
}

export interface SidecarTxn {
  id: string;
  amount: number;
  merchant: string;
  date: string;
  pending: boolean;
  pending_transaction_id: string | null;
  account_id: string | null;
  primary: string | null;
  detailed: string | null;
  confidence: string | null;
  legacy_category: string[];
}

export interface SidecarRecurring {
  merchant: string;
  amount: number;
  frequency: string;
  next_date: string | null;
  last_date: string | null;
  primary: string | null;
  detailed: string | null;
}

export interface SidecarSync {
  item_id: string;
  next_cursor: string;
  login_required: boolean;
  accounts: SidecarAccount[];
  added: SidecarTxn[];
  modified: SidecarTxn[];
  removed: string[];
  /** Absent on an older sidecar. An empty list means the bank listed no repeating charges. */
  recurring?: SidecarRecurring[];
}

export interface BankCursorUpdate {
  itemId: string;
  cursor: string;
}

export interface SidecarPageResult {
  household: HouseholdInput;
  sandboxLedger: LedgerRow[] | null;
  cursor: BankCursorUpdate | null;
}

/** Only a live trial health check may write balances and spend onto the household. */
export function syncWritesHousehold(health: { env: string } | null | undefined): boolean {
  return health?.env === 'trial';
}

function toTxn(row: SidecarTxn): BankTransaction {
  return {
    id: row.id,
    amount: row.amount,
    merchant: row.merchant,
    date: row.date,
    pending: row.pending,
    pendingTransactionId: row.pending_transaction_id,
    accountId: row.account_id,
    primary: row.primary,
    detailed: row.detailed,
    confidence: row.confidence,
    legacyCategory: row.legacy_category,
  };
}

export function toPayload(page: SidecarSync): BankSyncPayload {
  return {
    itemId: page.item_id,
    loginRequired: page.login_required,
    accounts: page.login_required
      ? undefined
      : page.accounts.map((account) => ({
          plaidAccountId: account.plaid_account_id,
          name: account.name,
          kind: account.kind,
          current: account.current,
        })),
    added: page.added.map(toTxn),
    modified: page.modified.map(toTxn),
    removed: page.removed,
    recurring:
      page.login_required || page.recurring == null
        ? undefined
        : page.recurring.map((stream) => ({
            merchant: stream.merchant,
            amount: stream.amount,
            frequency: stream.frequency,
            nextDate: stream.next_date,
            lastDate: stream.last_date,
            primary: stream.primary,
            detailed: stream.detailed,
          })),
  };
}

/**
 * Apply one sidecar page. The cursor is returned only after a trial write that finished.
 * Sandbox and a dead login leave it null so the caller retries this page.
 */
export function applySidecarPage(
  household: HouseholdInput,
  page: SidecarSync,
  sandbox: boolean,
  itemId: string,
  now = new Date(),
): SidecarPageResult {
  const result = applyBankSync(household, toPayload(page), { sandbox, now });
  const cursor =
    !sandbox && !page.login_required && page.next_cursor ? { itemId, cursor: page.next_cursor } : null;
  return { household: result.household, sandboxLedger: result.sandboxLedger, cursor };
}

export async function fetchHealth(baseUrl: string): Promise<SidecarHealth | null> {
  try {
    const res = await fetch(`${baseUrl}/health`);
    if (!res.ok) return null;
    return (await res.json()) as SidecarHealth;
  } catch {
    return null;
  }
}

export async function fetchSyncPage(
  baseUrl: string,
  token: string,
  itemId: string,
  cursor: string | null,
): Promise<SidecarSync> {
  const res = await fetch(`${baseUrl}/transactions/sync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Plaid-Sidecar-Token': token,
    },
    body: JSON.stringify({ item_id: itemId, cursor }),
  });
  const json = (await res.json()) as SidecarSync & { detail?: string };
  if (!res.ok) {
    const detail = typeof json.detail === 'string' ? json.detail : `Bank link failed (${res.status})`;
    throw new Error(detail);
  }
  return json;
}

/**
 * Trial pull. A thrown sync, including a sidecar that dies mid-page, returns null.
 * The caller keeps the previous books and does not advance cursors.
 */
export async function pullLinkedBooks(
  household: HouseholdInput,
  io: {
    health: () => Promise<{ env: string } | null>;
    syncItem: (itemId: string, cursor: string | null) => Promise<SidecarSync>;
    cursorFor: (itemId: string) => string | null;
    now?: Date;
  },
): Promise<{ household: HouseholdInput; cursors: BankCursorUpdate[] } | null> {
  const items = household.plaidItems ?? [];
  if (!items.length) return null;
  const health = await io.health();
  if (!syncWritesHousehold(health)) return null;
  let next = household;
  const cursors: BankCursorUpdate[] = [];
  try {
    for (const item of items) {
      const page = await io.syncItem(item.itemId, io.cursorFor(item.itemId));
      const result = applySidecarPage(next, page, false, item.itemId, io.now);
      next = result.household;
      if (result.cursor) cursors.push(result.cursor);
    }
  } catch {
    return null;
  }
  return { household: next, cursors };
}
