# Asset Aware — complaint buildout

Build order for the complaints that are still this product. Checked 2026-09-27 against public reviews and help docs from Mint’s aftermath, YNAB, Monarch, Copilot, Simplifi, Rocket Money, Empower, ProjectionLab, Boldin, and Actual Budget.

**Catalog:** [BACKLOG.md](./BACKLOG.md) rows Q01–Q05  
**In-scope MVP:** [WORK.md](./WORK.md) — do not move these rows there  
**Scored table:** the finance-app-complaints canvas

People leave these apps when the link lies, the same dollar is counted twice, or leftover cash is not actually free. Transfers, card payments, and a card paid off every month are already kept out of a second living expense. Reserved versus leftover is the home sentence. This file is the trust work. How much of a household’s money the books hold follows the coverage rule in [BACKLOG.md](./BACKLOG.md).

Do the tickets in order. A later ticket does not start because an earlier one is unpleasant.

---

## Already in code

Do not rebuild these. A complaint that matches a row here is a device-QA miss or a copy miss, not a new screen.

| Complaint | Where it already lives |
| --- | --- |
| A card payment or transfer looks like spending | `classifyTransaction` in `packages/forecast-engine/src/budget.ts`. Fuel, insurance, HOA, repairs, and loan payments stay `already_counted`. |
| A card paid off every month becomes lifelong debt | Consumer-gap tests: a card paid monthly is not amortized as a long loan. |
| Merchant fixes disappear on disconnect | Rules, renames, splits, ignores, and tags stay on the household. `forgetPlaidItem` drops the institution and keeps the books. |
| The mortgage is both a loan and a living bill | Same-bill prompt. Escrow is split from principal and interest. |
| Setup eats the trial before a date exists | Job pick, take-home pay, tenure. The bank is the short path later. Typing still dates the plan. |
| Leftover cash might not be free | `standing()` reserved versus leftover. Liquid only. Track A in WORK.md is the phone pass of that sentence. |

---

## Q01 — A failed link stays the last good sync

**Backlog:** P2, P3.  
**Status:** open.

**Failure.** Dashboards die when a bank goes dark and the month becomes zero. Sandbox is still forbidden from writing the real household. The Android link is not the daily path.

**Target.** Trial sync in the Android dev client writes balances and this month’s classified spend onto the household. A failed sync, a dead login, and a stale link leave balances, ledger rows, expenses, and the hired date. The screen says the bank needs a refresh. Missing transactions are unknown, not zero spending.

**Done when.**

- A trial Item updates the real household. Sandbox still cannot.
- Killing the sidecar mid-sync leaves the previous books.
- The budget and holdings screens say the link is stale after 30 days, and they do not show zeros for the gap.
- Link failure does not wipe the ledger.

**Files.** `apps/mobile/src/app/plaid.tsx`, `apps/mobile/src/plaid/sync-on-open.tsx`, `apps/mobile/src/app/(tabs)/budget.tsx`, `packages/forecast-engine/src/budget.ts`.

**Not this ticket.** A store listing. A dollar price. Paid Production (O11). New sidecar routes beyond the sync that already returns recurring streams.

---

## Q02 — A typed charge and the later bank row are one spend

**Status:** open. Engine work. Can start before Q01 is on a device. Must not change sandbox behavior.

**Failure.** Pending is replaced when the posted charge arrives. A charge the user typed, and a later bank row with a different id, both stay in the month. Category spent doubles. Liquid Budget and Simplifi users hit this same miss.

**Target.** On a non-sandbox sync, a new bank spend matches one typed spend when the merchant key matches, the amounts are within the same closeness rule as recurring detection, and the dates are within 3 days in the open month. Keep the typed row’s category, review flag, split, and merchant name. Drop the bank duplicate. Two bank rows that are both real charges stay two rows. A transfer or a card payment does not match a living spend.

**Done when.** A test types $6 at a merchant, syncs a bank row of $6 at that merchant two days later, and `categorySpent` is $6. A test with two different bank charges of the same amount keeps both. Sandbox sync still leaves the household byte-for-byte unchanged.

**Files.** `packages/forecast-engine/src/budget.ts`, `packages/forecast-engine/src/budget.test.ts`.

