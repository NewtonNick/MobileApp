import { HOUSEHOLD_SCHEMA_VERSION } from './types';
import { offsetToMonthKey } from './month';

/**
 * Bring a stored household up to the current schema.
 * Offset months are converted from `now`, which is how those offsets behave today.
 */
export function migrateHousehold(raw: unknown, now = new Date()): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const input = { ...(raw as Record<string, unknown>) };
  const version = typeof input.schemaVersion === 'number' && Number.isFinite(input.schemaVersion) ? input.schemaVersion : 1;
  if (version >= HOUSEHOLD_SCHEMA_VERSION) {
    input.schemaVersion = HOUSEHOLD_SCHEMA_VERSION;
    return input;
  }

  if (input.plannedRaiseAt == null && typeof input.plannedRaiseMonth === 'number') {
    input.plannedRaiseAt = offsetToMonthKey(input.plannedRaiseMonth, now);
  }

  if (Array.isArray(input.expenses)) {
    input.expenses = input.expenses.map((row) => {
      if (!row || typeof row !== 'object') return row;
      const expense = { ...(row as Record<string, unknown>) };
      if (expense.startAt == null && typeof expense.startMonth === 'number') {
        expense.startAt = offsetToMonthKey(expense.startMonth, now);
      }
      if (expense.endAt == null && typeof expense.endMonth === 'number') {
        expense.endAt = offsetToMonthKey(expense.endMonth, now);
      }
      return expense;
    });
  }

  if (Array.isArray(input.accounts)) {
    input.accounts = input.accounts.map((row) => {
      if (!row || typeof row !== 'object') return row;
      const account = { ...(row as Record<string, unknown>) };
      if (account.forgivenessAt == null && typeof account.forgivenessMonth === 'number') {
        account.forgivenessAt = offsetToMonthKey(account.forgivenessMonth, now);
      }
      return account;
    });
  }

  if (Array.isArray(input.extraIncomes)) {
    input.extraIncomes = input.extraIncomes.map((row) => {
      if (!row || typeof row !== 'object') return row;
      const extra = { ...(row as Record<string, unknown>) };
      if (extra.onceAt == null && typeof extra.onceMonth === 'number') {
        extra.onceAt = offsetToMonthKey(extra.onceMonth, now);
      }
      return extra;
    });
  }

  input.schemaVersion = HOUSEHOLD_SCHEMA_VERSION;
  return input;
}
