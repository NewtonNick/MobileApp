import {
  BUDGET_CATEGORIES,
  BUDGET_GROUPS,
  DEFAULT_FIRE_FLAVOR,
  DEFAULT_JOB_CLASS,
  DEBT_ORDERS,
  DEFAULT_SURPLUS_POLICY,
  FIRE_FLAVORS,
  HOUSING_TENURES,
  JOB_CLASSES,
  PAYCHECK_CADENCES,
  PREVIEW_HOUSEHOLD_ID,
  SURPLUS_POLICIES,
  WITHDRAWAL_BUCKETS,
} from './types';
import type {
  BankBill,
  BankBillCadence,
  BenefitInput,
  BudgetCategory,
  BudgetGroup,
  CategoryOverride,
  DebtOrder,
  ExpenseInput,
  ExtraIncomeInput,
  FireFlavor,
  GoalSpec,
  HouseholdInput,
  HousingTenure,
  JobClass,
  LedgerRow,
  LedgerRole,
  LedgerSource,
  MerchantSighting,
  MerchantTag,
  NetWorthMark,
  PaycheckCadence,
  PlaidAccountKind,
  PlaidItemLink,
  RaiseEarner,
  SurplusPolicy,
  WithdrawalBucket,
} from './types';
import { isCompleteCustomSpec, parseGoalSpec, presetGoalSpec, syncFocusJob } from './goals';
import { migrateHousehold } from './migrate';
import { offsetToMonthKey, parseMonthKey } from './month';
import { HOUSEHOLD_SCHEMA_VERSION, isLiquid } from './types';
import { parseStoredGainRate, parseTaxLots } from './taxlots';

const now = () => new Date().toISOString();

export function previewHousehold(zip = '10001', jobClass: JobClass = DEFAULT_JOB_CLASS): HouseholdInput {
  const t = now();
  const primary = presetGoalSpec({ jobClass } as HouseholdInput, jobClass);
  const extras =
    jobClass === DEFAULT_JOB_CLASS
      ? [presetGoalSpec({ jobClass: 'cash_buffer' } as HouseholdInput, 'cash_buffer')]
      : [];
  return {
    id: PREVIEW_HOUSEHOLD_ID,
    kind: 'preview',
    zip,
    monthlyIncome: 6500,
    partnerMonthlyIncome: null,
    paycheckCadence: 'monthly',
    jobClass,
    fireFlavor: jobClass === 'work_optional' ? DEFAULT_FIRE_FLAVOR : DEFAULT_FIRE_FLAVOR,
    goalSpec: null,
    openGoals: [primary, ...extras],
    targetDate: null,
    housingTenure: 'own',
    hasVehicle: true,
    hasMortgage: false,
    createdAt: t,
    realizedEventKeys: [],
    accounts: [
      {
        id: 'preview-cash',
        type: 'cash',
        name: 'Savings',
        lastEditedAt: t,
        balance: 80000,
      },
    ],
    assets: [
      {
        id: 'preview-home',
        type: 'home',
        name: 'House',
        value: 400000,
        yearBuilt: 2005,
        lastEditedAt: t,
      },
      {
        id: 'preview-car',
        type: 'vehicle',
        name: '2018 Honda Civic',
        value: 20000,
        vehicleYear: 2018,
        make: 'Honda',
        model: 'Civic',
        vehicleClass: 'car',
        mileage: 72000,
        lastEditedAt: t,
      },
    ],
    expenses: [
      {
        id: 'preview-food',
        name: 'Food',
        monthlyAmount: 800,
        variable: true,
      },
    ],
  };
}

export function emptyRealHousehold(zip = ''): HouseholdInput {
  return {
    id: 'real-household',
    kind: 'real',
    zip,
    monthlyIncome: null,
    partnerMonthlyIncome: null,
    paycheckCadence: null,
    jobClass: DEFAULT_JOB_CLASS,
    fireFlavor: DEFAULT_FIRE_FLAVOR,
    goalSpec: null,
    openGoals: [],
    targetDate: null,
    housingTenure: null,
    hasVehicle: null,
    hasMortgage: null,
    createdAt: new Date().toISOString(),
    realizedEventKeys: [],
    accounts: [],
    assets: [],
    expenses: [],
  };
}

function synthesizeOpenGoals(jobClass: JobClass, goalSpec: GoalSpec | null): GoalSpec[] {
  if (jobClass === 'custom' && isCompleteCustomSpec(goalSpec)) return [goalSpec];
  return [presetGoalSpec({ jobClass } as HouseholdInput, jobClass === 'custom' ? DEFAULT_JOB_CLASS : jobClass)];
}