**Not this ticket.** A fuzzy payee that ignores the merchant. Matching across months. Editing a pending row in a way that blocks the posted replacement. That replacement already exists.

---

## Q03 — A plain export if this app disappears

**Status:** open.

**Failure.** Mint shut down on 23 March 2024 and the history went with it. The AES-256-GCM backup restores this household into this app. It is not a file a spreadsheet can open. Forgetting the PIN with no other copy still loses the household. That sentence stays true.

**Target.** From Backup, write a plain UTF-8 file of the books: accounts, assets, expenses, ledger rows, and the elected goals. No access token, no PIN, no entitlement, no standing sentence, no reserved cash. The encrypted backup remains the restore path. The plain file is the leave path.

**Done when.** Export, open the file as text, and the balances and expense amounts match the household on screen. The file does not contain `plaid` access material. Restore-from-plain-file is not required for this ticket.

**Files.** `apps/mobile/src/app/backup.tsx`, a small serializer next to the vault code. Round-trip of the encrypted backup stays as it is.

**Not this ticket.** A second importer. CSV of every forecast month. Cloud sync.

---

## Q04 — The SQLite file is encrypted at rest

**Backlog:** P1.  
**Status:** in code, not proved on a device. The native build turns SQLCipher on. A release build that cannot encrypt the file does not open. A dev build that cannot may seal each value instead.

**Failure.** People who left Mint and Empower over data handling will notice if a release build is still storing a readable database file.

**Target.** The database file is SQLCipher. Books, PIN, and the hired date survive export, wipe, and import.

**Done when.** The database file is encrypted. Wipe the app, import the encrypted backup, and the household and seed vintage match. Standing is still computed, not stored.

**Files.** `apps/mobile` database client. Do not put the vault key in household JSON.

**Not this ticket.** A cloud copy of the database. Encrypting the plain export from Q03. That file is intentionally readable.

---

## Q05 — A store build before anyone is asked to pay

**Backlog:** D1, U1, U2.  
**Status:** later. Starts after Q01, because a listing of a link that cannot write the household repeats the “I paid before I trusted it” complaint.

**Failure.** YNAB’s price climbed to about $109 a year while the product stalled. Monarch’s 7-day trial is spent on setup. Copilot is still described as Apple-only. This app has no store listing, and the bank-link price is unset on purpose.

**Target.** A real EAS project, an Android app bundle, and a hosted privacy policy. The screenshot is the standing sentence, reserved versus leftover, on a household the trial link has updated. iOS waits on an Apple Developer account (P4).

**Done when.** The bundle exists. The privacy policy URL exists. The price field in the product is still blank until the Plaid per-Item fee is known. Standing is not behind the paywall. Entitlement stays out of household JSON. Play Billing stays U2 until that price exists.

**Not this ticket.** Inventing a dollar amount. Paid Plaid Production (O11). Hiding, blurring, or trial-locking the homepage sentence.

---

## Partly done — no new job

| Complaint | Decision |
| --- | --- |
| Can I spend this? | Track A walks the standing sentence on the emulator. No second “safe to spend” number. |
| An annual bill or a repair surprises people | House and car chance stay on the path. A repeating merchant or a bank stream can be added as a bill. An annual stream is the charge divided by 12. Do not invent a bill that has no history. |
| Two calculators disagree | Looks-wrong edits this date. Do not import another product’s assumptions. |
| Free apps sell the data or the advisory call | Books stay on the phone. Standing stays free. Q04 is the remaining hole. There is no advisory upsell to remove. |

---

## Left out

Do not staff. Point at [BACKLOG.md](./BACKLOG.md).

| Complaint people will still make | Decision |
| --- | --- |
| Two logins on one set of books | O2. Partner pay is a second paycheck. |
| Cancel the subscription or negotiate the bill | Not this product. Rocket Money keeps 35% to 60% of the first-year savings. A found bill can be added to the date. Nobody calls the merchant. |
| Live performance and Morningstar | P5. A ticker is a label. There is no live price. A brokerage tax lot is a basis, a date, and a price the user types. |
| Envelopes as the home | O1. Category plans are allowed. The home stays the hired date. |
| A chat that explains the month | O7. Looks-wrong and the one-month spending comparison are the explanation. |
| A credit score | A credit pull stays out. |
