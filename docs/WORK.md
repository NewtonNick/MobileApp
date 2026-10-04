# Asset Aware — in-scope work

Tickets for **current MVP**. Deferred ideas stay in [BACKLOG.md](./BACKLOG.md). Contract: [DESIGN.md](./DESIGN.md). Built vs verified: [STATUS.md](./STATUS.md).

Statuses: `pending` | `in-progress` | `done` | `blocked`.

Do not add Plus, Plaid Link, SQLCipher-at-rest, iOS, or a standing cache here. Those stay backlog except where Track E already shipped a slice.

---

## Track A — founder QA (existing skeleton)

Does not block Track B unless the APK cannot boot.

| ID | Work | Done when | Status |
| --- | --- | --- | --- |
| A1 | Boot Pixel_8_API_36, debug APK, one four-field Realistic forecast | Screenshot of first sentence on emulator | pending |
| A2 | Walk R1–R17 on device (Not sure, vehicle search, debt-link, cash vs illiquid, backup, Preview isolation) | Failures logged in STATUS; pass/fail per ID | pending |
| A3 | Existing done-whens still unproven: completeness chip, same-bill prompt in UI, stale-cash 30-day banner, 14-day backup banner, notify caps, vintage on risk cards, 18-month seed banner | Each checked on emulator | pending |

---

## Track B — MVP product (conjunction)

Ship order. Each ticket is one PR-sized slice. Living = recompute on household save. Standing stays **free**.

### Engine

| ID | Work | Depends | Likely files | Done when | Status |
| --- | --- | --- | --- | --- | --- |
| B1 | Export `EventHit` from the forecast walker (do not persist hits) | — | `packages/forecast-engine/src/engine.ts`, `types.ts`, `index.ts` | Hits usable by projectors; existing tests still pass | done |
| B2 | Add `jobClass` (+ optional `targetDate` override only) to `HouseholdInput`. No `reservedCash` column. No IAP fields. | — | `packages/forecast-engine/src/types.ts`, `preview.ts` | Preview household has a default `jobClass`; types compile | done |
| B3 | `standing(household, bundle, scenario, jobClass)` live projector: sentence facts, **reserved** (Conservative shocks, liquid only), **leftover** (liquid − reserved), `pulseReasons`. Do not store the result. | B1, B2 | `packages/forecast-engine/src/standing.ts` (new), `engine.test.ts` | Unit tests: 401k ≠ reserved; leftover can be 0; seed/roof year changes move reserved | done |
| B4 | `projectCollision(baseStanding, shockedStanding)` — diff of two standing views, not a table. One override or shock moves the hired date. | B3 | `packages/forecast-engine/src/standing.ts` | Test: bumping a roof override changes collision line; books unchanged | done |

### App

| ID | Work | Depends | Likely files | Done when | Status |
| --- | --- | --- | --- | --- | --- |
| B5 | Persist `jobClass` with the household; `entitlements.ts` stub always unlocked; engine never reads it | B2 | `apps/mobile/src/state/*`, `apps/mobile/src/entitlements.ts` (new) | Household round-trips `jobClass`; no Plus fields in JSON | done |
| B6 | Job-pick screen before onboarding: work-optional, debt-free, cash buffer, keep house and car. FIRE is the work-optional label, not the only hire. | B5 | `apps/mobile/src/app/` (new route), `_layout.tsx` / `index.tsx` | ≤1 tap sets `jobClass`; back is safe | done |
| B7 | Onboarding stays job-shaped fields then standing (R1). Next-best still skippable (R2). | B6 | `apps/mobile/src/app/onboarding.tsx` | Hire-specific intake; five-ish taps still holds where the hire allows | done |
| B8 | Cash homepage renders **one standing sentence**: hired date, reserved vs leftover, house/car as constraint inside the sentence. Recompute on every household save. | B3, B5, B7 | `apps/mobile/src/app/(tabs)/index.tsx`, `state/context.tsx` | Edit cash or roof year → sentence updates with no save dialog | done |
| B9 | Collision **line** on home when leftover is claimed (shock/quote). Not a Compare lab. | B4, B8 | homepage + looks-wrong params | Line names that leftover is reserved; date moves | done |
| B10 | Looks-wrong edits the **date/gap** for the hired job (paycheck, bill, “I’m not on 4%”), then standing recomputes. Cost-line edit still allowed. | B8 | `apps/mobile/src/app/looks-wrong.tsx` | Changing an assumption updates the homepage sentence | done |
| B11 | Pulse = R9 only: last-edited, 30-day stale-cash banner, mark shock realized. No weekly ceremony. | B8 | homepage, `notifications.ts` | Stale banner shows; realized shock drops out of reserved | done |
| B12 | Risk + Forecast copy attaches to the hired job (constraint, not a second app). L/R/C unchanged. | B8 | `risk.tsx`, `forecast.tsx` | Same `jobClass`; 401k still does not bury the roof (R5) | done |

