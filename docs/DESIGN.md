# Asset Aware — design contract

Living product rules. If a screen or engine change violates this file, it is a bug.

| Doc | Role |
| --- | --- |
| This file | What we build against |
| [PLAN.md](./PLAN.md) | Original full steps, week sequence, R1–R17 done-whens (snapshot) |
| [STATUS.md](./STATUS.md) | What is built vs still open |
| [BACKLOG.md](./BACKLOG.md) | Deferred features (later / unresolved / out of scope) |
| [WORK.md](./WORK.md) | In-scope MVP tickets |
| [BUILDOUT.md](./BUILDOUT.md) | Complaint build order (Q01–Q05). Not MVP. |
| [SOURCES.md](./SOURCES.md) | Seed citations and banned sources |

Source thesis: the business-plan document, kept outside this repo.
That document’s Next.js + cloud FastAPI stack is **superseded**. FinAtlas source is proprietary — do not use it.

Council record (Business → Validators → Engineers, 2026-09-06) is at the bottom of this file. Those verdicts **amend** the identity, MVP, and stack sections below. They do not cancel R2–R17.

## What this product is

A local-first planner. The user elects **one or more date-shaped goals** (Retire early / Debt Free / Emergency Fund / Stay Afloat / If pay stopped / custom). Presets compile to the same `GoalSpec` as Something else. Home tracks each open goal’s progress on the same books. We still show whether leftover cash is actually free or already reserved after the next real bill — roof and car when they own them, rent when they rent.

Not a bank. Not an envelope app (coffee is not the product). A short category budget is allowed; the home is still the hired date. Not advice. Not shop quotes.

**Coverage (founder, 2026-09-29).** Market share requires the books to be semi-exhaustive of one household’s financial situation. Pay, spending, cash, debts, house, car, retirement, brokerage, and the taxes and lots that change a sale belong here when they move the hired date or leftover. A gap that makes those numbers wrong is in bounds, including work that was not on the original MVP list. Another business stays out until it is promoted: shopping a policy, filing a return, a credit pull, a spouse login, a live price, calling a merchant. Honesty rules still bind that breadth. Do not invent a price, a bracket, or a bill the household has not entered.

Differentiator vs Mint/YNAB-class clones: each goal **includes** the constraint they actually have (house, car, or rent). Differentiator vs FIRE calculators: leftover is not a savings rate if the HVAC window is open. Do not invent a house to keep that sentence. **Take-home pay is load-bearing** — without it, dates and leftover are a guess.

## Locked decisions

