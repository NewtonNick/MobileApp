import { extraIncomeForMonth, householdIncomeForMonth } from './cadence';
import { round2 } from './money';
import { expenseCountsInLiving } from './expenses';
import {
  BUDGET_CATEGORY_LABELS,
  budgetLines,
  categoryForExpense,
  categorySpent,
  countsAsSpend,
  groupForCategory,
  linkIsCurrent,
  looksRecurring,
  merchantKey,
  monthKey,
  rowMonth,
  setCategoryPlan,
} from './budget';
import type {
  BankBill,
  BankBillCadence,
  BudgetCategory,
  ExpenseInput,
  HouseholdInput,
  LedgerRow,
  MerchantSighting,
} from './types';
import { ACCOUNT_TYPE_LABELS, BUDGET_CATEGORIES, isLiability } from './types';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

function shiftMonth(month: string, delta: number): string {
  const [year, raw] = month.split('-').map(Number);
  const date = new Date(year, (raw ?? 1) - 1 + delta, 1);
  return monthKey(date);
}

export interface AllocationSlice {
  id: string;
  label: string;
  amount: number;
  /** Share of gross assets. Debts are not in this mix. */
  share: number;
  kind: 'liquid' | 'retirement' | 'brokerage' | 'home' | 'vehicle' | 'other';
}

export interface HoldingMix {
  slices: AllocationSlice[];
  debt: number;
  net: number;
  /** Weighted expected return on retirement and brokerage. Null when those balances are zero. */
  expectedReturn: number | null;
}

function sumBalances(household: HouseholdInput, types: string[]): number {
  return round2(
    household.accounts
      .filter((account) => types.includes(account.type))
      .reduce((sum, account) => sum + Math.max(0, account.balance), 0),
  );
}

function sumAssets(household: HouseholdInput, type: 'home' | 'vehicle' | 'other'): number {
  return round2(
    household.assets
      .filter((asset) => asset.type === type)
      .reduce((sum, asset) => sum + Math.max(0, asset.value ?? 0), 0),
  );
}

/** Current mix from typed balances. No live prices. */
export function holdingAllocation(household: HouseholdInput): HoldingMix {
  const parts: Omit<AllocationSlice, 'share'>[] = [
    { id: 'liquid', label: 'Cash', amount: sumBalances(household, ['checking', 'savings', 'cash']), kind: 'liquid' },
    {
      id: 'retirement',
      label: 'Retirement',
      amount: sumBalances(household, ['retirement_401k', 'retirement_ira']),
      kind: 'retirement',
    },
    { id: 'brokerage', label: 'Brokerage', amount: sumBalances(household, ['brokerage']), kind: 'brokerage' },
    { id: 'home', label: 'Home', amount: sumAssets(household, 'home'), kind: 'home' },
    { id: 'vehicle', label: 'Vehicles', amount: sumAssets(household, 'vehicle'), kind: 'vehicle' },
    {
      id: 'other',
      label: 'Other',
      amount: round2(sumBalances(household, ['other']) + sumAssets(household, 'other')),
      kind: 'other',
    },
  ];
  const gross = parts.reduce((sum, part) => sum + part.amount, 0);
  const slices = parts
    .filter((part) => part.amount > 0)
    .map((part) => ({ ...part, share: gross > 0 ? part.amount / gross : 0 }));
  const debt = round2(
    household.accounts.filter((account) => isLiability(account.type)).reduce((sum, account) => sum + account.balance, 0),
  );
  const invested = household.accounts.filter(
    (account) =>
      (account.type === 'retirement_401k' || account.type === 'retirement_ira' || account.type === 'brokerage') &&
      account.balance > 0,
  );
  const investedTotal = invested.reduce((sum, account) => sum + account.balance, 0);
  const expectedReturn =
    investedTotal > 0
      ? invested.reduce((sum, account) => sum + account.balance * (account.expectedReturn ?? 0.07), 0) / investedTotal
      : null;
  return {
    slices,
    debt,
    net: round2(gross - debt),
    expectedReturn,
  };
}

export interface CategoryDelta {
  category: BudgetCategory;
  label: string;
  thisMonth: number;
  lastMonth: number;
  delta: number;
}