### Guardrails (checklists, not features)

| ID | Work | Done when | Status |
| --- | --- | --- | --- |
| G1 | Plaid sidecar frozen — no new routes, no household in FastAPI | README + `apps/plaid-api` unchanged for this wave | done |
| G2 | No persisted forecast / standing cache / `reservedCash` as books | Code review against DESIGN engine API | done |
| G3 | Standing never behind a paywall | Homepage has no Plus gate | done |

---

## Sequence

```
A1  (founder, parallel)
B1 EventHit ─┬─ B3 standing() ─ B4 collision
B2 jobClass ─┤
             └─ B5 persist ─ B6 pick ─ B7 onboard ─ B8 home ─ B9 collision UI
                                                      ├─ B10 looks-wrong
                                                      ├─ B11 pulse
                                                      └─ B12 risk/forecast copy
G1–G3 throughout
```

**First engineering slice:** B1 + B2 + B3 (engine tests, no UI).  
**First user-visible slice:** B6 + B7 + B8.  
**Screenshot-able standing** (unlocks backlog U1 / D1): B8 + B9.

---

## Track D — finish first-pass (refine B/C to DESIGN)

B and C are in code. This track makes those screens match the contract instead of dumping a form. Founder owns Track A.

| ID | Work | Depends | Likely files | Done when | Status |
| --- | --- | --- | --- | --- | --- |
| D1 | Next-best and completeness chip open **one** missing field (`/improve`). Not the accounts dump. | C4 | `jobs.ts`, `improve.tsx`, `(tabs)/index.tsx` | Chip / Improve this job land on the next fact; Skip is safe | done |
| D2 | Change hire from home. If outline still ready, go home. Onboarding prefills and does not wipe books. | D1 | `job-pick.tsx`, `onboarding.tsx` | Switching Stay Afloat → Emergency Fund keeps cash and house | done |
| D3 | Tour Preview confirms before replacing a real household (R12). | C4 | `index.tsx` | Real books are not silently overwritten | done |
| D4 | Tab icons; Compare Advanced bars use the fan series; 18-month seed banner on home; stale-cash pulse can notify (R9/R14/R16) | B8, B12 | `(tabs)/_layout.tsx`, `compare.tsx`, `notifications.ts` | Tabs are not broken X boxes; fan heights follow Liberal/Realistic/Conservative | done |

---

## Track C — intro honesty (2026-09-07 council)

Human titles, tenure, minimum outline, reserved-by-hire. Do not invent a house. Stay Afloat is not Y (L4).

| ID | Work | Depends | Likely files | Done when | Status |
| --- | --- | --- | --- | --- | --- |
| C1 | Founder titles on pick + standing: Retire early, Debt Free, Emergency Fund, Stay Afloat. FIRE is a blurb, not the title. | B6 | `types.ts`, `onboarding/spec.ts`, `job-pick.tsx` | Labels match founder list; no “work-optional” on the pick | done |
| C2 | Persist `housingTenure` + `hasVehicle`. Intake: tenure and car yes/no first, then hire-minimum. Rent is a named expense. Skip-house is skip, not national averages. Next-best does not nag a mortgage without a house. | C1 | `types.ts`, `jobs.ts`, `preview.ts`, `onboarding.tsx` | Renter outline has no home asset; completeness can pass without a roof year | done |
| C3 | Reserved-by-hire: Emergency Fund = N-month Conservative living; Stay Afloat own = ownership shocks; Stay Afloat rent/none = N-month living including rent. Sentence/caption follow tenure. | C2 | `standing.ts`, `engine.test.ts` | Tests: owner Stay Afloat reserved = hits; renter Emergency Fund reserved ≠ phantom roof | done |
| C4 | Gate/unlock/home/forecast copy does not assume a house. Returning renter with books goes home (not only `assets.length`). | C2 | `index.tsx`, `(tabs)/index.tsx`, `forecast.tsx`, `risk.tsx` | Renter household reaches standing; unlock does not lead with house-and-car | done |

---

## Track E — post-standing (non-Plaid backlog)

Category budgets and the Trial bank link are in the product. Envelope-as-the-home stays out (O1). Paid Production is still the rollout step (O11). Standing stays free.

