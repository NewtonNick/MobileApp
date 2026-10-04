import { View } from 'react-native';
import { type Href, useRouter } from 'expo-router';

import { requestNotifyPermission } from '@/notifications';
import { useHousehold } from '@/state/context';
import { backupIsStale } from '@/state/household';
import { Banner, Body, Chip, Kicker, ListGroup, ListRow, Meta, Screen } from '@/ui/primitives';

export default function MoreScreen() {
  const router = useRouter();
  const { settings, patchSettings } = useHousehold();

  return (
    <Screen>
        {backupIsStale(settings) ? (
          <Banner>Save a backup. The last one is older than 14 days, or missing.</Banner>
        ) : null}

        <Kicker>Household</Kicker>
        <ListGroup>
          <ListRow label="Improve the books" onPress={() => router.push('/accounts')} />
          <ListRow label="Dashboard" detail="Spending, cash, holdings, and the hired date" onPress={() => router.push('/dashboard' as Href)} />
          <ListRow label="Debt first vs Retire early" onPress={() => router.push('/sequence')} />
          <ListRow label="This house" detail="Keep, delay, or downsize" onPress={() => router.push('/moves')} />
          <ListRow label="Save backup" onPress={() => router.push('/backup')} />
        </ListGroup>

        <Kicker>Bank</Kicker>
        <ListGroup>
          <ListRow label="Bank link" onPress={() => router.push('/plaid')} />
        </ListGroup>

        <Kicker>Display</Kicker>
        <Meta>Appearance</Meta>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {(
            [
              ['system', 'Match phone'],
              ['light', 'Light'],
              ['dark', 'Dark'],
            ] as const
          ).map(([key, label]) => (
            <Chip
              key={key}
              label={label}
              selected={(settings.appearance ?? 'system') === key}
              onPress={() => patchSettings({ appearance: key })}
            />
          ))}
        </View>
        <Meta>Dollars</Meta>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <Chip label="Today's dollars" selected={!settings.showNominal} onPress={() => patchSettings({ showNominal: false })} />
          <Chip label="Future dollars" selected={settings.showNominal} onPress={() => patchSettings({ showNominal: true })} />
        </View>
        <Meta>Alerts</Meta>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {(
            [
              ['daily', 'Daily brief'],
              ['outliers', 'Outliers only'],
              ['off', 'Off'],
            ] as const
          ).map(([key, label]) => (
            <Chip
              key={key}
              label={label}
              selected={settings.notificationMode === key}
              onPress={() => {
                if (key === 'off') {
                  patchSettings({ notificationMode: 'off' });
                  return;
                }
                void requestNotifyPermission(
                  'A short note when the plan changes. Next, the phone asks permission to show it.',
                ).then((granted) => {
                  if (granted) patchSettings({ notificationMode: key });
                });
              }}
            />
          ))}
        </View>

        <Kicker>Lock</Kicker>
        <ListGroup>
          <ListRow label="PIN and fingerprint" onPress={() => router.push('/pin' as Href)} />
          <ListRow label="Erase everything" detail="Deletes the books on this phone" onPress={() => router.push('/recovery' as Href)} />
          <ListRow label="About these numbers" onPress={() => router.push('/disclaimer')} />
          <ListRow label="Privacy" onPress={() => router.push('/privacy')} />
          <ListRow label="Terms" onPress={() => router.push('/terms' as Href)} />
          <ListRow label="Open-source notices" onPress={() => router.push('/licenses' as Href)} />
        </ListGroup>
        <Meta>Planning estimates, not a bank. Not financial advice.</Meta>
        <Body>Fewer alerts is one tap under Display.</Body>
    </Screen>
  );
}