/** This open month versus the previous month, from filed spend only. */
export function spendingChange(household: HouseholdInput, now = new Date()): CategoryDelta[] {
  const current = monthKey(now);
  const previous = shiftMonth(current, -1);
  const rows = household.ledger ?? [];
  return BUDGET_CATEGORIES.map((category) => {
    const thisMonth = categorySpent(rows, current, category);
    const lastMonth = categorySpent(rows, previous, category);
    return {
      category,
      label: BUDGET_CATEGORY_LABELS[category],
      thisMonth,
      lastMonth,
      delta: round2(thisMonth - lastMonth),
    };
  }).filter((row) => row.thisMonth !== 0 || row.lastMonth !== 0);
}

export interface MonthPlanDraft {
  household: HouseholdInput;
  applied: BudgetCategory[];
  /** More than one living bill already shares this category, so the month was not written over them. */
  skipped: BudgetCategory[];
}

/**
 * Rewrite category plan amounts from this month's filed spend.
 * A stale bank link refuses. No link is allowed: typed rows are the household's own numbers.
 * Returns null only when a linked bank is stale.
 */
export function draftMonthAsPlan(household: HouseholdInput, now = new Date()): MonthPlanDraft | null {
  const linked = (household.plaidItems ?? []).length > 0;
  if (linked && !linkIsCurrent(household.plaidItems, now.getTime())) return null;
  const month = monthKey(now);
  let next = household;
  const applied: BudgetCategory[] = [];
  const skipped: BudgetCategory[] = [];
  for (const category of BUDGET_CATEGORIES) {
    const rows = (household.ledger ?? []).filter(
      (row) =>
        rowMonth(row.date) === month &&
        countsAsSpend(row) &&
        row.category === category &&
        !row.thisMonthOnly &&
        !row.yearSpread &&
        row.amount > 0,
    );
    if (!rows.length) continue;
    const spent = round2(rows.reduce((sum, row) => sum + row.amount, 0));
    const lines = household.expenses.filter(
      (expense) => categoryForExpense(expense) === category && expenseCountsInLiving(expense, 1),
    );
    if (lines.length > 1) {
      skipped.push(category);
      continue;
    }
    next = setCategoryPlan(next, category, spent);
    applied.push(category);
  }
  return { household: next, applied, skipped };
}

function sightingsFromBooks(household: HouseholdInput): MerchantSighting[] {
  const rows: MerchantSighting[] = [...(household.merchantSightings ?? [])];
  for (const row of household.ledger ?? []) {
    if (!countsAsSpend(row) || !(row.amount > 0)) continue;
    const month = rowMonth(row.date);
    if (!month) continue;
    const merchant = merchantKey(row.merchant);
    if (rows.some((item) => merchantKey(item.merchant) === merchant && item.month === month)) continue;
    rows.push({ merchant, amount: round2(row.amount), month });
  }
  return rows;
}

function displayMerchant(household: HouseholdInput, key: string): string {
  let name = key;
  let best = '';
  for (const row of household.ledger ?? []) {
    if (merchantKey(row.merchant) !== key) continue;
    if (row.date >= best) {
      best = row.date;
      const trimmed = row.merchant.trim();
      if (trimmed) name = trimmed;
    }
  }
  return name;
}

function categoryForMerchant(household: HouseholdInput, key: string): BudgetCategory {
  const override = (household.categoryOverrides ?? []).find((item) => merchantKey(item.merchant) === key);
  if (override) return override.category;
  let category: BudgetCategory | null = null;
  let best = '';
  for (const row of household.ledger ?? []) {
    if (merchantKey(row.merchant) !== key || !row.category) continue;
    if (row.date >= best) {
      best = row.date;
      category = row.category;
    }
  }
  return category ?? 'subscriptions';
}

function typicalDay(household: HouseholdInput, key: string): number | null {
  const days: number[] = [];
  for (const row of household.ledger ?? []) {
    if (merchantKey(row.merchant) !== key) continue;
    const day = Number(row.date.slice(8, 10));
    if (day >= 1 && day <= 31) days.push(day);
  }
  if (!days.length) return null;
  days.sort((a, b) => a - b);
  return days[Math.floor(days.length / 2)] ?? null;
}

function institutionsFor(household: HouseholdInput, key: string): number {
  const ids = new Set<string>();
  for (const row of household.merchantSightings ?? []) {
    if (merchantKey(row.merchant) !== key || !row.itemId) continue;
    ids.add(row.itemId);
  }
  for (const row of household.ledger ?? []) {
    if (merchantKey(row.merchant) !== key || !row.itemId) continue;
    ids.add(row.itemId);
  }
  for (const row of household.bankBills ?? []) {
    if (merchantKey(row.merchant) !== key || !row.itemId) continue;
    ids.add(row.itemId);
  }
  return ids.size;
}

