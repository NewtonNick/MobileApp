import { gcm } from '@noble/ciphers/aes.js';
import { equalBytes } from '@noble/ciphers/utils.js';
import { pbkdf2Async } from '@noble/hashes/pbkdf2.js';
import { scryptAsync } from '@noble/hashes/scrypt.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, randomBytes } from '@noble/hashes/utils.js';

function toBytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function fromBytes(b: Uint8Array): string {
  return new TextDecoder().decode(b);
}

function xor(data: Uint8Array, key: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = data[i] ^ key[i % key.length];
  return out;
}

function sha256Hex(text: string): string {
  return bytesToHex(sha256(toBytes(text)));
}

function equalHex(a: string, b: string): boolean {
  if (a.length !== b.length || a.length % 2 !== 0) return false;
  try {
    return equalBytes(hexToBytes(a), hexToBytes(b));
  } catch {
    return false;
  }
}

/** PIN stretching. Parameters are stored with the hash so they can be raised later. */
export const PIN_SCRYPT = { N: 2 ** 15, r: 8, p: 1, dkLen: 32 } as const;

/** Backup passphrase stretching. N=2^17 is the on-disk default. */
export const BACKUP_SCRYPT = { N: 2 ** 17, r: 8, p: 1, dkLen: 32 } as const;

export const BACKUP_FORMAT = 'asset-aware-backup';
export const BACKUP_VERSION = 3;
export const BACKUP_SCHEMA_VERSION = 1;
export const BACKUP_MAX_BYTES = 20 * 1024 * 1024;
export const MIN_BACKUP_PASSPHRASE = 10;

export type PinScryptParams = { N: number; r: number; p: number; dkLen: number };

export type PinRecord =
  | { v: 1; hash: string }
  | { v: 2; salt: string; hash: string; params: PinScryptParams };

export type BackupErrorCode =
  | 'not-a-backup'
  | 'wrong-passphrase'
  | 'newer-version'
  | 'corrupt'
  | 'legacy'
  | 'weak-passphrase'
  | 'too-large';

export class BackupError extends Error {
  readonly code: BackupErrorCode;
  constructor(code: BackupErrorCode, message: string) {
    super(message);
    this.name = 'BackupError';
    this.code = code;
  }
}

export type BackupPayload = {
  household: unknown;
  settings: Record<string, unknown>;
};

export type BackupMeta = {
  appVersion: string;
  createdAt: string;
  schemaVersion?: number;
};

/** Old install-wide SHA-256 PIN. Kept so the first unlock can rehash to scrypt. */
export async function hashPin(pin: string): Promise<string> {
  const salt = sha256Hex('asset-aware-pin-salt');
  return sha256Hex(`${salt}:${pin}`);
}

export async function hashPinV2(pin: string, salt: Uint8Array, params: PinScryptParams = PIN_SCRYPT): Promise<Uint8Array> {
  return scryptAsync(pin, salt, params);
}

export async function createPinRecord(pin: string, params: PinScryptParams = PIN_SCRYPT): Promise<PinRecord> {
  const salt = randomBytes(16);
  const hash = await hashPinV2(pin, salt, params);
  return { v: 2, salt: bytesToHex(salt), hash: bytesToHex(hash), params: { ...params } };
}

export async function verifyPin(pin: string, record: PinRecord): Promise<boolean> {
  if (record.v === 1) {
    const hashed = await hashPin(pin);
    return equalHex(hashed, record.hash.toLowerCase());
  }
  const digest = await hashPinV2(pin, hexToBytes(record.salt), record.params);
  return equalBytes(digest, hexToBytes(record.hash));
}

function keyFromPin(pin: string, salt: string): Uint8Array {
  return sha256(toBytes(`${salt}:${pin}`));
}

async function aesKeyFromPin(pin: string, salt: Uint8Array): Promise<Uint8Array> {
  return pbkdf2Async(sha256, pin, salt, { c: 120_000, dkLen: 32 });
}

/** v1 XOR backup. Tests and the old-import path use this. The app does not save it. */
export async function encryptLegacyXor(payload: unknown, pin: string): Promise<string> {
  const salt = bytesToHex(randomBytes(16));
  const key = keyFromPin(pin, salt);
  const data = xor(toBytes(JSON.stringify(payload)), key);
  return JSON.stringify({ v: 1, salt, data: bytesToHex(data) });
}

async function decryptV1<T>(parsed: { salt: string; data: string }, pin: string): Promise<T> {
  const key = keyFromPin(pin, parsed.salt);
  return JSON.parse(fromBytes(xor(hexToBytes(parsed.data), key))) as T;
}

async function decryptV2<T>(
  parsed: { salt: string; nonce: string; data: string },
  pin: string,
): Promise<T> {
  const key = await aesKeyFromPin(pin, hexToBytes(parsed.salt));
  const cipher = gcm(key, hexToBytes(parsed.nonce));
  return JSON.parse(fromBytes(cipher.decrypt(hexToBytes(parsed.data)))) as T;
}

export async function decryptJson<T>(blob: string, pin: string): Promise<T> {
  const parsed = JSON.parse(blob) as {
    v?: number;
    alg?: string;
    salt: string;
    data: string;
    nonce?: string;
  };
  if (parsed.v === 2 && parsed.alg === 'aes-256-gcm' && parsed.nonce) {
    return decryptV2<T>({ salt: parsed.salt, nonce: parsed.nonce, data: parsed.data }, pin);
  }
  return decryptV1<T>(parsed, pin);
}

