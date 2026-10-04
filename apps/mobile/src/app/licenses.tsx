import { useRouter } from 'expo-router';

import notices from '../../assets/licenses.json';
import { Body, Button, Card, Meta, Screen } from '@/ui/primitives';

export default function LicensesScreen() {
  const router = useRouter();
  return (
    <Screen>
      <Body>The app itself is proprietary. These components keep their own licenses.</Body>
      <Meta>{notices.generated}</Meta>
      {notices.packages.map((pkg) => (
        <Card key={pkg.name}>
          <Body>{pkg.name}</Body>
          <Meta>{pkg.license}</Meta>
        </Card>
      ))}
      <Button label="Back" tone="ghost" onPress={() => router.back()} />
    </Screen>
  );
}
