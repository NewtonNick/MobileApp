import { isUsZip } from './lookups';
import { parseIsoDate } from './month';
import { firstLoanMissingApr } from './rates';
import {
  JOB_CLASSES,
  isInvestment,
  isLiability,
  type GoalSpec,
  type HouseholdInput,
  type HousingTenure,
  type JobClass,
} from './types';

export type IntakeBlock =
  | 'tenure'
  | 'vehicle'
  | 'income'
  | 'spend'
  | 'investments'
  | 'cash'
  | 'mortgage'
  | 'debts'
  | 'house'
  | 'car'
  | 'rent';

/** One missing fact. Home “Improve this plan” opens this field, not the accounts dump. */
export type NextBestKey =
  | 'tenure'
  | 'rent'
  | 'mortgage_yn'
  | 'mortgage'
  | 'income'
  | 'spend'
  | 'debts'
  | 'investments'
  | 'cash'
  | 'vehicle_yesno'
  | 'car'
  | 'zip'
  | 'house'
  | 'house_value'
  | 'roof'
  | 'hvac'
  | 'mileage'
  | 'apr'
  | 'partner'
  | 'cadence'
  | 'goal'
  | 'ss_age'
  | 'pension_age'
  | 'partner_ss_age'
  | 'extra_month'
  | 'payday'
  | 'mortgage_match'
  | 'lease'
  | 'lease_end'
  | 'arm'
  | 'promo'
  | 'promo_end'
  | 'interest_only'
  | 'deferment'
  | 'income_end'
  | 'partner_age'
  | 'partner_benefits'
  | 'income_volatility'
  | 'rental'
  | 'exterior'
  | 'vehicle_class';

export type NextBest = { key: NextBestKey; question: string };

function home(h: HouseholdInput) {
  return h.assets.find((a) => a.type === 'home');
}

function car(h: HouseholdInput) {
  return h.assets.find((a) => a.type === 'vehicle');
}

function jobFromSpec(spec: GoalSpec): JobClass {
  if (spec.source === 'preset') {
    const raw = spec.id.startsWith('preset:') ? spec.id.slice('preset:'.length) : spec.id;
    if (JOB_CLASSES.includes(raw as JobClass) && raw !== 'custom') return raw as JobClass;
  }
  return 'custom';
}

function electedSpecs(h: HouseholdInput): { job: JobClass; spec?: GoalSpec | null }[] {
  if (Array.isArray(h.openGoals)) {
    return h.openGoals.map((spec) => ({ job: jobFromSpec(spec), spec }));
  }
  return [{ job: h.jobClass, spec: h.goalSpec ?? null }];
}

/** Monthly take-home. A yearly or one-time extra does not date the plan. */
function hasIncome(h: HouseholdInput): boolean {
  if (h.monthlyIncome != null && h.monthlyIncome > 0) return true;
  if (h.partnerMonthlyIncome != null && h.partnerMonthlyIncome > 0) return true;
  return (h.extraIncomes ?? []).some((row) => row.schedule === 'monthly' && row.amount > 0);
}

export function householdHasIncome(h: HouseholdInput): boolean {
  return hasIncome(h);
}

/**
 * Income driver. Any extra with an amount still posts when take-home is missing,
 * including a March bonus on a household whose paycheck is 0.
 */
export function postsIncome(h: HouseholdInput): boolean {
  if (householdHasIncome(h)) return true;
  return (h.extraIncomes ?? []).some((row) => row.amount > 0);
}

