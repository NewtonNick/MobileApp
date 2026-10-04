export type Scenario = 'liberal' | 'realistic' | 'conservative';

export type HouseholdKind = 'preview' | 'real';

/** Hired date-shaped job. FIRE is the Retire early blurb, not a separate class. */
export type JobClass =
  | 'work_optional'
  | 'debt_free'
  | 'cash_buffer'
  | 'keep_house_car'
  | 'survive_paycheck'
  | 'custom';

export const PRIMARY_JOB_CLASSES: JobClass[] = ['work_optional', 'debt_free', 'cash_buffer', 'keep_house_car'];

export const JOB_CLASSES: JobClass[] = [...PRIMARY_JOB_CLASSES, 'survive_paycheck', 'custom'];

export const DEFAULT_JOB_CLASS: JobClass = 'keep_house_car';

export const JOB_CLASS_LABELS: Record<JobClass, string> = {
  work_optional: 'Retire early',
  debt_free: 'Debt Free',
  cash_buffer: 'Emergency Fund',
  keep_house_car: 'Stay Afloat',
  survive_paycheck: 'If pay stopped',
  custom: 'Custom',
};

export type GoalTargetKind =
  | 'amount'
  | 'date'
  | 'debt_zero'
  | 'runway'
  | 'afford'
  | 'work_optional'
  | 'afloat';
export type GoalAmountBucket = 'liquid' | 'investments' | 'named_account' | 'net_worth';
export type GoalReservedPolicy = 'ownership' | 'n_months_living' | 'paycheck_year' | 'none';

export type GoalTarget =
  | { kind: 'amount'; dollars: number; bucket: GoalAmountBucket; accountId?: string | null }
  | { kind: 'date'; by: string }
  | { kind: 'debt_zero'; accountIds?: string[] | null }
  | { kind: 'runway'; months: number }
  | { kind: 'afford'; dollars: number; eventKey?: string | null }
  | { kind: 'afloat' }
  | { kind: 'work_optional' };

export interface GoalSpec {
  id: string;
  name: string;
  source: 'preset' | 'custom';
  target: GoalTarget;
  reserved: GoalReservedPolicy;
}

export function hiredJobTitle(
  jobClass: JobClass,
  fireFlavor?: FireFlavor | null,
  spec?: GoalSpec | null,
): string {
  if (jobClass === 'custom') {
    const name = spec?.name?.trim();
    if (name) return name;
  }
  if (jobClass === 'work_optional' && fireFlavor && fireFlavor !== 'standard') {
    return `${FIRE_FLAVOR_LABELS[fireFlavor]} FIRE`;
  }
  return JOB_CLASS_LABELS[jobClass];
}

/** Retire early variants. Ignored unless `jobClass` is `work_optional`. */
export type FireFlavor = 'standard' | 'coast' | 'lean' | 'fat';

export const FIRE_FLAVORS: FireFlavor[] = ['standard', 'coast', 'lean', 'fat'];

export const DEFAULT_FIRE_FLAVOR: FireFlavor = 'standard';

export const FIRE_FLAVOR_LABELS: Record<FireFlavor, string> = {
  standard: 'Standard',
  coast: 'Coast',
  lean: 'Lean',
  fat: 'Fat',
};

export type PaycheckCadence = 'monthly' | 'semimonthly' | 'biweekly' | 'weekly';

export const PAYCHECK_CADENCES: PaycheckCadence[] = ['monthly', 'semimonthly', 'biweekly', 'weekly'];

export const DEFAULT_PAYCHECK_CADENCE: PaycheckCadence = 'monthly';

export const PAYCHECK_CADENCE_LABELS: Record<PaycheckCadence, string> = {
  monthly: 'Monthly',
  semimonthly: 'Twice a month',
  biweekly: 'Every two weeks',
  weekly: 'Weekly',
};

/** Where leftover goes after bills and minimum payments. Default is cash until the user picks. */
export type SurplusPolicy = 'debt' | 'retirement' | 'cash';

export const SURPLUS_POLICIES: SurplusPolicy[] = ['cash', 'debt', 'retirement'];

