export const LOCKOUT_THRESHOLD = 5;
export const LOCKOUT_BASE_MS = 30_000;
export const LOCKOUT_CAP_MS = 60 * 60 * 1000;

export type LockoutState = {
  failures: number;
  nextAllowedAt: number;
};

export const clearLockout = (): LockoutState => ({ failures: 0, nextAllowedAt: 0 });

/** After 5 failures, wait 30s, then double, capped at 1 hour. */
export function lockoutAfterFailure(prev: LockoutState, now: number): LockoutState {
  const failures = prev.failures + 1;
  if (failures < LOCKOUT_THRESHOLD) return { failures, nextAllowedAt: 0 };
  const exponent = failures - LOCKOUT_THRESHOLD;
  const wait = Math.min(LOCKOUT_BASE_MS * 2 ** exponent, LOCKOUT_CAP_MS);
  return { failures, nextAllowedAt: now + wait };
}

/**
 * A try during the wait is rejected and does not add another failure.
 * A try after the wait counts.
 */
export function lockoutLabel(until: number, now: number): string | null {
  const left = until - now;
  if (left <= 0) return null;
  const seconds = Math.ceil(left / 1000);
  if (seconds >= 60) return `Try again in ${Math.ceil(seconds / 60)} min`;
  return `Try again in ${seconds}s`;
}

export function registerFailure(
  prev: LockoutState,
  now: number,
): { state: LockoutState; rejected: boolean } {
  if (prev.nextAllowedAt > now) return { state: prev, rejected: true };
  return { state: lockoutAfterFailure(prev, now), rejected: false };
}
