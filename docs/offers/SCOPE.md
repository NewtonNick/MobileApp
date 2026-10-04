# Offer fit — engine scope

Scoped 2026-10-03. Amended the same day by the council at the bottom of this file, and by the audit in [IMPLEMENTATION.md](./IMPLEMENTATION.md), which owns ticket order and the Plaid dependency. **Not promoted.** Those verdicts amend this scope. They do not amend [DESIGN.md](../DESIGN.md). Standing, Decide, and the bank link do not wait on it.

A lawyer reviews [the draft addendum](../legal/offers.md) before any offer link ships.

## What the council kept

An on-device what-if. It clones the household through the same apply path Decide already uses, then reads `standing`. There is no second ranker. Order is the order in `compareRank`: featured hired month, then whether a repair or bill collides with leftover, then leftover. Interest saved after the fee is a hide-gate. It is not a sort key. A bounty is not in the module the ranker imports.

The issuer underwrites. The app does not say the user will be approved. A click, when a later phase has one, sends no balance, APR, ZIP, or Plaid item.

ZIP is a cost-table input. It is not an offer input. Plaid returns a credit limit, and the sidecar drops it, so utilization is not a target. [IMPLEMENTATION.md](./IMPLEMENTATION.md) amends this scope for Plaid Liabilities and the debt import. The screen says the comparison ignores effects on a credit score. A home-secured comparison says taxes are not in the number.

## Use cases

Each row is a case the household can already express. “Link” means an outbound issuer button. Phase 1 has no link.

| Case | Already on the books | Ruling |
| --- | --- | --- |
| A card’s own promo is about to end | `promoApr`, `promoEndsAt`, balance | Phase 1 reader. Name the month and the rate that returns. No catalog required. |
| Leftover pays the revolving balance off cheaper than any fee | Surplus policy, leftover, `reserved`, user APR | `keep_current`. The sentence says to pay it down. A transfer that loses to that path is hidden. |
| One revolving card, terms they type | `credit_card`, user `apr`, `minPayment` | Phase 1. Fee, promo length, go-to rate, annual fee. |
| One revolving card, a posted page | Same, plus a fresh catalog row | Phase 2 link only. Ask-once only for this case. |
| Several revolving cards into one loan they confirm | More than one revolving balance | Phase 1 after they confirm the new row’s name, rate, and payment. Ask-once must not create an account. |
| They keep charging | Living expenses already in the walker | The sentence says the promo balance gets no new charges. Do not invent a spend figure. `typicalMonthlySpend` is the paid-monthly statement, not revolving spend. |
| Transfer fee from cash or onto the balance | Liquid cash, `reserved` | Two clones when cash above the reserve covers the fee. Otherwise only fee-on-balance. |
| Annual fee | Posted or typed terms | A dated expense on the clone, so leftover sees it. |
| Auto loan they already owe | `auto_loan`, user APR | Phase 1 typed refinance. No link until a state-law review (phase 4). |
| Car replacement they already opened in Decide | Existing car axis, price they typed | Typed loan terms on that clone only. Not its own pitch. |
| Adjustable mortgage reset | `rateFixedUntil`, caps, margin, rate-spike overlay | Phase 1 typed fixed rate, also scored under the rate-spike overlay. No link. No ask-once. |
| Lease coming due | `endsAt`, `residual`, `endChoice` | Phase 1 typed buyout loan versus return. No link. |
| Student loan with forgiveness on the books | `forgivenessAt` or `forgivenessMonth` | Refusal sentence. Never scored as a win. Never a link. A refinance can end the forgiveness. |
| Home equity versus a card they already owe | Home value, mortgage, card APR | Typed numbers only. Never asked. Never linked. Screen says taxes are omitted. Founder ruled for consensus 2026-10-03; Business dissent overruled. |
| A future roof, HVAC, or car repair put on a new card | Risk jobs, ownership shocks | **No.** Both chairs. The repair stays a collision check on a move of debt that already exists. It is not a balance to finance. |
| Rewards from spend categories | Budget categories | Parked. Cut until every card is `paid_monthly`, revolving balances are zero, and an earn rate is cited. |
| Another open hire moves the wrong way | `openGoals` | A catalog link hides. Typed terms show both dates and do not write the books unless they save. |
| Paid-in-full card | `payoffStyle: paid_monthly` | No balance-transfer row. |
| Blank APR | `liabilityApr` may assume a typical rate | No row. The typical rate is a forecast assumption. |
| Mortgage link, HELOC link, student link | — | Never. |

## Module

