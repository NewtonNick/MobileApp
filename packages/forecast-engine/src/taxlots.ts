import { cents } from './money';
import { isLiquid, type AccountInput, type HouseholdInput, type MonthPoint, type TaxLot } from './types';

/**
 * Brokerage lots the user types. A price is not a live quote.
 * Long-term means the sale is on or after the day that is one year after the day after acquisition
 * (IRS holding period). Wash sales, state tax, and the 3.8% net investment income tax are not applied.
 * A net loss can reduce other income by at most $3,000 in the sale quote. That cap is the federal
 * joint / single figure. Married filing separately is $1,500 and is not a separate switch here.
 * The deduction is reported. It is not added to the cash from the sale.
 */
export const CAPITAL_LOSS_ORDINARY_CAP = 3_000;

export type HoldingTerm = 'short' | 'long';

export interface TaxLotSaleLine {
  lotId: string;
  shares: number;
}

export interface CapitalGainRates {
  shortTerm: number | null;
  longTerm: number | null;
}

export interface TaxLotQuoteLine {
  lotId: string;
  symbol: string;
  accountId: string;
  shares: number;
  proceeds: number;
  basis: number;
  gain: number;
  term: HoldingTerm;
}

export interface TaxLotSaleQuote {
  proceeds: number;
  basis: number;
  shortGain: number;
  longGain: number;
  netShort: number;
  netLong: number;
  ordinaryDeduction: number;
  carryforward: number;
  /** Null when a positive gain has no rate. Zero when nothing is taxable. */
  tax: number | null;
  afterTaxProceeds: number | null;
  unpriced: boolean;
  lines: TaxLotQuoteLine[];
}

export type TaxLotResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** Gain slice already split into terms. Dollars match the balances they sit next to. */
export interface BrokerageGainSlice {
  covered: number;
  basis: number;
  shortGain: number;
  longGain: number;
  shortTermRate: number | null;
  longTermRate: number | null;
}

export type BrokerageLotStanding = 'none' | 'unpriced' | 'taxed';

interface DateParts {
  y: number;
  m: number;
  d: number;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function parseIsoDate(value: string): DateParts | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.slice(0, 10));
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null;
  return { y, m, d };
}

function utcDay(parts: DateParts): number {
  return Math.floor(Date.UTC(parts.y, parts.m - 1, parts.d) / 86_400_000);
}

function fromUtcDay(day: number): DateParts {
  const date = new Date(day * 86_400_000);
  return { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() };
}

function addYears(parts: DateParts, years: number): DateParts {
  const y = parts.y + years;
  const dim = daysInMonth(y, parts.m);
  if (parts.d <= dim) return { y, m: parts.m, d: parts.d };
  return fromUtcDay(utcDay({ y, m: parts.m + 1, d: 1 }));
}

export function localIsoDate(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Long-term when the sale date includes a full year counted from the day after purchase. */
export function holdingTerm(acquiredOn: string, soldOn: string): HoldingTerm | null {
  const acquired = parseIsoDate(acquiredOn);
  const sold = parseIsoDate(soldOn);
  if (!acquired || !sold) return null;
  if (utcDay(sold) < utcDay(acquired)) return null;
  const start = fromUtcDay(utcDay(acquired) + 1);
  const mature = addYears(start, 1);
  return utcDay(sold) >= utcDay(mature) ? 'long' : 'short';
}

export function parseStoredGainRate(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 0.8) return null;
  return n;
}

const SYMBOL = /^[A-Z][A-Z0-9.\-]{0,11}$/;

export function parseTaxLots(value: unknown): TaxLot[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (!row || typeof row !== 'object') return [];
    const item = row as Partial<TaxLot>;
    if (typeof item.id !== 'string' || !item.id.trim()) return [];
    if (typeof item.accountId !== 'string' || !item.accountId.trim()) return [];
    if (typeof item.symbol !== 'string') return [];
    const symbol = item.symbol.trim().toUpperCase();
    if (!SYMBOL.test(symbol)) return [];
    const acquired = parseIsoDate(typeof item.acquiredOn === 'string' ? item.acquiredOn : '');
    if (!acquired) return [];
    const shares = Number(item.shares);
    const costBasis = Number(item.costBasis);
    const pricePerShare = Number(item.pricePerShare);
    if (!Number.isFinite(shares) || !(shares > 0)) return [];
    if (!Number.isFinite(costBasis) || costBasis < 0) return [];
    if (!Number.isFinite(pricePerShare) || !(pricePerShare > 0)) return [];
    return [
      {
        id: item.id,
        accountId: item.accountId,
        symbol,
        acquiredOn: `${acquired.y}-${String(acquired.m).padStart(2, '0')}-${String(acquired.d).padStart(2, '0')}`,
        shares,
        costBasis,
        pricePerShare,
      },
    ];
  });
}

