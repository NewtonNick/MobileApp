import { useState } from 'react';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';

import { useHousehold } from '@/state/context';
import { nextRoute } from '@/state/routing';
import { backupErrorMessage, encryptBackup, MIN_BACKUP_PASSPHRASE } from '@/vault/crypto';
import { pickAndReadBackup, writeBackupFile } from '@/vault/backup-io';
import { Body, Button, Field, Meta, Screen, Title } from '@/ui/primitives';

function appVersion(): string {
  return Constants.expoConfig?.version ?? '0.1.0';
}

export default function RecoveryScreen() {
  const router = useRouter();
  const { vaultError, restoreBackup, eraseAndRestart } = useHousehold();
  const [passphrase, setPassphrase] = useState('');
  const [eraseText, setEraseText] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const restore = (mode: 'current' | 'legacy') => {
    if (busy) return;
    setBusy(true);
    void (async () => {
      try {
        const payload = await pickAndReadBackup(passphrase, mode);
        if (!payload) return;
        const books = await restoreBackup(payload.household, payload.settings);
        if (mode === 'legacy' && passphrase.length >= MIN_BACKUP_PASSPHRASE) {
          try {
            const blob = await encryptBackup(
              { household: payload.household, settings: payload.settings },
              passphrase,
              { appVersion: appVersion(), createdAt: new Date().toISOString() },
            );
            await writeBackupFile(blob);
          } catch {
            /* The books are restored even when the new file is not saved. */
          }
        }
        router.replace(nextRoute(books));
      } catch (error) {
        setMessage(backupErrorMessage(error));
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <Screen>
      <Title>Recover this phone</Title>
      <Body>{vaultError ?? 'The books stay closed until you restore a backup or erase this phone and start over.'}</Body>
      <Field
        accessibilityLabel="Backup passphrase"
        placeholder="Backup passphrase"
        value={passphrase}
        onChangeText={setPassphrase}
        secureTextEntry
        autoCapitalize="none"
      />
      <Button label="Restore from backup" disabled={busy} onPress={() => restore('current')} />
      <Button label="Import an old backup" tone="ghost" disabled={busy} onPress={() => restore('legacy')} />
      <Body>Erase deletes the books, the PIN, and the bank link on this phone. It does not cancel a Google Play subscription. Type ERASE to confirm.</Body>
      <Field
        accessibilityLabel="Type ERASE"
        placeholder="ERASE"
        value={eraseText}
        onChangeText={setEraseText}
        autoCapitalize="characters"
      />
      <Button
        label="Erase and start over"
        tone="danger"
        disabled={busy || eraseText !== 'ERASE'}
        onPress={() => {
          setBusy(true);
          void eraseAndRestart()
            .then(() => setMessage('This phone is empty.'))
            .catch((error: unknown) => setMessage(backupErrorMessage(error)))
            .finally(() => setBusy(false));
        }}
      />
      {message ? <Meta>{message}</Meta> : null}
    </Screen>
  );
}