- **Platforms:** Expo, Android first (Windows). iOS later via EAS.
- **First user:** one household, US ZIP when they own (or later want local tables). Renters are first-class; ZIP is not a proxy for a house.
- **Housing tenure:** `own` | `rent` | `none`, asked up front. Skip-house is skip, not national averages. Rent is a named expense, not coffee in the living blob.
- **Privacy:** books on device (SQLite). PIN / vault key in SecureStore. Forecast on device.
- **Scale:** N independent phones, N SQLite blobs. No cloud household ledger. No Next.js rewrite.
- **Plaid:** optional. Sandbox, then Trial on the production host (≤10 Items for the team). Paid Production is the rollout step, after the per-Item fee is known. Access tokens stay on the sidecar. Link failure must not wipe the ledger. Only rows marked spend can move a plan, and only while the link is current.
- **Investments:** balance + expected return (asked as a percent; blank uses 7% as a labeled typical). Optional ticker label; no live prices. A brokerage can hold tax lots the user types: symbol, acquired date, shares, cost basis, and a price per share. That price is theirs. A sale quote uses the lots they choose, the one-year holding rule, and the short-term and long-term rates they enter. Net losses use the $3,000 federal ordinary cap. Wash sales, state tax, and the 3.8% net investment income tax are not in the number. When the lots match the account balance and the rates are set, a brokerage withdrawal on the hired date is taxed on the gain. Lots that do not match the balance do not tax the rest of the account.
- **Accounts:** enumerable types (cash, 401k, home, vehicles, debts, other). Ledger is “improve this job,” not the home.
- **Loan interest:** persist `apr` when the user enters it. Do not treat a missing rate as 0%. Unknown APR uses a labeled typical by loan type (Liberal lower / Conservative higher). Not a lender quote.
- **Cash flow:** monthly net income is **required for a dated plan**. Optional partner stream (same household, not a spouse login) + paycheck cadence (monthly / twice a month / biweekly / weekly). ±20% on variable categories only. Do not auto-fill bills. Missing income widens every date to “not dated yet.”
- **Identity:** car = year/make/model + ZIP + mileage, only if they have a car. Home = ZIP + year built + sqft + system ages, only if they own. No VIN, no street address. No ZIP-median house for renters.
- **Cost data:** free cited public tables (see [SOURCES.md](./SOURCES.md)). Paid TCO APIs later.
- **Scenarios:** Liberal / Realistic / Conservative on every money figure. Default Realistic.
- **Standing:** live projection of books + each elected `GoalSpec` (presets and customs in `openGoals`) + seed. Never persist the sentence, reserved, leftover, or collision month as books. Persist the specs. `jobClass` is the featured goal for Forecast leftover copy, not the only hire.
- **Reserved vs leftover:** derived live; never stored. **Reserved follows the hire and tenure** (council 2026-09-07). Emergency Fund = N months Conservative living (default 3), liquid only. Stay Afloat + own = Conservative ownership shocks. Stay Afloat + rent/none = N months living including rent. If pay stopped = 12 months Conservative living + ownership. Retire early / Debt Free leftover still nets ownership shocks when a house or car is on the books. User “I already set this aside” is an override that feeds the walker.
- **Stay Afloat ≠ paycheck-death (Y).** Stay Afloat is keep-this-life (Z when they own). Y is the hire **If pay stopped**. Sequence lab and keep/delay/downsize are what-ifs on the same books, not a second home.
- **Retire early flavors:** Standard / Coast / Lean / Fat. Same walker. Persist `fireFlavor`; standing still live-eval.
- **Backup:** AES-256-GCM file, scrypt passphrase, format version 3. A forgotten passphrase is not opened by the PIN. XOR and the older PBKDF2 file open only through Import old backup. A plain UTF-8 export is the leave path and is not a restore. The on-device SQLite file uses SQLCipher. A release build that cannot encrypt the file does not open. A dev build that cannot may seal each value with AES-256-GCM instead. The vault key stays in SecureStore, not in household JSON.
- **Billing:** entitlement lives outside household JSON. Engine never reads IAP. Standing stays free. The paid object is an annual bank link capped at two institutions (a checking login and a card login). Monthly is the other way to pay. No dollar amount is stored in the repo. Play products `bank_link_annual` and `bank_link_monthly` supply the price. The bank link locks only after Play returns a price and this phone has no active plan. Do not hide, blur, or trial-lock the homepage sentence.
- **Marketing / pricing:** do not calendarize first $100k until standing is screenshot-able on a store-shaped build.

## Budgets and the bank link (2026-09-26)

A budget is the expense lines the walker already uses. `monthlyAmount` stays the plan. Spent and left are computed for the open month from ledger rows whose role is `spend`. Transfers, pending holds, card payments, income, and charges the forecast already prices (fuel, insurance, HOA, repairs, loan payments) do not become a second living expense.

Plaid fills those rows only after classification. High-confidence spends file themselves. The inbox is the rest. “Use this month as the plan” writes `monthlyAmount` only from spend rows, and only when the link is current. An annual charge is this month only, or amount / 12. It never becomes a new monthly bill equal to the full charge.

The date stays on screen. The ask is the work of keeping it true: an empty month, the next month back, or a collision. The bank is the short path. Typing still works.

The dashboard keeps that date, then three fixed reports: Spending, Cash ahead, and Holdings. Spending shows this month by category against the plan, and can set a plan when only one bill uses the category. Cash ahead lists the next three months and any found bill that is not on the date yet. A stream the bank already calls recurring is a found bill before a local charge exists. An annual stream is the charge divided by 12, never the full charge as a new monthly bill. Sandbox still does not write those streams onto the household. Holdings lists each balance, the last sync, and the change in recorded net worth. A recorded mark is the mix of balances that month. It is not a market price and not a stored forecast. A merchant rename or tag does not change the plan. Flex buckets, a report builder, a spouse login, live prices, and a credit pull stay out.