export function lotMarketValue(lot: TaxLot): number {
  return cents(lot.shares * lot.pricePerShare);
}

export function lotsMarketValue(lots: TaxLot[]): number {
  return cents(lots.reduce((sum, lot) => sum + lot.shares * lot.pricePerShare, 0));
}

export interface OpenLot {
  lot: TaxLot;
  marketValue: number;
  gain: number;
  term: HoldingTerm;
}

export function openLots(lots: TaxLot[], asOf: string): OpenLot[] {
  return lots.flatMap((lot) => {
    const term = holdingTerm(lot.acquiredOn, asOf);
    if (!term) return [];
    const marketValue = lotMarketValue(lot);
    return [{ lot, marketValue, gain: cents(marketValue - lot.costBasis), term }];
  });
}

export interface CoveredLots {
  market: number;
  basis: number;
  shortGain: number;
  longGain: number;
}

/** Lots price the account only when their market value matches the balance within a dollar. */
export function coveredAccountLots(account: AccountInput, lots: TaxLot[] | null | undefined, asOf: string): CoveredLots | null {
  if (account.type !== 'brokerage') return null;
  const mine = (lots ?? []).filter((lot) => lot.accountId === account.id);
  if (!mine.length) return null;
  const opened = openLots(mine, asOf);
  if (opened.length !== mine.length) return null;
  const market = cents(opened.reduce((sum, row) => sum + row.marketValue, 0));
  if (Math.abs(market - cents(account.balance)) > 1) return null;
  let shortGain = 0;
  let longGain = 0;
  for (const row of opened) {
    if (row.term === 'long') longGain += row.gain;
    else shortGain += row.gain;
  }
  return {
    market,
    basis: cents(mine.reduce((sum, lot) => sum + lot.costBasis, 0)),
    shortGain: cents(shortGain),
    longGain: cents(longGain),
  };
}

/**
 * Split unrealized gain for a withdrawal.
 * Through month 12, today's short-term and long-term lots keep their term and this year's growth is short-term.
 * After that, the whole unrealized gain is long-term: a later withdrawal is not a sale of this month's shares.
 */
export function splitUnrealized(
  unrealized: number,
  openingShort: number,
  openingLong: number,
  month: number,
): { short: number; long: number } {
  if (month > 12) return { short: 0, long: unrealized };
  let short = openingShort;
  let long = openingLong;
  const extra = unrealized - short - long;
  if (extra >= 0) return { short: short + extra, long };
  let left = -extra;
  const takeShort = Math.min(Math.max(0, short), left);
  short -= takeShort;
  left -= takeShort;
  const takeLong = Math.min(Math.max(0, long), left);
  long -= takeLong;
  left -= takeLong;
  short -= left;
  return { short, long };
}

function clampRate(rate: number | null): number | null {
  if (rate == null || !Number.isFinite(rate) || rate < 0 || rate > 0.8) return null;
  return rate;
}

function netGains(shortGain: number, longGain: number): {
  netShort: number;
  netLong: number;
  ordinaryDeduction: number;
  carryforward: number;
} {
  let netShort = shortGain;
  let netLong = longGain;
  if (netShort > 0 && netLong < 0) {
    const offset = Math.min(netShort, -netLong);
    netShort = cents(netShort - offset);
    netLong = cents(netLong + offset);
  } else if (netLong > 0 && netShort < 0) {
    const offset = Math.min(netLong, -netShort);
    netLong = cents(netLong - offset);
    netShort = cents(netShort + offset);
  }
  const loss = cents(Math.max(0, -netShort) + Math.max(0, -netLong));
  const ordinaryDeduction = cents(Math.min(CAPITAL_LOSS_ORDINARY_CAP, loss));
  return { netShort, netLong, ordinaryDeduction, carryforward: cents(loss - ordinaryDeduction) };
}

export type LotMethod = 'fifo' | 'hifo';

