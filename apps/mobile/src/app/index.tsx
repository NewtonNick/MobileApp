import { useEffect, useRef, useState } from 'react';
import { useRouter, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useHousehold } from '@/state/context';
import { lockoutLabel } from '@/vault/lockout';
import { Body, Button, Field, Meta, Screen, Title } from '@/ui/primitives';

export default function GateScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { status, vaultError, biometricsOn, lockoutUntil, unlock } = useHousehold();
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(0);
  const prompted = useRef(false);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    if (lockoutUntil <= Date.now()) return;
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [lockoutUntil]);

  useEffect(() => {
    if (status !== 'locked' || !biometricsOn || prompted.current) return;
    prompted.current = true;
    void unlock({ biometric: true }).then((result) => {
      if (!result.ok) setError(result.message);
    });
  }, [biometricsOn, status, unlock]);

  const waiting = now > 0 ? lockoutLabel(lockoutUntil, now) : null;

  return (
    <Screen style={{ paddingTop: Math.max(insets.top, 12) }}>
      <Title>Asset-aware plan</Title>
      {status === 'error' && vaultError ? <Body>{vaultError}</Body> : null}
      {status === 'opening' ? <Body>Opening the books…</Body> : null}
      {status === 'locked' ? (
        <>
          <Body>Enter your PIN to open this household.</Body>
          <Field
            accessibilityLabel="PIN"
            value={pin}
            onChangeText={setPin}
            keyboardType="number-pad"
            secureTextEntry
          />
          {waiting ? <Meta>{waiting}</Meta> : null}
          {error ? <Meta>{error}</Meta> : null}
          <Button
            label="Unlock"
            disabled={waiting != null}
            onPress={() => {
              void unlock({ pin }).then((result) => {
                if (!result.ok) setError(result.message);
              });
            }}
          />
          {biometricsOn ? (
            <Button
              label="Use fingerprint"
              tone="ghost"
              onPress={() => {
                void unlock({ biometric: true }).then((result) => {
                  if (!result.ok) setError(result.message);
                });
              }}
            />
          ) : null}
          <Button label="Forgot PIN" tone="ghost" onPress={() => router.push('/recovery' as Href)} />
        </>
      ) : null}
      <Meta>If you forget your PIN and have no backup, this household is gone.</Meta>
    </Screen>
  );
}