function parseWithdrawalOrder(raw: unknown): WithdrawalBucket[] | null {
  if (!Array.isArray(raw) || !raw.length) return null;
  const seen = new Set<WithdrawalBucket>();
  const order: WithdrawalBucket[] = [];
  for (const item of raw) {
    if (!WITHDRAWAL_BUCKETS.includes(item as WithdrawalBucket)) return null;
    const bucket = item as WithdrawalBucket;
    if (seen.has(bucket)) return null;
    seen.add(bucket);
    order.push(bucket);
  }
  return order;
}

/** Coerce loaded JSON onto books-only HouseholdInput. Drops Plus / reservedCash if present. */
export function normalizeHousehold(raw: unknown, now = new Date()): HouseholdInput {
  const migrated = migrateHousehold(raw, now);
  const input = (migrated ?? {}) as Partial<HouseholdInput> & {
    reservedCash?: unknown;
    plus?: unknown;
    entitlements?: unknown;
  };
  let jobClass: JobClass = JOB_CLASSES.includes(input.jobClass as JobClass)
    ? (input.jobClass as JobClass)
    : DEFAULT_JOB_CLASS;
  const parsedSpec = parseGoalSpec((input as { goalSpec?: unknown }).goalSpec);
  let goalSpec: GoalSpec | null = null;
  if (jobClass === 'custom') {
    if (isCompleteCustomSpec(parsedSpec)) {
      goalSpec = parsedSpec;
    } else {
      jobClass = DEFAULT_JOB_CLASS;
      goalSpec = null;
    }
  }
  const parsedOpen = Array.isArray(input.openGoals)
    ? input.openGoals.map(parseGoalSpec).filter((s): s is GoalSpec => s != null)
    : null;
  const openGoals = parsedOpen ?? synthesizeOpenGoals(jobClass, goalSpec);
  const fireFlavor: FireFlavor = FIRE_FLAVORS.includes(input.fireFlavor as FireFlavor)
    ? (input.fireFlavor as FireFlavor)
    : DEFAULT_FIRE_FLAVOR;
  const paycheckCadence: PaycheckCadence | null = PAYCHECK_CADENCES.includes(input.paycheckCadence as PaycheckCadence)
    ? (input.paycheckCadence as PaycheckCadence)
    : input.paycheckCadence === null
      ? null
      : null;
  const books: HouseholdInput = {
    schemaVersion: HOUSEHOLD_SCHEMA_VERSION,
    id: input.id ?? 'real-household',
    kind: input.kind === 'preview' ? 'preview' : 'real',
    zip: zipCode(input.zip),
    monthlyIncome: input.monthlyIncome ?? null,
    partnerMonthlyIncome: input.partnerMonthlyIncome ?? null,
    paycheckCadence,
    jobClass,
    fireFlavor,
    goalSpec,
    openGoals,
    targetDate: input.targetDate ?? null,
    housingTenure: HOUSING_TENURES.includes(input.housingTenure as HousingTenure)
      ? (input.housingTenure as HousingTenure)
      : null,
    hasVehicle: input.hasVehicle === true ? true : input.hasVehicle === false ? false : null,
    hasMortgage: input.hasMortgage === true ? true : input.hasMortgage === false ? false : null,
    accounts: parseAccounts(input.accounts),
    assets: parseAssets(input.assets),
    expenses: parseExpenses(input.expenses),
    realizedEventKeys: input.realizedEventKeys ?? [],
    createdAt: input.createdAt ?? new Date().toISOString(),
    nextPayday: typeof input.nextPayday === 'string' ? input.nextPayday : null,
    partnerPaycheckCadence: PAYCHECK_CADENCES.includes(input.partnerPaycheckCadence as PaycheckCadence)
      ? (input.partnerPaycheckCadence as PaycheckCadence)
      : null,
    partnerNextPayday: typeof input.partnerNextPayday === 'string' ? input.partnerNextPayday : null,
    surplusPolicy: SURPLUS_POLICIES.includes(input.surplusPolicy as SurplusPolicy)
      ? (input.surplusPolicy as SurplusPolicy)
      : DEFAULT_SURPLUS_POLICY,
    debtOrder: DEBT_ORDERS.includes(input.debtOrder as DebtOrder) ? (input.debtOrder as DebtOrder) : null,
    surplusTargetLoanId: typeof input.surplusTargetLoanId === 'string' ? input.surplusTargetLoanId : null,
    withdrawalOrder: parseWithdrawalOrder(input.withdrawalOrder),
    bufferMonths: input.bufferMonths === 12 ? 12 : input.bufferMonths === 6 ? 6 : input.bufferMonths === 3 ? 3 : null,
    skippedQuestions: Array.isArray(input.skippedQuestions)
      ? input.skippedQuestions.filter((item): item is string => typeof item === 'string')
      : [],
    birthYear: finiteOrNull(input.birthYear),
    currentAge: clampAge(input.currentAge),
    partnerAge: clampAge(input.partnerAge),
    socialSecurity: parseBenefit(input.socialSecurity),
    pension: parseBenefit(input.pension),
    healthAfterWorkMonthly: finiteOrNull(input.healthAfterWorkMonthly),
    withdrawalTaxRate: finiteOrNull(input.withdrawalTaxRate),
    shortTermGainRate: parseStoredGainRate(input.shortTermGainRate),
    longTermGainRate: parseStoredGainRate(input.longTermGainRate),
    taxLots: parseTaxLots(input.taxLots),
    rentGrowthAnnual: clampUnit(input.rentGrowthAnnual),
    plannedRaiseMonth: null,
    plannedRaiseAt: monthOrLegacy(input.plannedRaiseAt, input.plannedRaiseMonth, now),
    plannedRaisePercent: clampUnit(input.plannedRaisePercent),
    incomeEndsAt: monthOrNull(input.incomeEndsAt),
    partnerIncomeEndsAt: monthOrNull(input.partnerIncomeEndsAt),
    retireAtHiredDate: input.retireAtHiredDate === true,
    incomeVolatility: clampUnit(input.incomeVolatility),
    plannedRaiseEarner: input.plannedRaiseEarner === 'partner' || input.plannedRaiseEarner === 'own'
      ? (input.plannedRaiseEarner as RaiseEarner)
      : null,
    monthlyGross: finiteOrNull(input.monthlyGross),
    extraIncomes: parseExtraIncomes(input.extraIncomes),
    featuredHomeId: typeof input.featuredHomeId === 'string' ? input.featuredHomeId : null,
    ignoredMerchants: stringList(input.ignoredMerchants),
    reviewedPurchaseIds: stringList(input.reviewedPurchaseIds),
    fuelPricePerGallon: finiteOrNull(input.fuelPricePerGallon),
    ledger: parseLedger(input.ledger),
    plaidUserId: typeof input.plaidUserId === 'string' && input.plaidUserId.trim() ? input.plaidUserId.trim() : null,
    plaidItems: parsePlaidItems(input.plaidItems),
    categoryOverrides: parseOverrides(input.categoryOverrides),
    merchantSightings: parseSightings(input.merchantSightings),
    bankBills: parseBankBills(input.bankBills),
    merchantTags: parseMerchantTags(input.merchantTags),
    netWorthMarks: parseNetWorthMarks(input.netWorthMarks),
  };
  return syncFocusJob(books);
}

