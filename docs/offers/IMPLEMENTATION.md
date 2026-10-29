# Debt data and offer fit — implementation plan

Written 2026-10-03. **Backlog only. Pending Plaid.** Nothing here is part of the shipped planner. Backlog rows: P10, U4, U5 in [BACKLOG.md](../BACKLOG.md).

This plan joins three pieces that were discussed separately the same day:

- [Offer fit scope and council](./SCOPE.md) — compare a debt already on the books with typed or posted credit terms.
- The soft-pull credit-profile chat — an opt-in import of debts reported in the user’s name.
- Plaid Liabilities — the product the sidecar does not request yet, and the one both of the above depend on.

The draft legal text is [legal/offers.md](../legal/offers.md). None of this is a legal opinion. Counsel signs the gates in “Legal and policy” before anything ships that touches a lender, an issuer, or a bureau.

---

## 1. Audit

### Offer-fit scope

| Finding | Effect | Fix in this plan |
| --- | --- | --- |
| Every offer gate required a user-typed APR. Plaid Liabilities returns card, student-loan, and mortgage rates. | After Plaid, a linked user who never typed a rate would never be matched, even though the bank reported it. | Provenance on each rate (PL3). A Plaid rate the user confirmed passes the gate. The labeled typical rate still never does. |
| Phase 2 waited on Plaid confirming “matching does not use End User Data.” | Once rates come from Plaid, that confirmation cannot be true. | Phase 2 waits on Plaid **approving the use case in writing**, plus an express-consent screen before offers. Plaid’s terms allow marketing on its data only with express consent or a written approval. |
| One APR and one promo per card. | A card with a purchase balance and a transfer balance at different rates is forecast wrong, and a transfer offer is scored against the wrong number. | APR buckets on cards (PL4). |
| No overdue or hardship rule. | Plaid reports `is_overdue` and `past_due_amount`. A balance-transfer pitch to someone already late is likely denied and likely harmful. | Overdue debts are never an offer source (ethics table). |
| “A credit limit is not collected.” | Plaid account balances include `limit` on credit accounts. | The limit is mapped on the sidecar and dropped before the phone. It is not stored and is not a target until a use is promoted. |
| Forgiveness guard read only `forgivenessAt` the user typed. | Plaid’s public-service forgiveness fields (`pslf_status`) are no longer populated. The repayment plan type still is. | Income-driven plan types also trigger the forgiveness refusal (PL6). Do not read `pslf_status`. |
| Mortgage refinance case had no prepayment penalty or mortgage-insurance input. | `has_prepayment_penalty` and `has_pmi` arrive from Plaid as booleans. | Penalty must be typed before a refinance scores (PL7). Mortgage insurance ending at 80% of the home value is a free planning case (ethics table). |
| A personal-loan link was treated as a state-law question only. | Google Play treats lead generators and lender connectors as personal-loan apps: Finance category, a lending-partner declaration, max APR under 36% in the US, repayment-period and cost disclosures on the listing. | Play declaration is a gate on any personal-loan link (OF4). Cards, auto, mortgage, and student loans sit outside Google’s personal-loan definition. |

### Soft-pull credit-profile chat

| What the chat said | Correction | Fix in this plan |
| --- | --- | --- |
| The rate is usually missing, so most rates stay typed. | True of raw bureau tradelines. Debt vendors refresh balance, APR, due date, and minimum directly from many institutions, and Plaid Liabilities covers cards, student loans, and mortgages. | The soft pull’s own value is debts the user never linked, and the loan types Plaid does not cover: auto, personal, buy-now-pay-later, collections. |
| Ranking an offer from the file is an adverse action. | Overstated. Whether a planner that hides an offer is taking an adverse action is a counsel question. The real limits are the purpose the user authorized, the vendor contract, and the accuracy of any approval claim. | The product rule stays: the file does not rank offers or feed prequalification. Prequalification uses the issuer’s own check (OF2b). |
| The vendor screen might collect the identifier so the app never sees it. | Vendors require a verified person before the pull: phone, name, date of birth, address, and often a Social Security number. | Vendor-hosted identity capture is a selection criterion (SP0). If none is available, the sidecar passes identity through in transit and stores none of it. |
| Data security was framed as bureau contract terms. | A planner that holds bank and credit data is very likely a financial institution under the FTC Safeguards Rule. That means a written security program, a named owner, risk assessment, encryption, multi-factor access to the sidecar, and an FTC notice within 30 days of a breach touching 500 or more people. | Safeguards program is a gate before Plaid Production, not only before the soft pull (LG1). |
| Bundle the import into the bank-link plan, if counsel agrees. | Still the right shape. Missing: the pull has a per-call vendor cost, and Plaid Liabilities has its own fee. | Both feed the unset bank-link price (PR1). |
| Collections and closed accounts stay off unless the user adds them. | Kept. Missing: the same rule for medical debt and buy-now-pay-later, and that none of them can recruit an offer. | Sensitive rows and the never-target list in the ethics table. |

