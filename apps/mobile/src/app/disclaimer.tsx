import { useState } from 'react';
import { Alert } from 'react-native';
import { type Href, useRouter } from 'expo-router';

import { useHousehold } from '@/state/context';
import { startPreview, DISCLAIMER_VERSION, TERMS_VERSION } from '@/state/household';
import { Body, Button, Meta, Screen, Title } from '@/ui/primitives';

export default function DisclaimerScreen() {
  const router = useRouter();
  const { household, patchSettings, setHousehold } = useHousehold();
  const [adult, setAdult] = useState(false);

  const accept = () => {
    if (!adult) return;
    const at = new Date().toISOString();
    patchSettings({
      sawDisclaimer: true,
      disclaimerVersion: DISCLAIMER_VERSION,
      disclaimerAcceptedAt: at,
      termsVersion: TERMS_VERSION,
      termsAcceptedAt: at,
    });
  };

  const tour = () => {
    const go = () => {
      const at = new Date().toISOString();
      patchSettings({
        sawDisclaimer: true,
        disclaimerVersion: DISCLAIMER_VERSION,
        disclaimerAcceptedAt: at,
        termsVersion: TERMS_VERSION,
        termsAcceptedAt: at,
      });
      setHousehold(startPreview());
    };
    if (household?.kind === 'real') {
      Alert.alert(
        'Replace your household?',
        'The preview example replaces the numbers you already entered. This is a tour, not your books.',
        [
          { text: 'Keep mine', style: 'cancel' },
          { text: 'Tour preview', style: 'destructive', onPress: go },
        ],
      );
      return;
    }
    go();
  };

  return (
    <Screen>
      <Title>About these numbers</Title>
      <Body>
        These figures are ranges from public cost tables and the numbers you enter. They are not a shop
        bid, not a bank, and not financial advice.
      </Body>
      <Button label="Privacy" tone="ghost" onPress={() => router.push('/privacy' as Href)} />
      <Button label="Terms" tone="ghost" onPress={() => router.push('/terms' as Href)} />
      <Body>
        Liberal is a better year. Realistic is the central case. Conservative is a harder year. We default
        to Realistic.
      </Body>
      <Button
        label={adult ? 'I am 18 or older' : 'I am 18 or older — tap to confirm'}
        tone={adult ? 'accent' : 'ghost'}
        onPress={() => setAdult(true)}
      />
      <Meta>Continue records acceptance of this notice and the Terms.</Meta>
      <Button label="Continue" disabled={!adult} onPress={accept} />
      <Button label="Tour the preview household" tone="ghost" disabled={!adult} onPress={tour} />
      <Button label="I have a backup file" tone="ghost" onPress={() => router.push('/backup')} />
    </Screen>
  );
}