/** Facts the books have, but not enough to use. */
export function householdWarnings(household: HouseholdInput): string[] {
  const warnings: string[] = [];
  const social = household.socialSecurity;
  if ((social?.monthlyAmount ?? 0) > 0 && social?.startAge == null) {
    warnings.push('Social Security has an amount and no start age.');
  }
  const pension = household.pension;
  if ((pension?.monthlyAmount ?? 0) > 0 && pension?.startAge == null) {
    warnings.push('Pension has an amount and no start age.');
  }
  const partnerSocial = household.partnerSocialSecurity;
  if ((partnerSocial?.monthlyAmount ?? 0) > 0 && partnerSocial?.startAge == null) {
    warnings.push('Partner Social Security has an amount and no start age.');
  }
  for (const row of household.extraIncomes ?? []) {
    if (row.schedule === 'annual' && (row.monthOfYear == null || row.monthOfYear < 1 || row.monthOfYear > 12)) {
      warnings.push(`${row.name} is a yearly amount with no month.`);
    }
  }
  if (household.nextPayday && !parseIsoDate(household.nextPayday)) {
    warnings.push('Next payday is not a date like 2026-10-03.');
  }
  if (mortgageFlagContradicts(household)) {
    warnings.push('The mortgage answer does not match the loans on the books.');
  }
  return warnings;
}

function hasSpend(h: HouseholdInput): boolean {
  return h.expenses.some((e) => e.monthlyAmount != null && e.monthlyAmount > 0);
}

function hasDebt(h: HouseholdInput): boolean {
  return h.accounts.some((a) => isLiability(a.type) && a.balance > 0);
}

function hasInvestments(h: HouseholdInput): boolean {
  return h.accounts.some((a) => isInvestment(a.type) && a.balance > 0);
}

function hasCash(h: HouseholdInput): boolean {
  return h.accounts.some((a) => (a.type === 'checking' || a.type === 'savings' || a.type === 'cash') && a.balance > 0);
}

export function resolveHousingTenure(h: HouseholdInput): HousingTenure | null {
  if (h.housingTenure === 'own' || h.housingTenure === 'rent' || h.housingTenure === 'none') {
    return h.housingTenure;
  }
  if (home(h)) return 'own';
  return null;
}

export function resolveHasVehicle(h: HouseholdInput): boolean | null {
  if (h.hasVehicle === true || h.hasVehicle === false) return h.hasVehicle;
  if (car(h)) return true;
  return null;
}

export function hasMortgageAccount(h: HouseholdInput): boolean {
  return h.accounts.some((a) => a.type === 'mortgage' && a.balance > 0);
}

export function resolveHasMortgage(h: HouseholdInput): boolean | null {
  if (hasMortgageAccount(h)) return true;
  if (h.hasMortgage === true || h.hasMortgage === false) return h.hasMortgage;
  return null;
}

/** The stored yes/no does not match a mortgage balance on the books. */
export function mortgageFlagContradicts(h: HouseholdInput): boolean {
  if (h.hasMortgage == null) return false;
  return h.hasMortgage !== hasMortgageAccount(h);
}

export function hasNamedRent(h: HouseholdInput): boolean {
  return h.expenses.some((e) => {
    if (e.monthlyAmount == null || e.monthlyAmount <= 0) return false;
    if (e.id === 'exp-rent') return true;
    return e.name.trim().toLowerCase() === 'rent';
  });
}

export function isOutlineReady(h: HouseholdInput): boolean {
  if (!hasIncome(h)) return false;
  const specs = electedSpecs(h);
  if (!specs.length) return false;
  return specs.every((row) => intakeGapProbe(h, row.job) == null);
}

const BLOCK_ORDER: IntakeBlock[] = [
  'tenure',
  'vehicle',
  'income',
  'spend',
  'investments',
  'cash',
  'mortgage',
  'debts',
  'house',
  'car',
  'rent',
];

function uniqueBlocks(lists: IntakeBlock[][]): IntakeBlock[] {
  const set = new Set(lists.flat());
  set.add('income');
  return BLOCK_ORDER.filter((b) => set.has(b));
}

/**
 * First-screen blocks for this hire + tenure. Tenure and vehicle always lead.
 * Income is always collected — leftover and dates are a guess without it.
 * House details only when they own. Rent only when they rent.
 */
