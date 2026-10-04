import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { ErrorCode, useIAP, type ProductSubscription } from 'expo-iap';

import {
  BANK_ANNUAL_ID,
  BANK_MONTHLY_ID,
  BANK_PLAN_IDS,
  availabilityFrom,
  hasBankPlan,
  listedPlan,
  offerTokenFor,
  type BankPlanId,
  type StorePlan,
} from '@/billing/plans';
import { getBillingSnapshot, registerBillingActions, setBillingSnapshot } from '@/billing/state';

function toStorePlan(product: ProductSubscription | undefined, id: BankPlanId): StorePlan | null {
  if (!product) return null;
  const offer = product.subscriptionOffers?.find((item) => item.offerTokenAndroid?.trim());
  return listedPlan(
    {
      id: product.id,
      displayPrice: product.displayPrice || offer?.displayPrice || '',
      productStatusAndroid: 'productStatusAndroid' in product ? product.productStatusAndroid : null,
      offerToken: offer?.offerTokenAndroid ?? null,
    },
    id,
  );
}

/** Asks Google Play for the bank-link plans. Standing is not involved. */
export function BillingBridge() {
  const [queried, setQueried] = useState(false);
  const { connected, subscriptions, activeSubscriptions, fetchProducts, requestPurchase, finishTransaction, getActiveSubscriptions } =
    useIAP({
      onPurchaseSuccess: (purchase) => {
        void finishTransaction({ purchase, isConsumable: false })
          .then(() => getActiveSubscriptions([...BANK_PLAN_IDS]))
          .then(() => setBillingSnapshot({ notice: null }))
          .catch(() => setBillingSnapshot({ notice: 'Play did not finish the purchase. The date is still here.' }));
      },
      onPurchaseError: (error) => {
        if (error.code === ErrorCode.UserCancelled) return;
        setBillingSnapshot({ notice: error.message || 'Play could not complete the purchase.' });
      },
    });

  useEffect(() => {
    const timeout = setTimeout(() => {
      if (getBillingSnapshot().availability === 'unknown') {
        setBillingSnapshot({ availability: 'unavailable' });
      }
    }, 8000);
    return () => clearTimeout(timeout);
  }, []);

  useEffect(() => {
    if (!connected || queried) return;
    let live = true;
    void Promise.all([
      fetchProducts({ skus: [...BANK_PLAN_IDS], type: 'subs' }),
      getActiveSubscriptions([...BANK_PLAN_IDS]),
    ])
      .then(() => {
        if (live) setQueried(true);
      })
      .catch(() => {
        if (!live) return;
        setBillingSnapshot({
          availability: 'unavailable',
          notice: 'Play Billing did not respond. The date is still here.',
        });
      });
    return () => {
      live = false;
    };
  }, [connected, fetchProducts, getActiveSubscriptions, queried]);

  useEffect(() => {
    if (!queried) return;
    const annual = toStorePlan(
      subscriptions.find((item) => item.id === BANK_ANNUAL_ID),
      BANK_ANNUAL_ID,
    );
    const monthly = toStorePlan(
      subscriptions.find((item) => item.id === BANK_MONTHLY_ID),
      BANK_MONTHLY_ID,
    );
    setBillingSnapshot({
      availability: availabilityFrom({ queried: true, connected, annual, monthly }),
      subscribed: hasBankPlan(activeSubscriptions),
      annualPrice: annual?.displayPrice ?? null,
      monthlyPrice: monthly?.displayPrice ?? null,
    });
  }, [activeSubscriptions, connected, queried, subscriptions]);

  useEffect(() => {
    registerBillingActions({
      purchase: async (plan) => {
        const storePlan = toStorePlan(
          subscriptions.find((item) => item.id === plan),
          plan,
        );
        const token = offerTokenFor(storePlan);
        if (Platform.OS === 'android' && !token) {
          setBillingSnapshot({ notice: 'Play did not return an offer for this plan.' });
          return;
        }
        await requestPurchase({
          type: 'subs',
          request: {
            apple: { sku: plan },
            google: {
              skus: [plan],
              subscriptionOffers: token ? [{ sku: plan, offerToken: token }] : undefined,
            },
          },
        });
      },
      restore: async () => {
        await getActiveSubscriptions([...BANK_PLAN_IDS]);
        setBillingSnapshot({ notice: null });
      },
    });
    return () => registerBillingActions(null);
  }, [getActiveSubscriptions, requestPurchase, subscriptions]);

  return null;
}