## Scenario standard

Liberal = better year (lower costs, higher net worth).
Realistic = central case (default).
Conservative = harder year.

Coherent worlds (line items must add up). Do not mix percentiles across rows.

- Ownership costs: Liberal P25, Realistic P50, Conservative P75 (engine only — never show P-jargon on default UI)
- Variable expenses: −20% / midpoint / +20%
- Home path: stronger / median FHFA / weaker
- Vehicle depreciation: slower / class curve / faster
- Investments: return +2pp / user return / return −2pp (floor 0% for cash-like)

Emergency **recommended** reserve on the Forecast card may still show ownership shocks; the **homepage Emergency Fund hire** uses N-month living, not a second Stay Afloat. Liquid cash only (R6).
UI default is today’s dollars. Nominal is a toggle.

## Screens (amended)

1. Unlock / welcome (Preview, my household, restore backup). Copy does not assume a house.
2. Disclaimer once
3. **Goal pick** (multi-select): Retire early, Debt Free, Emergency Fund, Stay Afloat, If pay stopped, plus **Something else**. FIRE is a blurb on Retire early; Coast/Lean/Fat are flavors of that goal. If the house is the fear, include Stay Afloat — Retire early is when work can stop. Customs add to the board; they do not wipe the others.
4. Onboarding: **take-home pay first** (cadence + optional partner), then tenure + vehicle, then the union of fields the elected goals need. Own / rent / neither. Car yes / no. **Owners are asked paid-off vs mortgage** — do not assume the house is free and clear. Unknowns stay skippable (R2). Missing APR uses a labeled typical, never 0%. House and car are constraints **only when they exist**.
5. **Home:** elected-goals board — each open goal is a card (headline date, progress, reserved vs leftover for that spec). Living card under it (trail, exit, next probe, turnaround). Collision line if leftover is claimed. Next-best is weighted by open goals **and tenure**. Returning users with an unfinished outline (no income, or missing goal facts) go back to onboarding. Cash / Forecast / Risk stay the home. Budget is a tab, not the home.
6. Forecast: Realistic sentence first, then **line-graph** cash/net-worth path + ownership waterfall (401k must not bury the roof)
7. Risk cards with vintage + event timeline
8. Compare: L/R/C **line** paths; optional Advanced fan band; hard-year / better-year overlay paths. Homepage has no time-series chart.
9. Accounts / income / debt-link prompt (improves the books, not a ledger home)
10. This looks wrong — edits the **date/gap** assumptions, not only a cost line
11. Backup as “save,” not a legal gate. AES-GCM file.
12. Sequence lab (debt first vs Retire early), keep/delay/downsize, and the decision lab — what-ifs on these books, not the home. The lab ranks discrete choices: surplus, debt order, cushion size (3, 6, or 12), per-system delay, downsize of this house, a typed lump, a typed benefit age only with a typed check, a typed car replacement, a typed pay change, a typed refinance, and withdrawal order when more than one taxed bucket exists. It does not shop another house, invent a benefit formula, or invent a tax bracket. The fan still does not pick the row. A cited crash stretch uses the GFC-like HPI triple and the macro crash jump already in the seed.
13. Privacy screen (in-app policy).
14. Plaid sandbox / Trial — later, not this wave.

## Usability resolutions (R1–R17)

Must stay implemented. Done-when tests live in the engine and UI.