export function intakeBlocks(
  jobClass: JobClass,
  tenure: HousingTenure | null,
  hasVehicle: boolean | null,
  hasMortgage: boolean | null = null,
  spec?: GoalSpec | null,
): IntakeBlock[] {
  const blocks: IntakeBlock[] = ['tenure', 'vehicle', 'income'];
  const hire: IntakeBlock[] =
    jobClass === 'custom'
      ? customHireBlocks(spec)
      : jobClass === 'debt_free'
        ? ['spend', 'debts']
        : jobClass === 'work_optional'
          ? ['spend', 'investments', 'cash', 'debts']
          : jobClass === 'cash_buffer'
            ? ['cash', 'spend']
            : jobClass === 'survive_paycheck'
              ? ['cash', 'spend']
              : ['cash'];
  blocks.push(...hire);
  if (tenure === 'rent') blocks.push('rent');
  if (tenure === 'own') blocks.push('mortgage');
  if (hasMortgage === true && !blocks.includes('debts')) blocks.push('debts');
  if (tenure === 'own' && (jobClass === 'keep_house_car' || jobClass === 'cash_buffer' || jobClass === 'work_optional' || jobClass === 'survive_paycheck')) {
    blocks.push('house');
  }
  if (hasVehicle === true && (jobClass === 'keep_house_car' || jobClass === 'cash_buffer' || jobClass === 'survive_paycheck')) {
    blocks.push('car');
  }
  if (tenure === 'none' && (jobClass === 'keep_house_car' || jobClass === 'survive_paycheck') && !blocks.includes('spend')) {
    blocks.push('spend');
  }
  return uniqueBlocks([blocks]);
}

/** Union of intake blocks for every elected goal. Income is always present. */
export function intakeBlocksForHousehold(
  household: HouseholdInput,
  tenure: HousingTenure | null = household.housingTenure ?? null,
  hasVehicle: boolean | null = household.hasVehicle ?? null,
  hasMortgage: boolean | null = household.hasMortgage ?? null,
): IntakeBlock[] {
  const specs = electedSpecs(household);
  if (!specs.length) {
    return intakeBlocks(household.jobClass, tenure, hasVehicle, hasMortgage, household.goalSpec);
  }
  return uniqueBlocks(
    specs.map((row) => intakeBlocks(row.job, tenure, hasVehicle, hasMortgage, row.spec)),
  );
}

function customHireBlocks(spec?: GoalSpec | null): IntakeBlock[] {
  const kind = spec?.target.kind;
  const blocks: IntakeBlock[] = [];
  if (kind === 'amount' || kind === 'runway' || kind === 'afford') blocks.push('cash');
  if (kind === 'runway') blocks.push('spend');
  if (kind === 'debt_zero') blocks.push('debts');
  return blocks;
}

/**
 * What this hire still needs before a first date is more than a guess.
 * Onboarding should collect these. Remaining gaps become next-best on home.
 */
export function intakeGap(household: HouseholdInput, jobClass: JobClass = household.jobClass): string | null {
  return intakeGapProbe(household, jobClass)?.question ?? null;
}

