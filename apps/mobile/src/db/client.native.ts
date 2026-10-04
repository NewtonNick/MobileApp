import { drizzle } from 'drizzle-orm/expo-sqlite';
import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system/legacy';
import { defaultDatabaseDirectory, deleteDatabaseSync, openDatabaseSync, type SQLiteDatabase } from 'expo-sqlite';

import * as schema from '@/db/schema';
import { deleteEnrolledDevice } from '@/plaid/device-delete';
import { VaultKeyMissing } from '@/vault/errors';
import { looksSealed, openText, sealText } from '@/vault/seal';
import { clearVaultSecrets, loadDbKey, saveDbKey } from '@/vault/secure';
import { sqlcipherKeyPragma } from '@/vault/sqlcipher';

const DB_NAME = 'asset-aware-vault.db';
const PROBE_NAME = 'asset-aware-cipher-probe.db';
const STAGING_NAME = 'asset-aware-vault-staging.db';
const PLAIN_BACKUP_NAME = 'asset-aware-vault.plainbak';

let db: SQLiteDatabase | null = null;
let opening: Promise<void> | null = null;
let vaultKey: string | null = null;
/** True when SQLCipher encrypts the file. False when values are AES-256-GCM inside a plain file. */
let fileCipher = false;

function requireKey(): string {
  if (!vaultKey) throw new Error('Vault is not open.');
  return vaultKey;
}

function schemaSql(database: SQLiteDatabase): void {
  database.execSync(`
    CREATE TABLE IF NOT EXISTS kv (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );
    DROP TABLE IF EXISTS bank_txns;
  `);
}

function dumpKv(database: SQLiteDatabase): { key: string; value: string }[] {
  try {
    return database.getAllSync<{ key: string; value: string }>('SELECT key, value FROM kv');
  } catch {
    return [];
  }
}

function storeValue(value: string): string {
  return fileCipher ? value : sealText(value, requireKey());
}

function readValue(value: string): string {
  if (fileCipher || !looksSealed(value)) return value;
  return openText(value, requireKey());
}

async function ensureDbKey(): Promise<string> {
  const existing = (await loadDbKey())?.trim().toLowerCase() ?? '';
  if (/^[0-9a-f]{64}$/.test(existing)) return existing;
  if (existing) {
    throw new Error('The vault key on this phone is unreadable. Books were not opened with a new key.');
  }
  const info = await FileSystem.getInfoAsync(databaseUri());
  if (info.exists) throw new VaultKeyMissing();
  const bytes = await Crypto.getRandomBytesAsync(32);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  await saveDbKey(hex);
  const saved = await loadDbKey();
  if (saved !== hex) throw new Error('The vault key could not be saved. Books were not written.');
  return hex;
}

function databaseUri(name = DB_NAME): string {
  const path = `${defaultDatabaseDirectory}/${name}`;
  return path.startsWith('file:') ? path : `file://${path}`;
}