export const DEFAULT_SURPLUS_POLICY: SurplusPolicy = 'cash';

export const SURPLUS_POLICY_LABELS: Record<SurplusPolicy, string> = {
  cash: 'Leave leftover in cash',
  debt: 'Extra toward loans',
  retirement: 'Extra to retirement',
};

/** Which open loan receives extra after minimum payments. Missing means highest rate. */
export type DebtOrder = 'highest_rate' | 'smallest_balance';

export const DEBT_ORDERS: DebtOrder[] = ['highest_rate', 'smallest_balance'];

export const DEBT_ORDER_LABELS: Record<DebtOrder, string> = {
  highest_rate: 'Higher rate first',
  smallest_balance: 'Smaller balance first',
};

/** Bucket a retirement withdrawal is drawn from. Missing order keeps the blended withdrawal rate. */
export type WithdrawalBucket = 'traditional' | 'roth' | 'brokerage';

export const WITHDRAWAL_BUCKETS: WithdrawalBucket[] = ['traditional', 'roth', 'brokerage'];

export type RetirementTaxTreatment = 'traditional' | 'roth';

export type CardPayoffStyle = 'revolving' | 'paid_monthly';

export type ExtraIncomeSchedule = 'monthly' | 'annual' | 'once';

export type RaiseEarner = 'own' | 'partner';

/** Downsize: keep the loan, or pay it down so equity stays. */
export type DownsizeLoanChoice = 'keep_loan' | 'pay_down';

export interface BenefitInput {
  monthlyAmount: number | null;
  startAge: number | null;
}

export interface ExtraIncomeInput {
  id: string;
  name: string;
  amount: number;
  schedule: ExtraIncomeSchedule;
  /** Calendar month 1–12 when schedule is annual. */
  monthOfYear?: number | null;
  /** Forecast month index when schedule is once. Legacy. Prefer `onceAt`. */
  onceMonth?: number | null;
  /** Calendar month the one-time amount lands. `YYYY-MM`. */
  onceAt?: string | null;
}

/** Keep / delay the next replacement / downsize this house. Planner what-if — not a shop. */
export type ZMove = 'keep' | 'delay_replace' | 'downsize';

export const Z_MOVES: ZMove[] = ['keep', 'delay_replace', 'downsize'];

export const Z_MOVE_LABELS: Record<ZMove, string> = {
  keep: 'Keep this house',
  delay_replace: 'Delay the next replacement',
  downsize: 'Downsize this house',
};

export type SequencePolicy = 'debt_first' | 'fire_first';

/** Own / rent / neither. Null means not asked yet — do not infer rent from a missing house. */
export type HousingTenure = 'own' | 'rent' | 'none';

export const HOUSING_TENURES: HousingTenure[] = ['own', 'rent', 'none'];

export const HOUSING_TENURE_LABELS: Record<HousingTenure, string> = {
  own: 'I own',
  rent: 'I rent',
  none: 'Neither',
};

/** Default months of Conservative living for Emergency Fund and renter Stay Afloat. */
export const DEFAULT_BUFFER_MONTHS = 3;

/** Default safe-withdrawal rate for Retire early. Looks-wrong can override later; not a household column. */
export const DEFAULT_WITHDRAWAL_RATE = 0.04;

export type AccountType =
  | 'checking'
  | 'savings'
  | 'cash'
  | 'brokerage'
  | 'retirement_401k'
  | 'retirement_ira'
  | 'mortgage'
  | 'auto_loan'
  | 'auto_lease'
  | 'student_loan'
  | 'credit_card'
  | 'other_liability'
  | 'other';

export type AssetType = 'home' | 'vehicle' | 'other';

export type VehicleClass = 'car' | 'suv' | 'truck' | 'van' | 'ev' | 'motorcycle' | 'rv';

export type LeaseEndChoice = 'return' | 'buy';

export type ExteriorResponsibility = 'owner' | 'hoa';

/** Current household document. Migrations in `migrate.ts` bring older books here. */
export const HOUSEHOLD_SCHEMA_VERSION = 2;

