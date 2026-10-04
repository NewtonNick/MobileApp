# B6 — Job-pick screen

**Status:** done in code (not device QA)

## Done when

≤1 tap sets `jobClass`; back is safe.

## What changed

New route `apps/mobile/src/app/job-pick.tsx` before onboarding.

- Four hires. Labels: **Retire early**, **Debt Free**, **Emergency Fund**, **Stay Afloat**. FIRE is a blurb on Retire early, not the title.
- One tap writes `jobClass` onto a real household and pushes onboarding.
- Gate and disclaimer now route here instead of straight to onboarding.
- Preview tour still skips pick (preview already has a default `jobClass`).
- Back from the screen does not require a choice; a later pick overwrites `jobClass`.
