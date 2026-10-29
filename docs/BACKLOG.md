# Asset Aware — backlog

Single catalog of work that is **not MVP**. If an idea is not already a ticket in [WORK.md](./WORK.md) and not here, add it here the same turn it appears.

**In-scope tickets:** [WORK.md](./WORK.md)  
**Complaint build order:** [BUILDOUT.md](./BUILDOUT.md) (Q01–Q05)

Statuses:

- `later` — viable after MVP standing ships; still this product
- `unresolved` — decision required before staffing
- `out-of-scope` — not this product; do not staff
- `cut` — considered and rejected as a first-class job

When you promote an item into the current build, move the ticket into [WORK.md](./WORK.md) and mark it `promoted` here with a date.

**Coverage, 2026-09-29.** The founder wants market share, so the books are semi-exhaustive of one household’s finances. A missing fact that changes the hired date or leftover is this product. Rows under Out of scope stay other businesses until promoted.

---

## Unresolved

| ID | Item | Why it waits | Notes |
| --- | --- | --- | --- |
| U1 | Paid SKU | decided 2026-09-26 | Annual “keep the date current” plan, capped at two institutions. Monthly is the other way to pay. No dollar amount until Plaid’s per-Item fee is known. Standing stays free. Entitlement stays out of household JSON. Not a lifetime license. |
| U2 | Play Billing vs license-in-backup | Local-first has no cloud account | Pipe only. Entitlement never on household JSON. |
| U3 | Job mix evidence | FIRE vs house-fear vs buffer as the real hire | Copy on pick: house-fear → Stay Afloat. Still watch whether people hire Retire early for the roof. |
| U4 | Offer fit | Founder 2026-10-03. Council and audit the same day. Pending Plaid | What-if on debts and contracts already on the books, through the Decide clone, ranked like `compareRank`. Phase 1 is typed terms plus promo-end, forgiveness refusal, and pay-down-beats-fee. A rate passes only if typed or confirmed from Plaid or the import. Overdue debts never match. Phase 2 is one posted card link, then issuer prequalification. It waits on the store listing (founder 2026-10-03), counsel, Plaid written approval, and the affiliate contract. Typed home-equity comparison allowed, never linked. No repair-as-new-debt, no mortgage or student link, no offers SKU. Plan: [offers/IMPLEMENTATION.md](./offers/IMPLEMENTATION.md) track OF. Spec and council: [offers/SCOPE.md](./offers/SCOPE.md). Draft addendum: [legal/offers.md](./legal/offers.md). |
| U5 | Soft-pull debt import | Founder 2026-10-03. Pending P10 | Opt-in import of debts reported in the user’s name, through a bureau vendor. Each row is a proposal they accept. Fills auto, personal, buy-now-pay-later, collections, and unlinked debts. Not a score, not monitoring, not credit repair, never a separate price. Included in the bank-link plan with a yearly pull cap. Vendor: Method, Spinwheel as fallback. Never sent to issuers, including for prequalification. Sidecar holds no identity after the session. Blocked on FTC Safeguards program, privacy rewrite, FCRA review, signed vendor. Plan: [offers/IMPLEMENTATION.md](./offers/IMPLEMENTATION.md) track SP. |

---

## Later — product (after standing)

These are the deferred FIRE / goal extras. They sit on the same household books as MVP.

| ID | Item | Source | Notes |
| --- | --- | --- | --- |
| L1 | Standing on more than one hired job at once | Business / Validators | promoted 2026-09-08 — elected `openGoals` board on home |
| L2 | Sequence what-if lab (“debt first vs FIRE first”) | Business | promoted 2026-09-07 — `/sequence` |
| L3 | Paycheck cadence (weekly / biweekly / semimonthly) | Business drop as *need*; still viable | promoted 2026-09-07 |
| L4 | Survive as owner after paycheck dies (Y) | Expansionist | promoted 2026-09-07 — hire `survive_paycheck` / If pay stopped |
| L5 | Keep / delay-replace / downsize to move the date (Z) | Expansionist | promoted 2026-09-07 — `/moves` on this house only |
| L6 | Coast / Lean / Fat FIRE variants | Early goals plan | promoted 2026-09-07 — `fireFlavor` |
| L7 | Reopen / living-card briefing beyond the homepage sentence | Validators | promoted 2026-09-07 — trail/exit/probe/turnaround |
| L8 | Preview as a goal costume | Business | promoted 2026-09-07 — preview badge names the hire |
| L9 | Goal-language notifications | Business drop as need | promoted 2026-09-07 — pulse names the hire |
| L10 | Accounts UX as “improve this job” polish | Business | promoted 2026-09-07 |
| L11 | Next-best-question weighted by jobClass | R1 | promoted 2026-09-07 — cadence/partner probes; fuller ranking later |
| L12 | Partner income as second stream (no spouse login) | Validators later | promoted 2026-09-07 — `partnerMonthlyIncome` |
| L13 | Decision lab ranker | Founder 2026-09-29 | promoted 2026-09-29 — `/decide`. Discrete clones ranked by the featured hired month, then rechecked on harder years. Fan does not pick the row. |

---

## Later — distribution and money