export interface AccountInput {
  id: string;
  type: AccountType;
  name: string;
  balance: number;
  expectedReturn?: number | null;
  /** Ticker symbol only. No live price in this wave. */
  ticker?: string | null;
  apr?: number | null;
  minPayment?: number | null;
  lastEditedAt: string;
  lastSyncedAt?: string | null;
  linkedExpenseId?: string | null;
  duplicateReviewed?: boolean;
  /** Tax and insurance inside a mortgage payment. Null means the whole payment is treated as principal and interest. */
  escrowMonthly?: number | null;
  /** True: house tax and insurance are inside escrow, so those lines are not billed again. False: they are separate. Null: not answered. */
  escrowCoversHousing?: boolean | null;
  /** Cards only. Paid monthly does not accrue. Null means revolving. */
  payoffStyle?: CardPayoffStyle | null;
  /** Retirement accounts. Null on a 401(k) or IRA means traditional. */
  taxTreatment?: RetirementTaxTreatment | null;
  /** Dollars per month already taken out of take-home. Does not reduce checking again. */
  employeeContributionMonthly?: number | null;
  /** Fraction of gross, added to the dollar contribution. 0.06 is 6%. */
  employeeContributionPercent?: number | null;
  /** Fraction of the employee contribution the employer adds. 0.5 is a 50% match. */
  employerMatchPercent?: number | null;
  /** Match stops at this fraction of gross. Null means no cap. */
  employerMatchCapPercent?: number | null;
  /** Gross pay this contribution percent uses. Falls back to household gross. */
  grossMonthly?: number | null;
  /** Student loan: balance and payment stop at this forecast month even if a balance remains. Legacy. Prefer `forgivenessAt`. */
  forgivenessMonth?: number | null;
  /** `YYYY-MM` when a student loan balance is forgiven. */
  forgivenessAt?: string | null;
  /** Mortgage escrow applies to this home. Missing means every owned home. */
  linkedAssetId?: string | null;
  /** Paid-monthly cards. The usual statement. Not the opening balance. */
  typicalMonthlySpend?: number | null;
  /** Introductory rate, as a fraction. The walker uses `apr` after `promoEndsAt`. */
  promoApr?: number | null;
  promoEndsAt?: string | null;
  /** Interest-only through this month, then the stated payment amortizes. */
  interestOnlyUntil?: string | null;
  /** Student loan: no payment until this month. Interest accrues unless `subsidized`. */
  deferredUntil?: string | null;
  subsidized?: boolean | null;
  /** Adjustable mortgage: fixed rate through this month. */
  rateFixedUntil?: string | null;
  /** Added to the scenario index at reset. */
  indexMargin?: number | null;
  /** Maximum rate change at one reset, as a fraction. */
  capPeriodic?: number | null;
  /** Maximum rate above the opening APR. */
  capLifetime?: number | null;
  /** Lease end month. */
  endsAt?: string | null;
  mileageCap?: number | null;
  /** Dollars per mile over the cap. */
  overageRate?: number | null;
  endChoice?: LeaseEndChoice | null;
  residual?: number | null;
}

/** One purchase in a brokerage. The price is what the user typed. */
export interface TaxLot {
  id: string;
  accountId: string;
  symbol: string;
  /** ISO date YYYY-MM-DD. */
  acquiredOn: string;
  shares: number;
  /** Total dollars paid for these shares. */
  costBasis: number;
  /** Dollars per share the user typed. */
  pricePerShare: number;
}

