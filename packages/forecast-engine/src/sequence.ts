import { typicalMonthlyIncome } from './cadence';
import { plannedEvents } from './drivers';
import { expenseMonth, liabilityPaymentMonth } from './engine';
import { liabilityApr } from './rates';
import { projectCollision, standing } from './standing';
import type { SeedBundle } from './seed-types';
import type {
  AssetInput,
  CollisionDiff,
  DownsizeLoanChoice,
  HouseholdInput,
  JobClass,
  Scenario,
  StandingView,
  ZMove,
} from './types';
import { JOB_CLASSES, JOB_CLASS_LABELS, isLiability } from './types';

const DELAY_YEARS = 5;
const DOWNSIZE_FACTOR = 0.7;

/** Extra after living, minimum payments, and recurring ownership. Live only — not a books column. */
export function extraMonthly(
  household: HouseholdInput,
  scenario: Scenario = 'realistic',
  bundle?: SeedBundle,
): number {
  const ownership = bundle
    ? plannedEvents(household, bundle, scenario)
        .filter((event) => event.month === -1)
        .reduce((sum, event) => sum + event.cost, 0)
    : 0;
  return Math.max(
    0,
    typicalMonthlyIncome(household) - expenseMonth(household, scenario) - liabilityPaymentMonth(household) - ownership,
  );
}

/** Clone: send leftover to the highest-APR loan. Does not write the original books. */
export function withDebtFirst(household: HouseholdInput, scenario: Scenario = 'realistic'): HouseholdInput {
  const extra = extraMonthly(household, scenario);
  const loans = household.accounts.filter((a) => isLiability(a.type) && a.balance > 0);
  if (!loans.length || extra <= 0) return household;
  const target = loans.reduce((best, a) =>
    liabilityApr(a, scenario) > liabilityApr(best, scenario) ? a : best,
  );
  return {
    ...household,
    accounts: household.accounts.map((a) =>
      a.id === target.id ? { ...a, minPayment: (a.minPayment ?? 0) + extra } : a,
    ),
  };
}

/**
 * Clone: leftover already sits as cash in the walker. FIRE-first keeps min payments
 * and lets Retire early treat surplus as savings. Same household object shape.
 */
export function withFireFirst(household: HouseholdInput): HouseholdInput {
  return { ...household, jobClass: 'work_optional', fireFlavor: household.fireFlavor ?? 'standard' };
}

export function highestRateLoan(household: HouseholdInput, scenario: Scenario = 'realistic') {
  const loans = household.accounts.filter((a) => isLiability(a.type) && a.balance > 0 && a.payoffStyle !== 'paid_monthly');
  if (!loans.length) return null;
  return loans.reduce((best, account) => (liabilityApr(account, scenario) > liabilityApr(best, scenario) ? account : best));
}

export function compareSequence(
  household: HouseholdInput,
  bundle: SeedBundle,
  scenario: Scenario,
): {
  debtFirst: StandingView;
  fireFirst: StandingView;
  diff: CollisionDiff;
  extraMonthly: number;
  targetLoanName: string | null;
} {
  const extra = extraMonthly(household, scenario, bundle);
  const loan = highestRateLoan(household, scenario);
  const debtHousehold = { ...household, surplusPolicy: 'debt' as const, jobClass: 'debt_free' as const };
  const fireHousehold = { ...withFireFirst(household), surplusPolicy: 'retirement' as const };
  const debtFirst = standing(debtHousehold, bundle, scenario, 'debt_free');
  const fireFirst = standing(fireHousehold, bundle, scenario, 'work_optional');
  return {
    debtFirst,
    fireFirst,
    diff: projectCollision(fireFirst, debtFirst),
    extraMonthly: extra,
    targetLoanName: loan?.name ?? null,
  };
}

export function featuredHome(household: HouseholdInput): AssetInput | undefined {
  if (household.featuredHomeId) {
    const chosen = household.assets.find((asset) => asset.id === household.featuredHomeId && asset.type === 'home');
    if (chosen) return chosen;
  }
  return household.assets.find((asset) => asset.type === 'home');
}