| ID | Item | Source | Notes |
| --- | --- | --- | --- |
| D1 | Play Store listing of the standing sentence | Validators | Blocked on screenshot-able standing. |
| D2 | Play Billing module | Engineers | Pipe is in the app (`expo-iap`). Price comes from Play products `bank_link_annual` and `bank_link_monthly`. Standing stays free. The bank link locks only after Play returns a price and this phone has no plan. |
| D3 | Steal-at-the-event GTM (first-repair, car-due, house-then-FIRE) | Validators Expansionist | Not “another budget app.” |
| D4 | EAS init / store AAB | store | Required for iOS from Windows. |
| D5 | Privacy policy / store launch legal | PLAN | promoted 2026-09-07 — in-app `/privacy`; hosted URL still later |

---

## Later — platform and data

| ID | Item | Source | Notes |
| --- | --- | --- | --- |
| P1 | Prove vault restore on a device | device | SQLCipher is on in the native build. Release builds fail closed without it. Backup files are scrypt AES-256-GCM. XOR and PBKDF2 files open only through Import old backup. Remaining: export, wipe, and import on a device. |
| P2 | Plaid Link in the Android dev client | device | In progress with the budget slice. Sandbox cannot write the real household. Link failure must not wipe the ledger. Rebuild the dev client so the Link SDK is in the binary. |
| P3 | Plaid Trial (≤10 Items), founder then maybe household | PLAN R17 | Current live-bank step. Trial uses the production host. Paid Production is the rollout step (O11), after the per-Item fee is read. |
| P4 | iOS via EAS | store | Apple Developer account. |
| P5 | Tickers / live prices | product | Ticker *label* promoted 2026-09-07. Tax lots the user types promoted 2026-09-29. No live price feed. |
| P6 | Paid TCO / shop-quote APIs | SOURCES | After the product earns it. |
| P7 | Seed refresh / ETL on a schedule | PLAN | 18-month banner is R14 now. |
| P8 | Monte Carlo fan polish (Victory/Skia) | PLAN | promoted 2026-09-07 — sparkline. **promoted 2026-09-07 (quarter)** — Victory Native + Skia path/fan/waterfall/timeline. Fan band still Compare → Advanced. |
| P9 | Signed overlay pack (hard year + better year) | Quarter engine | promoted 2026-09-07 — paycheck gap/raise, HPI crash/boom, clustered/delayed repairs, expense shock/lean, rate spike, market run |
| P10 | Plaid Liabilities | Offer-fit audit 2026-10-03 | Sidecar requests only transactions today. Liabilities adds card APR buckets, minimums, overdue flags, student plan type, mortgage rate type and flags. Not auto or personal loans. Proposals the user confirms; a sync never overwrites a typed value. Sidecar drops addresses and account numbers. After P2 and P3; check Trial includes it; read its fee before O11. Plan: [offers/IMPLEMENTATION.md](./offers/IMPLEMENTATION.md) track PL. |

---

## Later — complaint buildout (2026-09-27)

Sequence and done-whens are in [BUILDOUT.md](./BUILDOUT.md). Do them in order. They are not MVP tickets in [WORK.md](./WORK.md).

| ID | Item | Notes |
| --- | --- | --- |
| Q01 | A failed link stays the last good sync | Points at P2 and P3. Sandbox still cannot write the real household. |
| Q02 | A typed charge and the later bank row are one spend | New. Pending-to-posted replacement already exists. |
| Q03 | Plain spreadsheet export | New. The encrypted backup stays the restore path. |
| Q04 | SQLite encrypted at rest | Points at P1. After Q03. |
| Q05 | Store listing before a price | Points at D1 and U1. Price stays unset until the Plaid per-Item fee is known. |

Bill negotiation, a second login, live prices, an envelope home, a chat assistant, and a credit pull stay in Out of scope. They are not Q tickets.

---

## Out of scope

Do not staff. If a request matches one of these, point here instead of adding a screen. A household fact that changes the date or leftover is in bounds, including when it was absent from the original MVP list.

| ID | Item | Why |
| --- | --- | --- |
| O1 | Envelopes as the product | Category budgets are allowed (2026-09-26). Envelope aging, “give every dollar a job” as the home screen, and coffee-as-the-product stay out. Home is still the hired date. |
| O2 | Spouse login / second household identity | One household, US ZIP. |
| O3 | Tax return | A brokerage lot and a sale quote are in. A return, wash sales, state tax, and the 3.8% investment-income tax are not. |
| O4 | Insurance shopping | Shop quotes. |
| O5 | Buy-this-house vs that house | Z is keep/delay/downsize on *this* house only. |
| O6 | Web app as product | Web preview is localStorage only. |
| O7 | LLM / receipts / OCR | Original thesis week-7; still out. |
| O8 | Non-USD | Later national USD is not this either. |
| O9 | Next.js + cloud household ledger | Thesis stack superseded. |
| O10 | FinAtlas source | Proprietary. |
| O11 | Paid Plaid Production | Rollout step. Trial is the current live-bank step. Read the per-Item fee before applying. |
| O12 | Weekly permission ceremony as the paid object | Validators dissent: fake MVP. Pulse is R9. |
| O13 | Persisted standing cache / `reservedCash` as books | Engineers NO-GO. Live eval only. |
| O14 | Four-goal scoreboard on first open | promoted 2026-09-08 — elected goals board on home; not a fake four-preset dump |

---

## How to add an idea

1. Check [WORK.md](./WORK.md) (is it already a ticket?).
2. If not, add a row here with `later`, `unresolved`, or `out-of-scope`.
3. Do not invent a new status. Do not hide items only in chat.
