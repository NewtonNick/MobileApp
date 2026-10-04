import type { HouseholdInput } from '@asset-aware/forecast-engine';

const SECRET =
  /^(access_?token|pin|pinhash|entitlements?|plus|banklinkunlocked|reservedcash|standing|leftover|sentence)$/i;

function scrub(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrub);
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET.test(key)) continue;
    out[key] = scrub(item);
  }
  return out;
}

/**
 * UTF-8 leave path. Balances, tax lots, expenses, ledger rows, and elected goals.
 * No access token, PIN, entitlement, standing sentence, or reserved cash.
 * This file does not restore the app.
 */
export function plainBooks(household: HouseholdInput): string {
  const body = {
    kind: 'plain-copy',
    note: 'This file does not restore the app.',
    accounts: household.accounts.map((account) => ({
      id: account.id,
      name: account.name,
      type: account.type,
      balance: account.balance,
    })),
    assets: household.assets.map((asset) => ({
      id: asset.id,
      name: asset.name,
      type: asset.type,
      value: asset.value ?? null,
    })),
    expenses: household.expenses.map((expense) => ({
      id: expense.id,
      name: expense.name,
      monthlyAmount: expense.monthlyAmount,
    })),
    ledger: (household.ledger ?? []).map((row) => ({
      merchant: row.merchant,
      amount: row.amount,
      date: row.date.slice(0, 10),
      category: row.category,
      role: row.role,
    })),
    taxLots: (household.taxLots ?? []).map((lot) => ({
      accountId: lot.accountId,
      symbol: lot.symbol,
      acquiredOn: lot.acquiredOn,
      shares: lot.shares,
      costBasis: lot.costBasis,
      pricePerShare: lot.pricePerShare,
    })),
    shortTermGainRate: household.shortTermGainRate ?? null,
    longTermGainRate: household.longTermGainRate ?? null,
    goals: (household.openGoals ?? []).map((goal) => scrub(goal)),
  };
  return `${JSON.stringify(body, null, 2)}\n`;
}
