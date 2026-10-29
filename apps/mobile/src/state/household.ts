import {
  findDuplicateGuesses,
  normalizeHousehold,
  openGoalBoard,
  previewHousehold,
  runAllScenarios,
  runMonteCarloFan,
  standing,
  type DuplicateGuess,
  type HouseholdInput,
  type JobClass,
  type Scenario,
  PREVIEW_HOUSEHOLD_ID,
} from '@asset-aware/forecast-engine';
import { kvGet, kvSet, kvSetMany } from '@/db/client';
import { seedBundle } from '@/lib/seed';
import { HouseholdUnreadable } from '@/vault/errors';

const HOUSE_KEY = 'household';
const SETTINGS_KEY = 'settings';

/** Bump when the disclaimer wording changes so Continue is asked again. */
export const DISCLAIMER_VERSION = 1;
/** Bump when the Terms wording changes so acceptance is asked again. */
export const TERMS_VERSION = 1;

export interface AppSettings {
  scenario: Scenario;
  showNominal: boolean;
  sawDisclaimer: boolean;
  lastBackupAt: string | null;
  backupReminderAt: string | null;
  /** Scheduled notification id for the backup reminder. Not household books. */
  backupReminderId: string | null;
  notificationMode: 'daily' | 'outliers' | 'off';
  allClearCount: number;
  lastNotificationAt: string | null;
  /** Looks-wrong “I’m not on 4%”. Null means the engine default. Not stored on household JSON. */
  withdrawalRate: number | null;
  /** `YYYY-MM` of the last return nudge that actually notified. Not household books. */
  lastReturnNudgeMonth: string | null;
  /** Stays up after a collision is marked, until the bank link is current. */
  collisionBankAsk: boolean;
  /** Light, dark, or follow the phone. */
  appearance: 'system' | 'light' | 'dark';
  /** Matches DISCLAIMER_VERSION after the person accepts that wording. */
  disclaimerVersion: number;
  /** ISO time of the latest disclaimer acceptance. */
  disclaimerAcceptedAt: string | null;
  /** Matches TERMS_VERSION after the person accepts that wording. */
  termsVersion: number;
  /** ISO time of the latest Terms acceptance, including the 18+ attestation. */
  termsAcceptedAt: string | null;
}

export const defaultSettings = (): AppSettings => ({
  scenario: 'realistic',
  showNominal: false,
  sawDisclaimer: false,
  lastBackupAt: null,
  backupReminderAt: null,
  backupReminderId: null,
  notificationMode: 'off',
  allClearCount: 0,
  lastNotificationAt: null,
  withdrawalRate: null,
  lastReturnNudgeMonth: null,
  collisionBankAsk: false,
  appearance: 'system',
  disclaimerVersion: 0,
  disclaimerAcceptedAt: null,
  termsVersion: 0,
  termsAcceptedAt: null,
});

export function loadHousehold(): HouseholdInput | null {
  const raw = kvGet(HOUSE_KEY);
  if (!raw) return null;
  try {
    return normalizeHousehold(JSON.parse(raw));
  } catch (error) {
    if (error instanceof HouseholdUnreadable) throw error;
    throw new HouseholdUnreadable();
  }
}

export function saveHousehold(h: HouseholdInput): void {
  const wrote = kvSet(HOUSE_KEY, JSON.stringify(normalizeHousehold(h)));
  if (wrote === false) throw new Error('The books could not be saved.');
}

export type PortableSettings = Pick<
  AppSettings,
  | 'scenario'
  | 'showNominal'
  | 'appearance'
  | 'withdrawalRate'
  | 'notificationMode'
  | 'sawDisclaimer'
  | 'disclaimerVersion'
  | 'disclaimerAcceptedAt'
  | 'termsVersion'
  | 'termsAcceptedAt'
  | 'collisionBankAsk'
>;

export function portableSettings(settings: AppSettings): PortableSettings {
  return {
    scenario: settings.scenario,
    showNominal: settings.showNominal,
    appearance: settings.appearance,
    withdrawalRate: settings.withdrawalRate,
    notificationMode: settings.notificationMode,
    sawDisclaimer: settings.sawDisclaimer,
    disclaimerVersion: settings.disclaimerVersion,
    disclaimerAcceptedAt: settings.disclaimerAcceptedAt,
    termsVersion: settings.termsVersion,
    termsAcceptedAt: settings.termsAcceptedAt,
    collisionBankAsk: settings.collisionBankAsk,
  };
}