export interface AssetInput {
  id: string;
  type: AssetType;
  name: string;
  value: number | null;
  yearBuilt?: number | null;
  vehicleYear?: number | null;
  make?: string | null;
  model?: string | null;
  vehicleClass?: VehicleClass | null;
  mileage?: number | null;
  sqft?: number | null;
  roofYear?: number | null;
  hvacYear?: number | null;
  waterHeaterYear?: number | null;
  lastEditedAt: string;
  costOverrides?: Partial<Record<string, number>>;
  /** House lines the user types. Null means not entered — we do not invent a tax. */
  taxMonthly?: number | null;
  insuranceMonthly?: number | null;
  hoaMonthly?: number | null;
  /** Vehicle lines. Null means a labeled estimate. Zero means the user cleared it. */
  registrationAnnual?: number | null;
  fuelMonthly?: number | null;
  milesPerYear?: number | null;
  mpg?: number | null;
  /** EV efficiency. kWh per mile. */
  kwhPerMile?: number | null;
  rentalIncomeMonthly?: number | null;
  /** Share of months vacant, such as 0.08. */
  vacancyRate?: number | null;
  /** Share of collected rent paid to a manager. */
  managementPct?: number | null;
  exteriorResponsibility?: ExteriorResponsibility | null;
}

export interface ExpenseInput {
  id: string;
  name: string;
  monthlyAmount: number | null;
  variable: boolean;
  linkedLiabilityId?: string | null;
  /** Ownership line this expense duplicates, such as `home:id:insurance`. */
  linkedAssetKey?: string | null;
  duplicateReviewed?: boolean;
  /** First forecast month this bill counts. Legacy. Prefer `startAt`. */
  startMonth?: number | null;
  /** Last forecast month this bill counts. Legacy. Prefer `endAt`. */
  endMonth?: number | null;
  /** `YYYY-MM`. The bill counts from this month. */
  startAt?: string | null;
  /** `YYYY-MM`. The bill counts through this month. */
  endAt?: string | null;
  /** Screen section. Missing means inferred from the category or the name. */
  group?: BudgetGroup | null;
  /** Short budget category. Missing means inferred from the name. Debt and ownership lines stay unset. */
  budgetCategory?: BudgetCategory | null;
}

/** Sections on the budget screen. Not a second list of bills. */
export type BudgetGroup = 'housing' | 'bills' | 'living' | 'sinking';

export const BUDGET_GROUPS: BudgetGroup[] = ['housing', 'bills', 'living', 'sinking'];

/** The short category list. A new merchant does not add a line. */
export type BudgetCategory =
  | 'housing'
  | 'groceries'
  | 'transport'
  | 'utilities'
  | 'subscriptions'
  | 'other_living';

export const BUDGET_CATEGORIES: BudgetCategory[] = [
  'housing',
  'groceries',
  'transport',
  'utilities',
  'subscriptions',
  'other_living',
];

export type LedgerRole = 'spend' | 'transfer' | 'income' | 'pending' | 'already_counted';

export type LedgerSource = 'typed' | 'plaid' | 'sandbox' | 'simulated';

/** One bank or typed row. Spent and left are computed from these; they are not stored. */
export interface LedgerRow {
  id: string;
  /** Plaid sign: positive means money left the account. A negative spend is a refund. */
  amount: number;
  merchant: string;
  /** `YYYY-MM-DD` or an ISO timestamp. */
  date: string;
  category: BudgetCategory | null;
  role: LedgerRole;
  source: LedgerSource;
  confidence: 'high' | 'low';
  itemId?: string | null;
  plaidAccountId?: string | null;
  pendingId?: string | null;
  /** Counts this month and does not change the plan. */
  thisMonthOnly?: boolean;
  /** Plan was set to amount / 12. The full charge is not a new monthly bill. */
  yearSpread?: boolean;
  reviewed?: boolean;
}

export interface CategoryOverride {
  merchant: string;
  category: BudgetCategory;
}

/** Merchant memory for “same charge, most months.” Not a budget line. */
export interface MerchantSighting {
  merchant: string;
  amount: number;
  /** `YYYY-MM` */
  month: string;
  /** Which linked institution saw it. Null on a typed row. */
  itemId?: string | null;
}

/** How the bank described a repeating charge. The stored amount is already a month. */
export type BankBillCadence = 'weekly' | 'biweekly' | 'semimonthly' | 'monthly' | 'annual';

/**
 * A repeating charge the bank listed. It is not a plan line until the household adds it.
 * `amount` is the monthly equivalent. An annual charge is the bank amount divided by 12.
 */