Extend the Decide clone. `applyRefinance` today writes only `apr` and `minPayment`. That is not enough for a promo, a fee, or a go-to rate, and a parallel `offers.ts` ranker is a second formula that will drift from `compareRank`.

Phase 1 adds terms onto the existing apply path:

```ts
type TransferTerms = {
  sourceAccountIds: string[];
  /** Confirmed new row only. Absent when the source account itself is rewritten. */
  openedAccountId: string | null;
  promoApr: number | null;
  promoMonths: number | null;
  transferFeeRate: number;
  transferFeeMin: number;
  feeFromCash: boolean;
  goToAprHigh: number;
  annualFee: number;
  minPayment: number;
};
```

`rankDecisions` scores the clone. A catalog row, in phase 2, is only a way to fill `TransferTerms` from `data/seed/offers_v1.json`. The rank function does not import compensation. Payout notes live in a file the ranker cannot see.

Readers that are not clones:

- `promoEnding` — user-entered promo, balance still there, end inside the walker horizon.
- `forgivenessGuard` — student loan with a forgiveness month. Copy only.
- `paydownBeatsFee` — leftover path clears the revolving balance with more interest saved than the candidate. Forces `keep_current`.

Fit results are derived. They are not stored on the household. Consent and the click log stay outside household JSON, same rule as entitlement.

### Gates, in order

1. The case is allowed in the table above for this phase.
2. Every source APR is typed, or synced from Plaid or the debt import and confirmed by the user. The labeled typical never passes. Paid-monthly and overdue debts are not sources.
3. Fee, promo length, and `goToAprHigh` are finite. Fee 0–10%. Promo 1–21 months when a promo is the product. Go-to APR 0–36%. A floor with no high end is unrankable.
4. Catalog rows only: `asOf` within 14 days and `expiresOn` not past. Typed terms skip this gate.
5. Clone through `standing` on Realistic, on Conservative, and, for an adjustable mortgage, under the rate-spike overlay.
6. Featured hired month is not later. Collision is not worse than today. Another open hire is not later when the row would carry a link.
7. Interest after the fee, in today’s dollars, is lower than staying. The deflator is the one `standing` already uses.
8. The payment is the one already on the books, plus surplus only when that policy already points at this debt. The extra dollars required to clear a promo may come from leftover after `reserved`. They may not spend the reserve.
9. Cash fee only when liquid cash above `reserved` covers it.

One catalog link per source debt. Typed terms can show the winner and the keep-current sentence together.

## Surfaces

Nothing on the homepage sentence. No notification. No badge. The repair event and the car-due moment stay about the date. They do not grow an issuer button.

| Surface | When | Rule |
| --- | --- | --- |
| Promo ending | Their own promo end is inside the horizon and a balance remains | Name the month and the rate that comes back. A phase 2 link only if a posted transfer also passes the gates. |
| Forgiveness | A student loan has a forgiveness month | “A refinance is not scored. Forgiveness is on this loan.” No field for replacement terms. |
| Bring terms | They type figures on a debt the table allows | Keep or move, both dates if another hire moves, collision if one appears. No link in phase 1. |
| Confirm a new row | They are combining cards, or typing a lease buyout | The row exists only after they confirm name, rate, and payment. Same rule as books. |
| Ask once | Phase 2, and only a revolving card whose posted transfer wins on the current payment | Not during onboarding. Not on a mortgage, a car, a lease, or a repair. No sticks until that card’s balance moves more than 10% or its APR changes. |
| One row on that card | They said yes | Fee, promo end, go-to rate used, hired-month gap, collision if any, and the paid line in the same view as the button. |

`keep_current` is a sentence with no button. It names the reason: leftover clears it, the fee costs more, a harder year reverses it, or a repair collides.

## Click and money

Unchanged from the first scope, and only in phase 2 or later. Allowlisted host, random click id, no household fields. Device log is offer id and time, deleted by Erase everything, not part of the books backup. The user is not charged. Offers are not a paid tier. The bank-link plan remains the paid object.

A server, if a network requires one, accepts click id, offer id, and time. It rejects a balance, an APR, a ZIP, an account id, or a Plaid token.

## Phases