| ID | Risk | Resolution |
| --- | --- | --- |
| R1 | Onboarding wall | Goal pick (one or more), take-home pay, tenure + car yes/no, then the union of fields those goals need. Everything else is “Improve this plan.” |
| R2 | I don’t know | Not sure on hard fields. Wider range, never block. Income missing means dates stay undated — not a fake number. |
| R3 | Make/model | One search box. Fallback: custom name + class. |
| R4 | Debt twice | Liabilities own payment. “Same bill?” once. |
| R5 | 401k hides house | Homepage is the goals board + reserved vs leftover (cash safety). Full NW is a second tab. |
| R6 | 401k as repair cash | Reserved math = checking/savings/cash only. Emergency Fund uses N-month living, not 401k. |
| R7 | Fan charts | Sentence first. L/R/C control. **Line graphs** on Forecast/Compare. Monte Carlo **fan band** only in Compare → Advanced. Homepage is words + progress, no time-series. No P-jargon on axes. |
| R8 | Inflated dollars | Default today’s dollars. |
| R9 | Stale books | Last-edited. 30-day stale banner. Mark shocks realized. This is pulse, not a weekly ceremony. |
| R10 | Data loss | Encrypted backup after first forecast. No Android Auto Backup claim. |
| R11 | Expo Go | Dev client only. Documented in README. |
| R12 | Demo leak | Preview badge. Real household cannot contain `preview-*` ids. |
| R13 | Fake budgeting | Copy says planner until Plaid. Not a clone envelope app. |
| R14 | Stale tables | Source + vintage on cards. Banner if seed > 18 months. Seed change must invalidate any session memo. |
| R15 | Fake precision | No “exactly / guaranteed / precise.” No P25/P50/P75 on default UI. |
| R16 | Notify spam | ≤1/day. ≤3 all-clears, then silence. |
| R17 | Plaid cost | Sandbox + Trial only. Link failure must not wipe the ledger. |

## Out of scope and later

Catalog: [BACKLOG.md](./BACKLOG.md). Do not add deferred ideas only in this file or in chat.

## Cut order if time slips

Keep: job pick, standing sentence on free home, reserved vs leftover, collision line, looks-wrong on the date, Realistic default, liquid-only reserved, debt-link.
Cut last: Plaid sandbox, Monte Carlo fan, extra account-type polish, Preview restyle, Play Billing.

## Engine API (engineers lock)

- Only mutable book: `HouseholdInput`. Persist `jobClass` (featured), `openGoals` (elected specs), optional `goalSpec` (custom when featured), optional `targetDate`, `housingTenure`, `hasVehicle`, `paycheckCadence`, `partnerMonthlyIncome`, `fireFlavor`. Never persist standing / reserved / leftover.
- Keep `runForecast`. Export `EventHit`. `standing()` reads `GoalSpec` (override via `opts.spec`). `openGoalBoard()` live-evals every elected goal. Reserved uses that spec + tenure, not a single roof formula.
- Collision is a diff of two standing views (base vs shock/quote), not a table. Sequence and Z moves are the same reader on clones. Named overlays are the same walker with a signed driver delta.
- Forbidden on household JSON: Plus, entitlements, Plaid access tokens, `reservedCash` as truth, persisted `ForecastResult`, persisted `EventHit[]`, stored collision month, stored standing sentence. `plaidItems` (item id, institution, sync state) stay on the household so the phone can classify and know whether the link is current. The access token stays on the sidecar.
- `entitlements.ts` stub unlocked. Engine never reads IAP.
- Plaid sidecar: no new routes this wave.
- New user input = registered driver. Do not grow an `if` per feature in the month loop.

## Engine math (quarter)

Coherent L/R/C worlds on one 60-month walker. UI default is today’s dollars (deflate by CPI). Standard P&I amortization. Per-vehicle depreciation. `sqft` scales home maint. Partner pay uses the same cadence. Liquid yield optional (0 if unknown). Other assets: Conservative flat, Liberal modest CPI or user return.

**Signed overlays** (skip when `appliesIf` is false): paycheck gap / raise; rate spike; HPI crash / boom; clustered repairs / delayed replacement; expense shock / lean spend; market run. Homepage stays Realistic.

**Path Monte Carlo** (Compare → Advanced): joint recession/expansion factor, lognormal returns + rare cited jump, HPI mean-reversion toward metro, AR(1) variable expenses ±20%, Weibull-ish repair timing. Report cash expected shortfall, P(cash < 0), P(bill claims leftover), hired-date both tails. No GARCH, copulas, Greeks, live prices.

**GoalSpec:** `amount` | `date` | `debt_zero` | `runway` | `afford`. Reserved: `ownership` | `n_months_living` | `paycheck_year` | `none`. Elected list is `openGoals`. Custom “save a down payment” is liquid amount. Not buy-this-house (O5). Founder 2026-09-08: multiple open goals on first open — O14 reversed.

**Charts:** SVG line graphs in `apps/mobile/src/charts/line-charts.tsx` (cash path, L/R/C lines, fan, overlay). Waterfall stays labeled bars. Screens do not import Skia.