function intakeGapProbe(household: HouseholdInput, jobClass: JobClass): NextBest | null {
  const tenure = resolveHousingTenure(household);
  if (!tenure) {
    return { key: 'tenure', question: 'Tell us if you own, rent, or neither so we do not invent a house.' };
  }

  if (!hasIncome(household)) {
    return { key: 'income', question: 'Add take-home pay. Without it, dates and leftover are a guess.' };
  }

  if (tenure === 'rent' && !hasNamedRent(household)) {
    return { key: 'rent', question: 'Add monthly rent so housing is not mixed into coffee.' };
  }

  const mortgage = resolveHasMortgage(household);
  if (tenure === 'own' && (jobClass === 'work_optional' || jobClass === 'debt_free') && mortgage == null) {
    return { key: 'mortgage_yn', question: 'Tell us if the house is paid off or still has a mortgage.' };
  }
  if (tenure === 'own' && mortgage === true && !hasMortgageAccount(household)) {
    return {
      key: 'mortgage',
      question: 'Add the mortgage balance and payment so we do not treat the house as paid off.',
    };
  }

  switch (jobClass) {
    case 'debt_free':
      if (!hasIncome(household)) return { key: 'income', question: 'Add take-home pay to size Debt Free.' };
      if (!hasSpend(household) && tenure !== 'rent') {
        return { key: 'spend', question: 'Add monthly spending so the payment is not the only outflow.' };
      }
      if (!hasDebt(household)) return { key: 'debts', question: 'Add a loan balance and its payment to size Debt Free.' };
      return null;
    case 'work_optional':
      if (!hasIncome(household)) return { key: 'income', question: 'Add take-home pay to size Retire early.' };
      if (!hasSpend(household) && tenure !== 'rent') {
        return { key: 'spend', question: 'Add monthly spending to size Retire early.' };
      }
      if (!hasInvestments(household) && !hasCash(household)) {
        return { key: 'investments', question: 'Add investments or cash so there is a nest egg to date.' };
      }
      return null;
    case 'cash_buffer':
      if (!hasCash(household)) return { key: 'cash', question: 'Add cash on hand to size the Emergency Fund.' };
      if (!hasSpend(household) && tenure !== 'rent') {
        return { key: 'spend', question: 'Add monthly spending so we can size a few months of bills.' };
      }
      return null;
    case 'keep_house_car':
      if (!hasCash(household)) return { key: 'cash', question: 'Add cash on hand to see if Stay Afloat is covered.' };
      if (tenure === 'own' && !household.zip && !home(household)) {
        return { key: 'zip', question: 'Add ZIP or the house so ownership costs have a place.' };
      }
      if (tenure === 'none' && !hasSpend(household)) {
        return { key: 'spend', question: 'Add monthly spending so Stay Afloat has a burn rate.' };
      }
      return null;
    case 'survive_paycheck':
      if (!hasCash(household)) {
        return { key: 'cash', question: 'Add cash on hand to see how long this life lasts without a paycheck.' };
      }
      if (!hasSpend(household) && tenure !== 'rent') {
        return { key: 'spend', question: 'Add monthly spending so a stopped paycheck has a burn rate.' };
      }
      if (tenure === 'own' && !household.zip && !home(household)) {
        return { key: 'zip', question: 'Add ZIP or the house — this hire is keep-this-life if pay stops, not a guessed house.' };
      }
      return null;
    case 'custom': {
      const spec = household.goalSpec;
      if (!spec?.name?.trim() || !spec.target) {
        return { key: 'goal', question: 'Name the date and pick a target so we know what hired means.' };
      }
      const kind = spec.target.kind;
      if (kind === 'amount' && (!(spec.target.dollars > 0) || (spec.target.bucket === 'named_account' && !spec.target.accountId))) {
        return { key: 'goal', question: 'Add the dollar target so we know when this date is hired.' };
      }
      if (kind === 'date' && !spec.target.by) {
        return { key: 'goal', question: 'Add the date this hire is aiming at.' };
      }
      if (kind === 'runway' && !(spec.target.months > 0)) {
        return { key: 'goal', question: 'Add how many months of bills this date should cover.' };
      }
      if (kind === 'afford' && !(spec.target.dollars > 0)) {
        return { key: 'goal', question: 'Add the bill this leftover should cover.' };
      }
      if ((kind === 'amount' || kind === 'runway' || kind === 'afford') && !hasCash(household)) {
        return { key: 'cash', question: 'Add cash on hand to size this date.' };
      }
      if (kind === 'runway' && !hasSpend(household) && tenure !== 'rent') {
        return { key: 'spend', question: 'Add monthly spending so we can size months of bills.' };
      }
      if (kind === 'debt_zero' && !hasDebt(household)) {
        return { key: 'debts', question: 'Add a loan balance and its payment to size this date.' };
      }
      return null;
    }
  }
}

type ProbeRow = [boolean, NextBestKey, string];

function wantsRetireEarly(h: HouseholdInput): boolean {
  if (h.jobClass === 'work_optional') return true;
  if (h.goalSpec?.target.kind === 'work_optional') return true;
  return (h.openGoals ?? []).some((spec) => spec.target.kind === 'work_optional');
}

