/** Shared dollar helpers. One definition for the engine and the charts. */

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function cents(n: number): number {
  return round2(n);
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export function leftoverOf(liquid: number, reserved: number): number {
  return Math.max(0, liquid - reserved);
}

export function formatUsd(n: number): string {
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(Math.round(n));
  return `${sign}$${abs.toLocaleString('en-US')}`;
}

/** Compact labels. Adds billions and trillions above the millions tier. */
export function compactUsd(n: number): string {
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  const trim = (v: number) => {
    const rounded = Math.round(v * 10) / 10;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  };
  if (abs >= 1_000_000_000_000) return `${sign}$${trim(abs / 1_000_000_000_000)}T`;
  if (abs >= 1_000_000_000) return `${sign}$${trim(abs / 1_000_000_000)}B`;
  if (abs >= 1_000_000) return `${sign}$${trim(abs / 1_000_000)}M`;
  if (abs >= 10_000) return `${sign}$${Math.round(abs / 1000)}k`;
  if (abs >= 1000) return `${sign}$${trim(abs / 1000)}k`;
  return `${sign}$${Math.round(abs)}`;
}
