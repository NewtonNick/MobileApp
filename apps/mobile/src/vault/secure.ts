import { Platform } from 'react-native';

import type { PinRecord } from '@/vault/crypto';
import { clearLockout, type LockoutState } from '@/vault/lockout';

const DB_KEY = 'asset-aware-db-key';
const PIN_KEY = 'asset-aware-pin';
const LEGACY_PIN_KEY = 'asset-aware-pin-hash';
const LOCKOUT_KEY = 'asset-aware-lockout';
const BIO_KEY = 'asset-aware-biometrics';
export const DEVICE_ID_KEY = 'asset-aware-device-id';
export const DEVICE_SECRET_KEY = 'asset-aware-device-secret';

const ALL_KEYS = [DB_KEY, PIN_KEY, LEGACY_PIN_KEY, LOCKOUT_KEY, BIO_KEY, DEVICE_ID_KEY, DEVICE_SECRET_KEY];

async function store() {
  if (Platform.OS === 'web') return null;
  return import('expo-secure-store');
}

export async function saveDbKey(value: string) {
  const SecureStore = await store();
  if (!SecureStore) return;
  await SecureStore.setItemAsync(DB_KEY, value);
}

export async function loadDbKey() {
  const SecureStore = await store();
  if (!SecureStore) return null;
  return SecureStore.getItemAsync(DB_KEY);
}

function parsePinRecord(raw: string | null): PinRecord | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PinRecord;
    if (parsed.v === 2 && parsed.salt && parsed.hash && parsed.params) return parsed;
    if (parsed.v === 1 && parsed.hash) return { v: 1, hash: parsed.hash };
  } catch {
    if (/^[0-9a-f]{64}$/i.test(raw)) return { v: 1, hash: raw.toLowerCase() };
  }
  return null;
}

/** Verifier lives in SecureStore, never in the vault file. */
export async function loadPinRecord(): Promise<PinRecord | null> {
  const SecureStore = await store();
  if (!SecureStore) return null;
  const current = parsePinRecord(await SecureStore.getItemAsync(PIN_KEY));
  if (current) return current;
  const legacy = await SecureStore.getItemAsync(LEGACY_PIN_KEY);
  if (legacy && /^[0-9a-f]{64}$/i.test(legacy)) return { v: 1, hash: legacy.toLowerCase() };
  return null;
}

export async function savePinRecord(record: PinRecord): Promise<void> {
  const SecureStore = await store();
  if (!SecureStore) return;
  await SecureStore.setItemAsync(PIN_KEY, JSON.stringify(record));
  try {
    await SecureStore.deleteItemAsync(LEGACY_PIN_KEY);
  } catch {
    /* no legacy hash */
  }
}

export async function clearPinRecord(): Promise<void> {
  const SecureStore = await store();
  if (!SecureStore) return;
  await SecureStore.deleteItemAsync(PIN_KEY).catch(() => undefined);
  await SecureStore.deleteItemAsync(LEGACY_PIN_KEY).catch(() => undefined);
  await SecureStore.deleteItemAsync(BIO_KEY).catch(() => undefined);
}

export async function loadLockout(): Promise<LockoutState> {
  const SecureStore = await store();
  if (!SecureStore) return clearLockout();
  const raw = await SecureStore.getItemAsync(LOCKOUT_KEY);
  if (!raw) return clearLockout();
  try {
    const parsed = JSON.parse(raw) as LockoutState;
    if (typeof parsed.failures === 'number' && typeof parsed.nextAllowedAt === 'number') return parsed;
  } catch {
    /* reset below */
  }
  return clearLockout();
}

export async function saveLockout(state: LockoutState): Promise<void> {
  const SecureStore = await store();
  if (!SecureStore) return;
  await SecureStore.setItemAsync(LOCKOUT_KEY, JSON.stringify(state));
}

export async function loadBiometricsEnabled(): Promise<boolean> {
  const SecureStore = await store();
  if (!SecureStore) return false;
  return (await SecureStore.getItemAsync(BIO_KEY)) === '1';
}

export async function saveBiometricsEnabled(on: boolean): Promise<void> {
  const SecureStore = await store();
  if (!SecureStore) return;
  await SecureStore.setItemAsync(BIO_KEY, on ? '1' : '0');
}

export async function loadDeviceCredential(): Promise<{ deviceId: string; secret: string } | null> {
  const SecureStore = await store();
  if (!SecureStore) return null;
  const deviceId = await SecureStore.getItemAsync(DEVICE_ID_KEY);
  const secret = await SecureStore.getItemAsync(DEVICE_SECRET_KEY);
  if (!deviceId || !secret) return null;
  return { deviceId, secret };
}

export async function clearVaultSecrets(): Promise<void> {
  const SecureStore = await store();
  if (!SecureStore) return;
  await Promise.all(ALL_KEYS.map((key) => SecureStore.deleteItemAsync(key).catch(() => undefined)));
}
