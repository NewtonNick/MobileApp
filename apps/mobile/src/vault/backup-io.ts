import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import { BACKUP_MAX_BYTES, BackupError, decryptBackup, importLegacyBackup, type BackupPayload } from '@/vault/crypto';

/** Read a backup only after the size is known. A missing size still checks the file. */
export async function readBackupText(uri: string, knownSize?: number | null): Promise<string> {
  if (knownSize != null && knownSize > BACKUP_MAX_BYTES) {
    throw new BackupError('too-large', 'That file is larger than 20 MB.');
  }
  const info = await FileSystem.getInfoAsync(uri);
  if (info.exists && info.size > BACKUP_MAX_BYTES) {
    throw new BackupError('too-large', 'That file is larger than 20 MB.');
  }
  return FileSystem.readAsStringAsync(uri);
}

/** Null when the picker is cancelled. */
export async function pickAndReadBackup(passphrase: string, mode: 'current' | 'legacy'): Promise<BackupPayload | null> {
  const pick = await DocumentPicker.getDocumentAsync({
    type: ['application/json', 'text/plain'],
    copyToCacheDirectory: true,
  });
  if (pick.canceled || !pick.assets[0]) return null;
  const asset = pick.assets[0];
  const raw = await readBackupText(asset.uri, asset.size);
  return mode === 'legacy' ? importLegacyBackup(raw, passphrase) : decryptBackup(raw, passphrase);
}

/**
 * Android writes through the Storage Access Framework and returns true only after that write.
 * Other platforms share a cache file and return true when the share sheet finishes.
 */
export async function writeBackupFile(contents: string): Promise<boolean> {
  if (Platform.OS === 'android') {
    const perm = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
    if (!perm.granted) return false;
    const uri = await FileSystem.StorageAccessFramework.createFileAsync(
      perm.directoryUri,
      'asset-aware-backup.json',
      'application/json',
    );
    await FileSystem.writeAsStringAsync(uri, contents);
    return true;
  }
  const dir = FileSystem.cacheDirectory;
  if (!dir) return false;
  const path = `${dir}asset-aware-backup.json`;
  await FileSystem.writeAsStringAsync(path, contents);
  if (!(await Sharing.isAvailableAsync())) return false;
  await Sharing.shareAsync(path, { mimeType: 'application/json', UTI: 'public.json' });
  return true;
}
