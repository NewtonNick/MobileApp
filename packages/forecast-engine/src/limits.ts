/**
 * Employee retirement deferral caps.
 * IRS Notice 2023-75 (2024), Notice 2024-80 (2025), Notice 2025-67 (2026).
 * https://www.irs.gov/retirement-plans/cola-increases-for-dollar-limitations-on-benefits-and-contributions
 */

export type DeferralPlan = '401k' | 'ira';

interface YearCaps {
  k401: number;
  k401CatchUp: number;
  /** Ages 60–63, in place of the age-50 catch-up. SECURE 2.0. */
  k401SuperCatchUp: number;
  ira: number;
  iraCatchUp: number;
}

const CAPS: Record<number, YearCaps> = {
  2024: { k401: 23_000, k401CatchUp: 7_500, k401SuperCatchUp: 7_500, ira: 7_000, iraCatchUp: 1_000 },
  2025: { k401: 23_500, k401CatchUp: 7_500, k401SuperCatchUp: 11_250, ira: 7_000, iraCatchUp: 1_000 },
  2026: { k401: 24_500, k401CatchUp: 8_000, k401SuperCatchUp: 11_250, ira: 7_500, iraCatchUp: 1_100 },
};

function capsFor(taxYear: number): YearCaps {
  if (CAPS[taxYear]) return CAPS[taxYear];
  const years = Object.keys(CAPS).map(Number).sort((a, b) => a - b);
  const prior = [...years].reverse().find((year) => year <= taxYear);
  return CAPS[prior ?? years[0]];
}

/** Annual employee deferral cap for the tax year and age. Employer match is separate. */
export function employeeDeferralCap(taxYear: number, age: number | null, plan: DeferralPlan): number {
  const caps = capsFor(taxYear);
  const years = age != null && Number.isFinite(age) ? age : null;
  if (plan === 'ira') {
    const catchUp = years != null && years >= 50 ? caps.iraCatchUp : 0;
    return caps.ira + catchUp;
  }
  let catchUp = 0;
  if (years != null && years >= 60 && years <= 63) catchUp = caps.k401SuperCatchUp;
  else if (years != null && years >= 50) catchUp = caps.k401CatchUp;
  return caps.k401 + catchUp;
}

/** Monthly employee dollars, capped at the annual IRS limit divided by 12. */
export function capMonthlyDeferral(
  monthlyEmployee: number,
  taxYear: number,
  age: number | null,
  plan: DeferralPlan,
): number {
  const monthlyCap = employeeDeferralCap(taxYear, age, plan) / 12;
  return Math.min(Math.max(0, monthlyEmployee), monthlyCap);
}