/** Shares to sell, oldest first or highest cost basis first. */
export function pickLotSale(
  lots: TaxLot[],
  symbol: string,
  shares: number,
  method: LotMethod,
): TaxLotSaleLine[] {
  const open = lots.filter((lot) => lot.symbol === symbol && lot.shares > 0);
  const sorted = [...open].sort((a, b) => {
    if (method === 'hifo') {
      const aBasis = a.shares > 0 ? a.costBasis / a.shares : 0;
      const bBasis = b.shares > 0 ? b.costBasis / b.shares : 0;
      return bBasis - aBasis;
    }
    return a.acquiredOn.localeCompare(b.acquiredOn);
  });
  const lines: TaxLotSaleLine[] = [];
  let left = shares;
  for (const lot of sorted) {
    if (!(left > 0)) break;
    const take = Math.min(lot.shares, left);
    lines.push({ lotId: lot.id, shares: take });
    left -= take;
  }
  return lines;
}

export function quoteTaxLotSale(
  lots: TaxLot[],
  lines: TaxLotSaleLine[],
  rates: CapitalGainRates,
  soldOn: string,
): TaxLotResult<TaxLotSaleQuote> {
  if (!parseIsoDate(soldOn)) return { ok: false, error: 'Use a sale date like 2026-03-15.' };
  const byId = new Map(lots.map((lot) => [lot.id, lot]));
  const quoteLines: TaxLotQuoteLine[] = [];
  for (const line of lines) {
    if (!(line.shares > 0)) continue;
    const lot = byId.get(line.lotId);
    if (!lot) return { ok: false, error: 'That lot is not on the books.' };
    if (line.shares > lot.shares + 1e-8) return { ok: false, error: `${lot.symbol} does not have that many shares.` };
    const shares = Math.min(line.shares, lot.shares);
    const term = holdingTerm(lot.acquiredOn, soldOn);
    if (!term) return { ok: false, error: `${lot.symbol} was acquired after the sale date.` };
    const proceeds = cents(shares * lot.pricePerShare);
    const basis = cents(lot.costBasis * (shares / lot.shares));
    quoteLines.push({
      lotId: lot.id,
      symbol: lot.symbol,
      accountId: lot.accountId,
      shares,
      proceeds,
      basis,
      gain: cents(proceeds - basis),
      term,
    });
  }
  if (!quoteLines.length) return { ok: false, error: 'Enter the shares to sell.' };
  const shortGain = cents(quoteLines.filter((line) => line.term === 'short').reduce((sum, line) => sum + line.gain, 0));
  const longGain = cents(quoteLines.filter((line) => line.term === 'long').reduce((sum, line) => sum + line.gain, 0));
  const net = netGains(shortGain, longGain);
  const shortRate = clampRate(rates.shortTerm);
  const longRate = clampRate(rates.longTerm);
  const stTaxable = Math.max(0, net.netShort);
  const ltTaxable = Math.max(0, net.netLong);
  const unpriced = (stTaxable > 0 && shortRate == null) || (ltTaxable > 0 && longRate == null);
  const tax = unpriced ? null : cents(stTaxable * (shortRate ?? 0) + ltTaxable * (longRate ?? 0));
  const proceeds = cents(quoteLines.reduce((sum, line) => sum + line.proceeds, 0));
  const basis = cents(quoteLines.reduce((sum, line) => sum + line.basis, 0));
  return {
    ok: true,
    value: {
      proceeds,
      basis,
      shortGain,
      longGain,
      netShort: net.netShort,
      netLong: net.netLong,
      ordinaryDeduction: net.ordinaryDeduction,
      carryforward: net.carryforward,
      tax,
      afterTaxProceeds: tax == null ? null : cents(proceeds - tax),
      unpriced,
      lines: quoteLines,
    },
  };
}

function ratesOf(household: HouseholdInput): CapitalGainRates {
  return { shortTerm: household.shortTermGainRate ?? null, longTerm: household.longTermGainRate ?? null };
}

