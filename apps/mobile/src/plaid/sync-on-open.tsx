import { useEffect, useRef } from 'react';

import { bankLinkIsUnlocked } from '@/entitlements';
import { commitBankCursor, pullLinkedItems } from '@/plaid/client';
import { useHousehold } from '@/state/context';

/** Pull linked institutions when the app opens. A failed pull leaves the books. */
export function BankSyncOnOpen() {
  const { status } = useHousehold();
  if (status !== 'open') return null;
  return <BankSyncWhenOpen />;
}

function BankSyncWhenOpen() {
  const { household, setHousehold, readHousehold } = useHousehold();
  const started = useRef(false);

  useEffect(() => {
    if (started.current || !household?.plaidItems?.length || !bankLinkIsUnlocked()) return;
    started.current = true;
    const snapshot = household;
    void (async () => {
      let base = snapshot;
      for (let attempt = 0; attempt < 3; attempt++) {
        const pulled = await pullLinkedItems(base);
        if (!pulled) return;
        const latest = readHousehold();
        if (!latest || latest === base) {
          setHousehold(pulled.household);
          for (const cursor of pulled.cursors) commitBankCursor(cursor);
          return;
        }
        base = latest;
      }
    })();
  }, [household, readHousehold, setHousehold]);

  return null;
}