| Phase | Ships | Blocked until |
| --- | --- | --- |
| 1. Typed terms and the readers | Promo-ending reader, forgiveness refusal, paydown-beats-fee, transfer terms on the Decide clone, auto and adjustable-mortgage and lease-end as typed comparisons, consolidation only after a confirmed row | Tests below. No addendum required to compare numbers they typed. The forgiveness sentence and the “taxes omitted” line ship with the cases they belong to. |
| 2. Posted card catalog | Seed file, ask-once, one link on a revolving card | Counsel signs the addendum. Privacy text updated. Plaid approves offer matching on Plaid-sourced fields in writing, and an express-consent screen comes before any offer. Standing is listed in the store (founder adopted the Validators dissent 2026-10-03). Counsel, Plaid, and the affiliate application start before the listing. |
| 3. Payout join | Device click log; endpoint only if the network requires it | Contract pays for an approval, not for placement. |
| 4. Links beyond cards | Auto refinance link, and only that | State credit-services and broker review. Mortgage, HELOC, and student links do not enter this phase. |
| 5. Rewards | Still parked | Zero revolving debt and a cited earn rate. |

## Tests

- `apr: null` matches nothing, including when `liabilityApr` would use the typical card rate.
- `paid_monthly` is not a transfer source.
- A promo already on the card, ending inside the horizon with a balance left, produces a reader sentence and no link.
- A student loan with `forgivenessAt` produces the refusal and cannot accept replacement terms.
- Leftover that clears a 25% card before a 3% fee pays for itself is `keep_current`.
- $6,000 at a user-entered 25%, payment clears inside a typed 0% window, fee 3% from the balance, beats staying. A 5% fee on the same window ranks worse. Collision, if the fee creates one, outranks the interest savings: the collided clone does not win.
- Cash fee is absent when paying it would touch `reserved`.
- Annual fee is in the leftover figure.
- Conservative reversal, or a go-to high end that costs more interest, hides a link.
- An adjustable mortgage is also scored under the rate-spike overlay.
- A risk-job cost never becomes a new card balance.
- Another open hire moving later hides a catalog link.
- Changing a compensation note outside the ranker does not change order. The rank module’s imports do not include that file.
- Apply URL query is click id only.
- Ask-once does not run for a mortgage, an auto loan, a lease, or a repair, and “no” sticks until that card’s balance or APR changes.
- Interest dollars move when the today’s-dollars deflator moves.

## Promotion

Phase 1 can be promoted as planner work: terms the user typed, on debts the walker already has. Phase 2 ships after the store listing and the counsel list. Homepage, onboarding, and notifications do not change in either phase.

---

# Council record — 2026-10-03