export function applyTaxLotSale(
  household: HouseholdInput,
  lines: TaxLotSaleLine[],
  soldOn: string,
): TaxLotResult<HouseholdInput> {
  const quoted = quoteTaxLotSale(household.taxLots ?? [], lines, ratesOf(household), soldOn);
  if (!quoted.ok) return quoted;
  const quote = quoted.value;
  if (quote.unpriced || quote.afterTaxProceeds == null) {
    return { ok: false, error: 'Set both gain rates before recording a sale. The cash added has to include the tax.' };
  }
  const soldByLot = new Map(quote.lines.map((line) => [line.lotId, line.shares]));
  const taxLots = (household.taxLots ?? []).flatMap((lot) => {
    const sold = soldByLot.get(lot.id);
    if (sold == null) return [lot];
    if (sold >= lot.shares - 1e-8) return [];
    const remain = lot.shares - sold;
    return [{ ...lot, shares: remain, costBasis: cents(lot.costBasis * (remain / lot.shares)) }];
  });
  const proceedsByAccount = new Map<string, number>();
  for (const line of quote.lines) {
    proceedsByAccount.set(line.accountId, cents((proceedsByAccount.get(line.accountId) ?? 0) + line.proceeds));
  }
  const now = new Date().toISOString();
  let accounts = household.accounts.map((account) => {
    const proceeds = proceedsByAccount.get(account.id);
    if (proceeds == null) return account;
    const remaining = taxLots.filter((lot) => lot.accountId === account.id);
    const wasCovered = coveredAccountLots(account, household.taxLots, soldOn) != null;
    const balance = wasCovered ? lotsMarketValue(remaining) : cents(Math.max(0, account.balance - proceeds));
    return { ...account, balance, lastEditedAt: now };
  });
  const cash = quote.afterTaxProceeds;
  const liquidIndex = accounts.findIndex((account) => isLiquid(account.type));
  if (liquidIndex >= 0) {
    const liquid = accounts[liquidIndex];
    accounts = accounts.map((account, index) =>
      index === liquidIndex ? { ...account, balance: cents(liquid.balance + cash), lastEditedAt: now } : account,
    );
  } else {
    accounts = [
      ...accounts,
      { id: `cash-${Date.now()}`, type: 'cash', name: 'Cash and savings', balance: cash, lastEditedAt: now },
    ];
  }
  return { ok: true, value: { ...household, accounts, taxLots } };
}

/** Tax on a withdrawal from a covered brokerage. Null means a gain is still unpriced. Losses do not create cash. */
export function taxOnBrokerageWithdrawal(withdrawal: number, slice: BrokerageGainSlice): number | null {
  if (!(slice.covered > 0) || !(withdrawal > 0)) return 0;
  const scale = Math.min(1, withdrawal / slice.covered);
  const net = netGains(cents(slice.shortGain * scale), cents(slice.longGain * scale));
  const shortRate = clampRate(slice.shortTermRate);
  const longRate = clampRate(slice.longTermRate);
  const stTaxable = Math.max(0, net.netShort);
  const ltTaxable = Math.max(0, net.netLong);
  if (stTaxable <= 0 && ltTaxable <= 0) return 0;
  if (stTaxable > 0 && shortRate == null) return null;
  if (ltTaxable > 0 && longRate == null) return null;
  return cents(stTaxable * (shortRate ?? 0) + ltTaxable * (longRate ?? 0));
}

export function brokerageSliceNow(household: HouseholdInput, asOf = localIsoDate()): BrokerageGainSlice | null {
  let covered = 0;
  let basis = 0;
  let shortGain = 0;
  let longGain = 0;
  for (const account of household.accounts) {
    const lots = coveredAccountLots(account, household.taxLots, asOf);
    if (!lots) continue;
    covered += lots.market;
    basis += lots.basis;
    shortGain += lots.shortGain;
    longGain += lots.longGain;
  }
  if (!(covered > 0)) return null;
  const split = splitUnrealized(covered - basis, shortGain, longGain, 0);
  return {
    covered: cents(covered),
    basis: cents(basis),
    shortGain: cents(split.short),
    longGain: cents(split.long),
    shortTermRate: household.shortTermGainRate ?? null,
    longTermRate: household.longTermGainRate ?? null,
  };
}

export function brokerageSliceFromPoint(household: HouseholdInput, point: MonthPoint): BrokerageGainSlice | null {
  const covered = point.brokerageCovered ?? 0;
  if (!(covered > 0)) return null;
  return {
    covered,
    basis: point.brokerageBasis ?? 0,
    shortGain: point.brokerageShortGain ?? 0,
    longGain: point.brokerageLongGain ?? 0,
    shortTermRate: household.shortTermGainRate ?? null,
    longTermRate: household.longTermGainRate ?? null,
  };
}

export function describeBrokerageLots(household: HouseholdInput, asOf = localIsoDate()): BrokerageLotStanding {
  const slice = brokerageSliceNow(household, asOf);
  if (!slice) return 'none';
  const shortGain = Math.max(0, slice.shortGain);
  const longGain = Math.max(0, slice.longGain);
  if (shortGain <= 0 && longGain <= 0) return 'none';
  if (shortGain > 0 && clampRate(slice.shortTermRate) == null) return 'unpriced';
  if (longGain > 0 && clampRate(slice.longTermRate) == null) return 'unpriced';
  return 'taxed';
}