export interface BankBill {
  merchant: string;
  amount: number;
  day: number | null;
  itemId: string;
  category: BudgetCategory | null;
  cadence: BankBillCadence;
}

/** A label on a merchant. It does not change the plan or the hired date. */
export interface MerchantTag {
  merchant: string;
  tag: string;
}

/** Net worth from the balances recorded that month. Not a forecast and not a market price. */
export interface NetWorthMark {
  /** `YYYY-MM` */
  month: string;
  net: number;
  at: string;
}

export type PlaidAccountKind = 'checking' | 'savings' | 'credit' | 'other';

export interface PlaidAccountLink {
  plaidAccountId: string;
  /** Null until the row is matched to a local account. */
  localAccountId: string | null;
  name: string;
  kind: PlaidAccountKind;
}

/** Item id and account map. Never an access token. */
export interface PlaidItemLink {
  itemId: string;
  institutionName: string | null;
  lastSyncedAt: string | null;
  loginRequired: boolean;
  accounts: PlaidAccountLink[];
}

export type GoalStatus = 'on_track' | 'dated' | 'overdue' | 'incomplete' | 'beyond_horizon';

export interface HouseholdInput {
  id: string;
  kind: HouseholdKind;
  /** Missing on older books. `normalizeHousehold` writes the current version. */
  schemaVersion?: number;
  zip: string;
  monthlyIncome: number | null;
  /** Second take-home stream. Same household, not a spouse login. */
  partnerMonthlyIncome?: number | null;
  paycheckCadence?: PaycheckCadence | null;
  /** Next payday for the owner. Biweekly and weekly months follow this date. */
  nextPayday?: string | null;
  partnerPaycheckCadence?: PaycheckCadence | null;
  partnerNextPayday?: string | null;
  /** Leftover after bills. Missing means leave it in cash. */
  surplusPolicy?: SurplusPolicy | null;
  /** When extra goes to debt, which loan is paid first. Missing means highest rate. */
  debtOrder?: DebtOrder | null;
  /** When set, extra debt payments go to this loan while it still has a balance. */
  surplusTargetLoanId?: string | null;
  /**
   * Order of traditional, Roth, and brokerage withdrawals.
   * Missing means each bucket is taxed at the withdrawal rate on its own.
   */
  withdrawalOrder?: WithdrawalBucket[] | null;
  /** Emergency Fund preset length. 3, 6, or 12. Missing means 3. */
  bufferMonths?: number | null;
  /** Improve questions the user skipped. Cleared when they open books. */
  skippedQuestions?: string[] | null;
  birthYear?: number | null;
  currentAge?: number | null;
  socialSecurity?: BenefitInput | null;
  pension?: BenefitInput | null;
  /** Monthly health cost that starts when work stops. */
  healthAfterWorkMonthly?: number | null;
  /** Effective rate on traditional withdrawals. Null means this plan does not tax them. */
  withdrawalTaxRate?: number | null;
  /** Federal rate on a short-term gain. Null means a short-term sale is not taxed in this plan. */
  shortTermGainRate?: number | null;
  /** Federal rate on a long-term gain. Null means a long-term sale is not taxed in this plan. */
  longTermGainRate?: number | null;
  /** Brokerage lots the user typed. A price is not a live quote. */
  taxLots?: TaxLot[] | null;
  /** Optional real growth on the rent line, such as 0.03. */
  rentGrowthAnnual?: number | null;
  /** Legacy forecast offset. Prefer `plannedRaiseAt`. */
  plannedRaiseMonth?: number | null;
  /** `YYYY-MM` when the planned raise starts. */
  plannedRaiseAt?: string | null;
  /** Own take-home stops at this month. */
  incomeEndsAt?: string | null;
  partnerIncomeEndsAt?: string | null;
  /** When set, the Retire early path stops pay at the hired month. */
  retireAtHiredDate?: boolean | null;
  partnerAge?: number | null;
  partnerSocialSecurity?: BenefitInput | null;
  partnerPension?: BenefitInput | null;
  /** 0–1. Monte Carlo spreads take-home by this much. */
  incomeVolatility?: number | null;
  /** Fraction, such as 0.10 for a 10% raise. */
  plannedRaisePercent?: number | null;
  plannedRaiseEarner?: RaiseEarner | null;
  /** Gross pay for a percent-of-pay retirement contribution. Not take-home. */
  monthlyGross?: number | null;
  extraIncomes?: ExtraIncomeInput[] | null;
  /** House that Keep / delay / downsize uses. Missing means the first house. */
  featuredHomeId?: string | null;
  ignoredMerchants?: string[] | null;
  reviewedPurchaseIds?: string[] | null;
  /** Dollars per gallon for a fuel estimate from miles and mpg. */
  fuelPricePerGallon?: number | null;
  /** Open-month rows from typing or from a bank. Aggregates are computed, not stored. */
  ledger?: LedgerRow[] | null;
  /** Stable Plaid user id. Restored from backup so a reinstall does not burn a new Item. */
  plaidUserId?: string | null;
  /** Linked items and which bank account maps where. Cursors and access tokens stay off this object. */
  plaidItems?: PlaidItemLink[] | null;
  /** Merchant → category decisions. Survive backup. */
  categoryOverrides?: CategoryOverride[] | null;
  /** Compact history for recurring detection. Older months are not budget lines. */
  merchantSightings?: MerchantSighting[] | null;
  /** Repeating charges the bank already lists. Not a plan line, and not written by sandbox. */
  bankBills?: BankBill[] | null;
  /** Merchant labels. They do not change a category plan. */
  merchantTags?: MerchantTag[] | null;
  /** One observed net worth per month, from the balances on the books. Not a stored forecast. */
  netWorthMarks?: NetWorthMark[] | null;
  /**
   * Focus job for leftover / forecast copy. Persist; never persist standing.
   * Open goals live in `openGoals` — this is which card is featured, not the only hire.
   */
  jobClass: JobClass;
  /** Custom hire when focus is custom. Also listed in `openGoals`. */
  goalSpec?: GoalSpec | null;
  /**
   * Elected goals on the home board. Presets and customs. Empty means none chosen yet.
   * Missing on old books is synthesized from `jobClass` on load.
   */
  openGoals?: GoalSpec[];
  /** Retire early variant. Persist; standing still live-eval. */
  fireFlavor?: FireFlavor | null;
  /** Optional hired-date override (ISO `YYYY-MM-DD`). Not the primary key. */
  targetDate?: string | null;
  /** Asked up front. Null means unknown — never invent a house. */
  housingTenure?: HousingTenure | null;
  /** Asked up front. Null means unknown — do not nag a car they said they do not have. */
  hasVehicle?: boolean | null;
  /** Asked when they own. Null means unknown — do not assume the house is paid off. */
  hasMortgage?: boolean | null;
  accounts: AccountInput[];
  assets: AssetInput[];
  expenses: ExpenseInput[];
  realizedEventKeys: string[];
  createdAt: string;
}