| ID | Work | Depends | Likely files | Done when | Status |
| --- | --- | --- | --- | --- | --- |
| E1 | Paycheck cadence + partner take-home on the same household | B8 | `cadence.ts`, `engine.ts`, onboarding / accounts / looks-wrong | Biweekly year sums; partner adds; no spouse login | done |
| E2 | If pay stopped (Y) as its own hire; reserved = 12-month burn + ownership | C3 | `types.ts`, `standing.ts`, `job-pick.tsx` | Stay Afloat ≠ Y; runway in the sentence | done |
| E3 | Coast / Lean / Fat as `fireFlavor` on Retire early | E2 | `types.ts`, `standing.ts`, job-pick | Coast is later than Standard when they still save | done |
| E4 | Sequence lab: debt first vs Retire early (clones, not books) | E1 | `sequence.ts`, `sequence.tsx` | Compare two standing views; original JSON unchanged | done |
| E5 | Keep / delay-replace / downsize this house (Z moves) | B8 | `sequence.ts`, `moves.tsx` | Delay bumps known years; downsize is 70% of entered value; no other address | done |
| E6 | Living card (trail / exit / probe / turnaround) + other dates as secondary lines | E2 | `briefing.ts`, homepage | Sentence still hero; not a four-goal scoreboard on first open | done |
| E7 | Preview costume wears the hired job; accounts framed as improve-this-job; ticker label only | L8/L10/P5 | homepage, accounts, `preview.ts` | Preview badge names the hire; ticker has no live price | done |
| E8 | Goal-language pulse; next-best includes cadence/partner | L9/L11 | `notifications.ts`, `jobs.ts`, improve | Stale copy names the hire; Skip on partner writes 0 | done |
| E9 | Advanced fan sparkline; in-app privacy screen | P8/D5 | `compare.tsx`, `privacy.tsx` | Fan still Compare → Advanced; More has Privacy | done |
| E10 | Backup AES-256-GCM (v2); v1 XOR still decrypts | P1 slice | `vault/crypto.ts`, backup | New files `alg: aes-256-gcm`; old files open | done |

G1 still holds: no new Plaid routes.

---

## Track F — quarter (engine, charts, custom goals)

Standing is in code. This track is the next major update. Founder Track A stays parallel. No Plaid, no scoreboard, no buy-this-house.

| ID | Work | Depends | Likely files | Done when | Status |
| --- | --- | --- | --- | --- | --- |
| F1 | Driver catalog: every `HouseholdInput` field moves the walker; missing widens ranges | E1 | `engine.ts`, `drivers.ts` | sqft scales maint; two cars dep independently; partner cadence; liquid yield; other-asset path | done |
| F2 | Seed both tails (CPI/HPI/equity vol, crash/boom, jumps, HPI half-life) | F1 | `macro_v1.json`, `home_v1.json`, ETL, SOURCES | Cited vintage; app seed copy matches | done |
| F3 | CPI in walker (real $ default), P&I amortization, per-vehicle dep | F1, F2 | `engine.ts` | R8 deflate; one vs two cars; L/R/C still coherent | done |
| F4 | Signed overlays (hard year + better year); skip if no driver | F3 | `overlays.ts`, compare | Job-loss leftover < base; raise leftover > base; no-house skips HPI | done |
| F5 | Real path MC (joint factor, jumps, ES, both tails); replace jitter | F3 | `engine.ts` / `montecarlo.ts` | Seeded reproducible; ES worse than median; not Uniform jitter | done |
| F6 | Victory Native + Skia chart kit | F5 | `apps/mobile/src/charts/` | Path, fan, waterfall, timeline, overlay compare; screens do not import Skia | done |
| F7 | Wire Forecast / Risk / Compare charts. Home stays sentence-only | F6 | `forecast.tsx`, `risk.tsx`, `compare.tsx` | Sentence first; fan band Advanced only | done |
| F8 | `GoalSpec` IR; presets compile; standing/intake read spec only | F1 | `goals.ts`, `standing.ts`, `types.ts` | Persist spec not standing; preset standing unchanged | done |
| F9 | Job pick Something else: name + target; one hire | F8 | `job-pick.tsx`, custom goal screen | Honda paid off / $15k trip works; switch preset does not wipe books | done |

---

## Track G — income + elected goals (2026-09-08 founder)

One hire made the home feel empty; missing income made leftover and dates a guess. Charts were bar sparks, not lines.

| ID | Work | Depends | Likely files | Done when | Status |
| --- | --- | --- | --- | --- | --- |
| G1 | Take-home pay is required for a dated outline; intake always asks it first | C2 | `jobs.ts`, `onboarding.tsx` | No income → `intakeGap` names take-home; dates stay undated | done |
| G2 | Persist `openGoals`; presets + customs on the same books | F8 | `types.ts`, `goals.ts`, `preview.ts` | Old books synthesize one spec; adding a custom does not wipe presets | done |
| G3 | Home is an elected-goals board (headline, progress, per-spec leftover) | G2 | `(tabs)/index.tsx`, `standing.ts` `openGoalBoard` | Preview shows Stay Afloat + Emergency Fund; add/change goals from home | done |
| G4 | SVG line graphs on Forecast / Compare (not bar sparks) | F7 | `charts/line-charts.tsx` | Cash path, L/R/C, fan, overlay are polylines | done |

---

[BACKLOG.md](./BACKLOG.md): Plaid Link/Trial, SQLCipher at-rest, iOS/EAS, Play listing, paid SKU, live prices, paid TCO APIs.