function billOnPlan(household: HouseholdInput, key: string): boolean {
  return household.expenses.some(
    (expense) => merchantKey(expense.name) === key && expense.monthlyAmount != null && expenseCountsInLiving(expense, 1),
  );
}

export interface FoundBill {
  merchant: string;
  name: string;
  amount: number;
  category: BudgetCategory;
  months: number;
  onPlan: boolean;
  /** Usual day of the month from filed rows. Null when only a month is known. */
  day: number | null;
  /** Linked institutions that have seen this merchant. Zero when the rows were typed. */
  institutions: number;
  /** Null when the bill was inferred from local months, not from a bank stream. */
  cadence: BankBillCadence | null;
}

/** Same merchant, similar amount, in most months of the span. Three months minimum. */
export function foundBills(household: HouseholdInput): FoundBill[] {
  const sightings = sightingsFromBooks(household);
  const ignored = new Set((household.ignoredMerchants ?? []).map((name) => merchantKey(name)));
  const keys = new Set(sightings.map((row) => merchantKey(row.merchant)));
  const bills: FoundBill[] = [];
  for (const key of keys) {
    if (!key || ignored.has(key)) continue;
    const mine = sightings.filter((row) => merchantKey(row.merchant) === key);
    const latest = [...mine].sort((a, b) => a.month.localeCompare(b.month)).at(-1);
    if (!latest || !(latest.amount > 0)) continue;
    if (!looksRecurring(sightings, key, latest.amount)) continue;
    const months = new Set(mine.map((row) => row.month)).size;
    bills.push({
      merchant: key,
      name: displayMerchant(household, key),
      amount: latest.amount,
      category: categoryForMerchant(household, key),
      months,
      onPlan: billOnPlan(household, key),
      day: typicalDay(household, key),
      institutions: institutionsFor(household, key),
      cadence: null,
    });
  }
  for (const bill of billsFromBank(household)) {
    const existing = bills.find((item) => item.merchant === bill.merchant);
    if (!existing) {
      bills.push(bill);
      continue;
    }
    existing.day = existing.day ?? bill.day;
    existing.cadence = existing.cadence ?? bill.cadence;
    existing.institutions = institutionsFor(household, bill.merchant);
  }
  return bills.sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name));
}

function categoryForBank(household: HouseholdInput, bill: BankBill): BudgetCategory {
  const override = (household.categoryOverrides ?? []).find((item) => merchantKey(item.merchant) === merchantKey(bill.merchant));
  if (override) return override.category;
  return bill.category ?? 'subscriptions';
}

/** Bills the bank listed. Local months are not required. Ignored merchants stay out. */
function billsFromBank(household: HouseholdInput): FoundBill[] {
  const ignored = new Set((household.ignoredMerchants ?? []).map((name) => merchantKey(name)));
  const grouped = new Map<string, BankBill[]>();
  for (const bill of household.bankBills ?? []) {
    const key = merchantKey(bill.merchant);
    if (!key || ignored.has(key) || !(bill.amount > 0)) continue;
    const list = grouped.get(key) ?? [];
    list.push(bill);
    grouped.set(key, list);
  }
  const found: FoundBill[] = [];
  for (const [key, rows] of grouped) {
    const latest = [...rows].sort((a, b) => b.amount - a.amount)[0];
    if (!latest) continue;
    found.push({
      merchant: key,
      name: latest.merchant.trim() || key,
      amount: latest.amount,
      category: categoryForBank(household, latest),
      months: 0,
      onPlan: billOnPlan(household, key),
      day: latest.day,
      institutions: institutionsFor(household, key),
      cadence: latest.cadence,
    });
  }
  return found;
}

function billId(merchant: string): string {
  const slug = merchantKey(merchant).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  return `exp-bill-${slug || 'merchant'}`;
}

/** Append the found bill as its own expense. The walker then counts it, so the hired date can move. */
export function addBillToPlan(household: HouseholdInput, merchant: string): HouseholdInput {
  const bill = foundBills(household).find((item) => item.merchant === merchantKey(merchant));
  if (!bill || bill.onPlan) return household;
  const id = billId(bill.merchant);
  if (household.expenses.some((expense) => expense.id === id)) return household;
  const expense: ExpenseInput = {
    id,
    name: bill.name,
    monthlyAmount: bill.amount,
    variable: false,
    group: groupForCategory(bill.category),
    budgetCategory: bill.category,
  };
  return { ...household, expenses: [...household.expenses, expense] };
}