/** Facts that are present but unusable. These lead the improve queue. */
function warningRows(h: HouseholdInput): ProbeRow[] {
  const social = h.socialSecurity;
  const pension = h.pension;
  const partnerSocial = h.partnerSocialSecurity;
  const yearly = (h.extraIncomes ?? []).find(
    (row) => row.schedule === 'annual' && (row.monthOfYear == null || row.monthOfYear < 1 || row.monthOfYear > 12),
  );
  return [
    [(social?.monthlyAmount ?? 0) > 0 && social?.startAge == null, 'ss_age', 'Social Security has an amount and no start age.'],
    [(pension?.monthlyAmount ?? 0) > 0 && pension?.startAge == null, 'pension_age', 'Pension has an amount and no start age.'],
    [
      (partnerSocial?.monthlyAmount ?? 0) > 0 && partnerSocial?.startAge == null,
      'partner_ss_age',
      'Partner Social Security has an amount and no start age.',
    ],
    [!!yearly, 'extra_month', yearly ? `${yearly.name} is a yearly amount with no month.` : 'A yearly amount has no month.'],
    [!!(h.nextPayday && !parseIsoDate(h.nextPayday)), 'payday', 'Next payday is not a date like 2026-10-03.'],
    [mortgageFlagContradicts(h), 'mortgage_match', 'The mortgage answer does not match the loans on the books.'],
  ];
}

/** Household situations the walker can model, once the outline is in. */
function modelRows(h: HouseholdInput): ProbeRow[] {
  const vehicle = h.assets.find((asset) => asset.type === 'vehicle');
  const homeAsset = h.assets.find((asset) => asset.type === 'home');
  const lease = h.accounts.find((account) => account.type === 'auto_lease' && !account.endsAt);
  const ownedCar =
    !!vehicle &&
    !h.accounts.some((account) => account.type === 'auto_lease' || account.type === 'auto_loan');
  const mortgage = h.accounts.find((account) => account.type === 'mortgage' && account.balance > 0);
  const promoOpen = h.accounts.find((account) => account.promoApr != null && !account.promoEndsAt);
  const card = h.accounts.find(
    (account) => account.type === 'credit_card' && account.balance > 0 && account.promoApr == null && !account.promoEndsAt,
  );
  const interestOnly = h.accounts.find(
    (account) =>
      (account.type === 'mortgage' || account.type === 'auto_loan' || account.type === 'other_liability') &&
      account.balance > 0 &&
      !account.interestOnlyUntil,
  );
  const deferred = h.accounts.find(
    (account) =>
      account.type === 'student_loan' &&
      account.balance > 0 &&
      (account.minPayment == null || account.minPayment <= 0) &&
      !account.deferredUntil,
  );
  return [
    [!!lease, 'lease_end', `When does the ${lease?.name ?? 'lease'} end?`],
    [ownedCar, 'lease', 'Is the car leased?'],
    [
      !!mortgage && !mortgage.rateFixedUntil && mortgage.indexMargin == null,
      'arm',
      `Is the ${mortgage?.name ?? 'mortgage'} a fixed rate or an adjustable rate?`,
    ],
    [!!promoOpen, 'promo_end', `${promoOpen?.name ?? 'That card'} has an intro rate and no end month.`],
    [!!card, 'promo', `Does ${card?.name ?? 'the card'} have an intro rate?`],
    [!!interestOnly, 'interest_only', `Does ${interestOnly?.name ?? 'the loan'} stay interest-only for a while?`],
    [!!deferred, 'deferment', `${deferred?.name ?? 'The student loan'} has no payment. Is it deferred?`],
    [
      wantsRetireEarly(h) && !h.incomeEndsAt && h.retireAtHiredDate == null,
      'income_end',
      'Should pay stop when Retire early is hired?',
    ],
    [(h.partnerMonthlyIncome ?? 0) > 0 && h.partnerAge == null, 'partner_age', 'Add your partner’s age so their benefits can start on time.'],
    [
      (h.partnerMonthlyIncome ?? 0) > 0 && h.partnerAge != null && h.partnerSocialSecurity == null && h.partnerPension == null,
      'partner_benefits',
      'Add a partner Social Security or pension, or say there is none.',
    ],
    [hasIncome(h) && h.incomeVolatility == null, 'income_volatility', 'Does take-home stay steady, or does it jump around?'],
    [!!homeAsset && homeAsset.rentalIncomeMonthly == null, 'rental', 'Do you collect rent on a house?'],
    [!!homeAsset && homeAsset.exteriorResponsibility == null, 'exterior', 'Do you pay for the roof and exterior, or does an HOA?'],
    [!!vehicle && !vehicle.vehicleClass, 'vehicle_class', 'What kind of vehicle is it? That changes fuel and upkeep.'],
  ];
}