---

## 2. Data sources

What each source can put on the books, after the user confirms it.

| Field | Typed | Plaid Transactions (today) | Plaid Liabilities | Soft-pull vendor |
| --- | --- | --- | --- | --- |
| Card balance | Yes | Current balance | Last statement balance too | Reported, often weeks old; refresh where supported |
| Card APRs by bucket | One APR and one promo | No | Purchase, transfer, cash, and special, with the balance under each | Where the vendor can refresh from the issuer |
| Promo end date | Yes | No | No | No |
| Card minimum and due date | Minimum | No | Yes | Where refreshable |
| Paid in full each month | Yes | Inferred from payments | Last statement balance and last payment | No |
| Credit limit | No | In balances | In balances | Yes |
| Student rate, repayment plan | Yes | No | Rate, plan type, servicer, expected payoff | Rate where refreshable |
| Mortgage rate and type | Yes | No | Rate, fixed or variable, escrow, insurance flag, prepayment flag, maturity | Balance, rate where refreshable |
| Auto loan | Yes | Payments only | **Not covered** | Yes, plus payoff quote with some vendors |
| Personal loan, buy-now-pay-later | Yes | Payments only | **Not covered** | Yes |
| Collections, medical | Yes | No | No | Yes |
| Overdue | No | No | `is_overdue`, past-due amount | Status |
| Street address, account number | Never | — | Returned. **Dropped on the sidecar.** | Returned. **Dropped on the sidecar.** |

The bank link stays the first source. A soft pull fills what is left. Typing still works for everything.

---

## 3. Tracks

IDs are local to this plan. Each ticket says what it is blocked by. Do them in track order unless a ticket says otherwise.

### Track PL — Plaid Liabilities

Blocked by: P2 (Link in the dev client) and P3 (Trial). Check that Trial includes Liabilities before PL1. Read Liabilities pricing before O11.

| ID | Work | Done when |
| --- | --- | --- |
| PL1 | Sidecar requests Liabilities on new links without blocking institutions that do not support it. Confirm the Link parameter for optional products in Plaid’s docs when this is built. Existing Items get Liabilities through update mode, with the user’s consent. New `POST /liabilities` returns a whitelisted map per account: APR buckets, minimum, next due date, last statement balance, last payment, overdue flag, past-due amount, student rate and plan type, mortgage rate, rate type, escrow, insurance flag, prepayment flag, maturity. | Sandbox Item returns the map. Property address, servicer address, account number, and payment reference number are not in the response. A test fails if they appear. |
| PL2 | Phone shows Plaid liability fields as proposals on the matching account. “Your bank reports 24.9%.” Accept writes the field. Skip leaves the typed value. A typed value is never overwritten by a sync. | A sync with a different rate does not change a typed rate. Accept changes it and the hired date moves. |
| PL3 | Provenance on rates and balances: `aprSource: 'typed' \| 'plaid' \| 'bureau'`, `aprAsOf`. A missing rate stays null and the forecast keeps its labeled typical. | Migration is additive. Old books read as typed. `liabilityApr` is unchanged. |
| PL4 | APR buckets on cards. `aprBuckets: { kind, apr, balance }[]` when the issuer reports more than one. The walker accrues each bucket and sends payments above the minimum to the highest rate first, the way the federal card rules require. | A card with $1,000 at 0% and $4,000 at 25% accrues on the $4,000 only. Extra payment reduces the 25% bucket first. Single-rate cards walk exactly as today. |
| PL5 | Paid-in-full proposal: when the last payment covered the last statement balance for the recent statements available, propose `paid_monthly`. The user confirms. | No silent switch. A confirmed switch stops interest accrual on that card. |
| PL6 | Student plan type. An income-driven plan proposes the forgiveness question on that loan. `pslf_status` is ignored. | A loan on an income-driven plan cannot accept replacement terms until the user answers. |
| PL7 | Mortgage. A variable rate proposes the reset fields the walker already has. A prepayment flag requires a typed penalty before a refinance scores. The insurance flag proposes a monthly insurance amount field. | Variable-rate mortgage prompts once. Refinance with the flag and no penalty returns “type the penalty first.” |
| PL8 | Overdue. `is_overdue` is stored as a flag on the account, outside the forecast. | Offer gate reads it. Forecast does not change. |
| PL9 | Cadence. Liabilities refresh with the same on-open sync. No extra polling. A failed liabilities call leaves the last confirmed values. | Liabilities failure does not block transactions sync and does not wipe a field. |

