import { useState } from 'react';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';

import { backupErrorMessage, encryptBackup, MIN_BACKUP_PASSPHRASE } from '@/vault/crypto';
import { pickAndReadBackup, writeBackupFile } from '@/vault/backup-io';
import { plainBooks } from '@/vault/plain-books';
import { reminderLabel, scheduleBackupReminder } from '@/notifications';
import { useHousehold } from '@/state/context';
import { portableSettings } from '@/state/household';
import { nextRoute } from '@/state/routing';
import { confirm } from '@/ui/confirm';
import { Body, Button, Field, Meta, Screen, Title } from '@/ui/primitives';

function appVersion(): string {
  return Constants.expoConfig?.version ?? '0.1.0';
}

export default function BackupScreen() {
  const router = useRouter();
  const { household, settings, patchSettings, restoreBackup } = useHousehold();
  const [passphrase, setPassphrase] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const restore = (mode: 'current' | 'legacy') => {
    confirm('Restore this backup?', 'This replaces the books on this phone.', () => {
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
        }
      })();
    });
  };

  return (
    <Screen>
      <Title>Save your household</Title>
      <Body>A backup means a new phone does not wipe this. Android Auto Backup will not restore the vault.</Body>
      <Meta>
        The file is AES-256-GCM with a scrypt passphrase of at least 10 characters. A plain copy is readable text for
        leaving. It does not restore this app. If you forget the passphrase and have no other copy, this household is
        gone.
      </Meta>
      <Field
        accessibilityLabel="Passphrase for the file"
        placeholder="Passphrase for the file"
        value={passphrase}
        onChangeText={setPassphrase}
        secureTextEntry
        autoCapitalize="none"
      />
      <Button
        label="Save backup"
        onPress={() => {
          void (async () => {
            if (!household || passphrase.length < MIN_BACKUP_PASSPHRASE) {
              setMessage('Need a household and a passphrase of at least 10 characters.');
              return;
            }
            try {
              const blob = await encryptBackup(
                { household, settings: portableSettings(settings) },
                passphrase,
                { appVersion: appVersion(), createdAt: new Date().toISOString() },
              );
              const wrote = await writeBackupFile(blob);
              if (!wrote) {
                setMessage('The backup file was not saved. The household is still on this phone.');
                return;
              }
              if (settings.backupReminderId) {
                try {
                  const Notifications = await import('expo-notifications');
                  await Notifications.cancelScheduledNotificationAsync(settings.backupReminderId);
                } catch {
                  // The reminder may already have fired.
                }
              }
              patchSettings({ lastBackupAt: new Date().toISOString(), backupReminderAt: null, backupReminderId: null });
              setMessage('Backup saved.');
            } catch (error) {
              setMessage(backupErrorMessage(error));
            }
          })();
        }}
      />
      <Button
        label="Export a plain copy"
        tone="ghost"
        onPress={() => {
          void (async () => {
            if (!household) {
              setMessage('Need a household first.');
              return;
            }
            try {
              const text = plainBooks(household);
              const dir = FileSystem.cacheDirectory;
              if (!dir) {
                setMessage('A plain copy needs the Android app. Your household is still on this device.');
                return;
              }
              const path = `${dir}asset-aware-books.txt`;
              await FileSystem.writeAsStringAsync(path, text);
              if (await Sharing.isAvailableAsync()) {
                await Sharing.shareAsync(path, { mimeType: 'text/plain', UTI: 'public.plain-text' });
              }
              setMessage('Plain copy saved. Open it as text. It is not a restore file.');
            } catch {
              setMessage('Could not write the plain copy. The household is still on this device.');
            }
          })();
        }}
      />
      <Button
        label="Remind me tonight"
        tone="ghost"
        onPress={() => {
          void (async () => {
            const scheduled = await scheduleBackupReminder(settings);
            if (!scheduled.ok) {
              setMessage(scheduled.message);
              return;
            }
            patchSettings({ backupReminderAt: scheduled.at, backupReminderId: scheduled.id });
            setMessage(reminderLabel(scheduled.at));
          })();
        }}
      />
      <Button label="Restore from file" tone="ghost" onPress={() => restore('current')} />
      <Button label="Import an old backup" tone="ghost" onPress={() => restore('legacy')} />
      {message ? <Meta>{message}</Meta> : null}
    </Screen>
  );
}