export function homeHasSystemYear(home: AssetInput | undefined): boolean {
  if (!home) return false;
  return home.roofYear != null || home.hvacYear != null || home.waterHeaterYear != null;
}

export interface ZMoveResult {
  household: HouseholdInput;
  applied: boolean;
  note: string | null;
}

/** Planner what-if on the featured house. Never invents a different property. */
export function applyZMove(
  household: HouseholdInput,
  move: ZMove,
  loanChoice?: DownsizeLoanChoice | null,
): HouseholdInput {
  return projectZMove(household, move, loanChoice).household;
}

export function projectZMove(
  household: HouseholdInput,
  move: ZMove,
  loanChoice?: DownsizeLoanChoice | null,
): ZMoveResult {
  if (move === 'keep') return { household, applied: true, note: null };
  const home = featuredHome(household);
  if (!home) return { household, applied: false, note: 'Add this house first.' };
  if (move === 'delay_replace') {
    if (!homeHasSystemYear(home)) {
      return { household, applied: false, note: 'Nothing to push — no roof, HVAC, or water-heater year is known.' };
    }
    const bump = (year: number | null | undefined) => (year == null ? year : year + DELAY_YEARS);
    return {
      applied: true,
      note: null,
      household: {
        ...household,
        assets: household.assets.map((asset) =>
          asset.id !== home.id
            ? asset
            : {
                ...asset,
                roofYear: bump(asset.roofYear) ?? asset.roofYear,
                hvacYear: bump(asset.hvacYear) ?? asset.hvacYear,
                waterHeaterYear: bump(asset.waterHeaterYear) ?? asset.waterHeaterYear,
              },
        ),
      },
    };
  }
  if (home.value == null) return { household, applied: false, note: 'Add a house value before downsizing.' };
  const mortgages = household.accounts.filter((account) => account.type === 'mortgage' && account.balance > 0);
  if (mortgages.length && loanChoice !== 'keep_loan' && loanChoice !== 'pay_down') {
    return {
      household,
      applied: false,
      note: 'This house has a mortgage. Choose whether the loan stays or equity stays.',
    };
  }
  const newValue = home.value * DOWNSIZE_FACTOR;
  let accounts = household.accounts;
  if (mortgages.length && loanChoice === 'pay_down') {
    const loanTotal = mortgages.reduce((sum, account) => sum + account.balance, 0);
    const equity = home.value - loanTotal;
    const nextLoan = Math.min(newValue, Math.max(0, newValue - Math.max(0, equity)));
    accounts = household.accounts.map((account) => {
      if (account.type !== 'mortgage' || account.balance <= 0 || loanTotal <= 0) return account;
      return { ...account, balance: nextLoan * (account.balance / loanTotal) };
    });
  }
  return {
    applied: true,
    note: loanChoice === 'keep_loan' ? 'The mortgage stays. The house value is lower.' : null,
    household: {
      ...household,
      accounts,
      assets: household.assets.map((asset) => (asset.id === home.id ? { ...asset, value: newValue } : asset)),
    },
  };
}

export function compareZMove(
  household: HouseholdInput,
  bundle: SeedBundle,
  scenario: Scenario,
  move: ZMove,
): { base: StandingView; moved: StandingView; diff: CollisionDiff } {
  const base = standing(household, bundle, scenario);
  const moved = standing(projectZMove(household, move).household, bundle, scenario);
  return { base, moved, diff: projectCollision(base, moved) };
}

/** Secondary dates for other hires. Not a first-open scoreboard. */
export function otherJobStandings(
  household: HouseholdInput,
  bundle: SeedBundle,
  scenario: Scenario,
  hired: JobClass = household.jobClass,
): StandingView[] {
  return JOB_CLASSES.filter((job) => job !== hired && job !== 'custom').map((job) =>
    standing(household, bundle, scenario, job),
  );
}

export function pulseBody(jobClass: JobClass, text: string): string {
  return `${JOB_CLASS_LABELS[jobClass]} · ${text}`;
}