export interface UpcomingBill {
  name: string;
  amount: number;
}

/** A repeating merchant that is not on the hired date yet. It is not part of `total`. */
export interface SeenBill {
  name: string;
  amount: number;
  day: number | null;
  cadence: BankBillCadence | null;
}

export interface UpcomingMonth {
  monthIndex: number;
  label: string;
  income: number;
  bills: UpcomingBill[];
  total: number;
  seen: SeenBill[];
}

function ownershipBills(household: HouseholdInput): UpcomingBill[] {
  const bills: UpcomingBill[] = [];
  for (const asset of household.assets) {
    const lines =
      asset.type === 'home'
        ? [
            { name: 'Property tax', amount: asset.taxMonthly },
            { name: 'Home insurance', amount: asset.insuranceMonthly },
            { name: 'HOA', amount: asset.hoaMonthly },
          ]
        : asset.type === 'vehicle'
          ? [
              { name: `${asset.name} insurance`, amount: asset.insuranceMonthly },
              { name: `${asset.name} fuel`, amount: asset.fuelMonthly },
            ]
          : [];
    for (const line of lines) {
      if (line.amount == null || !(line.amount > 0)) continue;
      bills.push({ name: line.name, amount: line.amount });
    }
  }
  return bills;
}

/** Pay and the bills the hired date already counts. Found bills are listed beside that total and are not included in it. */
export function upcomingCash(household: HouseholdInput, now = new Date(), count = 3): UpcomingMonth[] {
  const seen: SeenBill[] = foundBills(household)
    .filter((bill) => !bill.onPlan)
    .map((bill) => ({ name: bill.name, amount: bill.amount, day: bill.day, cadence: bill.cadence }));
  const months: UpcomingMonth[] = [];
  for (let monthIndex = 1; monthIndex <= count; monthIndex += 1) {
    const date = new Date(now.getFullYear(), now.getMonth() + (monthIndex - 1), 1);
    const bills: UpcomingBill[] = [];
    for (const expense of household.expenses) {
      if (!expenseCountsInLiving(expense, monthIndex) || expense.monthlyAmount == null || !(expense.monthlyAmount > 0)) {
        continue;
      }
      bills.push({ name: expense.name, amount: expense.monthlyAmount });
    }
    for (const account of household.accounts) {
      if (!isLiability(account.type) || account.minPayment == null || !(account.minPayment > 0)) continue;
      bills.push({ name: account.name, amount: account.minPayment });
    }
    bills.push(...ownershipBills(household));
    const income = round2(householdIncomeForMonth(household, monthIndex, now) + extraIncomeForMonth(household.extraIncomes, monthIndex, now));
    const total = round2(bills.reduce((sum, bill) => sum + bill.amount, 0));
    months.push({
      monthIndex,
      label: `${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`,
      income,
      bills,
      total,
      seen,
    });
  }
  return months;
}

/** Put part of a filed spend on another category. The remainder stays on the original row. */
export function splitSpend(
  household: HouseholdInput,
  rowId: string,
  category: BudgetCategory,
  amount: number,
): HouseholdInput | null {
  const row = (household.ledger ?? []).find((item) => item.id === rowId);
  if (!row || !countsAsSpend(row) || !(row.amount > 0)) return null;
  const part = round2(amount);
  const rest = round2(row.amount - part);
  if (!(part > 0) || !(rest > 0)) return null;
  if (row.category === category) return null;
  const ids = new Set((household.ledger ?? []).map((item) => item.id));
  let id = `${row.id}:split`;
  let n = 2;
  while (ids.has(id)) {
    id = `${row.id}:split:${n}`;
    n += 1;
  }
  const split: LedgerRow = {
    ...row,
    id,
    amount: part,
    category,
    role: 'spend',
    confidence: 'high',
    reviewed: true,
  };
  return {
    ...household,
    ledger: (household.ledger ?? []).flatMap((item) => (item.id === rowId ? [{ ...item, amount: rest }, split] : [item])),
  };
}

