import { useEffect } from 'react';

import { setBillingSnapshot } from '@/billing/state';

/** Web and tests have no Play store. Bank linking stays open. */
export function BillingBridge() {
  useEffect(() => {
    setBillingSnapshot({ availability: 'unavailable' });
  }, []);
  return null;
}