/** Ownership shock from the forecast walker. Live only — do not persist. */
export interface EventHit {
  key: string;
  /** `-1` = recurring each month; `1..n` = one-shot month index from now. */
  month: number;
  cost: number;
  label: string;
  ownership: boolean;
}

export type PulseReason =
  | { kind: 'stale_cash'; days: number }
  | { kind: 'last_edited'; at: string }
  | { kind: 'realized_shock'; key: string }
  | { kind: 'stale_seed' };

export interface StandingView {
  jobClass: JobClass;
  scenario: Scenario;
  sentence: string;
  reserved: number;
  leftover: number;
  liquid: number;
  /** Caption for the reserved number — follows hire and tenure. */
  reservedLabel: string;
  hiredMonth: number | null;
  hiredDate: string | null;
  collisionMonth: number | null;
  collisionLabel: string | null;
  /** Event key for “I already paid this”. Not guessed from the label. */
  collisionKey: string | null;
  constraintLabel: string | null;
  status: GoalStatus;
  /** Months liquid lasts if paycheck is zero. Live only. */
  runwayMonths: number | null;
  pulseReasons: PulseReason[];
}

export interface CollisionDiff {
  line: string;
  hiredMonthDelta: number | null;
  leftoverDelta: number;
  reservedDelta: number;
  leftoverClaimed: boolean;
}