---

# Council record — 2026-09-06

Personas from [claude-council](https://github.com/TorpedoD/claude-council) (copied, not cloned). Serial: Business → Validators → Engineers. Peer review and debate skipped. Founder QAs the current skeleton in parallel.

## 1. Business — customer need

**Charter:** Find and fill customer need inside the current product (ownership-aware planner + requested FIRE/goals). Goal-first. Not MVP cut, not stack.

### Advisors

- **Red Team:** One durable goal sentence (standing + house as constraint + what-if). The 12-gap punch list kills the product. Drop paycheck cadence, nicer ledger, not-advice-as-job.
- **First Principles:** Hire is standing against a chosen date with roof and next car on the path. Sequence what-if is runner-up. Bank link is not first win.
- **Expansionist:** Missed weekly job is reserved vs free cash (“may I use this?”). Also named Y (survive after paycheck death) and Z (keep / delay-replace / downsize).
- **Outsider (SAR):** Brief the subject, not the mountain. Living mission card: one exit, trail, ordered probes, turnaround when the roof wins. “I want FIRE” may mean house-fear.
- **Executor:** Load-bearing: job pick, goal-shaped questions, standing on the *hired* goal, ownership as constraint, free shows standing. Drop cadence/pings/not-advice-as-need. Add honest balances, collision sentence, reopen on hired job.

### Chairmen

**Consensus:** Hand four jobs — hired-job pick → standing sentence; reserved vs free; living card; free must show standing. Drop paycheck, pings, nicer ledger, Preview-as-need, what-if lab.

**Dissent:** Hand one weekly hire — reserved vs free on one hired date. Collapse greeting into that sentence. Name Y and Z so they do not vanish. Goal pick can launder house-fear.

**Dissent ledger:** Five “keeps” is still a punch list; reserved vs free is not an add-on; turnaround when the roof wins; Y/Z must be named.

## 2. Validators — MVP and first $100k

**Charter:** What is mandatory to steal users from clone budget apps and reach first $100k.

### Advisors

- **Red Team:** Paid job is the *conjunction* (hired date + reserved vs free + living standing). FIRE is not the only preset. Fake MVP if those split.
- **First Principles:** People pay to keep the living standing card. Plaid is not the switch. Pulse is stale cash / looks-wrong / shocks, not a weekly calendar.
- **Expansionist:** $12/mo Plus prices the wrong object. Collision SKU: standing stays free; charge when leftover is claimed. Steal at first-repair / car-due, not from YNAB. Lifetime local license is how they pay.
- **Outsider (ER):** Discharge line, not MRI. Price the ritual, not the ledger. If free hides standing, you hid the vital sign.
- **Executor:** MVP = job pick, standing, reserved vs free, collision line, free shows standing. $100k pipe = Play listing + Play Billing after the sentence is screenshot-able. Later: bank, Y, Z, vault, iOS.

### Chairmen

**Consensus:** Standing stays free. Paid is living loop + collision claims. Plus must not hide standing. Play Billing after the sentence exists. Steal at first-repair / car-due.

**Dissent:** Charge the collision packet, not $12 Plus. Weekly ceremony is fake MVP. Living means recompute on edit, not a static sentence and not a Monday ritual. Play Billing is pipe, not offer.

**Dissent ledger:** Collision SKU vs Plus; conjunction is the product not the SKU; weekly permission as paid habit is wrong; collapsing living to a static sentence is a wizard.

**SKU status:** not locked. Do not bake either SKU into schema.

## 3. Engineers — stack and volume

**Charter:** Compatible architecture that ships fast and works at 1 or 100k devices.

### Advisors

- **Outsider (spreadsheet):** SQLite is cells; engine is the formula graph; standing is a named eval. Billing is a watermark on the glass. If cache disagrees with live eval, cache is wrong.
- **Expansionist:** Projection kernel on existing `runForecast`. Export `EventHit`. Pure readers for standing / reserved-free / collision. Optional versioned cache.
- **Red Team:** Keep the stack. No persisted forecast. `jobClass` as seed key. Plus/Plaid not on household JSON.
- **Executor:** Keep Expo. Add goal + reservedCash; extract `standing()`; freeze Plaid; stub entitlements. SQLCipher after R1–R17. No Next.js. Volume = independent engines.
- **First Principles:** Scale is N copies of one household machine. Entitlement never on household JSON. Collision is a diff of two standing views.

### Chairmen

**Consensus:** Live eval is only truth. Persist `jobClass` + optional targetDate. Derive reserved. Export `EventHit`. Add `standing()`. Session memo optional if it matches live. SQLCipher after device QA.

**Dissent:** NO-GO on versioned standing cache and persisted `reservedCash`. Persist `jobClass`, not a bare goal number. Export `EventHit` so collision is a reader.

**Dissent ledger:** Cache misses seed vintage; stored reserved lies when shocks move; bare `goal:number` is a second FIRE calculator; EventHit export is required.

---

# Council record — 2026-09-07

Personas from [claude-council](https://github.com/TorpedoD/claude-council) (copied, not cloned). Standard advisors + dual chair. Peer review and debate skipped (same as 2026-09-06). Charter: audit intro path + four hires; founder titles; minimum outline then live refine; stop assuming a house (rent etc.).

## Advisors

- **Red Team:** Option 2 (rent field on today’s `standing()`) fails — collect rent, still reserve a roof. Stay Afloat cannot mean Z and Y. Lock the first screenshot to one owner hire the walker can tell the truth about. Y is a later hire with its own reserved.
- **First Principles:** Strongest is rename + tenure fork. Tenure decides whether ownership shocks exist; the hire names which date is tested. Skip-house today invents averages, not a renter. Owner-only is runner-up. Rename-only fails. Founder titles already invited the renter.
- **Expansionist:** Options 1–3 keep one reserved formula. Dominant missed option: **reserved-by-hire**. Emergency Fund = N-month living (or a stated number). Stay Afloat = shocks if own, rent runway if rent. Twin cash jobs sharing a formula is why rename-only is comic.
- **Outsider (SAR intake):** First questions must match actual terrain or they hang up. Sketch the date from pay, spend, and the one obligation they name. House/car/ZIP are later sightings. Use the founder’s words on the pick.
- **Executor:** OODA Decide. RICE: rename-only 14; owner-only 13; D (rename + `intakeGap`-only first screen + stop scoring skipped house; owner gate; no tenure column) 11; full tenure fork 2. Recommends D this week. Blocked on Pixel screenshot + owner-only vs tenure call.

## Chairmen

**Consensus:** Reject rename-only and permanent owner-only. Adopt option 2 **with reserved-by-hire as a load-bearing amendment**. Act 1: founder titles; first screen pay/spend/named obligation; stop scoring skipped house; Stay Afloat is Z, Y stays later. Act 2: tenure that changes reserved (own → shocks; rent → rent, not HVAC). Do not add a rent field until reserved can mean rent.

**Dissent:** **NO-GO on Option 2** as this week’s Act. GO on Executor D this week. Destination is reserved-by-hire, not owner-only forever. Stay Afloat stays Z. Emergency Fund ≠ Stay Afloat formula. Do not add rent/own to `standing()` until reserved is redefined per hire.

## Dissent ledger

- DISSENT PRESERVED: Collecting rent while reserved is still a roof is the kill — Red Team + Expansionist. Consensus kept option 2 only if reserved changes; Dissent refused option 2 as the Act.
- DISSENT PRESERVED: Stay Afloat must not mean paycheck-death (Y) — Red Team. Y remains L4.
- DISSENT PRESERVED: Twin cash jobs sharing one reserved formula is why new titles stay comic — Expansionist.
- DISSENT PRESERVED: A1 has no Pixel screenshot; a five-week tenure rewrite before a true owner sentence is how the last QA failed twice — Executor.
- NOTE: Chairman-Dissent recommends D this week + reserved-by-hire as destination. Chairman-Consensus recommends option 2 as the decision, phased. **This build implements Consensus Act 1 plus the reserved-by-hire amendment both chairs called load-bearing** (titles, tenure, Emergency Fund ≠ Stay Afloat, rent changes reserved). Owner-only is a Preview costume, not product identity.

## In-scope work

Tickets: [WORK.md](./WORK.md). Deferred: [BACKLOG.md](./BACKLOG.md).
