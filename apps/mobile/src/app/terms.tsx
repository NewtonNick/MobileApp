import { useRouter } from 'expo-router';

import { Body, Button, Meta, Screen } from '@/ui/primitives';

export default function TermsScreen() {
  const router = useRouter();
  return (
    <Screen>
      <Body>You must be 18 or older. The notice before the books records that attestation with the time you accepted.</Body>
      <Body>
        Figures are planning estimates from public cost tables and the numbers you enter. They are not a bid, not a
        bank balance, and not financial, tax, or legal advice.
      </Body>
      <Body>
        You keep your books. A forgotten PIN with no backup means those books cannot be recovered. A backup is only as
        safe as the passphrase you choose.
      </Body>
      <Body>
        Bank linking is optional. When you turn it on, the Plaid terms apply to that connection. A bank-link plan, when
        Play lists one, is billed by Google Play. The date stays available without that plan.
      </Body>
      <Body>The app is licensed for your personal planning. Do not present its output as professional advice.</Body>
      <Meta>Same text as docs/legal/terms.md. A lawyer should review it before a store listing.</Meta>
      <Button label="Back" tone="ghost" onPress={() => router.back()} />
    </Screen>
  );
}