export interface PercentileTriple {
  liberal: number;
  realistic: number;
  conservative: number;
}

export interface SourceRef {
  source: string;
  vintage: string;
  model: string;
  url?: string;
  note?: string;
}

export interface MonthPoint {
  month: number;
  netWorth: number;
  cash: number;
  home: number;
  vehicles: number;
  investments: number;
  liabilities: number;
  ownershipCost: number;
  livingExpenses: number;
  income: number;
  /** Nominal (future) dollars. `netWorth` is today’s dollars. UI `showNominal` reads this. */
  nominalNetWorth?: number;
  /** Retirement balances in today’s dollars, split so withdrawal tax can apply. */
  traditional: number;
  roth: number;
  brokerage: number;
  /** Brokerage market value whose lots match the balance, in today’s dollars. Zero when they do not. */
  brokerageCovered: number;
  /** Cost basis of that covered value, in today’s dollars. */
  brokerageBasis: number;
  /** Unrealized short-term gain on the covered value, in today’s dollars. */
  brokerageShortGain: number;
  /** Unrealized long-term gain on the covered value, in today’s dollars. */
  brokerageLongGain: number;
}

export interface WaterfallSlice {
  key: string;
  label: string;
  amount: number;
  ownership: boolean;
}

export interface ForecastResult {
  scenario: Scenario;
  netWorthNow: number;
  liquidNow: number;
  illiquidNow: number;
  houseCost5y: number;
  carCost5y: number;
  ownershipCost12m: number;
  ownershipCost5y: number;
  emergencyFundRecommended: number;
  emergencyFundTargets: PercentileTriple;
  emergencyGap: number;
  cashCoversConservative: boolean;
  months: MonthPoint[];
  waterfall: WaterfallSlice[];
  completeness: number;
  nextQuestion: string | null;
  confidenceChip: string | null;
  sources: SourceRef[];
  houseValueUsed: number | null;
  houseValueIsEstimate: boolean;
  staleCash: boolean;
  cashLastEditedAt: string | null;
}

export interface MonteCarloFan {
  months: number[];
  liberal: number[];
  realistic: number[];
  conservative: number[];
}

export interface DuplicateGuess {
  expenseId: string;
  liabilityId: string;
  expenseName: string;
  liabilityName: string;
  expenseAmount: number;
  liabilityPayment: number;
}

export const LIQUID_TYPES: AccountType[] = ['checking', 'savings', 'cash'];
export const INVESTMENT_TYPES: AccountType[] = ['brokerage', 'retirement_401k', 'retirement_ira'];
export const LIABILITY_TYPES: AccountType[] = [
  'mortgage',
  'auto_loan',
  'auto_lease',
  'student_loan',
  'credit_card',
  'other_liability',
];

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  checking: 'Checking',
  savings: 'Savings',
  cash: 'Cash',
  brokerage: 'Brokerage',
  retirement_401k: '401(k)',
  retirement_ira: 'IRA',
  mortgage: 'Mortgage',
  auto_loan: 'Auto loan',
  auto_lease: 'Auto lease',
  student_loan: 'Student loan',
  credit_card: 'Credit card',
  other_liability: 'Other loan',
  other: 'Other',
};

export const PREVIEW_HOUSEHOLD_ID = 'preview-household';
export const REAL_HOUSEHOLD_ID = 'real-household';

export function isLiquid(type: AccountType): boolean {
  return LIQUID_TYPES.includes(type);
}

export function isInvestment(type: AccountType): boolean {
  return INVESTMENT_TYPES.includes(type);
}

export function isLiability(type: AccountType): boolean {
  return LIABILITY_TYPES.includes(type);
}

export function scenarioLabel(scenario: Scenario): string {
  if (scenario === 'liberal') return 'Liberal';
  if (scenario === 'conservative') return 'Conservative';
  return 'Realistic';
}