/** Remember the category and file every open spend from that merchant. Income and transfers stay put. */
export function setMerchantRule(
  household: HouseholdInput,
  merchant: string,
  category: BudgetCategory,
): HouseholdInput {
  const key = merchantKey(merchant);
  if (!key) return household;
  const overrides = [
    ...(household.categoryOverrides ?? []).filter((item) => merchantKey(item.merchant) !== key),
    { merchant: key, category },
  ];
  return {
    ...household,
    categoryOverrides: overrides,
    ledger: (household.ledger ?? []).map((row) => {
      if (merchantKey(row.merchant) !== key) return row;
      if (row.role === 'income' || row.role === 'transfer' || row.role === 'pending' || row.role === 'already_counted') {
        return row;
      }
      return { ...row, role: 'spend', category, confidence: 'high' as const, reviewed: true };
    }),
  };
}

export interface CategoryTrack {
  category: BudgetCategory;
  label: string;
  planned: number;
  spent: number;
  left: number;
  lastMonth: number;
  delta: number;
  /** False when more than one living bill already shares the category. */
  editable: boolean;
}

/** This month's plan, spent, and left for each category that has a plan or any spend. */
export function categoryTrack(household: HouseholdInput, now = new Date()): CategoryTrack[] {
  const current = monthKey(now);
  const previous = shiftMonth(current, -1);
  const rows = household.ledger ?? [];
  const lines = budgetLines(household, now);
  return BUDGET_CATEGORIES.map((category) => {
    const line = lines.find((item) => item.category === category);
    const spent = categorySpent(rows, current, category);
    const lastMonth = categorySpent(rows, previous, category);
    const planned = line?.planned ?? 0;
    const bills = household.expenses.filter(
      (expense) => categoryForExpense(expense) === category && expenseCountsInLiving(expense, 1),
    ).length;
    return {
      category,
      label: BUDGET_CATEGORY_LABELS[category],
      planned,
      spent,
      left: round2(planned - spent),
      lastMonth,
      delta: round2(spent - lastMonth),
      editable: bills <= 1,
    };
  }).filter((row) => row.planned !== 0 || row.spent !== 0 || row.lastMonth !== 0);
}

export interface BookBalance {
  id: string;
  name: string;
  typeLabel: string;
  amount: number;
  owed: boolean;
  syncedAt: string | null;
  institution: string | null;
}

/** Each account and asset on the books. A sync time is the last bank write, not a live price. */
export function bookBalances(household: HouseholdInput): BookBalance[] {
  const linked = new Map<string, { name: string | null; at: string | null }>();
  for (const item of household.plaidItems ?? []) {
    for (const account of item.accounts) {
      if (!account.localAccountId) continue;
      linked.set(account.localAccountId, { name: item.institutionName, at: item.lastSyncedAt });
    }
  }
  const rows: BookBalance[] = household.accounts.map((account) => {
    const link = linked.get(account.id);
    return {
      id: account.id,
      name: account.name,
      typeLabel: ACCOUNT_TYPE_LABELS[account.type],
      amount: account.balance,
      owed: isLiability(account.type),
      syncedAt: account.lastSyncedAt ?? link?.at ?? null,
      institution: link?.name ?? null,
    };
  });
  for (const asset of household.assets) {
    if (asset.value == null) continue;
    rows.push({
      id: asset.id,
      name: asset.name,
      typeLabel: asset.type === 'home' ? 'Home' : asset.type === 'vehicle' ? 'Vehicle' : 'Other',
      amount: asset.value,
      owed: false,
      syncedAt: null,
      institution: null,
    });
  }
  return rows;
}

/** Remember this month's net worth from current balances. Same month and same net is a no-op. */
export function observeNetWorth(household: HouseholdInput, now = new Date()): HouseholdInput {
  const net = holdingAllocation(household).net;
  const month = monthKey(now);
  const marks = household.netWorthMarks ?? [];
  const current = marks.find((mark) => mark.month === month);
  if (current && current.net === net) return household;
  const next = [...marks.filter((mark) => mark.month !== month), { month, net, at: now.toISOString() }]
    .sort((a, b) => a.month.localeCompare(b.month))
    .slice(-36);
  return { ...household, netWorthMarks: next };
}

export interface BalanceChange {
  fromMonth: string;
  fromNet: number;
  toNet: number;
  delta: number;
  months: number;
}

