import type { FireFlavor, JobClass } from '@asset-aware/forecast-engine';

export const HIRE_COPY: Record<JobClass, { title: string; blurb: string; cta: string }> = {
  work_optional: {
    title: 'Retire early',
    blurb: 'A date when work can stop. People call this FIRE — we still count rent, or the house and car, if you have them.',
    cta: 'Show Retire early',
  },
  debt_free: {
    title: 'Debt Free',
    blurb: 'A date when the loans are gone. We will not assume a mortgage if you rent.',
    cta: 'Show Debt Free',
  },
  cash_buffer: {
    title: 'Emergency Fund',
    blurb: 'A date when cash covers a few months of bills — not the 401k. Roof and car wait until you own them.',
    cta: 'Show Emergency Fund',
  },
  keep_house_car: {
    title: 'Stay Afloat',
    blurb: 'Stay able to cover the next real bill in this life — this place, this car — without guessing a house you do not have.',
    cta: 'Show Stay Afloat',
  },
  survive_paycheck: {
    title: 'If pay stopped',
    blurb: 'How long this life lasts if the paycheck dies tomorrow. Not Stay Afloat — that hire assumes pay still arrives.',
    cta: 'Show If pay stopped',
  },
  custom: {
    title: 'Something else',
    blurb: 'A date you name, tracked with the others. House and car still count when you have them — this is not a shop for a different house.',
    cta: 'Hire this date',
  },
};

export const FIRE_FLAVOR_BLURB: Record<FireFlavor, string> = {
  standard: 'Usual 4% path while you still save.',
  coast: 'Stop new contributions. The nest egg has to get there on its own.',
  lean: 'A thinner year — about 70% of today’s spend.',
  fat: 'A richer year — about 150% of today’s spend.',
};
