import { Alert, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

import { notificationAllowed } from '@asset-aware/forecast-engine';
import type { AppSettings } from '@/state/household';

export function explainNotifications(body: string): Promise<boolean> {
  if (Platform.OS === 'web') return Promise.resolve(true);
  return new Promise((resolve) => {
    Alert.alert('Notifications', body, [
      { text: 'Not now', style: 'cancel', onPress: () => resolve(false) },
      { text: 'Continue', onPress: () => resolve(true) },
    ]);
  });
}

export async function cancelScheduledNotifications(): Promise<void> {
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
  } catch {
    /* already clear */
  }
}

export function tonightAtEight(now = new Date()): Date {
  const at = new Date(now);
  at.setHours(20, 0, 0, 0);
  if (at.getTime() <= now.getTime()) at.setDate(at.getDate() + 1);
  return at;
}

export function reminderLabel(iso: string, now = new Date()): string {
  const at = new Date(iso);
  return at.toDateString() === now.toDateString()
    ? 'Reminder set for 8:00 tonight.'
    : 'Reminder set for 8:00 tomorrow.';
}

/** User asked to be reminded. This is not the daily pulse, so alert mode does not block it. */
export async function scheduleBackupReminder(
  settings: AppSettings,
): Promise<{ ok: true; at: string; id: string } | { ok: false; message: string }> {
  const allow = await explainNotifications(
    'A reminder at 8:00 asks you to save a backup. Next, the phone asks permission to show that note.',
  );
  if (!allow) return { ok: false, message: 'No reminder was set.' };
  const perm = await Notifications.requestPermissionsAsync();
  if (!perm.granted) {
    return { ok: false, message: 'Notifications are off for this app, so the reminder was not set.' };
  }
  if (settings.backupReminderId) {
    try {
      await Notifications.cancelScheduledNotificationAsync(settings.backupReminderId);
    } catch {
      // The old reminder may already have fired.
    }
  }
  const at = tonightAtEight();
  try {
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Asset-aware plan',
        body: 'Save a backup so a new phone does not wipe this.',
        data: { href: '/backup' },
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at },
    });
    return { ok: true, at: at.toISOString(), id };
  } catch {
    return { ok: false, message: 'The reminder could not be scheduled.' };
  }
}

export async function requestNotifyPermission(body: string): Promise<boolean> {
  const allow = await explainNotifications(body);
  if (!allow) return false;
  const perm = await Notifications.requestPermissionsAsync();
  return perm.granted;
}

export async function maybeNotify(
  settings: AppSettings,
  body: string,
  hasOutlier: boolean,
): Promise<Partial<AppSettings>> {
  if (settings.notificationMode === 'off') return {};
  if (settings.notificationMode === 'outliers' && !hasOutlier) return {};
  const gate = notificationAllowed({
    lastNotificationAt: settings.lastNotificationAt,
    allClearCount: settings.allClearCount,
    hasOutlier,
  });
  if (!gate.send) return {};
  try {
    await Notifications.scheduleNotificationAsync({
      content: { title: 'Asset-aware plan', body, data: { href: '/' } },
      trigger: null,
    });
  } catch {
    return {};
  }
  return {
    lastNotificationAt: new Date().toISOString(),
    allClearCount: gate.kind === 'all_clear' ? settings.allClearCount + 1 : settings.allClearCount,
  };
}