Personas from [claude-council](https://github.com/TorpedoD/claude-council) (copied, not cloned). Serial: Business → Validators → Engineers. Dual chair. Peer review and debate skipped, same as 2026-09-06 and 2026-09-07.

**Charter.** Audit the offer-fit scope against the household the walker already stores. Founder: the draft is missing critical use cases, and the referral may be worth building. Goal is the hired date with the debts and ownership shocks already on the books. Not a license to become a card site.

## 1. Business — which debts are the product

**Charter.** Name the cases the first draft dropped. Separate a what-if on an existing obligation from new debt and from a paid link.

### Advisors

- **Red Team:** The draft is a balance-transfer affiliate wearing the hired month. It sorts by interest and leftover and drops collision, which this product ranks above leftover. It refuses the mortgage, the student loan, the lease, and the repair, so the ownership constraint never meets the offer. A new ranker beside `rankDecisions` will disagree with the refinance axis, and that axis only writes APR and payment. Kill the parallel module.
- **First Principles:** An offer is a what-if on a balance or a contract already in force. The cases already in the types are the promo end on their own card, leftover that clears the balance without a fee, the auto loan, the ARM reset, the lease residual, and forgiveness that must not be refinanced. The catalog is the thin case.
- **Expansionist:** The missed set is larger than cards. Promo end. Pay-down beats the fee. Several cards into one confirmed loan. Fee from cash versus fee on the balance. Annual fee. Auto loan. Loan terms on a car replacement they already opened. ARM under the rate-spike overlay. Lease buyout versus return. Student forgiveness as a refusal, not a product. A typed home-equity rate against a card, taxes omitted, no link. A known roof financed at 0% because that is the shock this app exists to see. Other open hires must not silently get worse. `typicalMonthlySpend` is the wrong field for revolving spend; the sentence has to say no new charges. ZIP and a credit limit are not targets.
- **Outsider (SAR):** The terrain is the promo end and the collision, not a shelf of cards. One line while they are already on that debt or that job. A lender inside the outlier notification is a different mountain. Grocery rewards are a different mountain.
- **Executor:** Load-bearing before any catalog: readers for promo end, forgiveness, and pay-down-beats-fee; transfer terms on the existing clone; auto, ARM, and lease-end as typed comparisons; consolidation only after they confirm the row. The roof-as-new-card idea is the one Expansionist case that creates debt. Hold it for the chair.

### Chairmen

**Consensus:** Adopt the dropped cases that describe a balance or a contract already on the books. Promo end, pay-down, typed transfer, confirmed consolidation, auto, ARM, lease end, forgiveness refusal, typed home-equity with taxes omitted and no link. Collision returns to the rank. No second ranker. The repair is a collision check, not a new balance.

**Dissent:** NO-GO on any home-secured comparison, including typed. A HELOC against a card is the mortgage product in a costume. NO-GO on financing a future repair. That part of the dissent matches consensus.

**Dissent ledger:** Home-equity typed comparison (Dissent no, Consensus yes, never linked). Roof-as-new-debt (both no). Parallel ranker (both no).

## 2. Validators — what can be sold, and when

**Charter.** Whether these cases earn trust toward the first store listing and the bank-link plan, or spend it.

### Advisors

- **Red Team:** A catalog before the standing sentence is screenshot-able is the Plus mistake again. Offers must not become the paid object. Steal stays first-repair and car-due. An issuer button on that event turns the steal into a card site.
- **First Principles:** People pay to keep the date true. A better payment is a free what-if, like Decide. The bounty is optional and must not be why the row exists.
- **Expansionist:** The money in these cases is a date worth keeping current, which is the bank link. Do not price the offer. A catalog opened in the repair month spends the reason they came.
- **Outsider (ER):** The vital signs are the date and whether leftover is free. A row that hides a collision or another open hire is a false discharge.
- **Executor:** Phase 1 is the typed cases and the refusal sentences. Phase 2 is one posted transfer on an existing revolving card. Repair, mortgage, car, and lease do not get ask-once.

### Chairmen

**Consensus:** Phase 1 is free planner work. Phase 2 is a card link under the counsel gates, one per revolving debt, never on the repair event. The bank-link plan stays the paid object.

**Dissent:** NO-GO on phase 2 until standing is in the store. Typed terms can ship. A catalog before that screenshot is a second company.

**Dissent ledger:** Phase 2 timing (Dissent waits for the store; Consensus waits on counsel, privacy, and Plaid). Issuer button on the repair event (both no). Offers as a price (both no).

## 3. Engineers — one formula

**Charter.** A shape that cannot drift from `standing` or leak the household.

### Advisors

- **Outsider (spreadsheet):** A second engine is a second formula. `applyRefinance` writes two fields. Extend that clone: fee, promo, go-to, annual fee, cash-versus-balance. The fit row is a reader of `standing`. If it disagrees with Decide, the fit row is wrong.
- **Expansionist:** Consolidation needs a confirmed new liability, not a ghost account. ARM clones also run under the rate-spike overlay. `otherGoalMonths` is on the row. Interest uses the standing deflator.
- **Red Team:** NO-GO on a ranker that can import the bounty. NO-GO on persisting fit results. NO-GO on ZIP as a feature. Click log stays out of household JSON.
- **Executor:** Catalog seed emits `TransferTerms`. It does not sort. Phase 1 ships with no catalog type in the rank module.
- **First Principles:** N phones, eval on the phone. Annual fee is a dated expense. A cash fee reduces liquid only when the reserve stays whole. Ask-once must not insert an account.

### Chairmen

**Consensus:** One clone, `compareRank` order, today’s dollars, nothing persisted. Compensation lives in a file the rank module does not import. Ask-once cannot create a row.

**Dissent:** NO-GO on a synthetic consolidation account even after confirm, until books can already add that loan without this feature. Consensus allows the confirmed row because books can already add a loan. The dissent is timing, not a second formula.

**Dissent ledger:** Synthetic account (Dissent: only after ordinary books can add it, which they can; Consensus: confirm is enough). Bounty file outside the rank module (both yes).

## What this build of the scope implements

Consensus from all three seats, plus every no that both chairs shared: no parallel ranker, no roof-as-new-debt, no repair-event link, no offers SKU, collision back in the order, bounty outside the ranker. Typed home-equity stays, never asked and never linked, with the Business dissent preserved above. Phase 2 staffing stays a founder call because Validators dissent and consensus disagree on waiting for the store.

**Founder ruling, 2026-10-03.** Typed home-equity comparison allowed (Business dissent overruled). Phase 2 waits for the store listing (Validators dissent adopted), with counsel, Plaid, and affiliate work started in parallel. Prequalification uses the issuer’s own check. See [IMPLEMENTATION.md](./IMPLEMENTATION.md) section 6.