function finiteOrNull(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function zipCode(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '').slice(0, 5);
}

function clampAge(value: unknown): number | null {
  const n = finiteOrNull(value);
  if (n == null || n < 0 || n > 120) return null;
  return n;
}

function clampUnit(value: unknown): number | null {
  const n = finiteOrNull(value);
  if (n == null || n < 0 || n > 1) return null;
  return n;
}

function monthOrNull(value: unknown): string | null {
  if (typeof value !== 'string' || !parseMonthKey(value)) return null;
  return value.trim();
}

function monthOrLegacy(at: unknown, legacy: unknown, now: Date): string | null {
  const key = monthOrNull(at);
  if (key) return key;
  const offset = finiteOrNull(legacy);
  if (offset == null) return null;
  return offsetToMonthKey(offset, now);
}

function parseAccounts(value: unknown): HouseholdInput['accounts'] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (!row || typeof row !== 'object') return [];
    const item = row as HouseholdInput['accounts'][number];
    if (typeof item.id !== 'string' || typeof item.name !== 'string' || typeof item.type !== 'string') return [];
    const balance = finiteOrNull(item.balance) ?? 0;
    return [
      {
        ...item,
        balance: isLiquid(item.type) ? balance : Math.max(0, balance),
        apr: clampUnit(item.apr),
        promoApr: clampUnit(item.promoApr),
        expectedReturn: clampUnit(item.expectedReturn),
        employeeContributionPercent: clampUnit(item.employeeContributionPercent),
        employerMatchPercent: clampUnit(item.employerMatchPercent),
        employerMatchCapPercent: clampUnit(item.employerMatchCapPercent),
        indexMargin: clampUnit(item.indexMargin),
        capPeriodic: clampUnit(item.capPeriodic),
        capLifetime: clampUnit(item.capLifetime),
        lastEditedAt: typeof item.lastEditedAt === 'string' ? item.lastEditedAt : new Date().toISOString(),
      },
    ];
  });
}

