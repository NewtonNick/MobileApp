/** One month of remaining-term P&I using the stated min payment as the payment. */

export interface AmortStep {
  interest: number;
  principal: number;
  payment: number;
  balance: number;
  /** Payment did not cover interest, so the balance grew. */
  negativeAmortization: boolean;
}

/**
 * Interest = balance * r/12. Payment = minPayment (capped at balance + interest).
 * Principal = payment − interest. If minPayment is 0, interest accrues and nothing is paid.
 */
export function amortizeMonth(balance: number, annualRate: number, minPayment: number | null | undefined): AmortStep {
  const rate = Number.isFinite(annualRate) ? Math.max(0, annualRate) : 0;
  const balanceStart = Number.isFinite(balance) ? balance : 0;
  const interest = balanceStart * (rate / 12);
  const due = balanceStart + interest;
  const rawPay = minPayment ?? 0;
  if (!Number.isFinite(rawPay) || rawPay <= 0) {
    const next = Math.max(0, due);
    return { interest, principal: 0, payment: 0, balance: next, negativeAmortization: next > balanceStart + 0.005 };
  }
  const payment = Math.min(rawPay, Math.max(0, due));
  const principal = payment - interest;
  const next = Math.max(0, due - payment);
  return { interest, principal, payment, balance: next, negativeAmortization: next > balanceStart + 0.005 };
}
