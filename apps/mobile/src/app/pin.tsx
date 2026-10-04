import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useHousehold } from '@/state/context';
import { lockoutLabel } from '@/vault/lockout';
import { Body, Button, Field, Meta, Screen, Title } from '@/ui/primitives';

const MIN_PIN = 4;

export default function PinScreen() {
  const insets = useSafeAreaInsets();
  const { hasPin, biometricsOn, lockoutUntil, setPin, clearPin, setBiometrics } = useHousehold();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [hardware, setHardware] = useState(false);
  const [now, setNow] = useState(0);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    if (lockoutUntil <= Date.now()) return;
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [lockoutUntil]);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    void (async () => {
      try {
        const LocalAuthentication = await import('expo-local-authentication');
        const has = await LocalAuthentication.hasHardwareAsync();
        const enrolled = await LocalAuthentication.isEnrolledAsync();
        setHardware(has && enrolled);
      } catch {
        setHardware(false);
      }
    })();
  }, []);

  const waiting = now > 0 ? lockoutLabel(lockoutUntil, now) : null;

  const save = async () => {
    if (next.length < MIN_PIN) {
      setMessage('PIN needs at least 4 digits.');
      return;
    }
    if (next !== confirm) {
      setMessage('Those PINs do not match.');
      return;
    }
    const result = await setPin(next, hasPin ? current : undefined);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    setCurrent('');
    setNext('');
    setConfirm('');
    setMessage(hasPin ? 'PIN changed.' : 'PIN saved.');
  };

  if (Platform.OS === 'web') {
    return (
      <Screen style={{ paddingTop: Math.max(insets.top, 12) }}>
        <Title>PIN</Title>
        <Body>The browser preview does not keep a PIN. Nothing is saved in this tab.</Body>
      </Screen>
    );
  }

  return (
    <Screen style={{ paddingTop: Math.max(insets.top, 12) }}>
      <Title>{hasPin ? 'Change PIN' : 'Set a PIN'}</Title>
      <Body>The PIN is checked before the books open. It is stored on this phone, not in the household file.</Body>
      {hasPin ? (
        <Field
          accessibilityLabel="Current PIN"
          placeholder="Current PIN"
          value={current}
          onChangeText={setCurrent}
          secureTextEntry
          keyboardType="number-pad"
        />
      ) : null}
      <Field
        accessibilityLabel="New PIN"
        placeholder="New PIN"
        value={next}
        onChangeText={setNext}
        secureTextEntry
        keyboardType="number-pad"
      />
      <Field
        accessibilityLabel="Confirm PIN"
        placeholder="Confirm PIN"
        value={confirm}
        onChangeText={setConfirm}
        secureTextEntry
        keyboardType="number-pad"
      />
      {waiting ? <Meta>{waiting}</Meta> : null}
      {message ? <Meta>{message}</Meta> : null}
      <Button label={hasPin ? 'Change PIN' : 'Save PIN'} disabled={waiting != null} onPress={() => void save()} />
      {hasPin ? (
        <Button
          label="Remove PIN"
          tone="danger"
          disabled={waiting != null}
          onPress={() => {
            void clearPin(current).then((result) => {
              setMessage(result.ok ? 'PIN removed.' : result.message);
              if (result.ok) setCurrent('');
            });
          }}
        />
      ) : null}
      {hasPin && hardware ? (
        <Button
          label={biometricsOn ? 'Turn off fingerprint' : 'Turn on fingerprint'}
          tone="ghost"
          onPress={() => {
            void (async () => {
              if (biometricsOn) {
                await setBiometrics(false);
                setMessage('Fingerprint unlock is off.');
                return;
              }
              const LocalAuthentication = await import('expo-local-authentication');
              const result = await LocalAuthentication.authenticateAsync({
                promptMessage: 'Confirm fingerprint unlock',
                cancelLabel: 'Cancel',
              });
              if (!result.success) {
                setMessage('Fingerprint was not confirmed.');
                return;
              }
              await setBiometrics(true);
              setMessage('Fingerprint unlock is on.');
            })();
          }}
        />
      ) : null}
    </Screen>
  );
}
