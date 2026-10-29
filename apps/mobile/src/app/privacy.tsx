import { type Href, useRouter } from 'expo-router';

import { databaseFileIsEncrypted } from '@/db/client';
import { Body, Button, Meta, Screen } from '@/ui/primitives';

export default function PrivacyScreen() {
  const router = useRouter();
  const encrypted = databaseFileIsEncrypted();
  return (
    <Screen>
      <Body>Books stay on this phone. There is no cloud household ledger and no required account. Forecasts run here.</Body>
      <Body>
        {encrypted
          ? 'The database file on this phone is encrypted.'
          : 'This copy is not writing an encrypted database file. A release build refuses to open books in that state. The web preview keeps nothing after you leave.'}
      </Body>
      <Body>
        The PIN stays in the device keystore, not in the household file. A backup is encrypted with a passphrase you
        choose. If you forget the PIN and have no backup, the household cannot be opened.
      </Body>
      <Body>
        Erase everything deletes the books and secrets on this phone. It does not call the bank-link service. Device
        enrollment is not built.
      </Body>
      <Body>ZIP is only for public cost tables. The app does not ask for a street address or a VIN.</Body>
      <Body>
        Bank link is optional. Plaid receives that connection under their privacy policy. This app does not sell
        household data.
      </Body>
      <Body>
        A bank-link plan, when Google Play lists one, is billed by Google Play. The price is the one Play shows. It is
        not stored in the household file. Erase everything does not cancel that subscription.
      </Body>
      <Body>The app is for adults 18 and older. Erase everything is how you delete what is stored here.</Body>
      <Meta>A shorter notice than docs/legal/privacy.md. A lawyer should review both before a store listing.</Meta>
      <Button label="Terms" tone="ghost" onPress={() => router.push('/terms' as Href)} />
      <Button label="Back" tone="ghost" onPress={() => router.back()} />
    </Screen>
  );
}
