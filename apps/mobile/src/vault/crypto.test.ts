import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  BACKUP_SCHEMA_VERSION,
  BACKUP_SCRYPT,
  BACKUP_VERSION,
  BackupError,
  createPinRecord,
  decryptBackup,
  encryptBackup,
  encryptLegacyXor,
  hashPin,
  importLegacyBackup,
  verifyPin,
} from './crypto';

const tiny = { N: 2 ** 4, r: 8, p: 1, dkLen: 32 };
const household = { kind: 'real', accounts: [], assets: [] };

describe('pin verifier', () => {
  it('keeps the old SHA hash stable and accepts it as v1', async () => {
    const first = await hashPin('1234');
    assert.equal(await hashPin('1234'), first);
    assert.equal(await verifyPin('1234', { v: 1, hash: first }), true);
    assert.equal(await verifyPin('9999', { v: 1, hash: first }), false);
  });

  it('stores a salted scrypt hash and rejects a different PIN', async () => {
    const record = await createPinRecord('1234', tiny);
    const other = await createPinRecord('1234', tiny);
    assert.equal(record.v, 2);
    assert.equal(other.v, 2);
    if (record.v !== 2 || other.v !== 2) return;
    assert.equal(await verifyPin('1234', record), true);
    assert.equal(await verifyPin('1235', record), false);
    assert.notEqual(record.salt, other.salt);
    assert.notEqual(record.hash, other.hash);
  });
});

describe('backup v3', () => {
  it('uses scrypt N=2^17 and schema version 1', () => {
    assert.equal(BACKUP_SCRYPT.N, 2 ** 17);
    assert.equal(BACKUP_VERSION, 3);
    assert.equal(BACKUP_SCHEMA_VERSION, 1);
  });

  it('round-trips household and settings', async () => {
    const blob = await encryptBackup(
      { household, settings: { scenario: 'realistic', sawDisclaimer: true } },
      'correct horse',
      { appVersion: '0.1.0', createdAt: '2026-09-30T00:00:00.000Z' },
      tiny,
    );
    const header = JSON.parse(blob) as { formatVersion: number; schemaVersion: number; appVersion: string; createdAt: string };
    assert.equal(header.formatVersion, 3);
    assert.equal(header.schemaVersion, 1);
    assert.equal(header.appVersion, '0.1.0');
    assert.equal(header.createdAt, '2026-09-30T00:00:00.000Z');
    assert.equal(blob.includes('realistic'), false);
    const opened = await decryptBackup(blob, 'correct horse');
    assert.deepEqual(opened.household, household);
    assert.equal(opened.settings.scenario, 'realistic');
  });

  it('rejects a short passphrase, the wrong passphrase, a newer file, and a non-backup', async () => {
    await assert.rejects(
      () => encryptBackup({ household, settings: {} }, 'short', { appVersion: '0.1.0', createdAt: '2026-09-30' }, tiny),
      (error: unknown) => error instanceof BackupError && error.code === 'weak-passphrase',
    );
    const blob = await encryptBackup(
      { household, settings: {} },
      'correct horse',
      { appVersion: '0.1.0', createdAt: '2026-09-30' },
      tiny,
    );
    await assert.rejects(
      () => decryptBackup(blob, 'wrong horse!'),
      (error: unknown) => error instanceof BackupError && error.code === 'wrong-passphrase',
    );
    const newer = JSON.parse(blob) as { formatVersion: number };
    newer.formatVersion = 4;
    await assert.rejects(
      () => decryptBackup(JSON.stringify(newer), 'correct horse'),
      (error: unknown) => error instanceof BackupError && error.code === 'newer-version',
    );
    await assert.rejects(
      () => decryptBackup('{"hello":1}', 'correct horse'),
      (error: unknown) => error instanceof BackupError && error.code === 'not-a-backup',
    );
  });

  it('rejects a v1 XOR file on the current path and imports it for a v3 re-export', async () => {
    const legacy = await encryptLegacyXor(household, 'old-pin');
    await assert.rejects(
      () => decryptBackup(legacy, 'old-pin'),
      (error: unknown) => error instanceof BackupError && error.code === 'legacy',
    );
    const imported = await importLegacyBackup(legacy, 'old-pin');
    assert.deepEqual(imported.household, household);
    const current = await encryptBackup(imported, 'correct horse', { appVersion: '0.1.0', createdAt: '2026-09-30' }, tiny);
    const opened = await decryptBackup(current, 'correct horse');
    assert.deepEqual(opened.household, household);
  });
});