function parseAssets(value: unknown): HouseholdInput['assets'] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (!row || typeof row !== 'object') return [];
    const item = row as HouseholdInput['assets'][number];
    if (typeof item.id !== 'string' || typeof item.name !== 'string' || typeof item.type !== 'string') return [];
    const valueAmount = finiteOrNull(item.value);
    return [
      {
        ...item,
        value: valueAmount == null ? null : Math.max(0, valueAmount),
        vacancyRate: clampUnit(item.vacancyRate),
        managementPct: clampUnit(item.managementPct),
        rentalIncomeMonthly:
          item.rentalIncomeMonthly == null ? null : Math.max(0, finiteOrNull(item.rentalIncomeMonthly) ?? 0),
        lastEditedAt: typeof item.lastEditedAt === 'string' ? item.lastEditedAt : new Date().toISOString(),
      },
    ];
  });
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function parseBenefit(value: unknown): BenefitInput | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as BenefitInput;
  return { monthlyAmount: finiteOrNull(raw.monthlyAmount), startAge: finiteOrNull(raw.startAge) };
}

const BANK_CADENCES: BankBillCadence[] = ['weekly', 'biweekly', 'semimonthly', 'monthly', 'annual'];
const LEDGER_ROLES: LedgerRole[] = ['spend', 'transfer', 'income', 'pending', 'already_counted'];
const LEDGER_SOURCES: LedgerSource[] = ['typed', 'plaid', 'sandbox', 'simulated'];
const PLAID_KINDS: PlaidAccountKind[] = ['checking', 'savings', 'credit', 'other'];

function parseExpenses(value: unknown): ExpenseInput[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (!row || typeof row !== 'object') return [];
    const item = row as ExpenseInput;
    if (typeof item.id !== 'string' || typeof item.name !== 'string') return [];
    const group = BUDGET_GROUPS.includes(item.group as BudgetGroup) ? (item.group as BudgetGroup) : null;
    const budgetCategory = BUDGET_CATEGORIES.includes(item.budgetCategory as BudgetCategory)
      ? (item.budgetCategory as BudgetCategory)
      : null;
    return [
      {
        id: item.id,
        name: item.name,
        monthlyAmount: finiteOrNull(item.monthlyAmount),
        variable: item.variable === true,
        linkedLiabilityId: typeof item.linkedLiabilityId === 'string' ? item.linkedLiabilityId : null,
        linkedAssetKey: typeof item.linkedAssetKey === 'string' ? item.linkedAssetKey : null,
        duplicateReviewed: item.duplicateReviewed === true,
        startMonth: null,
        endMonth: null,
        startAt: monthOrLegacy(item.startAt, item.startMonth, new Date()),
        endAt: monthOrLegacy(item.endAt, item.endMonth, new Date()),
        group,
        budgetCategory,
      },
    ];
  });
}

function parseLedger(value: unknown): LedgerRow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (!row || typeof row !== 'object') return [];
    const item = row as LedgerRow & { accessToken?: unknown; access_token?: unknown };
    if (typeof item.id !== 'string' || typeof item.merchant !== 'string' || typeof item.date !== 'string') return [];
    if (!LEDGER_ROLES.includes(item.role)) return [];
    if (!LEDGER_SOURCES.includes(item.source) || item.source === 'sandbox') return [];
    const amount = finiteOrNull(item.amount);
    if (amount == null) return [];
    const category = BUDGET_CATEGORIES.includes(item.category as BudgetCategory)
      ? (item.category as BudgetCategory)
      : null;
    return [
      {
        id: item.id,
        amount,
        merchant: item.merchant,
        date: item.date,
        category,
        role: item.role,
        source: item.source,
        confidence: item.confidence === 'high' ? 'high' : 'low',
        itemId: typeof item.itemId === 'string' ? item.itemId : null,
        plaidAccountId: typeof item.plaidAccountId === 'string' ? item.plaidAccountId : null,
        pendingId: typeof item.pendingId === 'string' ? item.pendingId : null,
        thisMonthOnly: item.thisMonthOnly === true,
        yearSpread: item.yearSpread === true,
        reviewed: item.reviewed === true,
      },
    ];
  });
}

function parseOverrides(value: unknown): CategoryOverride[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (!row || typeof row !== 'object') return [];
    const item = row as CategoryOverride;
    if (typeof item.merchant !== 'string') return [];
    if (!BUDGET_CATEGORIES.includes(item.category)) return [];
    return [{ merchant: item.merchant, category: item.category }];
  });
}

