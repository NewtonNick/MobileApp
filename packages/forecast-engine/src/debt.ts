import { amortizeMonth } from './amort';
import { resolvedMonthIndex } from './month';
import { VEHICLE_COST_ESTIMATES } from './ownership';
import { liabilityApr } from './rates';
import { isLiability } from './types';
import type { AccountInput, AssetInput, DuplicateGuess, ExpenseInput, HouseholdInput, Scenario } from './types';

const TOKENS = [
  'mortgage',
  'rent',
  'housing',
  'honda',
  'toyota',
  'ford',
  'chevy',
  'auto loan',
  'car payment',
  'car loan',
  'student',
  'visa',
  'mastercard',
  'tax',
  'insurance',
  'hoa',
  'repairs',
  'repair',
  'fuel',
  'gas',
];

export interface OwnershipDuplicateGuess {
  expenseId: string;
  assetId: string;
  lineKey: string;
  expenseName: string;
  lineLabel: string;
  expenseAmount: number;
  lineAmount: number;
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function tokenHit(name: string): boolean {
  const n = norm(name);
  return TOKENS.some((t) => n.includes(t));
}

function amountsClose(a: number, b: number): boolean {
  if (a <= 0 || b <= 0) return false;
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return (hi - lo) / hi <= 0.1;
}

export function findDuplicateGuesses(
  expenses: ExpenseInput[],
  accounts: AccountInput[],
): DuplicateGuess[] {
  const liabilities = accounts.filter((a) => isLiability(a.type) && (a.minPayment ?? 0) > 0);
  const guesses: DuplicateGuess[] = [];
  for (const expense of expenses) {
    if (expense.linkedLiabilityId || expense.duplicateReviewed) continue;
    if (expense.monthlyAmount == null) continue;
    for (const liability of liabilities) {
      if (liability.linkedExpenseId || liability.duplicateReviewed) continue;
      const payment = liability.minPayment ?? 0;
      const similarAmount = amountsClose(expense.monthlyAmount, payment);
      const similarName =
        tokenHit(expense.name) &&
        (tokenHit(liability.name) || similarAmount);
      if (similarAmount || similarName) {
        guesses.push({
          expenseId: expense.id,
          liabilityId: liability.id,
          expenseName: expense.name,
          liabilityName: liability.name,
          expenseAmount: expense.monthlyAmount,
          liabilityPayment: payment,
        });
      }
    }
  }
  return guesses;
}

const VEHICLE_INSURANCE_ESTIMATE = VEHICLE_COST_ESTIMATES.insuranceMonthly;
const VEHICLE_FUEL_ESTIMATE = VEHICLE_COST_ESTIMATES.fuelMonthly;
const VEHICLE_REGISTRATION_ESTIMATE = VEHICLE_COST_ESTIMATES.registrationAnnual;

const OWNERSHIP_LINES: { token: string; label: string; amount: (asset: AssetInput) => number }[] = [
  { token: 'tax', label: 'Property tax', amount: (asset) => asset.taxMonthly ?? 0 },
  {
    token: 'insurance',
    label: 'Insurance',
    amount: (asset) =>
      asset.insuranceMonthly ?? (asset.type === 'vehicle' ? VEHICLE_INSURANCE_ESTIMATE : 0),
  },
  { token: 'hoa', label: 'HOA', amount: (asset) => asset.hoaMonthly ?? 0 },
  { token: 'repair', label: 'Repairs', amount: () => 1 },
  {
    token: 'fuel',
    label: 'Fuel',
    amount: (asset) =>
      asset.type === 'vehicle' ? asset.fuelMonthly ?? VEHICLE_FUEL_ESTIMATE : 0,
  },
  {
    token: 'gas',
    label: 'Fuel',
    amount: (asset) =>
      asset.type === 'vehicle' ? asset.fuelMonthly ?? VEHICLE_FUEL_ESTIMATE : 0,
  },
  {
    token: 'registration',
    label: 'Registration',
    amount: (asset) =>
      asset.type === 'vehicle' ? (asset.registrationAnnual ?? VEHICLE_REGISTRATION_ESTIMATE) / 12 : 0,
  },
];

function lineKey(asset: AssetInput, token: string): string {
  if (token === 'repair') return asset.type === 'home' ? `home:${asset.id}:maint` : `vehicle:${asset.id}:maint`;
  if (token === 'gas' || token === 'fuel') return `vehicle:${asset.id}:fuel`;
  const field =
    token === 'tax' ? 'tax' : token === 'hoa' ? 'hoa' : token === 'registration' ? 'registration' : 'insurance';
  return `${asset.type === 'home' ? 'home' : 'vehicle'}:${asset.id}:${field}`;
}

/** Expense that repeats a house or car line, not only a loan payment. */
export function findOwnershipDuplicateGuesses(
  expenses: ExpenseInput[],
  assets: AssetInput[],
): OwnershipDuplicateGuess[] {
  const guesses: OwnershipDuplicateGuess[] = [];
  for (const expense of expenses) {
    if (expense.linkedLiabilityId || expense.linkedAssetKey || expense.duplicateReviewed) continue;
    if (expense.monthlyAmount == null) continue;
    const name = norm(expense.name);
    for (const asset of assets) {
      if (asset.type !== 'home' && asset.type !== 'vehicle') continue;
      for (const line of OWNERSHIP_LINES) {
        if (!name.includes(line.token)) continue;
        if (line.token === 'repair' && asset.type !== 'home' && asset.type !== 'vehicle') continue;
        if (line.token === 'tax' || line.token === 'hoa') {
          if (asset.type !== 'home') continue;
        }
        if ((line.token === 'fuel' || line.token === 'gas') && asset.type !== 'vehicle') continue;
        const amount = line.token === 'repair' ? expense.monthlyAmount : line.amount(asset);
        if (line.token !== 'repair' && !(amount > 0)) continue;
        guesses.push({
          expenseId: expense.id,
          assetId: asset.id,
          lineKey: lineKey(asset, line.token),
          expenseName: expense.name,
          lineLabel: line.label,
          expenseAmount: expense.monthlyAmount,
          lineAmount: line.token === 'repair' ? expense.monthlyAmount : amount,
        });
        break;
      }
    }
  }
  return guesses;
}

/** Same bill: the expense and the loan payment are one charge. */
export function linkDuplicateBills(household: HouseholdInput, guess: DuplicateGuess): HouseholdInput {
  return {
    ...household,
    expenses: household.expenses.map((expense) =>
      expense.id === guess.expenseId
        ? { ...expense, linkedLiabilityId: guess.liabilityId, duplicateReviewed: true }
        : expense,
    ),
    accounts: household.accounts.map((account) =>
      account.id === guess.liabilityId
        ? { ...account, linkedExpenseId: guess.expenseId, duplicateReviewed: true }
        : account,
    ),
  };
}

/** Not sure: remember the question without treating the two rows as one bill. */
export function dismissDuplicateGuess(household: HouseholdInput, guess: DuplicateGuess): HouseholdInput {
  return {
    ...household,
    expenses: household.expenses.map((expense) =>
      expense.id === guess.expenseId ? { ...expense, duplicateReviewed: true } : expense,
    ),
    accounts: household.accounts.map((account) =>
      account.id === guess.liabilityId ? { ...account, duplicateReviewed: true } : account,
    ),
  };
}

/** Same bill: drop the expense from living and, when the asset line was only an estimate, keep the typed amount. */
export function linkOwnershipExpense(household: HouseholdInput, guess: OwnershipDuplicateGuess): HouseholdInput {
  return {
    ...household,
    expenses: household.expenses.map((expense) =>
      expense.id === guess.expenseId
        ? { ...expense, linkedAssetKey: guess.lineKey, duplicateReviewed: true }
        : expense,
    ),
    assets: household.assets.map((asset) => {
      if (asset.id !== guess.assetId) return asset;
      if (guess.lineKey.endsWith(':insurance') && asset.insuranceMonthly == null) {
        return { ...asset, insuranceMonthly: guess.expenseAmount };
      }
      if (guess.lineKey.endsWith(':fuel') && asset.fuelMonthly == null) {
        return { ...asset, fuelMonthly: guess.expenseAmount };
      }
      if (guess.lineKey.endsWith(':tax') && asset.taxMonthly == null) {
        return { ...asset, taxMonthly: guess.expenseAmount };
      }
      if (guess.lineKey.endsWith(':hoa') && asset.hoaMonthly == null) {
        return { ...asset, hoaMonthly: guess.expenseAmount };
      }
      if (guess.lineKey.endsWith(':registration') && asset.registrationAnnual == null) {
        return { ...asset, registrationAnnual: guess.expenseAmount * 12 };
      }
      return asset;
    }),
  };
}

/** Mortgage escrow plus separate house tax or insurance. Null until the user says whether escrow already covers them. */
export function mortgageEscrowOverlap(
  accounts: AccountInput[],
  assets: AssetInput[],
): { mortgageId: string; mortgageName: string } | null {
  const home = assets.find(
    (asset) => asset.type === 'home' && ((asset.taxMonthly ?? 0) > 0 || (asset.insuranceMonthly ?? 0) > 0),
  );
  const mortgage = accounts.find(
    (account) =>
      account.type === 'mortgage' && (account.escrowMonthly ?? 0) > 0 && account.escrowCoversHousing == null,
  );
  if (!home || !mortgage) return null;
  return { mortgageId: mortgage.id, mortgageName: mortgage.name };
}

export function monthlyOutflows(expenses: ExpenseInput[], accounts: AccountInput[]): number {
  const linkedExpenseIds = new Set(
    expenses.filter((e) => e.linkedLiabilityId || e.linkedAssetKey).map((e) => e.id),
  );
  let sum = 0;
  for (const e of expenses) {
    if (e.monthlyAmount == null) continue;
    if (e.linkedLiabilityId || e.linkedAssetKey || linkedExpenseIds.has(e.id)) continue;
    sum += e.monthlyAmount;
  }
  for (const a of accounts) {
    if (!isLiability(a.type) || a.balance <= 0.5) continue;
    sum += a.minPayment ?? 0;
  }
  return sum;
}

export interface DebtWarning {
  accountId: string;
  code: 'missing_payment' | 'below_interest' | 'promo_expiry';
  message: string;
}

export function debtWarnings(household: HouseholdInput, scenario: Scenario = 'realistic', now = new Date()): DebtWarning[] {
  const warnings: DebtWarning[] = [];
  for (const account of household.accounts) {
    if (!isLiability(account.type) || account.balance <= 0.5 || account.payoffStyle === 'paid_monthly') continue;
    if (account.type === 'auto_lease') continue;
    const payment = account.minPayment ?? 0;
    if (!(payment > 0)) {
      warnings.push({
        accountId: account.id,
        code: 'missing_payment',
        message: `${account.name} has no payment, so interest can keep the balance growing.`,
      });
      continue;
    }
    const step = amortizeMonth(account.balance, liabilityApr(account, scenario), payment);
    if (step.negativeAmortization) {
      warnings.push({
        accountId: account.id,
        code: 'below_interest',
        message: `${account.name}'s payment is below this month's interest.`,
      });
    }
    const promoEnd = resolvedMonthIndex(account.promoEndsAt, null, now);
    if (account.promoApr != null && promoEnd != null && promoEnd <= 6) {
      warnings.push({
        accountId: account.id,
        code: 'promo_expiry',
        message: `${account.name}'s introductory rate ends soon, and the payment may change.`,
      });
    }
  }
  return warnings;
}
