import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import type { HouseholdInput } from '@asset-aware/forecast-engine';
import { hiredDateMoveLine, hiredJobTitle, normalizeHousehold } from '@asset-aware/forecast-engine';
import { eraseVault, openVault } from '@/db/client';
import {
  type AppSettings,
  assertNoPreviewLeak,
  defaultSettings,
  forecasts,
  liveBoard,
  liveStanding,
  loadHousehold,
  loadSettings,
  portableSettingsFrom,
  readLegacyPinHash,
  saveAll,
  saveHousehold,
  saveSettings,
  stripLegacyPinHash,
} from '@/state/household';
import { createPinRecord, verifyPin } from '@/vault/crypto';
import { HouseholdUnreadable } from '@/vault/errors';
import { clearLockout, registerFailure } from '@/vault/lockout';
import {
  clearPinRecord,
  loadBiometricsEnabled,
  loadLockout,
  loadPinRecord,
  saveBiometricsEnabled,
  saveLockout,
  savePinRecord,
} from '@/vault/secure';

export type VaultStatus = 'locked' | 'opening' | 'open' | 'error';

export type UnlockResult = { ok: true } | { ok: false; message: string };

type Ctx = {
  household: HouseholdInput | null;
  settings: AppSettings;
  status: VaultStatus;
  vaultError: string | null;
  hasPin: boolean;
  biometricsOn: boolean;
  lockoutUntil: number;
  setHousehold: (h: HouseholdInput, opts?: { recordUndo?: boolean }) => void;
  updateHousehold: (fn: (current: HouseholdInput) => HouseholdInput, opts?: { recordUndo?: boolean }) => void;
  saveError: string | null;
  readHousehold: () => HouseholdInput | null;
  undoChange: () => void;
  dismissChange: () => void;
  changeNote: string | null;
  canUndo: boolean;
  patchSettings: (p: Partial<AppSettings>) => void;
  refresh: () => void;
  unlock: (method: { pin: string } | { biometric: true }) => Promise<UnlockResult>;
  setPin: (pin: string, current?: string) => Promise<UnlockResult>;
  clearPin: (current: string) => Promise<UnlockResult>;
  setBiometrics: (on: boolean) => Promise<void>;
  restoreBackup: (householdRaw: unknown, settingsRaw: unknown) => Promise<HouseholdInput>;
  eraseAndRestart: () => Promise<void>;
  /** Local calendar day. Standing and forecasts recompute when this changes. */
  dayKey: string;
  now: Date;
  standingView: ReturnType<typeof liveStanding> | null;
  goalBoard: ReturnType<typeof liveBoard>;
};