### Track OF — Offer fit

Spec: [SCOPE.md](./SCOPE.md). This track only changes the gates and adds what the audit found.

| ID | Work | Blocked by | Done when |
| --- | --- | --- | --- |
| OF1 | Phase 1 as scoped: typed terms on the Decide clone, promo-ending reader, forgiveness refusal, pay-down-beats-fee, auto, adjustable mortgage, lease end, confirmed consolidation. **Gate change:** a rate passes if typed, or Plaid-sourced and confirmed. | PL3 for the gate change. Phase 1 can ship on typed rates before Plaid. | Tests in SCOPE.md, plus: a confirmed Plaid rate matches; an unconfirmed Plaid rate does not; the labeled typical never does; an overdue debt never does. |
| OF1a | Free planning readers that need Plaid fields: mortgage insurance near 80% of home value (FHFA path against balance), promo bucket ending, minimum-only payoff month on each card. No link. | PL4, PL7 | Each reader names a month and a dollar amount and has no button. |
| OF2 | Phase 2: dated public card catalog, express-consent screen, ask-once, one link per revolving card. | Counsel on the addendum, privacy text, LG1, LG3 (Plaid written approval), LG4 (affiliate contract), founder ruling on the Validators dissent. | Tests in SCOPE.md. Consent off means no catalog evaluation at all on the phone. |
| OF2b | Prequalification through the issuer’s or affiliate network’s own program. With a separate consent, the user enters identity on the issuer’s or network’s hosted form. The issuer runs its own soft check and returns the offers and terms it would likely approve. The phone ranks those by the hired month. “Prequalified” is the issuer’s word, shown with “not a guarantee.” The app never computes approval odds, and the debt import is never sent. If a network only offers an API that takes identity from us, the sidecar passes it in transit and stores none of it, the same rule as SP1. | OF2, a network or issuer with a prequalification program in the affiliate contract, counsel on the consent text. | Declining prequalification leaves OF2 working. A prequalified offer that loses on the hired month is still not linked. The import’s data never appears in a prequalification request. |
| OF3 | Payout join: click id, offer id, time. | OF2, LG4 | As in SCOPE.md. |
| OF4 | Auto refinance link. Personal-loan consolidation link only after the Play declaration. | LG5 (state broker review), LG6 (Play financial-features declaration for any personal-loan link) | Store listing shows the maximum APR, the repayment range, and a cost example before the first personal-loan link renders. Nothing above 36% renders. |
| OF5 | Rewards. Still parked. | Zero revolving debt and a cited earn rate. | — |

### Track SP — Soft-pull debt import

Opt-in import of debts reported in the user’s name. It finds debts. It does not build the profile, score anyone, or fix a credit file.

Blocked by: PL complete, so the import can dedupe against linked accounts; LG1; LG2; counsel.