function firstOpen(household: HouseholdInput, rows: ProbeRow[]): NextBest | null {
  const skipped = new Set(household.skippedQuestions ?? []);
  for (const [missing, key, question] of rows) {
    if (missing && !skipped.has(key)) return { key, question };
  }
  return null;
}

export function nextBest(household: HouseholdInput, jobClass: JobClass = household.jobClass): NextBest | null {
  if (!hasIncome(household)) {
    return { key: 'income', question: 'Add take-home pay. Without it, dates and leftover are a guess.' };
  }
  const specs = electedSpecs(household);
  if (specs.length) {
    for (const row of specs) {
      const gap = intakeGapProbe(household, row.job);
      if (gap) return gap;
    }
  } else {
    const gap = intakeGapProbe(household, jobClass);
    if (gap) return gap;
  }

  const warning = firstOpen(household, warningRows(household));
  if (warning) return warning;

  const tenure = resolveHousingTenure(household);
  const wantsCar = resolveHasVehicle(household);
  const h = home(household);
  const v = car(household);
  type Row = [boolean, NextBestKey, string];

  const tenureQs: Row[] = [
    [wantsCar === null, 'vehicle_yesno', 'Do you have a car we should keep on this date?'],
    [wantsCar === true && !v, 'car', 'Add the car so the next replacement is on the path.'],
  ];

  const ownership: Row[] =
    tenure === 'own'
      ? [
          [!isUsZip(household.zip), 'zip', 'Add your ZIP so we can use local cost tables.'],
          [!h, 'house', 'Add the house so ownership stays on this date.'],
          [
            household.assets.some((asset) => asset.type === 'home' && asset.value == null),
            'house_value',
            'Add a house value, or use the ZIP median.',
          ],
          [
            household.assets.some((asset) => asset.type === 'home' && asset.roofYear == null),
            'roof',
            'Add roof year to narrow the next house bill.',
          ],
          [
            household.assets.some((asset) => asset.type === 'home' && asset.hvacYear == null),
            'hvac',
            'Add HVAC year to narrow replacement timing.',
          ],
        ]
      : [];

  const mileage: Row[] = [
    [
      household.assets.some((asset) => asset.type === 'vehicle' && asset.mileage == null),
      'mileage',
      'Add mileage to tighten car maintenance.',
    ],
  ];

  const missingApr = firstLoanMissingApr(household.accounts);
  const rates: Row[] = [
    [
      !!missingApr,
      'apr',
      `Add the interest rate on ${missingApr?.name ?? 'each loan'} so we do not treat it as 0%.`,
    ],
  ];

  const cashflow: Row[] = [
    [tenure !== 'rent' && !hasSpend(household), 'spend', 'Add living expenses so the gap is not just housing.'],
    [
      tenure === 'own' && resolveHasMortgage(household) == null,
      'mortgage_yn',
      'Is the house paid off, or is there still a mortgage?',
    ],
    [
      tenure === 'own' && resolveHasMortgage(household) === true && !hasMortgageAccount(household),
      'mortgage',
      'Add the mortgage so the payment is on this date.',
    ],
  ];
  const nest: Row[] = [
    [
      !hasInvestments(household) &&
        (jobClass === 'work_optional' || electedSpecs(household).some((row) => row.job === 'work_optional')),
      'investments',
      'Add 401k / brokerage so Retire early is not only cash.',
    ],
  ];
  const partner: Row[] = [
    [
      (household.monthlyIncome ?? 0) > 0 && household.partnerMonthlyIncome == null,
      'partner',
      'Add a partner’s take-home if there is a second paycheck in this household.',
    ],
  ];
  const cadence: Row[] = [
    [
      (household.monthlyIncome ?? 0) > 0 && !household.paycheckCadence,
      'cadence',
      'Is pay monthly, twice a month, or every two weeks? Three-paycheck months move leftover.',
    ],
  ];

  const order: Row[] =
    jobClass === 'debt_free'
      ? [...rates, ...cashflow, ...cadence, ...partner, ...tenureQs, ...ownership, ...mileage, ...nest]
      : jobClass === 'work_optional'
        ? [...rates, ...nest, ...cashflow, ...cadence, ...partner, ...tenureQs, ...ownership, ...mileage]
        : jobClass === 'survive_paycheck'
          ? [...ownership, ...mileage, ...tenureQs, ...rates, ...cashflow]
          : jobClass === 'custom'
            ? [...tenureQs, ...ownership, ...mileage, ...rates, ...cashflow]
            : [...tenureQs, ...ownership, ...mileage, ...rates, ...cashflow, ...nest];

  return firstOpen(household, [...order, ...modelRows(household)]);
}