export function localDayKey(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function msUntilNextLocalMidnight(now = new Date()): number {
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  return Math.max(1000, next.getTime() - now.getTime());
}

const HouseholdContext = createContext<Ctx | null>(null);

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function HouseholdProvider({ children }: { children: ReactNode }) {
  const [household, setHouseholdState] = useState<HouseholdInput | null>(null);
  const [settings, setSettingsState] = useState<AppSettings>(defaultSettings);
  const [status, setStatus] = useState<VaultStatus>('opening');
  const [vaultError, setVaultError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [changeNote, setChangeNote] = useState<string | null>(null);
  const [undoBooks, setUndoBooks] = useState<HouseholdInput | null>(null);
  const [hasPin, setHasPin] = useState(false);
  const [biometricsOn, setBiometricsOn] = useState(false);
  const [lockoutUntil, setLockoutUntil] = useState(0);
  const [dayKey, setDayKey] = useState(localDayKey);
  const now = useMemo(() => {
    const [year, month, day] = dayKey.split('-').map((part) => Number(part));
    return new Date(year, (month || 1) - 1, day || 1, 12, 0, 0, 0);
  }, [dayKey]);
  const householdRef = useRef(household);
  const settingsRef = useRef(settings);
  const statusRef = useRef(status);
  const unlockFlight = useRef(false);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const arm = () => {
      timer = setTimeout(() => {
        setDayKey(localDayKey());
        arm();
      }, msUntilNextLocalMidnight());
    };
    arm();
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') setDayKey(localDayKey());
    });
    return () => {
      clearTimeout(timer);
      sub.remove();
    };
  }, []);

  const publishOpen = useCallback((next: HouseholdInput | null, loaded: AppSettings) => {
    householdRef.current = next;
    settingsRef.current = loaded;
    setHouseholdState(next);
    setSettingsState(loaded);
    setVaultError(null);
    setStatus('open');
  }, []);

  const failClosed = useCallback((error: unknown) => {
    householdRef.current = null;
    setHouseholdState(null);
    setVaultError(errorMessage(error, 'The books could not be opened.'));
    setStatus('error');
  }, []);

  const loadOpenVault = useCallback(() => {
    const next = loadHousehold();
    stripLegacyPinHash();
    publishOpen(next, loadSettings());
  }, [publishOpen]);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const [record, bio, lock] = await Promise.all([loadPinRecord(), loadBiometricsEnabled(), loadLockout()]);
        if (!live) return;
        setBiometricsOn(bio);
        setLockoutUntil(lock.nextAllowedAt);
        if (record) {
          setHasPin(true);
          setStatus('locked');
          return;
        }
        await openVault();
        if (!live) return;
        const legacy = readLegacyPinHash();
        if (legacy) {
          await savePinRecord({ v: 1, hash: legacy });
          setHasPin(true);
          setStatus('locked');
          return;
        }
        loadOpenVault();
      } catch (error) {
        if (!live) return;
        failClosed(error);
      }
    })();
    return () => {
      live = false;
    };
  }, [failClosed, loadOpenVault]);

  const notePinFailure = useCallback(async (now: number): Promise<UnlockResult> => {
    const prev = await loadLockout();
    const attempt = registerFailure(prev, now);
    await saveLockout(attempt.state);
    setLockoutUntil(attempt.state.nextAllowedAt);
    if (attempt.rejected) return { ok: false, message: 'Too many tries. Wait, then try the PIN again.' };
    return { ok: false, message: 'That PIN does not match.' };
  }, []);

  const acceptPin = useCallback(async (pin: string): Promise<UnlockResult> => {
    const now = Date.now();
    const lock = await loadLockout();
    if (lock.nextAllowedAt > now) {
      setLockoutUntil(lock.nextAllowedAt);
      return { ok: false, message: 'Too many tries. Wait, then try the PIN again.' };
    }
    const record = await loadPinRecord();
    if (!record) return { ok: false, message: 'No PIN is set.' };
    const match = await verifyPin(pin, record);
    if (!match) return notePinFailure(now);
    if (record.v === 1) await savePinRecord(await createPinRecord(pin));
    const reset = clearLockout();
    await saveLockout(reset);
    setLockoutUntil(0);
    setHasPin(true);
    return { ok: true };
  }, [notePinFailure]);

  const readHousehold = useCallback(() => householdRef.current, []);

  const setHousehold = useCallback((h: HouseholdInput, opts?: { recordUndo?: boolean }) => {
    const books = normalizeHousehold(h);
    assertNoPreviewLeak(books);
    const prev = householdRef.current;
    const recordUndo = opts?.recordUndo !== false;
    let onlySkips = false;
    if (prev && recordUndo) {
      const prevJson = JSON.stringify(prev);
      const nextJson = JSON.stringify(books);
      if (prevJson === nextJson) return;
      onlySkips = JSON.stringify({ ...prev, skippedQuestions: books.skippedQuestions }) === nextJson;
    }
    try {
      saveHousehold(books);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'The books could not be saved.');
      return;
    }
    setSaveError(null);
    const currentSettings = settingsRef.current;
    const clock = new Date();
    if (prev && recordUndo && !onlySkips) {
      const before = liveStanding(prev, currentSettings.scenario, currentSettings.withdrawalRate, clock);
      const after = liveStanding(books, currentSettings.scenario, currentSettings.withdrawalRate, clock);
      setUndoBooks(prev);
      setChangeNote(
        hiredDateMoveLine(
          hiredJobTitle(prev.jobClass, prev.fireFlavor, prev.goalSpec),
          before.hiredDate,
          hiredJobTitle(books.jobClass, books.fireFlavor, books.goalSpec),
          after.hiredDate,
        ),
      );
    } else if (!recordUndo) {
      setUndoBooks(null);
      setChangeNote(null);
    }
    householdRef.current = books;
    setHouseholdState(books);
  }, []);

  const updateHousehold = useCallback((fn: (current: HouseholdInput) => HouseholdInput, opts?: { recordUndo?: boolean }) => {
    const current = householdRef.current;
    if (!current) return;
    setHousehold(fn(current), opts);
  }, [setHousehold]);

  const undoChange = useCallback(() => {
    if (!undoBooks) return;
    const books = normalizeHousehold(undoBooks);
    assertNoPreviewLeak(books);
    try {
      saveHousehold(books);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'The books could not be saved.');
      return;
    }
    setSaveError(null);
    householdRef.current = books;
    setUndoBooks(null);
    setChangeNote(null);
    setHouseholdState(books);
  }, [undoBooks]);

  const dismissChange = useCallback(() => {
    setChangeNote(null);
    setUndoBooks(null);
  }, []);

  const patchSettings = useCallback((p: Partial<AppSettings>) => {
    setSettingsState((prev) => {
      const next = { ...prev, ...p };
      if (p.notificationMode === 'off' && prev.notificationMode !== 'off') {
        next.backupReminderId = null;
        void import('@/notifications').then((mod) => mod.cancelScheduledNotifications());
      }
      try {
        saveSettings(next);
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : 'Settings could not be saved.');
        return prev;
      }
      setSaveError(null);
      settingsRef.current = next;
      return next;
    });
  }, []);

  const refresh = useCallback(() => {
    try {
      const next = loadHousehold();
      householdRef.current = next;
      setHouseholdState(next);
      const loaded = loadSettings();
      settingsRef.current = loaded;
      setSettingsState(loaded);
      setVaultError(null);
    } catch (error) {
      if (error instanceof HouseholdUnreadable) failClosed(error);
      else failClosed(error);
    }
  }, [failClosed]);

  const unlock = useCallback(async (method: { pin: string } | { biometric: true }): Promise<UnlockResult> => {
    if (unlockFlight.current) return { ok: false, message: 'Already checking the PIN.' };
    unlockFlight.current = true;
    try {
      if ('biometric' in method) {
        if (!biometricsOn) return { ok: false, message: 'Fingerprint unlock is off.' };
        const LocalAuthentication = await import('expo-local-authentication');
        const result = await LocalAuthentication.authenticateAsync({
          promptMessage: 'Unlock your household',
          cancelLabel: 'Use PIN',
        });
        if (!result.success) return { ok: false, message: 'Fingerprint was not recognized.' };
        const reset = clearLockout();
        await saveLockout(reset);
        setLockoutUntil(0);
      } else {
        const accepted = await acceptPin(method.pin);
        if (!accepted.ok) return accepted;
      }
      setStatus('opening');
      try {
        await openVault();
        loadOpenVault();
      } catch (error) {
        failClosed(error);
        return { ok: false, message: errorMessage(error, 'The books could not be opened.') };
      }
      return { ok: true };
    } finally {
      unlockFlight.current = false;
    }
  }, [acceptPin, biometricsOn, failClosed, loadOpenVault]);

  const setPin = useCallback(async (pin: string, current?: string): Promise<UnlockResult> => {
    if (hasPin) {
      if (!current) return { ok: false, message: 'Enter the current PIN.' };
      const accepted = await acceptPin(current);
      if (!accepted.ok) return accepted;
    }
    await savePinRecord(await createPinRecord(pin));
    setHasPin(true);
    return { ok: true };
  }, [acceptPin, hasPin]);

  const clearPin = useCallback(async (current: string): Promise<UnlockResult> => {
    const accepted = await acceptPin(current);
    if (!accepted.ok) return accepted;
    await clearPinRecord();
    setHasPin(false);
    setBiometricsOn(false);
    return { ok: true };
  }, [acceptPin]);

  const setBiometrics = useCallback(async (on: boolean) => {
    await saveBiometricsEnabled(on);
    setBiometricsOn(on);
  }, []);

  const restoreBackup = useCallback(async (householdRaw: unknown, settingsRaw: unknown) => {
    const books = normalizeHousehold(householdRaw as HouseholdInput);
    assertNoPreviewLeak(books);
    const portable = portableSettingsFrom(settingsRaw);
    const wasOpen = statusRef.current === 'open';
    try {
      if (!wasOpen) {
        await eraseVault();
        await openVault();
      }
      const nextSettings = { ...defaultSettings(), ...loadSettings(), ...portable };
      saveAll({ household: books, settings: nextSettings });
      setUndoBooks(null);
      setChangeNote(null);
      setHasPin(Boolean(await loadPinRecord()));
      setBiometricsOn(await loadBiometricsEnabled());
      publishOpen(books, nextSettings);
      return books;
    } catch (error) {
      if (!wasOpen) failClosed(error);
      throw error;
    }
  }, [failClosed, publishOpen]);

  const eraseAndRestart = useCallback(async () => {
    try {
      await eraseVault();
      await openVault();
      setUndoBooks(null);
      setChangeNote(null);
      setSaveError(null);
      setHasPin(false);
      setBiometricsOn(false);
      setLockoutUntil(0);
      publishOpen(null, defaultSettings());
    } catch (error) {
      failClosed(error);
      throw error;
    }
  }, [failClosed, publishOpen]);

  const standingView = useMemo(
    () => (household && status === 'open' ? liveStanding(household, settings.scenario, settings.withdrawalRate, now) : null),
    [household, settings.scenario, settings.withdrawalRate, status, now],
  );
  const goalBoard = useMemo(
    () => (household && status === 'open' ? liveBoard(household, settings.scenario, settings.withdrawalRate, now) : []),
    [household, settings.scenario, settings.withdrawalRate, status, now],
  );

  const value = useMemo(
    () => ({
      household,
      settings,
      status,
      vaultError,
      hasPin,
      biometricsOn,
      lockoutUntil,
      saveError,
      setHousehold,
      updateHousehold,
      readHousehold,
      undoChange,
      dismissChange,
      changeNote,
      canUndo: undoBooks != null,
      patchSettings,
      refresh,
      unlock,
      setPin,
      clearPin,
      setBiometrics,
      restoreBackup,
      eraseAndRestart,
      dayKey,
      now,
      standingView,
      goalBoard,
    }),
    [
      household,
      settings,
      status,
      vaultError,
      hasPin,
      biometricsOn,
      lockoutUntil,
      saveError,
      setHousehold,
      updateHousehold,
      readHousehold,
      undoChange,
      dismissChange,
      changeNote,
      undoBooks,
      patchSettings,
      refresh,
      unlock,
      setPin,
      clearPin,
      setBiometrics,
      restoreBackup,
      eraseAndRestart,
      dayKey,
      now,
      standingView,
      goalBoard,
    ],
  );

  return <HouseholdContext.Provider value={value}>{children}</HouseholdContext.Provider>;
}

export function useHousehold() {
  const ctx = useContext(HouseholdContext);
  if (!ctx) throw new Error('useHousehold outside provider');
  return ctx;
}

/** Forecasts run only on screens that ask for them. */
export function useForecasts() {
  const { household, status, now } = useHousehold();
  return useMemo(
    () => (household && status === 'open' ? forecasts(household, now) : null),
    [household, status, now],
  );
}