| ID | Work | Done when |
| --- | --- | --- |
| SP0 | Vendor. **Decided 2026-10-03: Method first, Spinwheel as the fallback.** The usual pattern is one aggregator for accounts the user links (Plaid) and one debt-discovery vendor for everything else, not a vendor per loan type. Method’s discovery covers every type Plaid misses (auto, personal, buy-now-pay-later, home-equity lines, collections) and refreshes rate and minimum from many lenders. Spinwheel is the same shape. Array is a credit-score and monitoring product, which this track excludes. Before signing, confirm: vendor-hosted identity and consent screen, or transit-only identity; written-instructions consent language the vendor stands behind; contract allows debt discovery for planning; per-pull price; raw report off by default; deletion on request; no resale of our users. If Method fails one of those, run the same check on Spinwheel. | Checklist passed and an order form signed. |
| SP1 | Sidecar endpoint. Starts the vendor session, receives the account list, strips account numbers and addresses, returns proposals to the phone. Stores only: vendor person id, consent text version, consent time. Holds no identity after the session. | A test fails if a name, date of birth, Social Security number, or address is written to disk on the sidecar. |
| SP2 | Phone review list. Each row: creditor, type, reported balance and its date, open or closed, rate when the vendor refreshed it. Accept, skip, or “same as this account.” Dedupe proposes a match on creditor and type against typed and Plaid accounts. | Nothing writes the books without a tap. Accepting a duplicate is refused with the match named. |
| SP3 | Sensitive rows. Closed accounts, collections, medical debt, and buy-now-pay-later sit in a collapsed section. They can be added. They never recruit an offer. | Offer gate test: a debt imported from a collection or medical row never matches. |
| SP4 | Deletion. Raw report never requested. Vendor person deleted on Erase everything and on “remove credit import.” Proposals not acted on are dropped after 30 days. | Erase everything calls the vendor delete and the phone forgets the person id. |
| SP5 | Refresh. One pull per user request. No background monitoring, no score, no alerts in this track. A second pull returns only new debts. | No scheduled job exists. |
| SP6 | Use limits. The import feeds the books. Offer fit sees those debts only after acceptance, with `aprSource: 'bureau'` passing the gate only once the user confirms the rate. The file is never sent to an issuer or a network, including for prequalification. | Import, offers, and prequalification are three consents, and each can be declined alone. |

### Track LG — Legal and policy gates

| ID | Gate | Needed before |
| --- | --- | --- |
| LG1 | FTC Safeguards program: named owner, written risk assessment, encryption at rest and in transit on the sidecar, multi-factor access to the sidecar and vendor dashboards, access logging, vendor oversight, incident plan with the 30-day FTC notice. Confirm with counsel whether the small-entity exemptions apply at launch volume. | Plaid Production (O11). Also before SP. |
| LG2 | Privacy rewrite. Today it says no credit pull and no Social Security number. New text: what the bank link and the import collect, what stays on the phone, what the sidecar holds and for how long, that books are not sold, offers and prequalification as separate choices. | PL2 in production, SP, OF2. |
| LG3 | Plaid written approval of offer matching on Plaid-sourced fields, and the express-consent wording. | OF2 when any matched rate came from Plaid. |
| LG4 | Affiliate contract pays for an approved application, not for placement. Disclosure line matches the contract. | OF2. |
| LG5 | State credit-services and broker review for any loan link. Mortgage, home-equity, and student links stay excluded regardless. | OF4. |
| LG6 | Google Play financial-features declaration as a loan facilitator, lending partners named, listing disclosures. | First personal-loan link. |
| LG7 | Fair Credit Reporting Act review of the import: written-instructions consent, purpose scope, disposal, and whether any screen could be read as an adverse action. | SP1. |
| LG8 | Credit-repair language list. The app never says it will raise a score, fix a report, or remove an item, and never charges for anything described that way. | SP and OF ship. |

### Track PR — Price

| ID | Decision | Rule |
| --- | --- | --- |
| PR1 | Bank-link plan price | Add the Liabilities fee and the expected per-pull cost to the per-Item fee before Play gets a price. |
| PR2 | Import inside the plan | **Decided 2026-10-03: included in the bank-link plan**, subject to counsel under LG7 and LG8. Pulls per year are capped once the vendor price is known, so one subscriber cannot cost more than the plan earns. Never a separate product for the pull. |
| PR3 | Offers | Free. Never in a paid tier. Prequalification free. |
| PR4 | More profitable paths considered | **Free import for everyone** puts a per-pull cost on users who pay nothing, and the debts it finds cannot feed prequalification, so it buys no extra offer revenue. **A higher tier sold on the import** makes the credit file the reason to pay, which is the reading state credit-services laws are aimed at, and it doubles the Play products before the first price exists. **Pulling credit to power offers**, the free-score model, turns the import into lead generation and makes the app the one judging eligibility. The paths that add profit without those costs are already here: issuer prequalification (OF2b) costs nothing to run and raises approvals, and the import makes the bank-link plan worth more. Revisit a tier only with a vendor price, a conversion rate, and counsel’s read. |