/** null means no file yet. */
async function existingFileIsPlaintext(): Promise<boolean | null> {
  const info = await FileSystem.getInfoAsync(databaseUri());
  if (!info.exists) return null;
  try {
    const header = await FileSystem.readAsStringAsync(databaseUri(), {
      encoding: FileSystem.EncodingType.Base64,
      position: 0,
      length: 16,
    });
    const bytes = Uint8Array.from(atob(header), (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes).startsWith('SQLite format 3');
  } catch (error) {
    throw error instanceof Error ? error : new Error('The database file could not be read.');
  }
}

function sqlCipherAvailable(key: string): boolean {
  try {
    deleteDatabaseSync(PROBE_NAME);
  } catch {
    /* no probe yet */
  }
  const probe = openDatabaseSync(PROBE_NAME);
  try {
    probe.execSync(sqlcipherKeyPragma(key));
    const row = probe.getFirstSync<{ cipher_version: string | null }>('PRAGMA cipher_version');
    return Boolean(row?.cipher_version);
  } catch {
    return false;
  } finally {
    try {
      probe.closeSync();
    } catch {
      /* already closed */
    }
    try {
      deleteDatabaseSync(PROBE_NAME);
    } catch {
      /* already gone */
    }
  }
}

function applyKey(database: SQLiteDatabase, key: string): void {
  database.execSync(sqlcipherKeyPragma(key));
  const row = database.getFirstSync<{ cipher_version: string | null }>('PRAGMA cipher_version');
  if (!row?.cipher_version) throw new Error('SQLCipher did not open this file.');
}

function unsealRows(database: SQLiteDatabase, key: string): void {
  for (const row of dumpKv(database)) {
    if (!looksSealed(row.value)) continue;
    database.runSync('UPDATE kv SET value = ? WHERE key = ?', openText(row.value, key), row.key);
  }
}

function resealRows(database: SQLiteDatabase, key: string): void {
  for (const row of dumpKv(database)) {
    if (looksSealed(row.value)) continue;
    database.runSync('UPDATE kv SET value = ? WHERE key = ?', sealText(row.value, key), row.key);
  }
}

function writeRows(database: SQLiteDatabase, rows: { key: string; value: string }[]): void {
  for (const row of rows) {
    database.runSync('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)', row.key, row.value);
  }
}

async function removeFile(name: string): Promise<void> {
  try {
    await FileSystem.deleteAsync(databaseUri(name), { idempotent: true });
  } catch {
    /* already gone */
  }
}

/** If a previous migration died after the plaintext file was moved aside, bring the staged cipher file back. */
async function recoverStaging(): Promise<void> {
  const main = await FileSystem.getInfoAsync(databaseUri(DB_NAME));
  const staging = await FileSystem.getInfoAsync(databaseUri(STAGING_NAME));
  if (!main.exists && staging.exists) {
    await FileSystem.moveAsync({ from: databaseUri(STAGING_NAME), to: databaseUri(DB_NAME) });
  }
}

async function migratePlaintextToCipher(key: string): Promise<void> {
  const legacy = openDatabaseSync(DB_NAME);
  const rows = dumpKv(legacy).map((row) => ({
    key: row.key,
    value: looksSealed(row.value) ? openText(row.value, key) : row.value,
  }));
  legacy.closeSync();
  try {
    deleteDatabaseSync(STAGING_NAME);
  } catch {
    /* no staging file yet */
  }
  const staging = openDatabaseSync(STAGING_NAME);
  try {
    applyKey(staging, key);
    schemaSql(staging);
    writeRows(staging, rows);
    if (dumpKv(staging).length !== rows.length) throw new Error('The encrypted copy was incomplete.');
  } catch (error) {
    try {
      staging.closeSync();
    } catch {
      /* already closed */
    }
    try {
      deleteDatabaseSync(STAGING_NAME);
    } catch {
      /* already gone */
    }
    throw error;
  }
  staging.closeSync();
  await removeFile(PLAIN_BACKUP_NAME);
  await FileSystem.moveAsync({ from: databaseUri(DB_NAME), to: databaseUri(PLAIN_BACKUP_NAME) });
  try {
    await FileSystem.moveAsync({ from: databaseUri(STAGING_NAME), to: databaseUri(DB_NAME) });
  } catch (error) {
    const main = await FileSystem.getInfoAsync(databaseUri(DB_NAME));
    if (!main.exists) {
      await FileSystem.moveAsync({ from: databaseUri(PLAIN_BACKUP_NAME), to: databaseUri(DB_NAME) });
    }
    throw error;
  }
  const next = openDatabaseSync(DB_NAME);
  try {
    applyKey(next, key);
    schemaSql(next);
    db = next;
    fileCipher = true;
    await removeFile(PLAIN_BACKUP_NAME);
  } catch {
    try {
      next.closeSync();
    } catch {
      /* leave the failed file */
    }
    try {
      deleteDatabaseSync(DB_NAME);
    } catch {
      /* already gone */
    }
    const bak = await FileSystem.getInfoAsync(databaseUri(PLAIN_BACKUP_NAME));
    if (bak.exists) {
      await FileSystem.moveAsync({ from: databaseUri(PLAIN_BACKUP_NAME), to: databaseUri(DB_NAME) });
    }
    const restored = openDatabaseSync(DB_NAME);
    schemaSql(restored);
    writeRows(
      restored,
      rows.map((row) => ({ key: row.key, value: sealText(row.value, key) })),
    );
    db = restored;
    fileCipher = false;
  }
}

function openSealed(key: string): void {
  db = openDatabaseSync(DB_NAME);
  schemaSql(db);
  fileCipher = false;
  resealRows(db, key);
}

async function openEncrypted(key: string, plain: boolean | null): Promise<void> {
  if (plain === true) {
    await migratePlaintextToCipher(key);
    return;
  }
  db = openDatabaseSync(DB_NAME);
  applyKey(db, key);
  schemaSql(db);
  unsealRows(db, key);
  fileCipher = true;
}

async function openVaultOnce(): Promise<void> {
  const key = await ensureDbKey();
  vaultKey = key;
  await recoverStaging();
  const cipher = sqlCipherAvailable(key);
  const plain = await existingFileIsPlaintext();
  if (cipher) {
    try {
      await openEncrypted(key, plain);
      return;
    } catch (error) {
      if (db && fileCipher === false) throw error;
      if (plain === false) {
        throw new Error('This database is encrypted and this build could not open it.');
      }
      throw error;
    }
  }
  if (plain === false) {
    throw new Error('This database is encrypted. Rebuild the Android dev client so SQLCipher can open it.');
  }
  if (__DEV__) {
    openSealed(key);
    return;
  }
  throw new Error('This build has no SQLCipher, so the books were not opened.');
}

/** Open the on-device books. The key stays in SecureStore, never in household JSON. */
export function openVault(): Promise<void> {
  if (!opening) {
    opening = openVaultOnce().catch((error: unknown) => {
      opening = null;
      throw error;
    });
  }
  return opening;
}

export function databaseFileIsEncrypted(): boolean {
  return fileCipher;
}

async function cancelScheduledNotifications(): Promise<void> {
  try {
    const Notifications = await import('expo-notifications');
    await Notifications.cancelAllScheduledNotificationsAsync();
  } catch {
    /* notifications are unavailable */
  }
}

/** Close the file, delete every vault file, and clear SecureStore. A new key is not minted here. */
export async function eraseVault(): Promise<void> {
  try {
    await deleteEnrolledDevice();
  } catch {
    /* the sidecar can be gone; the phone still erases */
  }
  await cancelScheduledNotifications();
  if (db) {
    try {
      db.closeSync();
    } catch {
      /* already closed */
    }
    db = null;
  }
  vaultKey = null;
  fileCipher = false;
  opening = null;
  for (const name of [DB_NAME, STAGING_NAME, PROBE_NAME, PLAIN_BACKUP_NAME]) {
    try {
      deleteDatabaseSync(name);
    } catch {
      /* not a database file */
    }
    await removeFile(name);
  }
  await clearVaultSecrets();
}

function getDb(): SQLiteDatabase {
  if (!db) throw new Error('Vault is not open.');
  return db;
}

export function kvGet(key: string): string | null {
  const row = getDb().getFirstSync<{ value: string }>('SELECT value FROM kv WHERE key = ?', key);
  if (!row) return null;
  return readValue(row.value);
}

export function kvSet(key: string, value: string): boolean {
  getDb().runSync('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)', key, storeValue(value));
  return true;
}

/** One transaction so household and settings cannot land half-written. */
export function kvSetMany(entries: { key: string; value: string }[]): boolean {
  const database = getDb();
  database.withTransactionSync(() => {
    for (const entry of entries) {
      database.runSync('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)', entry.key, storeValue(entry.value));
    }
  });
  return true;
}

export function kvDelete(key: string): void {
  getDb().runSync('DELETE FROM kv WHERE key = ?', key);
}

export function getDrizzle() {
  return drizzle(getDb(), { schema });
}