function parseSightings(value: unknown): MerchantSighting[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (!row || typeof row !== 'object') return [];
    const item = row as MerchantSighting;
    if (typeof item.merchant !== 'string' || typeof item.month !== 'string') return [];
    const amount = finiteOrNull(item.amount);
    if (amount == null) return [];
    return [
      {
        merchant: item.merchant,
        amount,
        month: item.month,
        itemId: typeof item.itemId === 'string' && item.itemId.trim() ? item.itemId : null,
      },
    ];
  });
}

function parseBankBills(value: unknown): BankBill[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (!row || typeof row !== 'object') return [];
    const item = row as BankBill;
    if (typeof item.merchant !== 'string' || !item.merchant.trim()) return [];
    if (typeof item.itemId !== 'string' || !item.itemId.trim()) return [];
    if (!BANK_CADENCES.includes(item.cadence)) return [];
    const amount = finiteOrNull(item.amount);
    if (amount == null || !(amount > 0)) return [];
    const day = finiteOrNull(item.day);
    return [
      {
        merchant: item.merchant.trim().replace(/\s+/g, ' '),
        amount,
        day: day != null && day >= 1 && day <= 31 ? Math.round(day) : null,
        itemId: item.itemId,
        category: BUDGET_CATEGORIES.includes(item.category as BudgetCategory) ? (item.category as BudgetCategory) : null,
        cadence: item.cadence,
      },
    ];
  });
}

function parseMerchantTags(value: unknown): MerchantTag[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (!row || typeof row !== 'object') return [];
    const item = row as MerchantTag;
    if (typeof item.merchant !== 'string' || typeof item.tag !== 'string') return [];
    const tag = item.tag.trim();
    if (!item.merchant.trim() || !tag) return [];
    return [{ merchant: item.merchant, tag: tag.slice(0, 40) }];
  });
}

function parseNetWorthMarks(value: unknown): NetWorthMark[] {
  if (!Array.isArray(value)) return [];
  const marks = value.flatMap((row) => {
    if (!row || typeof row !== 'object') return [];
    const item = row as NetWorthMark;
    if (typeof item.month !== 'string' || !/^\d{4}-\d{2}$/.test(item.month)) return [];
    const net = finiteOrNull(item.net);
    if (net == null || typeof item.at !== 'string') return [];
    return [{ month: item.month, net, at: item.at }];
  });
  const byMonth = new Map<string, NetWorthMark>();
  for (const mark of marks) byMonth.set(mark.month, mark);
  return [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month)).slice(-36);
}

function parsePlaidItems(value: unknown): PlaidItemLink[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (!row || typeof row !== 'object') return [];
    const item = row as PlaidItemLink & { accessToken?: unknown; access_token?: unknown };
    if (typeof item.itemId !== 'string' || !item.itemId.trim()) return [];
    const accounts = Array.isArray(item.accounts)
      ? item.accounts.flatMap((account) => {
          if (!account || typeof account !== 'object') return [];
          const link = account as PlaidItemLink['accounts'][number] & { accessToken?: unknown };
          if (typeof link.plaidAccountId !== 'string') return [];
          return [
            {
              plaidAccountId: link.plaidAccountId,
              localAccountId: typeof link.localAccountId === 'string' ? link.localAccountId : null,
              name: typeof link.name === 'string' ? link.name : '',
              kind: PLAID_KINDS.includes(link.kind) ? link.kind : 'other',
            },
          ];
        })
      : [];
    return [
      {
        itemId: item.itemId,
        institutionName: typeof item.institutionName === 'string' ? item.institutionName : null,
        lastSyncedAt: typeof item.lastSyncedAt === 'string' ? item.lastSyncedAt : null,
        loginRequired: item.loginRequired === true,
        accounts,
      },
    ];
  });
}

function parseExtraIncomes(value: unknown): ExtraIncomeInput[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (!row || typeof row !== 'object') return [];
    const item = row as ExtraIncomeInput;
    if (typeof item.id !== 'string' || typeof item.name !== 'string') return [];
    if (item.schedule !== 'monthly' && item.schedule !== 'annual' && item.schedule !== 'once') return [];
    const amount = finiteOrNull(item.amount);
    if (amount == null) return [];
    return [
      {
        id: item.id,
        name: item.name,
        amount,
        schedule: item.schedule,
        monthOfYear: finiteOrNull(item.monthOfYear),
        onceMonth: null,
        onceAt: monthOrLegacy(item.onceAt, item.onceMonth, new Date()),
      },
    ];
  });
}
