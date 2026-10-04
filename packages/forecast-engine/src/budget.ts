import { paychecksPerYear, resolvePaycheckCadence } from './cadence';
import { expenseCountsInLiving } from './expenses';
import { round2 } from './money';
import { monthDiff, monthKey as calendarMonthKey } from './month';
import { ownershipLines } from './ownership';
import { merchantLooksOwnership } from './outliers';
import type {
  AccountInput,
  AccountType,
  BudgetCategory,
  BudgetGroup,
  CategoryOverride,
  ExpenseInput,
  HouseholdInput,
  LedgerRow,
  BankBill,
  BankBillCadence,
  MerchantSighting,
  PlaidAccountKind,
  PlaidAccountLink,
  PlaidItemLink,
} from './types';
import { BUDGET_CATEGORIES, isLiability } from './types';

/** Same window as stale cash. A link older than this cannot move the plan. */
export const STALE_LINK_DAYS = 30;

export const BUDGET_CATEGORY_LABELS: Record<BudgetCategory, string> = {
  housing: 'Housing',
  groceries: 'Groceries',
  transport: 'Transport',
  utilities: 'Utilities',
  subscriptions: 'Subscriptions',
  other_living: 'Other living',
};

export const BUDGET_GROUP_LABELS: Record<BudgetGroup, string> = {
  housing: 'Housing',
  bills: 'Bills',
  living: 'Living',
  sinking: 'Debt and ownership',
};

export interface BankTransaction {
  id: string;
  amount: number;
  merchant: string;
  date: string;
  pending?: boolean;
  pendingTransactionId?: string | null;
  accountId?: string | null;
  primary?: string | null;
  detailed?: string | null;
  confidence?: string | null;
  legacyCategory?: string[] | null;
}

export interface BankSyncAccount {
  plaidAccountId: string;
  name: string;
  kind: PlaidAccountKind;
  /** Current balance only. Available is intentionally absent. */
  current: number | null;
}

/** One outflow stream from the bank. Amount is the charge itself, not yet a monthly equivalent. */
export interface BankRecurringStream {
  merchant: string;
  amount: number;
  /** Plaid frequency, such as MONTHLY or ANNUALLY. */
  frequency: string;
  nextDate?: string | null;
  lastDate?: string | null;
  primary?: string | null;
  detailed?: string | null;
}

export interface BankSyncPayload {
  itemId: string;
  institutionName?: string | null;
  loginRequired?: boolean;
  accounts?: BankSyncAccount[];
  added: BankTransaction[];
  modified: BankTransaction[];
  removed: string[];
  /**
   * Present only when this sync asked the bank for repeating charges.
   * Omit it to leave stored bills alone. An empty list clears this institution.
   */
  recurring?: BankRecurringStream[];
}

export interface BankSyncResult {
  household: HouseholdInput;
  /** Populated only for a sandbox sync. Never written onto the household. */
  sandboxLedger: LedgerRow[] | null;
}

export interface BudgetLine {
  id: string;
  name: string;
  group: BudgetGroup;
  category: BudgetCategory | null;
  planned: number;
  spent: number;
  left: number;
  kind: 'category' | 'debt' | 'ownership';
  editable: boolean;
}

export interface Reconciliation {
  /** Money that left linked accounts this month, pending excluded. */
  outflow: number;
  transfers: number;
  spent: number;
  /** Outflow minus transfers minus categorized spend. This is the inbox. */
  gap: number;
}

export const LEDGER_MONTHS = 3;

export function monthKey(date: Date): string {
  return calendarMonthKey(date);
}

export function rowMonth(date: string): string | null {
  const day = date.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(day)) return day.slice(0, 7);
  return null;
}

export function merchantKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function groupForCategory(category: BudgetCategory): BudgetGroup {
  if (category === 'housing') return 'housing';
  if (category === 'utilities' || category === 'subscriptions') return 'bills';
  return 'living';
}

export function categoryForExpense(expense: ExpenseInput): BudgetCategory | null {
  if (expense.linkedLiabilityId || expense.linkedAssetKey) return null;
  if (expense.budgetCategory && BUDGET_CATEGORIES.includes(expense.budgetCategory)) {
    return expense.budgetCategory;
  }
  const name = expense.name.trim().toLowerCase();
  if (/(rent|mortgage|housing)/.test(name)) return 'housing';
  if (/grocer/.test(name)) return 'groceries';
  if (/(transit|transport|uber|lyft|bus pass)/.test(name)) return 'transport';
  if (/(utilit|electric|water|internet|phone)/.test(name)) return 'utilities';
  if (/subscri/.test(name)) return 'subscriptions';
  if (/(fuel|insurance|hoa|repair|registration)/.test(name)) return null;
  return 'other_living';
}

