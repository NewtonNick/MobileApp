/** Walker month 1 is the calendar month of `now`. */
export function forecastMonthLabel(monthIndex: number, now = new Date()): string {
  return new Date(now.getFullYear(), now.getMonth() + monthIndex - 1, 1).toLocaleString('en-US', {
    month: 'short',
    year: 'numeric',
  });
}

export function calendarFromMonthOffset(offset: number, now = new Date()): { year: number; monthIndex: number } {
  const d = new Date(now.getFullYear(), now.getMonth() + offset - 1, 1);
  return { year: d.getFullYear(), monthIndex: d.getMonth() };
}

/** Walker month index. 1 is the current month. Past months are 0 or less. */
export function monthOffsetFromCalendar(year: number, monthIndex: number, now = new Date()): number {
  return (year - now.getFullYear()) * 12 + (monthIndex - now.getMonth()) + 1;
}

export function isoFromYearMonth(year: number, monthIndex: number): string {
  const month = String(monthIndex + 1).padStart(2, '0');
  return `${year}-${month}-01`;
}

export function labelFromIso(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year, (month ?? 1) - 1, day ?? 1).toLocaleString('en-US', { month: 'short', year: 'numeric' });
}

/** One line for Cash after a book change. Same featured goal, or a newly featured one. */
export function hiredDateMoveLine(
  beforeTitle: string,
  beforeDate: string | null,
  afterTitle: string,
  afterDate: string | null,
): string {
  const from = beforeDate ? labelFromIso(beforeDate) : null;
  const to = afterDate ? labelFromIso(afterDate) : null;
  if (beforeTitle !== afterTitle) {
    return to
      ? `${afterTitle} is now the featured goal, around ${to}.`
      : `${afterTitle} is now the featured goal, and it is not dated yet.`;
  }
  if (beforeDate === afterDate) {
    return to ? `${afterTitle} stays ${to}.` : `${afterTitle} is still not dated.`;
  }
  if (!from && to) return `${afterTitle} is now ${to}.`;
  if (from && !to) return `${afterTitle} is no longer dated.`;
  return `${afterTitle} moved from ${from} to ${to}.`;
}