---

## 4. Targeting rules

“Targeting” here means which sentence or row appears, for which debt, and when. Every trigger is a fact on the books the user entered or confirmed.

### Allowed

| Trigger | What appears | Revenue |
| --- | --- | --- |
| Their promo ends inside the horizon with a balance left | Month and returning rate | None. Phase 2 link only if a transfer also passes every gate. |
| Leftover clears a revolving balance cheaper than any fee | “Pay it down” and the month | None |
| A confirmed revolving card at a rate where a posted transfer wins on the current payment | Ask once, then one row | Issuer pays on approval |
| Several revolving cards the user chose to combine | Typed or posted consolidation, after they confirm the new row | Phase 4 only |
| Auto loan they already owe, rate confirmed | Typed refinance; link in phase 4 | Phase 4 only |
| Variable-rate mortgage near reset | Reset month under Realistic and the rate-spike overlay; typed fixed-rate compare | None |
| Mortgage insurance near 80% of home value | Month the balance crosses it, and that they can ask the servicer | None |
| Minimum-only card | Payoff month at the minimum, and at the current surplus | None |
| Debt the import found that is not on the books | Proposal to add it | None |
| Payments in transactions to a lender not on the books | Proposal to add that debt | None |

### Never

- An overdue debt, a past-due amount, a collection, or medical debt as an offer source.
- A future repair, a car purchase, or the emergency fund as a reason for new credit.
- Transactions as a pitch: payday-lender payments, overdraft fees, a drop in pay, or a gambling merchant never trigger an offer. They may only propose a missing bill or debt.
- A student loan on an income-driven plan or with a forgiveness date.
- A mortgage, home-equity, or student-loan link.
- A notification, a badge, a homepage line, or the repair event as the place an offer appears.
- A computed approval chance, a credit score, or a utilization tip.
- Compensation in the rank, a tie-break, or the decision to show a row.

---

## 5. Order

| Step | Ships | Waits on |
| --- | --- | --- |
| 1 | OF1 on typed rates | Nothing outside this repo |
| 2 | P2, P3, then PL1–PL9 in Trial | Plaid Link on device; Trial includes Liabilities |
| 3 | LG1 | Before O11 |
| 4 | OF1 gate change and OF1a | PL3, PL4, PL7 |
| 5 | O11 with PR1 | Per-Item and Liabilities fees read |
| 6 | SP0–SP6 | PL done, LG1, LG2, LG7, LG8, vendor signed |
| 7 | OF2, then OF2b, then OF3 | D1 store listing of standing; LG2, LG3, LG4. Counsel, the Plaid request, and the affiliate application start at step 3, so they are not what holds this step. |
| 8 | OF4 | LG5, LG6 |

## 6. Founder decisions (resolved 2026-10-03)

1. **Posted catalog waits for the store listing.** Validators dissent adopted for shipping. Affiliate networks usually approve publishers that already have a live listing and traffic, a Play reviewer should meet a planner before a card link, and the catalog earns nothing without installs. Counsel, the Plaid approval request, and the affiliate application start now, in parallel, so the wait costs no calendar time.
2. **Typed home-equity comparison is allowed.** Business dissent overruled. The user types the home-equity rate, fee, and term. Never asked, never linked, taxes left out, and the screen says so.
3. **The import is included in the bank-link plan.** No separate price. Pulls per year capped once the vendor price is known. PR4 records the paths considered and why they earn less or cost more.
4. **Prequalification uses the issuer’s own check.** Not the app’s soft pull, and not “neither.” The issuer pays for its check, a prequalified offer is more likely to be approved, and the user’s credit import never leaves the phone for marketing.
5. **Method first, Spinwheel as the fallback.** One debt-discovery vendor alongside Plaid is the usual setup. A vendor per loan type is not.