export function groupForExpense(expense: ExpenseInput): BudgetGroup {
  if (expense.group && (expense.group === 'housing' || expense.group === 'bills' || expense.group === 'living' || expense.group === 'sinking')) {
    return expense.group;
  }
  if (expense.linkedLiabilityId || expense.linkedAssetKey) return 'sinking';
  const category = categoryForExpense(expense);
  return category ? groupForCategory(category) : 'sinking';
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function monthIndex(date: Date): number {
  return date.getFullYear() * 12 + date.getMonth();
}

export function linkIsCurrent(
  items: PlaidItemLink[] | null | undefined,
  now = Date.now(),
): boolean {
  if (!items?.length) return false;
  const windowMs = STALE_LINK_DAYS * 24 * 60 * 60 * 1000;
  return items.every((item) => {
    if (item.loginRequired || !item.lastSyncedAt) return false;
    const at = Date.parse(item.lastSyncedAt);
    if (Number.isNaN(at)) return false;
    return now - at <= windowMs;
  });
}

/** A linked bank cannot account for the rest of the month. Missing charges are unknown. */
export function linkGapUnknown(
  items: PlaidItemLink[] | null | undefined,
  now = Date.now(),
): boolean {
  return (items?.length ?? 0) > 0 && !linkIsCurrent(items, now);
}

export function countsAsSpend(row: LedgerRow): boolean {
  if (row.role !== 'spend') return false;
  return row.confidence === 'high' || row.reviewed === true;
}

export function isInboxRow(row: LedgerRow): boolean {
  if (row.role === 'pending') return false;
  if (row.reviewed && (row.role === 'income' || row.role === 'already_counted')) return false;
  if (countsAsSpend(row)) return false;
  if (row.role === 'transfer' && row.confidence === 'high') return false;
  return row.role === 'income' || row.role === 'already_counted' || row.role === 'transfer' || row.role === 'spend';
}

function ignored(merchant: string, list: string[]): boolean {
  const key = merchantKey(merchant);
  return list.some((item) => {
    const needle = merchantKey(item);
    return needle.length > 0 && (key === needle || key.includes(needle));
  });
}

function confidenceHigh(level: string | null | undefined): boolean {
  const value = (level ?? '').toUpperCase();
  return value === 'HIGH' || value === 'VERY_HIGH';
}

function detailedOf(txn: BankTransaction): string {
  return (txn.detailed ?? '').toUpperCase();
}

function primaryOf(txn: BankTransaction): string {
  return (txn.primary ?? '').toUpperCase();
}

function legacy(txn: BankTransaction): string {
  return (txn.legacyCategory ?? []).join(' ').toLowerCase();
}

function isCardPayment(txn: BankTransaction, linkedCreditIds: string[]): boolean {
  const detailed = detailedOf(txn);
  if (detailed === 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT') return true;
  const text = legacy(txn);
  if (text.includes('credit card') && text.includes('payment')) return true;
  if (
    txn.accountId &&
    linkedCreditIds.includes(txn.accountId) &&
    txn.amount < 0 &&
    (primaryOf(txn).startsWith('TRANSFER') || primaryOf(txn).startsWith('LOAN'))
  ) {
    return true;
  }
  return false;
}

function isLoanPayment(txn: BankTransaction): boolean {
  const detailed = detailedOf(txn);
  if (!detailed.startsWith('LOAN_PAYMENTS_')) return false;
  return detailed !== 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT';
}

function isP2pOrAtm(txn: BankTransaction): boolean {
  return /\b(venmo|zelle|cash app|atm)\b/i.test(txn.merchant);
}

function isTransferTxn(txn: BankTransaction): boolean {
  const primary = primaryOf(txn);
  const detailed = detailedOf(txn);
  if (isP2pOrAtm(txn)) return true;
  if (primary === 'TRANSFER_IN' || primary === 'TRANSFER_OUT' || detailed.startsWith('TRANSFER_')) return true;
  return legacy(txn).includes('transfer');
}

function transferIsSure(txn: BankTransaction): boolean {
  const detailed = detailedOf(txn);
  if (confidenceHigh(txn.confidence)) return true;
  if (!detailed || detailed.endsWith('_OTHER')) return false;
  return detailed.includes('ACCOUNT_TRANSFER') || detailed.includes('SAVINGS') || detailed.includes('CREDIT_CARD');
}

function isPayDeposit(txn: BankTransaction): boolean {
  if (txn.amount >= 0) return false;
  const primary = primaryOf(txn);
  const detailed = detailedOf(txn);
  if (primary === 'INCOME' || detailed.startsWith('INCOME_')) return true;
  return /\b(payroll|paycheck|direct dep|salary|wages)\b/.test(txn.merchant.toLowerCase());
}

function ownershipCharge(txn: BankTransaction): boolean {
  const detailed = detailedOf(txn);
  if (
    detailed === 'TRANSPORTATION_GAS' ||
    detailed === 'GENERAL_SERVICES_INSURANCE' ||
    detailed === 'GENERAL_SERVICES_AUTOMOTIVE' ||
    detailed.startsWith('HOME_IMPROVEMENT')
  ) {
    return true;
  }
  if (isLoanPayment(txn)) return true;
  if (merchantLooksOwnership(txn.merchant)) return true;
  return /\b(insurance|hoa|fuel)\b/.test(txn.merchant.toLowerCase());
}

export function mapPlaidCategory(primary: string | null | undefined, detailed: string | null | undefined): BudgetCategory | null {
  const d = (detailed ?? '').toUpperCase();
  const p = (primary ?? '').toUpperCase();
  if (d === 'RENT_AND_UTILITIES_RENT') return 'housing';
  if (d.startsWith('RENT_AND_UTILITIES')) return 'utilities';
  if (d === 'FOOD_AND_DRINK_GROCERIES') return 'groceries';
  if (d.startsWith('FOOD_AND_DRINK')) return 'other_living';
  if (d === 'TRANSPORTATION_GAS') return null;
  if (d.startsWith('TRANSPORTATION')) return 'transport';
  if (d === 'ENTERTAINMENT_TV_AND_MOVIES' || d === 'ENTERTAINMENT_MUSIC' || d.includes('SUBSCRIPTION')) {
    return 'subscriptions';
  }
  if (
    p === 'ENTERTAINMENT' ||
    p === 'GENERAL_MERCHANDISE' ||
    p === 'PERSONAL_CARE' ||
    p === 'MEDICAL' ||
    p === 'GENERAL_SERVICES' ||
    p === 'TRAVEL' ||
    p === 'FOOD_AND_DRINK'
  ) {
    return 'other_living';
  }
  return null;
}

function overrideFor(merchant: string, overrides: CategoryOverride[]): BudgetCategory | null {
  const key = merchantKey(merchant);
  const hit = overrides.find((row) => merchantKey(row.merchant) === key);
  return hit?.category ?? null;
}

function typicalFor(category: BudgetCategory | null, expenses: ExpenseInput[]): number {
  if (!category) return 0;
  return expenses
    .filter((expense) => categoryForExpense(expense) === category && expense.monthlyAmount != null)
    .reduce((sum, expense) => sum + (expense.monthlyAmount ?? 0), 0);
}

function isOutlierAmount(amount: number, typical: number): boolean {
  const size = Math.abs(amount);
  if (typical > 0 && size >= 500 && size >= 2 * typical) return true;
  return false;
}

export function classifyTransaction(
  txn: BankTransaction,
  household: HouseholdInput,
): LedgerRow | null {
  if (ignored(txn.merchant, household.ignoredMerchants ?? [])) return null;
  const base = {
    id: txn.id,
    amount: txn.amount,
    merchant: txn.merchant,
    date: txn.date.slice(0, 10),
    plaidAccountId: txn.accountId ?? null,
    pendingId: txn.pendingTransactionId ?? null,
    source: 'plaid' as const,
  };
  if (txn.pending) {
    return { ...base, category: null, role: 'pending', confidence: 'low' };
  }
  const creditIds = (household.plaidItems ?? []).flatMap((item) =>
    item.accounts.filter((account) => account.kind === 'credit').map((account) => account.plaidAccountId),
  );
  if (isCardPayment(txn, creditIds)) {
    return { ...base, category: null, role: 'transfer', confidence: 'high' };
  }
  if (ownershipCharge(txn)) {
    return { ...base, category: null, role: 'already_counted', confidence: 'low' };
  }
  if (isTransferTxn(txn)) {
    return {
      ...base,
      category: null,
      role: 'transfer',
      confidence: transferIsSure(txn) ? 'high' : 'low',
    };
  }
  if (isPayDeposit(txn)) {
    return { ...base, category: null, role: 'income', confidence: 'low' };
  }
  const taught = overrideFor(txn.merchant, household.categoryOverrides ?? []);
  const mapped = taught ?? mapPlaidCategory(txn.primary, txn.detailed);
  if (txn.amount < 0 && mapped) {
    return { ...base, category: mapped, role: 'spend', confidence: confidenceHigh(txn.confidence) || taught ? 'high' : 'low' };
  }
  const high = Boolean(taught) || confidenceHigh(txn.confidence);
  const outlier =
    isOutlierAmount(txn.amount, typicalFor(mapped, household.expenses)) ||
    (merchantLooksOwnership(txn.merchant) && Math.abs(txn.amount) >= 200);
  if (outlier) {
    return { ...base, category: mapped, role: mapped ? 'spend' : 'already_counted', confidence: 'low' };
  }
  if (mapped && high) {
    return { ...base, category: mapped, role: 'spend', confidence: 'high' };
  }
  return { ...base, category: mapped, role: 'spend', confidence: 'low' };
}

function pendingPostedPair(pending: LedgerRow, posted: LedgerRow): boolean {
  if (merchantKey(pending.merchant) !== merchantKey(posted.merchant)) return false;
  if (!amountsClose(pending.amount, posted.amount)) return false;
  const days = daysBetween(pending.date, posted.date);
  return days != null && days <= 5;
}

function amountsClose(a: number, b: number): boolean {
  const scale = Math.max(Math.abs(a), Math.abs(b), 1);
  return Math.abs(a - b) <= Math.max(2, scale * 0.15);
}

function daysBetween(a: string, b: string): number | null {
  const left = a.slice(0, 10);
  const right = b.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(left) || !/^\d{4}-\d{2}-\d{2}$/.test(right)) return null;
  const start = Date.parse(`${left}T00:00:00Z`);
  const end = Date.parse(`${right}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.abs(Math.round((start - end) / 86_400_000));
}

/**
 * A typed spend and a later bank spend are one charge when the merchant, amount, and date line up.
 * The typed row stays, so its category, review flag, split, and name stay. The bank copy is dropped.
 * Two bank rows are both real. A transfer or a card payment is not a living spend.
 */
function dropTypedDuplicates(existing: LedgerRow[], incoming: LedgerRow[], month: string): LedgerRow[] {
  const used = new Set<string>();
  const dropped = new Set<string>();
  for (const bank of incoming) {
    if (bank.role !== 'spend' || !(bank.amount > 0)) continue;
    if (rowMonth(bank.date) !== month) continue;
    let best: LedgerRow | null = null;
    let bestDays = 4;
    for (const row of existing) {
      if (used.has(row.id)) continue;
      if (row.source !== 'typed' || row.role !== 'spend' || !(row.amount > 0)) continue;
      if (rowMonth(row.date) !== month) continue;
      if (merchantKey(row.merchant) !== merchantKey(bank.merchant)) continue;
      if (!amountsClose(Math.abs(row.amount), Math.abs(bank.amount))) continue;
      const days = daysBetween(row.date, bank.date);
      if (days == null || days > 3) continue;
      if (days < bestDays) {
        best = row;
        bestDays = days;
      }
    }
    if (!best) continue;
    used.add(best.id);
    dropped.add(bank.id);
  }
  return incoming.filter((row) => !dropped.has(row.id));
}

function inclusiveMonthSpan(start: string, end: string): number {
  const [ys, ms] = start.split('-').map(Number);
  const [ye, me] = end.split('-').map(Number);
  if (!ys || !ms || !ye || !me) return 1;
  return (ye - ys) * 12 + (me - ms) + 1;
}

function cadenceOf(frequency: string): BankBillCadence | null {
  switch (frequency.trim().toUpperCase().replace(/[\s-]+/g, '_')) {
    case 'WEEKLY':
      return 'weekly';
    case 'BIWEEKLY':
      return 'biweekly';
    case 'SEMI_MONTHLY':
    case 'SEMIMONTHLY':
      return 'semimonthly';
    case 'MONTHLY':
      return 'monthly';
    case 'ANNUALLY':
    case 'ANNUAL':
    case 'YEARLY':
      return 'annual';
    default:
      return null;
  }
}

function monthlyEquivalent(amount: number, cadence: BankBillCadence): number {
  if (cadence === 'weekly') return round2((amount * 52) / 12);
  if (cadence === 'biweekly') return round2((amount * 26) / 12);
  if (cadence === 'semimonthly') return round2(amount * 2);
  if (cadence === 'annual') return round2(amount / 12);
  return round2(amount);
}

function dayOf(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const day = Number(iso.slice(8, 10));
  return day >= 1 && day <= 31 ? day : null;
}

/** Turn bank streams into monthly bills. Unknown cadence and non-positive amounts are dropped. */
export function billsFromStreams(itemId: string, streams: BankRecurringStream[]): BankBill[] {
  const bills: BankBill[] = [];
  for (const stream of streams) {
    const cadence = cadenceOf(stream.frequency);
    const merchant = stream.merchant.trim().replace(/\s+/g, ' ');
    if (!cadence || !merchantKey(merchant) || !(stream.amount > 0)) continue;
    bills.push({
      merchant,
      amount: monthlyEquivalent(stream.amount, cadence),
      day: dayOf(stream.nextDate) ?? dayOf(stream.lastDate),
      itemId,
      category: mapPlaidCategory(stream.primary, stream.detailed),
      cadence,
    });
  }
  return bills;
}

export function looksRecurring(sightings: MerchantSighting[], merchant: string, amount: number): boolean {
  const key = merchantKey(merchant);
  const months = new Set<string>();
  for (const row of sightings) {
    if (merchantKey(row.merchant) !== key) continue;
    if (!amountsClose(row.amount, amount)) continue;
    months.add(row.month);
  }
  if (months.size < 3) return false;
  const sorted = [...months].sort();
  const span = inclusiveMonthSpan(sorted[0], sorted[sorted.length - 1]);
  return months.size >= Math.ceil(span / 2);
}

export function addSightings(
  existing: MerchantSighting[],
  txns: BankTransaction[],
  itemId?: string | null,
): MerchantSighting[] {
  const next = existing.map((row) => ({ ...row }));
  for (const txn of txns) {
    if (txn.pending) continue;
    const month = rowMonth(txn.date);
    if (!month) continue;
    const merchant = merchantKey(txn.merchant);
    const amount = round2(Math.abs(txn.amount));
    const match = next.find(
      (row) =>
        row.merchant === merchant &&
        row.month === month &&
        amountsClose(row.amount, amount) &&
        (!row.itemId || !itemId || row.itemId === itemId),
    );
    if (match) {
      if (!match.itemId && itemId) match.itemId = itemId;
      continue;
    }
    next.push({ merchant, amount, month, itemId: itemId ?? null });
  }
  return next.slice(-500);
}

function rowsForMonth(rows: LedgerRow[], month: string): LedgerRow[] {
  return rows.filter((row) => rowMonth(row.date) === month);
}

function planSpendRows(rows: LedgerRow[], month: string, category: BudgetCategory): LedgerRow[] {
  return rowsForMonth(rows, month).filter(
    (row) =>
      countsAsSpend(row) &&
      row.category === category &&
      !row.thisMonthOnly &&
      !row.yearSpread,
  );
}

export function categorySpent(rows: LedgerRow[], month: string, category: BudgetCategory): number {
  return round2(planSpendRows(rows, month, category).reduce((sum, row) => sum + row.amount, 0));
}

export function budgetLines(household: HouseholdInput, now = new Date()): BudgetLine[] {
  const month = monthKey(now);
  const rows = household.ledger ?? [];
  const lines: BudgetLine[] = BUDGET_CATEGORIES.map((category) => {
    const planned = round2(
      household.expenses
        .filter((expense) => categoryForExpense(expense) === category && expenseCountsInLiving(expense, 1))
        .reduce((sum, expense) => sum + (expense.monthlyAmount ?? 0), 0),
    );
    const spent = categorySpent(rows, month, category);
    return {
      id: `cat:${category}`,
      name: BUDGET_CATEGORY_LABELS[category],
      group: groupForCategory(category),
      category,
      planned,
      spent,
      left: round2(planned - spent),
      kind: 'category',
      editable: true,
    };
  });
  for (const account of household.accounts) {
    if (!isLiability(account.type)) continue;
    const planned = account.minPayment ?? 0;
    lines.push({
      id: `debt:${account.id}`,
      name: account.name,
      group: 'sinking',
      category: null,
      planned,
      spent: 0,
      left: planned,
      kind: 'debt',
      editable: false,
    });
  }
  for (const line of ownershipLines(household)) {
    lines.push({
      id: line.id,
      name: line.name,
      group: 'sinking',
      category: null,
      planned: line.amount,
      spent: 0,
      left: line.amount,
      kind: 'ownership',
      editable: false,
    });
  }
  return lines;
}

export function reconcileMonth(rows: LedgerRow[], month: string): Reconciliation {
  const monthRows = rowsForMonth(rows, month).filter((row) => row.role !== 'pending');
  const outflow = round2(monthRows.reduce((sum, row) => sum + row.amount, 0));
  const transfers = round2(
    monthRows.filter((row) => row.role === 'transfer' && row.amount > 0).reduce((sum, row) => sum + row.amount, 0),
  );
  const spent = round2(monthRows.filter((row) => countsAsSpend(row)).reduce((sum, row) => sum + row.amount, 0));
  return { outflow, transfers, spent, gap: round2(outflow - transfers - spent) };
}

export function monthHasSpend(rows: LedgerRow[] | null | undefined, now = new Date()): boolean {
  const month = monthKey(now);
  return (rows ?? []).some((row) => rowMonth(row.date) === month && countsAsSpend(row));
}

export function figuresToRetype(household: HouseholdInput): number {
  let count = 0;
  if (household.monthlyIncome != null) count += 1;
  if ((household.partnerMonthlyIncome ?? null) != null) count += 1;
  count += household.expenses.filter(
    (expense) => expense.monthlyAmount != null && !expense.linkedLiabilityId && !expense.linkedAssetKey,
  ).length;
  count += household.accounts.filter(
    (account) => account.type === 'checking' || account.type === 'savings' || account.type === 'cash',
  ).length;
  return count;
}

function openedBeforeToday(createdAt: string, now: Date): boolean {
  const created = new Date(createdAt);
  if (Number.isNaN(created.getTime())) return false;
  return !sameDay(created, now);
}

export function showEmptyMonth(household: HouseholdInput, hiredDate: string | null, now = new Date()): boolean {
  if (!hiredDate || linkIsCurrent(household.plaidItems, now.getTime())) return false;
  if (!openedBeforeToday(household.createdAt, now)) return false;
  return !monthHasSpend(household.ledger, now);
}

export function showReturn(
  household: HouseholdInput,
  hiredDate: string | null,
  cashStale: boolean,
  now = new Date(),
): boolean {
  if (!hiredDate || linkIsCurrent(household.plaidItems, now.getTime())) return false;
  if (!openedBeforeToday(household.createdAt, now)) return false;
  if (monthHasSpend(household.ledger, now)) return false;
  const created = new Date(household.createdAt);
  if (Number.isNaN(created.getTime())) return false;
  const laterMonth = monthIndex(now) > monthIndex(created);
  return laterMonth || cashStale;
}

export function showCollisionAsk(household: HouseholdInput, collisionActive: boolean, now = new Date()): boolean {
  if (!collisionActive || linkIsCurrent(household.plaidItems, now.getTime())) return false;
  return openedBeforeToday(household.createdAt, now);
}

function upsertCategoryExpense(expenses: ExpenseInput[], category: BudgetCategory, monthlyAmount: number): ExpenseInput[] {
  const matches = expenses.filter((expense) => categoryForExpense(expense) === category);
  const rest = expenses.filter((expense) => categoryForExpense(expense) !== category);
  const kept = matches[0];
  const line: ExpenseInput = kept
    ? {
        ...kept,
        monthlyAmount,
        group: kept.group ?? groupForCategory(category),
        budgetCategory: kept.budgetCategory ?? category,
      }
    : {
        id: `exp-${category}`,
        name: BUDGET_CATEGORY_LABELS[category],
        monthlyAmount,
        variable: category === 'groceries' || category === 'transport' || category === 'other_living',
        group: groupForCategory(category),
        budgetCategory: category,
      };
  return [...rest, line];
}

export function setCategoryPlan(
  household: HouseholdInput,
  category: BudgetCategory,
  monthlyAmount: number,
): HouseholdInput {
  return { ...household, expenses: upsertCategoryExpense(household.expenses, category, monthlyAmount) };
}

export function addTypedSpend(
  household: HouseholdInput,
  input: { merchant: string; amount: number; category: BudgetCategory; date?: string },
): HouseholdInput {
  const date = (input.date ?? new Date().toISOString()).slice(0, 10);
  const row: LedgerRow = {
    id: `typed-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    amount: input.amount,
    merchant: input.merchant.trim() || BUDGET_CATEGORY_LABELS[input.category],
    date,
    category: input.category,
    role: 'spend',
    source: 'typed',
    confidence: 'high',
    reviewed: true,
  };
  return { ...household, ledger: [...(household.ledger ?? []), row] };
}

function mapRow(household: HouseholdInput, rowId: string, patch: Partial<LedgerRow>): HouseholdInput {
  return {
    ...household,
    ledger: (household.ledger ?? []).map((row) => (row.id === rowId ? { ...row, ...patch } : row)),
  };
}

export function fileAsSpend(household: HouseholdInput, rowId: string, category: BudgetCategory): HouseholdInput {
  const row = (household.ledger ?? []).find((item) => item.id === rowId);
  if (!row) return household;
  const overrides = household.categoryOverrides ?? [];
  const nextOverrides = [
    ...overrides.filter((item) => merchantKey(item.merchant) !== merchantKey(row.merchant)),
    { merchant: merchantKey(row.merchant), category },
  ];
  return {
    ...mapRow(household, rowId, {
      role: 'spend',
      category,
      confidence: 'high',
      reviewed: true,
      thisMonthOnly: false,
    }),
    categoryOverrides: nextOverrides,
  };
}

export function markThisMonthOnly(household: HouseholdInput, rowId: string): HouseholdInput {
  const row = (household.ledger ?? []).find((item) => item.id === rowId);
  if (!row) return household;
  return mapRow(household, rowId, {
    role: 'spend',
    category: row.category ?? 'other_living',
    confidence: 'high',
    reviewed: true,
    thisMonthOnly: true,
    yearSpread: false,
  });
}

export function spreadAcrossYear(household: HouseholdInput, rowId: string): HouseholdInput | null {
  const row = (household.ledger ?? []).find((item) => item.id === rowId);
  if (!row) return null;
  const category = row.category ?? 'other_living';
  const monthly = round2(Math.abs(row.amount) / 12);
  const expenses = upsertCategoryExpense(household.expenses, category, monthly);
  return {
    ...mapRow({ ...household, expenses }, rowId, {
      role: 'spend',
      category,
      confidence: 'high',
      reviewed: true,
      yearSpread: true,
      thisMonthOnly: false,
    }),
  };
}

export function acceptPay(household: HouseholdInput, rowId: string): HouseholdInput {
  const row = (household.ledger ?? []).find((item) => item.id === rowId);
  if (!row) return household;
  const next = mapRow(household, rowId, { role: 'income', reviewed: true, confidence: 'high' });
  if (household.monthlyIncome != null) return next;
  const checks = paychecksPerYear(resolvePaycheckCadence(household));
  return { ...next, monthlyIncome: round2((Math.abs(row.amount) * checks) / 12) };
}

export function alreadyInTakeHome(household: HouseholdInput, rowId: string): HouseholdInput {
  return mapRow(household, rowId, { role: 'income', reviewed: true, confidence: 'high' });
}

export function dismissAlreadyCounted(household: HouseholdInput, rowId: string): HouseholdInput {
  return mapRow(household, rowId, { role: 'already_counted', reviewed: true });
}

export function ignoreMerchant(household: HouseholdInput, merchant: string): HouseholdInput {
  const key = merchantKey(merchant);
  return {
    ...household,
    ignoredMerchants: [...new Set([...(household.ignoredMerchants ?? []), key])],
    reviewedPurchaseIds: [...new Set([...(household.reviewedPurchaseIds ?? []), key])],
    ledger: (household.ledger ?? []).filter((row) => merchantKey(row.merchant) !== key),
  };
}

export function acceptMonthAsPlan(household: HouseholdInput, now = new Date()): HouseholdInput | null {
  if (!linkIsCurrent(household.plaidItems, now.getTime())) return null;
  const month = monthKey(now);
  let expenses = household.expenses;
  let touched = false;
  for (const category of BUDGET_CATEGORIES) {
    const rows = planSpendRows(household.ledger ?? [], month, category);
    if (!rows.length) continue;
    const spent = round2(rows.reduce((sum, row) => sum + row.amount, 0));
    expenses = upsertCategoryExpense(expenses, category, spent);
    touched = true;
  }
  if (!touched) return household;
  return { ...household, expenses };
}

function localTypeFor(kind: PlaidAccountKind): AccountType | null {
  if (kind === 'checking') return 'checking';
  if (kind === 'savings') return 'savings';
  if (kind === 'credit') return 'credit_card';
  return null;
}

function applyBalances(
  household: HouseholdInput,
  itemId: string,
  institutionName: string | null,
  accounts: BankSyncAccount[],
  syncedAt: string,
): HouseholdInput {
  const items = household.plaidItems ?? [];
  const existing = items.find((item) => item.itemId === itemId);
  let books: HouseholdInput = {
    ...household,
    accounts: household.accounts.map((account) => ({ ...account })),
  };
  const taken = new Set(
    items
      .filter((item) => item.itemId !== itemId)
      .flatMap((item) => item.accounts.map((row) => row.localAccountId))
      .filter((id): id is string => !!id),
  );
  const links: PlaidAccountLink[] = [];
  for (const account of accounts) {
    const prior = existing?.accounts.find((row) => row.plaidAccountId === account.plaidAccountId);
    let localAccountId = prior?.localAccountId ?? null;
    const wanted = localTypeFor(account.kind);
    if (localAccountId && taken.has(localAccountId)) localAccountId = null;
    if (!localAccountId && wanted) {
      const matches = books.accounts.filter((row) => row.type === wanted && !taken.has(row.id));
      if (matches.length === 1) localAccountId = matches[0].id;
    }
    if (!localAccountId && wanted && account.current != null) {
      const sameType = books.accounts.filter((row) => row.type === wanted && !taken.has(row.id));
      if (sameType.length === 0) {
        localAccountId = `acct-${account.plaidAccountId}`;
        books = {
          ...books,
          accounts: [
            ...books.accounts,
            {
              id: localAccountId,
              type: wanted,
              name: account.name || wanted,
              balance: account.current,
              lastEditedAt: syncedAt,
              lastSyncedAt: syncedAt,
            },
          ],
        };
      }
    }
    if (localAccountId) taken.add(localAccountId);
    if (localAccountId && account.current != null && Number.isFinite(account.current)) {
      books = {
        ...books,
        accounts: books.accounts.map((row) =>
          row.id === localAccountId
            ? { ...row, balance: account.current as number, lastEditedAt: syncedAt, lastSyncedAt: syncedAt }
            : row,
        ),
      };
    }
    links.push({
      plaidAccountId: account.plaidAccountId,
      localAccountId,
      name: account.name,
      kind: account.kind,
    });
  }
  const item: PlaidItemLink = {
    itemId,
    institutionName: institutionName ?? existing?.institutionName ?? null,
    lastSyncedAt: syncedAt,
    loginRequired: false,
    accounts: links,
  };
  return {
    ...books,
    plaidItems: [...items.filter((row) => row.itemId !== itemId), item],
  };
}

function classifyPayloadRows(household: HouseholdInput, payload: BankSyncPayload, month: string): LedgerRow[] {
  const removed = new Set(payload.removed);
  for (const txn of [...payload.added, ...payload.modified]) {
    if (txn.pendingTransactionId) removed.add(txn.pendingTransactionId);
  }
  const incoming = [...payload.added, ...payload.modified];
  const classified: LedgerRow[] = [];
  for (const txn of incoming) {
    if (removed.has(txn.id)) continue;
    const row = classifyTransaction(txn, household);
    if (!row || rowMonth(row.date) !== month) continue;
    classified.push({ ...row, source: 'plaid', itemId: payload.itemId });
  }
  return classified;
}

export function applyBankSync(
  household: HouseholdInput,
  payload: BankSyncPayload,
  options: { now?: Date; sandbox?: boolean } = {},
): BankSyncResult {
  const now = options.now ?? new Date();
  if (options.sandbox) {
    const month = monthKey(now);
    return {
      household,
      sandboxLedger: classifyPayloadRows(household, payload, month).map((row) => ({ ...row, source: 'sandbox' })),
    };
  }
  if (payload.loginRequired) {
    const items = household.plaidItems ?? [];
    const existing = items.find((item) => item.itemId === payload.itemId);
    const item: PlaidItemLink = {
      itemId: payload.itemId,
      institutionName: payload.institutionName ?? existing?.institutionName ?? null,
      lastSyncedAt: existing?.lastSyncedAt ?? null,
      loginRequired: true,
      accounts: existing?.accounts ?? [],
    };
    return {
      household: { ...household, plaidItems: [...items.filter((row) => row.itemId !== payload.itemId), item] },
      sandboxLedger: null,
    };
  }
  const month = monthKey(now);
  const syncedAt = now.toISOString();
  let next = household;
  if (payload.accounts && payload.accounts.length) {
    next = applyBalances(next, payload.itemId, payload.institutionName ?? null, payload.accounts, syncedAt);
  } else {
    const items = next.plaidItems ?? [];
    const existing = items.find((item) => item.itemId === payload.itemId);
    if (existing) {
      next = {
        ...next,
        plaidItems: items.map((item) =>
          item.itemId === payload.itemId ? { ...item, lastSyncedAt: syncedAt, loginRequired: false } : item,
        ),
      };
    }
  }
  const removed = new Set(payload.removed);
  for (const txn of [...payload.added, ...payload.modified]) {
    if (txn.pendingTransactionId) removed.add(txn.pendingTransactionId);
  }
  if (payload.recurring) {
    const kept = (next.bankBills ?? []).filter((bill) => bill.itemId !== payload.itemId);
    next = { ...next, bankBills: [...kept, ...billsFromStreams(payload.itemId, payload.recurring)] };
  }
  const classified = dropTypedDuplicates(next.ledger ?? [], classifyPayloadRows(next, payload, month), month);
  const classifiedIds = new Set(classified.map((row) => row.id));
  const posted = classified.filter((row) => row.role !== 'pending');
  const kept = (next.ledger ?? []).filter((row) => {
    if (removed.has(row.id) || (row.pendingId && removed.has(row.pendingId))) return false;
    if (classifiedIds.has(row.id)) return false;
    if (row.role === 'pending' && posted.some((item) => pendingPostedPair(row, item))) return false;
    if (row.source === 'sandbox') return false;
    const key = rowMonth(row.date);
    if (!key) return false;
    const age = monthDiff(key, month);
    return age != null && age >= 0 && age < LEDGER_MONTHS;
  });
  return {
    household: {
      ...next,
      ledger: [...kept, ...classified],
      merchantSightings: addSightings(
        next.merchantSightings ?? [],
        [...payload.added, ...payload.modified],
        payload.itemId,
      ),
    },
    sandboxLedger: null,
  };
}

export function rememberPlaidItem(
  household: HouseholdInput,
  item: { itemId: string; institutionName?: string | null },
): HouseholdInput {
  const items = household.plaidItems ?? [];
  if (items.some((row) => row.itemId === item.itemId)) return household;
  return {
    ...household,
    plaidItems: [
      ...items,
      {
        itemId: item.itemId,
        institutionName: item.institutionName ?? null,
        lastSyncedAt: null,
        loginRequired: false,
        accounts: [],
      },
    ],
  };
}

export function ensurePlaidUserId(household: HouseholdInput): HouseholdInput {
  if (household.plaidUserId) return household;
  const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return { ...household, plaidUserId: `hh-${household.id}-${suffix}` };
}

export function ingestSimulatedOutlier(
  household: HouseholdInput,
  input: { id: string; merchant: string; amount: number; date?: string },
): HouseholdInput {
  const txn: BankTransaction = {
    id: input.id,
    amount: input.amount,
    merchant: input.merchant,
    date: (input.date ?? new Date().toISOString()).slice(0, 10),
    confidence: 'LOW',
    legacyCategory: merchantLooksOwnership(input.merchant) ? ['Service', 'Automotive'] : ['Shops'],
  };
  const classified = classifyTransaction(txn, household);
  const row: LedgerRow = classified
    ? { ...classified, source: 'simulated' }
    : {
        id: input.id,
        amount: input.amount,
        merchant: input.merchant,
        date: txn.date,
        category: null,
        role: 'spend',
        source: 'simulated',
        confidence: 'low',
      };
  return { ...household, ledger: [...(household.ledger ?? []).filter((item) => item.id !== row.id), row] };
}

export function localAccountUntouched(before: AccountInput, after: AccountInput): boolean {
  return before.balance === after.balance && before.lastEditedAt === after.lastEditedAt;
}