/** Change between recorded balance marks. Null until two different months exist. Not a market return. */
export function recordedBalanceChange(household: HouseholdInput, now = new Date()): BalanceChange | null {
  const marks = [...(household.netWorthMarks ?? [])].sort((a, b) => a.month.localeCompare(b.month));
  if (marks.length < 2) return null;
  const currentMonth = monthKey(now);
  const current = marks.find((mark) => mark.month === currentMonth) ?? marks[marks.length - 1];
  if (!current) return null;
  const target = shiftMonth(current.month, -12);
  const prior =
    [...marks].reverse().find((mark) => mark.month <= target && mark.month !== current.month) ??
    marks.find((mark) => mark.month !== current.month);
  if (!prior || prior.month === current.month) return null;
  const [fromYear, fromMonth] = prior.month.split('-').map(Number);
  const [toYear, toMonth] = current.month.split('-').map(Number);
  return {
    fromMonth: prior.month,
    fromNet: prior.net,
    toNet: current.net,
    delta: round2(current.net - prior.net),
    months: (toYear - fromYear) * 12 + (toMonth - fromMonth),
  };
}

export interface TagSpend {
  tag: string;
  amount: number;
}

/** This month's filed spend, grouped by merchant tag. Untagged merchants are left out. */
export function spendingByTag(household: HouseholdInput, now = new Date()): TagSpend[] {
  const month = monthKey(now);
  const tags = new Map((household.merchantTags ?? []).map((item) => [merchantKey(item.merchant), item.tag]));
  const sums = new Map<string, number>();
  for (const row of household.ledger ?? []) {
    if (rowMonth(row.date) !== month || !countsAsSpend(row)) continue;
    const tag = tags.get(merchantKey(row.merchant));
    if (!tag) continue;
    sums.set(tag, round2((sums.get(tag) ?? 0) + row.amount));
  }
  return [...sums.entries()]
    .map(([tag, amount]) => ({ tag, amount }))
    .sort((a, b) => b.amount - a.amount || a.tag.localeCompare(b.tag));
}

/** Remember a label for this merchant. A blank tag removes it. The plan and the hired date stay. */
export function setMerchantTag(household: HouseholdInput, merchant: string, tag: string): HouseholdInput {
  const key = merchantKey(merchant);
  const label = tag.trim().replace(/\s+/g, ' ').slice(0, 40);
  if (!key) return household;
  const rest = (household.merchantTags ?? []).filter((item) => merchantKey(item.merchant) !== key);
  if (!label) return { ...household, merchantTags: rest };
  return { ...household, merchantTags: [...rest, { merchant: key, tag: label }] };
}

/** Change the display name. Category rules, tags, and ignored merchants follow the new name. Roles stay. */
export function renameMerchant(household: HouseholdInput, from: string, to: string): HouseholdInput {
  const key = merchantKey(from);
  const name = to.trim().replace(/\s+/g, ' ');
  if (!key || !name) return household;
  const nextKey = merchantKey(name);
  return {
    ...household,
    ledger: (household.ledger ?? []).map((row) => (merchantKey(row.merchant) === key ? { ...row, merchant: name } : row)),
    expenses: household.expenses.map((expense) => (merchantKey(expense.name) === key ? { ...expense, name } : expense)),
    categoryOverrides: (household.categoryOverrides ?? []).map((item) =>
      merchantKey(item.merchant) === key ? { ...item, merchant: nextKey } : item,
    ),
    merchantTags: (household.merchantTags ?? []).map((item) =>
      merchantKey(item.merchant) === key ? { ...item, merchant: nextKey } : item,
    ),
    merchantSightings: (household.merchantSightings ?? []).map((item) =>
      merchantKey(item.merchant) === key ? { ...item, merchant: nextKey } : item,
    ),
    bankBills: (household.bankBills ?? []).map((item) =>
      merchantKey(item.merchant) === key ? { ...item, merchant: name } : item,
    ),
    ignoredMerchants: (household.ignoredMerchants ?? []).map((item) => (merchantKey(item) === key ? nextKey : item)),
  };
}

/** Drop the institution from the household. Accounts, expenses, ledger rows, and the hired date stay. */
export function forgetPlaidItem(household: HouseholdInput, itemId: string): HouseholdInput {
  return {
    ...household,
    plaidItems: (household.plaidItems ?? []).filter((item) => item.itemId !== itemId),
    bankBills: (household.bankBills ?? []).filter((bill) => bill.itemId !== itemId),
  };
}