export function portableSettingsFrom(raw: unknown): Partial<AppSettings> {
  if (!raw || typeof raw !== 'object') return {};
  const record = raw as Record<string, unknown>;
  const out: Partial<AppSettings> = {};
  if (record.scenario === 'liberal' || record.scenario === 'realistic' || record.scenario === 'conservative') {
    out.scenario = record.scenario;
  }
  if (typeof record.showNominal === 'boolean') out.showNominal = record.showNominal;
  if (record.appearance === 'system' || record.appearance === 'light' || record.appearance === 'dark') {
    out.appearance = record.appearance;
  }
  if (record.withdrawalRate === null || typeof record.withdrawalRate === 'number') {
    out.withdrawalRate = record.withdrawalRate;
  }
  if (record.notificationMode === 'daily' || record.notificationMode === 'outliers' || record.notificationMode === 'off') {
    out.notificationMode = record.notificationMode;
  }
  if (typeof record.sawDisclaimer === 'boolean') out.sawDisclaimer = record.sawDisclaimer;
  if (typeof record.disclaimerVersion === 'number') out.disclaimerVersion = record.disclaimerVersion;
  if (typeof record.disclaimerAcceptedAt === 'string' || record.disclaimerAcceptedAt === null) {
    out.disclaimerAcceptedAt = record.disclaimerAcceptedAt;
  }
  if (typeof record.termsVersion === 'number') out.termsVersion = record.termsVersion;
  if (typeof record.termsAcceptedAt === 'string' || record.termsAcceptedAt === null) {
    out.termsAcceptedAt = record.termsAcceptedAt;
  }
  if (typeof record.collisionBankAsk === 'boolean') out.collisionBankAsk = record.collisionBankAsk;
  return out;
}

export function loadSettings(): AppSettings {
  const raw = kvGet(SETTINGS_KEY);
  if (!raw) return defaultSettings();
  try {
    const parsed = JSON.parse(raw) as Partial<AppSettings> & { pinHash?: unknown };
    const { pinHash: _pin, ...rest } = parsed;
    const merged = { ...defaultSettings(), ...rest };
    if (merged.disclaimerVersion !== DISCLAIMER_VERSION || merged.termsVersion !== TERMS_VERSION) {
      merged.sawDisclaimer = false;
    }
    return merged;
  } catch {
    return defaultSettings();
  }
}

/** Old PIN hash stored inside the vault. Read so it can move to SecureStore before the next unlock. */
export function readLegacyPinHash(): string | null {
  const raw = kvGet(SETTINGS_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { pinHash?: unknown };
    return typeof parsed.pinHash === 'string' && parsed.pinHash.length > 0 ? parsed.pinHash : null;
  } catch {
    return null;
  }
}

/** Drop the in-vault PIN hash after a successful unlock. A parse failure leaves the file alone. */
export function stripLegacyPinHash(): void {
  const raw = kvGet(SETTINGS_KEY);
  if (!raw || !raw.includes('pinHash')) return;
  try {
    const parsed = JSON.parse(raw) as Partial<AppSettings> & { pinHash?: unknown };
    if (!('pinHash' in parsed)) return;
    delete parsed.pinHash;
    saveSettings({ ...defaultSettings(), ...parsed });
  } catch {
    /* leave the file */
  }
}

export function saveSettings(s: AppSettings): void {
  const wrote = kvSet(SETTINGS_KEY, JSON.stringify(s));
  if (wrote === false) throw new Error('Settings could not be saved.');
}

/** Household and settings land in one transaction. */
export function saveAll(input: { household?: HouseholdInput; settings?: AppSettings }): void {
  const entries: { key: string; value: string }[] = [];
  if (input.household) entries.push({ key: HOUSE_KEY, value: JSON.stringify(normalizeHousehold(input.household)) });
  if (input.settings) entries.push({ key: SETTINGS_KEY, value: JSON.stringify(input.settings) });
  if (!entries.length) return;
  const wrote = kvSetMany(entries);
  if (wrote === false) throw new Error('The books could not be saved.');
}

export function startPreview(jobClass?: JobClass): HouseholdInput {
  return previewHousehold('10001', jobClass);
}

export function assertNoPreviewLeak(h: HouseholdInput): void {
  if (h.kind === 'real' && h.id === PREVIEW_HOUSEHOLD_ID) {
    throw new Error('Preview household leaked into real books');
  }
  if (h.kind === 'real' && h.assets.some((a) => a.id.startsWith('preview-'))) {
    throw new Error('Preview assets leaked into real books');
  }
}

export function forecasts(h: HouseholdInput, now = new Date()) {
  return runAllScenarios(h, seedBundle, now);
}

export function liveStanding(h: HouseholdInput, scenario: Scenario, withdrawalRate: number | null, now = new Date()) {
  return standing(h, seedBundle, scenario, h.jobClass, {
    withdrawalRate: withdrawalRate ?? undefined,
    now,
  });
}

export function liveBoard(h: HouseholdInput, scenario: Scenario, withdrawalRate: number | null, now = new Date()) {
  return openGoalBoard(h, seedBundle, scenario, {
    withdrawalRate: withdrawalRate ?? undefined,
    now,
  });
}

export function fan(h: HouseholdInput) {
  return runMonteCarloFan(h, seedBundle, 250, 42);
}

export function duplicateGuesses(h: HouseholdInput): DuplicateGuess[] {
  return findDuplicateGuesses(h.expenses, h.accounts);
}

export function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return null;
  return Math.floor((Date.now() - parsed) / (24 * 60 * 60 * 1000));
}

export function backupIsStale(settings: AppSettings): boolean {
  if (!settings.lastBackupAt) return true;
  return (daysSince(settings.lastBackupAt) ?? 99) > 14;
}
