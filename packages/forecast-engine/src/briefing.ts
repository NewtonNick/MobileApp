import { formatUsd } from './engine';
import { labelFromMonthKey } from './month';
import type { NextBest } from './jobs';
import type { StandingView } from './types';
import { JOB_CLASS_LABELS } from './types';

export interface LivingBriefing {
  trail: string;
  exit: string;
  probes: string | null;
  turnaround: string | null;
}

/** Fuller living card: one trail, one exit, ordered probe, turnaround when the roof wins. */
export function livingBriefing(view: StandingView, next: NextBest | null): LivingBriefing {
  const job = JOB_CLASS_LABELS[view.jobClass];
  const trail =
    view.hiredMonth == null
      ? `${job} is not dated yet`
      : view.hiredMonth === 0
        ? `${job} looks on track now`
        : view.hiredDate
          ? `${job} around ${labelFromMonthKey(view.hiredDate.slice(0, 7)) ?? view.hiredDate.slice(0, 7)}`
          : `${job} in about ${view.hiredMonth} ${view.hiredMonth === 1 ? 'month' : 'months'}`;
  const exit = `${formatUsd(view.reserved)} reserved · ${formatUsd(view.leftover)} free`;
  const turnaround =
    view.collisionLabel && (view.leftover === 0 || view.collisionMonth != null)
      ? `${view.collisionLabel} claims leftover — turn around before spending it`
      : null;
  return { trail, exit, probes: next?.question ?? null, turnaround };
}
