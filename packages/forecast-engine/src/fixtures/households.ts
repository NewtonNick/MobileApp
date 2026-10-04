import { emptyRealHousehold } from '../preview';
import type { AccountInput, AssetInput, ExpenseInput, GoalSpec, HouseholdInput } from '../types';

const AT = '2024-06-01T00:00:00.000Z';

const STAY_AFLOAT: GoalSpec = {
  id: 'preset:keep_house_car',
  name: 'Stay Afloat',
  source: 'preset',
  target: { kind: 'afloat' },
  reserved: 'ownership',
};

function household(id: string, patch: Partial<HouseholdInput>): HouseholdInput {
  return {
    ...emptyRealHousehold('10001'),
    id,
    kind: 'real',
    createdAt: AT,
    monthlyIncome: 5000,
    paycheckCadence: 'monthly',
    jobClass: 'keep_house_car',
    housingTenure: 'own',
    hasVehicle: false,
    hasMortgage: false,
    openGoals: [STAY_AFLOAT],
    ...patch,
  };
}

function account(partial: Omit<AccountInput, 'lastEditedAt'>): AccountInput {
  return { ...partial, lastEditedAt: AT };
}

function home(partial: Partial<AssetInput> & Pick<AssetInput, 'id' | 'name'>): AssetInput {
  return {
    type: 'home',
    value: 400000,
    yearBuilt: 2005,
    lastEditedAt: AT,
    ...partial,
  };
}

function expense(partial: ExpenseInput): ExpenseInput {
  return partial;
}

/** Take-home is the partner's only. Own income is empty. */
export function partnerOnlyIncomeHousehold(): HouseholdInput {
  return household('fixture-partner-only', {
    monthlyIncome: null,
    paycheckCadence: null,
    partnerMonthlyIncome: 4800,
    partnerPaycheckCadence: 'biweekly',
    partnerNextPayday: '2024-06-07',
  });
}

/** Loan balance is already zero. The payment must not keep coming out. */
export function paidOffLoanHousehold(): HouseholdInput {
  return household('fixture-paid-off-loan', {
    hasVehicle: true,
    accounts: [
      account({
        id: 'paid-off-auto',
        type: 'auto_loan',
        name: 'Paid-off car loan',
        balance: 0,
        apr: 0.049,
        minPayment: 350,
      }),
    ],
    assets: [
      {
        id: 'paid-off-car',
        type: 'vehicle',
        name: 'Car',
        value: 12000,
        vehicleYear: 2016,
        vehicleClass: 'car',
        lastEditedAt: AT,
      },
    ],
  });
}

/** Custom goal whose date is already past. */
export function pastGoalDateHousehold(): HouseholdInput {
  const goal: GoalSpec = {
    id: 'past-trip',
    name: 'Trip',
    source: 'custom',
    target: { kind: 'date', by: '2020-06-01' },
    reserved: 'none',
  };
  return household('fixture-past-goal', {
    jobClass: 'custom',
    goalSpec: goal,
    openGoals: [goal],
    targetDate: '2020-06-01',
  });
}

/** Renting, but a house is still on the books. */
export function renterWithHomeHousehold(): HouseholdInput {
  return household('fixture-renter-home', {
    housingTenure: 'rent',
    hasMortgage: false,
    assets: [home({ id: 'leftover-home', name: 'Old house', value: 350000 })],
    expenses: [expense({ id: 'rent', name: 'Rent', monthlyAmount: 1800, variable: false })],
  });
}

/** A new house with roof, HVAC, and water-heater years filled in. */
export function newHomeKnownSystemsHousehold(): HouseholdInput {
  return household('fixture-new-home', {
    hasMortgage: true,
    assets: [
      home({
        id: 'new-home',
        name: 'New house',
        value: 520000,
        yearBuilt: 2024,
        roofYear: 2024,
        hvacYear: 2024,
        waterHeaterYear: 2024,
      }),
    ],
    accounts: [
      account({
        id: 'new-mortgage',
        type: 'mortgage',
        name: 'Mortgage',
        balance: 400000,
        apr: 0.065,
        minPayment: 2500,
      }),
    ],
  });
}

/**
 * Student loan with no payment. Later phases add deferment dates on this account.
 * The balance and rate are the ones those tests should keep.
 */
export function defermentHousehold(): HouseholdInput {
  return household('fixture-deferment', {
    accounts: [
      account({
        id: 'deferred-student',
        type: 'student_loan',
        name: 'Deferred student loan',
        balance: 28000,
        apr: 0.045,
        minPayment: 0,
      }),
    ],
  });
}

/**
 * Revolving card the promo tests will extend with a promo rate and end month.
 * `apr` is the rate after a promo ends.
 */
export function promoCardHousehold(): HouseholdInput {
  return household('fixture-promo-card', {
    accounts: [
      account({
        id: 'promo-card',
        type: 'credit_card',
        name: 'Promo card',
        balance: 2400,
        apr: 0.2499,
        minPayment: 40,
        payoffStyle: 'revolving',
      }),
    ],
  });
}

/** Two houses. The first one is the featured home. */
export function twoHomesHousehold(): HouseholdInput {
  return household('fixture-two-homes', {
    featuredHomeId: 'home-a',
    hasMortgage: true,
    assets: [
      home({ id: 'home-a', name: 'Main house', value: 480000 }),
      home({ id: 'home-b', name: 'Second house', value: 260000, yearBuilt: 1998 }),
    ],
    accounts: [
      account({
        id: 'mortgage-a',
        type: 'mortgage',
        name: 'Main mortgage',
        balance: 300000,
        apr: 0.06,
        minPayment: 1900,
      }),
    ],
  });
}

/**
 * Electric car stored as class `car` until the vehicle classes grow.
 * Miles and the missing mpg are what the electricity tests should use.
 */
export function evHousehold(): HouseholdInput {
  return household('fixture-ev', {
    hasVehicle: true,
    assets: [
      {
        id: 'ev',
        type: 'vehicle',
        name: 'EV',
        value: 28000,
        vehicleYear: 2023,
        make: 'Chevrolet',
        model: 'Bolt',
        vehicleClass: 'car',
        mileage: 18000,
        milesPerYear: 12000,
        mpg: null,
        lastEditedAt: AT,
      },
    ],
  });
}

/**
 * Monthly lease payment stored as a loan until the lease account type exists.
 * Balance stays 0 so it is not treated as a payoff balance.
 */
export function leaseHousehold(): HouseholdInput {
  return household('fixture-lease', {
    hasVehicle: true,
    accounts: [
      account({
        id: 'lease',
        type: 'auto_loan',
        name: 'Lease',
        balance: 0,
        apr: 0,
        minPayment: 389,
      }),
    ],
    assets: [
      {
        id: 'leased-car',
        type: 'vehicle',
        name: 'Leased car',
        value: 32000,
        vehicleYear: 2024,
        vehicleClass: 'car',
        mileage: 9000,
        lastEditedAt: AT,
      },
    ],
  });
}

export const EDGE_HOUSEHOLDS: Record<string, () => HouseholdInput> = {
  partnerOnlyIncome: partnerOnlyIncomeHousehold,
  paidOffLoan: paidOffLoanHousehold,
  pastGoalDate: pastGoalDateHousehold,
  renterWithHome: renterWithHomeHousehold,
  newHomeKnownSystems: newHomeKnownSystemsHousehold,
  deferment: defermentHousehold,
  promoCard: promoCardHousehold,
  twoHomes: twoHomesHousehold,
  ev: evHousehold,
  lease: leaseHousehold,
};
