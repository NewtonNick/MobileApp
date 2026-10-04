import { useEffect, useRef } from 'react';
import { Platform, Text, View } from 'react-native';
import { Stack, useRouter, useSegments, type Href } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';

import { BillingBridge } from '@/billing/bridge';
import { BankSyncOnOpen } from '@/plaid/sync-on-open';
import { destinationAfterGate } from '@/state/routing';
import { useHousehold, HouseholdProvider } from '@/state/context';
import { AppearanceProvider, useColorMode, useColors } from '@/ui/appearance';
import { CrashBoundary } from '@/ui/crash-boundary';
import { Body, Button, Card } from '@/ui/primitives';

void SplashScreen.preventAutoHideAsync().catch(() => undefined);

export default function RootLayout() {
  useEffect(() => {
    if (Platform.OS === 'web') return;
    void import('expo-screen-capture')
      .then((mod) => mod.preventScreenCaptureAsync())
      .catch(() => undefined);
  }, []);

  return (
    <CrashBoundary>
      <HouseholdProvider>
        <AppearanceProvider>
          <BillingBridge />
          <BankSyncOnOpen />
          <RootNavigation />
        </AppearanceProvider>
      </HouseholdProvider>
    </CrashBoundary>
  );
}

function SaveErrorBanner() {
  const { saveError } = useHousehold();
  const colors = useColors();
  if (!saveError) return null;
  return (
    <View style={{ backgroundColor: colors.danger, paddingHorizontal: 16, paddingVertical: 10 }}>
      <Text style={{ color: '#fff', fontSize: 15 }}>{saveError}</Text>
    </View>
  );
}

function PreviewBanner() {
  const colors = useColors();
  if (Platform.OS !== 'web') return null;
  return (
    <View style={{ backgroundColor: colors.warnSoft, paddingHorizontal: 16, paddingVertical: 10 }}>
      <Text style={{ color: colors.text, fontSize: 15 }}>Preview, nothing is saved</Text>
    </View>
  );
}

function UndoToast() {
  const { changeNote, canUndo, undoChange, dismissChange } = useHousehold();
  if (!changeNote) return null;
  return (
    <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
      <Card>
        <Body>{changeNote}</Body>
        {canUndo ? <Button label="Undo" tone="quiet" onPress={undoChange} /> : null}
        <Button label="Dismiss" tone="ghost" onPress={dismissChange} />
      </Card>
    </View>
  );
}

function notificationHref(data: unknown): string | null {
  if (!data || typeof data !== 'object' || !('href' in data)) return null;
  const href = (data as { href?: unknown }).href;
  return typeof href === 'string' && href.startsWith('/') ? href : null;
}

function RootNavigation() {
  const colors = useColors();
  const mode = useColorMode();
  const { status, settings, household } = useHousehold();
  const segments = useSegments() as string[];
  const segmentKey = segments.join('/');
  const router = useRouter();
  const pending = useRef<string | null>(null);

  useEffect(() => {
    if (status === 'opening') return;
    void SplashScreen.hideAsync().catch(() => undefined);
  }, [status]);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    let remove: () => void = () => undefined;
    let live = true;
    void import('expo-notifications').then(async (Notifications) => {
      const openHref = (data: unknown) => {
        const href = notificationHref(data);
        if (!href || !live) return;
        if (status !== 'open' || !settings.sawDisclaimer) {
          pending.current = href;
          return;
        }
        router.push(href as Href);
      };
      const last = await Notifications.getLastNotificationResponseAsync();
      openHref(last?.notification.request.content.data);
      const sub = Notifications.addNotificationResponseReceivedListener((response) => {
        openHref(response.notification.request.content.data);
      });
      remove = () => sub.remove();
    });
    return () => {
      live = false;
      remove();
    };
  }, [router, settings.sawDisclaimer, status]);

  useEffect(() => {
    if (status === 'opening') return;
    const parts = segmentKey ? segmentKey.split('/') : [];
    const root = parts[0];
    const atGate = parts.length === 0 || root === 'index';
    const here = parts.length === 0 ? '/' : `/${segmentKey}`;

    if (status === 'error') {
      if (root !== 'recovery') router.replace('/recovery' as Href);
      return;
    }

    if (status === 'locked') {
      if (!atGate && root !== 'recovery') {
        pending.current = here;
        router.replace('/');
      }
      return;
    }

    if (!settings.sawDisclaimer) {
      if (root !== 'disclaimer' && root !== 'privacy' && root !== 'backup') {
        if (!atGate && root !== 'recovery') pending.current = here;
        router.replace('/disclaimer');
      }
      return;
    }

    if (atGate || root === 'disclaimer') {
      const dest = destinationAfterGate(household, pending.current);
      pending.current = null;
      if (dest !== here) router.replace(dest);
    }
  }, [household, router, segmentKey, settings.sawDisclaimer, status]);

  return (
    <>
      <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
      <PreviewBanner />
      <SaveErrorBanner />
      {status === 'open' ? <UndoToast /> : null}
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.accent,
          headerTitleStyle: { fontWeight: '600', fontSize: 17, color: colors.text },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.bg },
        }}>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="disclaimer" options={{ title: 'About these numbers' }} />
        <Stack.Screen name="job-pick" options={{ title: 'Your goals' }} />
        <Stack.Screen name="custom-goal" options={{ title: 'Something else' }} />
        <Stack.Screen name="onboarding" options={{ title: 'Your household' }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="backup" options={{ title: 'Save backup' }} />
        <Stack.Screen name="compare" options={{ title: 'Compare scenarios' }} />
        <Stack.Screen name="sequence" options={{ title: 'Debt or Retire early' }} />
        <Stack.Screen name="moves" options={{ title: 'This house' }} />
        <Stack.Screen name="decide" options={{ title: 'Decision lab' }} />
        <Stack.Screen name="privacy" options={{ title: 'Privacy' }} />
        <Stack.Screen name="terms" options={{ title: 'Terms' }} />
        <Stack.Screen name="licenses" options={{ title: 'Open-source notices' }} />
        <Stack.Screen name="accounts" options={{ title: 'Improve the books' }} />
        <Stack.Screen name="looks-wrong" options={{ title: 'Adjust this number' }} />
        <Stack.Screen name="improve" options={{ title: 'Improve this plan' }} />
        <Stack.Screen name="plaid" options={{ title: 'Bank link' }} />
        <Stack.Screen name="paywall" options={{ title: 'Keep the date current' }} />
        <Stack.Screen name="spend" options={{ title: 'Add a spend' }} />
        <Stack.Screen name="dashboard" options={{ title: 'Dashboard' }} />
        <Stack.Screen name="event/[id]" options={{ title: 'Purchase' }} />
        <Stack.Screen name="pin" options={{ title: 'PIN' }} />
        <Stack.Screen name="recovery" options={{ title: 'Recover' }} />
      </Stack>
    </>
  );
}
