import { Platform } from 'react-native';

import type { HouseholdInput, LedgerRow } from '@asset-aware/forecast-engine';
import { kvGet, kvSet } from '@/db/client';
import { applySidecarPage, fetchHealth, fetchSyncPage, pullLinkedBooks } from './sync-decision';

export {
  applySidecarPage,
  fetchHealth,
  fetchSyncPage,
  pullLinkedBooks,
  syncWritesHousehold,
  toPayload,
} from './sync-decision';
export type {
  BankCursorUpdate,
  SidecarAccount,
  SidecarHealth,
  SidecarRecurring,
  SidecarSync,
  SidecarTxn,
} from './sync-decision';

const API = process.env.EXPO_PUBLIC_PLAID_API_URL ?? 'http://127.0.0.1:8787';
const SIDECAR_TOKEN = process.env.EXPO_PUBLIC_PLAID_SIDECAR_TOKEN ?? '';
const CURSOR_KEY = 'plaid-cursors';
const SANDBOX_LEDGER_KEY = 'sandbox-ledger';

export function sidecarUrl(): string {
  return API;
}

function headers(): HeadersInit {
  return {
    'Content-Type': 'application/json',
    'X-Plaid-Sidecar-Token': SIDECAR_TOKEN,
  };
}

async function readJson<T>(res: Response): Promise<T> {
  const json = (await res.json()) as T & { detail?: string };
  if (!res.ok) {
    const detail = typeof json.detail === 'string' ? json.detail : `Bank link failed (${res.status})`;
    throw new Error(detail);
  }
  return json;
}

export function getHealth() {
  return fetchHealth(API);
}

export async function createLinkToken(clientUserId: string, itemId?: string | null): Promise<string> {
  const res = await fetch(`${API}/link/token`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ client_user_id: clientUserId, item_id: itemId ?? null }),
  });
  const json = await readJson<{ link_token: string }>(res);
  return json.link_token;
}

export async function exchangePublicToken(publicToken: string): Promise<string> {
  const res = await fetch(`${API}/item/public_token/exchange`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ public_token: publicToken }),
  });
  const json = await readJson<{ item_id: string }>(res);
  return json.item_id;
}

export function syncItem(itemId: string, cursor: string | null) {
  return fetchSyncPage(API, SIDECAR_TOKEN, itemId, cursor);
}

/** Ask the sidecar to delete the access token. The phone still drops the link if this fails. */
export async function disconnectInstitution(itemId: string): Promise<'removed' | 'phone-only'> {
  const cursors = loadCursors();
  delete cursors[itemId];
  saveCursors(cursors);
  saveSandboxLedger(loadSandboxLedger().filter((row) => row.itemId !== itemId));
  try {
    const res = await fetch(`${API}/item/remove`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ item_id: itemId }),
    });
    if (res.ok || res.status === 404) return 'removed';
  } catch {
    return 'phone-only';
  }
  return 'phone-only';
}

export function loadCursors(): Record<string, string> {
  const raw = kvGet(CURSOR_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function saveCursors(cursors: Record<string, string>): void {
  kvSet(CURSOR_KEY, JSON.stringify(cursors));
}

export function loadSandboxLedger(): LedgerRow[] {
  const raw = kvGet(SANDBOX_LEDGER_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as LedgerRow[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveSandboxLedger(rows: LedgerRow[]): void {
  kvSet(SANDBOX_LEDGER_KEY, JSON.stringify(rows));
}

/** Save the cursor only after the household write succeeds. A crash before that retries this page. */
export function commitBankCursor(update: { itemId: string; cursor: string } | null): void {
  if (!update?.cursor) return;
  const cursors = loadCursors();
  cursors[update.itemId] = update.cursor;
  saveCursors(cursors);
}

/** Trial writes the household. Sandbox returns rows for the sandbox screen only. */
export async function syncInstitution(household: HouseholdInput, itemId: string, sandbox: boolean) {
  const cursors = loadCursors();
  const page = await syncItem(itemId, cursors[itemId] ?? null);
  return applySidecarPage(household, page, sandbox, itemId);
}

/**
 * Trial pull. A thrown sync, including a sidecar that dies mid-page, returns null.
 * The caller keeps the previous books and does not advance cursors.
 */
export function pullLinkedItems(household: HouseholdInput) {
  return pullLinkedBooks(household, {
    health: () => fetchHealth(API),
    syncItem: (itemId, cursor) => fetchSyncPage(API, SIDECAR_TOKEN, itemId, cursor),
    cursorFor: (itemId) => loadCursors()[itemId] ?? null,
  });
}

export async function openBankLink(
  token: string,
): Promise<{ publicToken: string; institutionName: string | null } | null> {
  if (Platform.OS === 'web') {
    throw new Error('Plaid Link runs in the Android dev client.');
  }
  const sdk = await import('react-native-plaid-link-sdk');
  return new Promise((resolve, reject) => {
    let settled = false;
    sdk
      .createPlaidLinkSession({
        token,
        onSuccess: (success) => {
          settled = true;
          resolve({
            publicToken: success.publicToken,
            institutionName: success.metadata.institution?.name ?? null,
          });
        },
        onExit: () => {
          if (!settled) resolve(null);
        },
        onEvent: () => {},
      })
      .then((session) => session.open())
      .catch((error: unknown) => {
        if (!settled) reject(error instanceof Error ? error : new Error('Plaid Link did not open.'));
      });
  });
}