export function nextBestQuestion(household: HouseholdInput, jobClass: JobClass = household.jobClass): string | null {
  return nextBest(household, jobClass)?.question ?? null;
}

export function completenessScore(household: HouseholdInput, jobClass: JobClass = household.jobClass): number {
  let points = 0;
  let total = 0;
  const add = (ok: boolean, weight = 1) => {
    total += weight;
    if (ok) points += weight;
  };
  const tenure = resolveHousingTenure(household);
  const wantsCar = resolveHasVehicle(household);
  const h = home(household);
  const v = car(household);
  const ownW = tenure === 'own' ? (jobClass === 'debt_free' ? 0.5 : jobClass === 'work_optional' ? 1 : 2) : 0;
  const flowW = 2;
  add(tenure != null, 2);
  add(wantsCar != null, 1);
  if (tenure === 'own') add(isUsZip(household.zip), ownW);
  add(hasIncome(household), flowW);
  add(hasSpend(household) || (tenure === 'rent' && hasNamedRent(household)), jobClass === 'keep_house_car' ? 0.5 : 1.5);
  if (tenure === 'rent') add(hasNamedRent(household), 2);
  if (tenure === 'own') {
    add(!!h, ownW);
    add(!!h?.value, ownW);
    add(!!h?.yearBuilt, 1);
    add(h?.roofYear != null, ownW);
    add(h?.hvacYear != null, 1);
    add(h?.waterHeaterYear != null, 0.5);
  }
  if (wantsCar !== false) {
    add(!!v, jobClass === 'debt_free' ? 0.5 : 1.5);
    add(!!v?.value, 1);
    add(!!(v?.vehicleYear && v.make), 1);
    add(v?.mileage != null, 1);
  }
  add(hasCash(household) || hasInvestments(household), 2);
  if (jobClass === 'debt_free') add(hasDebt(household), 2);
  if (jobClass === 'custom' && household.goalSpec?.target.kind === 'debt_zero') add(hasDebt(household), 2);
  const loans = household.accounts.filter((a) => isLiability(a.type) && a.balance > 0);
  if (loans.length) add(loans.every((a) => a.apr != null), jobClass === 'debt_free' || jobClass === 'work_optional' ? 2 : 1);
  if (tenure === 'own') {
    const mortgage = resolveHasMortgage(household);
    add(mortgage != null, 2);
    add(mortgage === false || hasMortgageAccount(household), 1);
  }
  add(hasInvestments(household), jobClass === 'work_optional' ? 2 : 0.5);
  return total === 0 ? 0 : Math.round((points / total) * 100);
}
