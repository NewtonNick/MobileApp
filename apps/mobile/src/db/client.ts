/** Web preview: memory only. Nothing is written to localStorage. Native uses client.native.ts. */

const memory = new Map<string, string>();

/** Web has no SQLite file. Native opens an encrypted vault before the first read. */
export async function openVault(): Promise<void> {}

export async function eraseVault(): Promise<void> {
  memory.clear();
}

export function databaseFileIsEncrypted(): boolean {
  return false;
}

export function kvGet(key: string): string | null {
  return memory.get(key) ?? null;
}

export function kvSet(key: string, value: string): boolean {
  memory.set(key, value);
  return true;
}

export function kvSetMany(entries: { key: string; value: string }[]): boolean {
  for (const entry of entries) memory.set(entry.key, entry.value);
  return true;
}

export function kvDelete(key: string): void {
  memory.delete(key);
}
