import { resolvedMonthIndex } from './month';
import { expenseMatchesOwnership } from './ownership';
import type { ExpenseInput, HouseholdInput } from './types';

/** Forecast month 1 is the current month of the plan. */
export function expenseIsActive(expense: ExpenseInput, month: number, now = new Date()): boolean {
  const start = resolvedMonthIndex(expense.startAt, expense.startMonth, now);
  const end = resolvedMonthIndex(expense.endAt, expense.endMonth, now);
  if (start != null && month < start) return false;
  if (end != null && month > end) return false;
  return true;
}

export function isRentExpense(expense: ExpenseInput): boolean {
  if (expense.id === 'exp-rent') return true;
  return expense.name.trim().toLowerCase() === 'rent';
}

export function expenseCountsInLiving(
  expense: ExpenseInput,
  month: number,
  household?: HouseholdInput,
  now = new Date(),
): boolean {
  if (expense.monthlyAmount == null) return false;
  if (expense.linkedLiabilityId || expense.linkedAssetKey) return false;
  if (household && expenseMatchesOwnership(expense, household)) return false;
  return expenseIsActive(expense, month, now);
}