type Envelope = {
  format?: string;
  formatVersion?: number;
  schemaVersion?: number;
  appVersion?: string;
  createdAt?: string;
  kdf?: string;
  params?: PinScryptParams;
  salt?: string;
  nonce?: string;
  data?: string;
  v?: number;
  alg?: string;
};

function parseEnvelope(blob: string): Envelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(blob);
  } catch {
    throw new BackupError('not-a-backup', 'That file is not a backup.');
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new BackupError('not-a-backup', 'That file is not a backup.');
  }
  return parsed as Envelope;
}

function asPayload(value: unknown): BackupPayload {
  if (!value || typeof value !== 'object') {
    throw new BackupError('corrupt', 'This backup file is damaged.');
  }
  const record = value as Record<string, unknown>;
  if (record.household && typeof record.household === 'object') {
    const settings =
      record.settings && typeof record.settings === 'object' ? (record.settings as Record<string, unknown>) : {};
    return { household: record.household, settings };
  }
  if ('accounts' in record || 'kind' in record) return { household: value, settings: {} };
  throw new BackupError('corrupt', 'This backup file is damaged.');
}

function isLegacyEnvelope(parsed: Envelope): boolean {
  if (parsed.format === BACKUP_FORMAT) return (parsed.formatVersion ?? 0) < BACKUP_VERSION;
  if (parsed.v === 1) return true;
  if (parsed.v === 2 && parsed.alg === 'aes-256-gcm') return true;
  return typeof parsed.salt === 'string' && typeof parsed.data === 'string' && parsed.format == null;
}

export async function encryptBackup(
  payload: BackupPayload,
  passphrase: string,
  meta: BackupMeta,
  params: PinScryptParams = BACKUP_SCRYPT,
): Promise<string> {
  if (passphrase.length < MIN_BACKUP_PASSPHRASE) {
    throw new BackupError('weak-passphrase', 'Use a passphrase of at least 10 characters.');
  }
  const salt = randomBytes(16);
  const nonce = randomBytes(12);
  const key = await scryptAsync(passphrase, salt, params);
  const cipher = gcm(key, nonce);
  const data = cipher.encrypt(toBytes(JSON.stringify(payload)));
  return JSON.stringify({
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_VERSION,
    schemaVersion: meta.schemaVersion ?? BACKUP_SCHEMA_VERSION,
    appVersion: meta.appVersion,
    createdAt: meta.createdAt,
    kdf: 'scrypt',
    params,
    salt: bytesToHex(salt),
    nonce: bytesToHex(nonce),
    data: bytesToHex(data),
  });
}

/** Current backups only. v1 XOR files throw `legacy` so the import path can take them. */
export async function decryptBackup(blob: string, passphrase: string): Promise<BackupPayload> {
  const parsed = parseEnvelope(blob);
  if (parsed.format !== BACKUP_FORMAT) {
    if (isLegacyEnvelope(parsed)) {
      throw new BackupError('legacy', 'This is an old backup. Use Import old backup.');
    }
    throw new BackupError('not-a-backup', 'That file is not a backup.');
  }
  if ((parsed.formatVersion ?? 0) > BACKUP_VERSION || (parsed.schemaVersion ?? 0) > BACKUP_SCHEMA_VERSION) {
    throw new BackupError('newer-version', 'This backup is from a newer version of the app.');
  }
  if ((parsed.formatVersion ?? 0) < BACKUP_VERSION) {
    throw new BackupError('legacy', 'This is an old backup. Use Import old backup.');
  }
  if (
    parsed.kdf !== 'scrypt' ||
    !parsed.params ||
    typeof parsed.salt !== 'string' ||
    typeof parsed.nonce !== 'string' ||
    typeof parsed.data !== 'string'
  ) {
    throw new BackupError('corrupt', 'This backup file is damaged.');
  }
  let plain: string;
  try {
    const key = await scryptAsync(passphrase, hexToBytes(parsed.salt), parsed.params);
    const cipher = gcm(key, hexToBytes(parsed.nonce));
    plain = fromBytes(cipher.decrypt(hexToBytes(parsed.data)));
  } catch {
    throw new BackupError('wrong-passphrase', 'That passphrase does not open this backup.');
  }
  try {
    return asPayload(JSON.parse(plain) as unknown);
  } catch (error) {
    if (error instanceof BackupError) throw error;
    throw new BackupError('corrupt', 'This backup file is damaged.');
  }
}

/** v1 XOR and v2 PBKDF backups. The caller re-exports the result as v3. */
export async function importLegacyBackup(blob: string, passphrase: string): Promise<BackupPayload> {
  const parsed = parseEnvelope(blob);
  if (parsed.format === BACKUP_FORMAT && (parsed.formatVersion ?? 0) >= BACKUP_VERSION) {
    return decryptBackup(blob, passphrase);
  }
  if (!isLegacyEnvelope(parsed)) {
    throw new BackupError('not-a-backup', 'That file is not a backup.');
  }
  try {
    const value = await decryptJson<unknown>(blob, passphrase);
    return asPayload(value);
  } catch (error) {
    if (error instanceof BackupError) throw error;
    throw new BackupError('wrong-passphrase', 'That passphrase does not open this backup.');
  }
}

export function backupErrorMessage(error: unknown): string {
  if (error instanceof BackupError) return error.message;
  return 'Could not open that file.';
}
