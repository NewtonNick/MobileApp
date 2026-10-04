# Consumer scope — gap tracker

Post-MVP. Standing already ships in code. This file is the resolution log for usability jank in those features, and for calculator coverage of ordinary US households.

**Status values:** `fixed` (in code, tests where noted) · `open` · `later` (decided, not this wave).

Update the status on the same change that lands the work. Do not move these rows back into MVP `WORK.md`.

## Decisions (resolved 2026-09-26)

Adopted as the plan. Rows that were waiting on these are `fixed`, except distribution D01–D04. This pass built the repair-chance model, the security rating, and the usability and household-calculator rows J04–J17 and K01–K15. Tests: `packages/forecast-engine/src/consumer-gaps.test.ts`.

1. **Surplus.** The user picks once: extra to the highest-rate loan, extra to retirement, or leave it in cash. Default until they pick: leave it in cash. Forecast, Retire early, and Debt first vs Retire early all use that choice.
2. **Social Security and pensions.** The user types a monthly amount and a start age. No SSA estimator.
3. **Health after work.** One monthly amount that starts on the retire date. Not an insurance shop.
4. **Withdrawal tax.** One effective rate on traditional accounts. Roth is untaxed. Not a tax return. Blank means the plan does not tax withdrawals, and the screen says so.
5. **Kids and college.** An expense can have a start month and an end month. No 529 tool.
6. **Emergency fund.** The preset offers 3 or 6 months. Default stays 3.
7. **Skipped questions.** Skip is remembered until the user opens books. It does not invent a roof year.
8. **Second car or house.** Books can add another. Downsize and delay apply to one chosen house.
9. **Paid offer.** Standing stays free. The offer is an annual plan to keep the date current, capped at two institutions. Monthly is the other way to pay. The dollar price stays unset until Plaid shows the per-Item fee. Entitlement stays out of household JSON. This replaces the lifetime-license note. See the Plaid budgets plan. Store and encryption stay D01 and D03. Bank link is D02.

1. **Where leftover goes (blocks K01, K02, J12).** One rule for the forecast path, the Retire early date, and Debt first vs Retire early. Proposal: the user picks a surplus policy — extra to the highest-APR loan, extra to retirement, or leave it in cash — and every calculator uses that policy.
2. **Social Security and pensions (blocks K10).** Proposal: the user types a monthly benefit and a start age. No SSA estimator in this wave.
3. **Healthcare after work (blocks K10).** Proposal: one monthly amount that replaces employer health on the work-optional date. Not an insurance shop.
4. **Withdrawal tax (blocks K13).** Proposal: one effective tax rate on traditional withdrawals. Roth balances are tagged untaxed. Not a tax engine.
5. **Kids and college (blocks K11).** Proposal: dated expenses the user types (childcare until a year, a college bill in a year). No 529 optimizer.
6. **Emergency fund length (blocks J14).** Proposal: 3 or 6 months on the preset, default 3.
7. **Skipped questions (blocks J05).** Proposal: a skip is stored on the household and that question does not return until the user opens books.
8. **Second car and house (blocks J07).** Engine already walks every home and vehicle. Proposal: books can add them. Downsize and delay still apply to one chosen house.
9. **Paid offer, store, encryption, bank link.** D02 and D04 point at the Plaid budgets plan (annual keep-it-current, two institutions, price unset). D01 and D03 are unchanged.

## Fixed this pass

### R01 — Old homes and cars were priced as certain bills

**Status:** fixed. Tests: `packages/forecast-engine/src/risk.test.ts`.

**Failure.** A system past its useful life was booked next month at the full replacement cost. Reserved cash treated that as a bill. Routine upkeep was a percent of the full house value, so an expensive old home became tens of thousands a year before the roof was added again. Age and mileage multipliers on cars stacked with no cap.

**Now.** Each major job shows three numbers: chance in 5 years (capped at 80%), dollars if it happens, and the chance-weighted monthly cost (`chance × cost / 60`). Forecast and reserved cash use the monthly figure. Routine upkeep uses home value capped at $400,000. Vehicle routine multipliers cap at 1.75. An aging car adds a transmission job the same way. An unknown year uses a typical mid-life age and says so.

**Security rating.** 0–100 from cash versus the largest repair (50 points), months of bills that cash covers up to 6 (30), and whether monthly leftover still covers the chance-weighted cost (20). Secure 80+, Stable 60–79, Exposed 40–59, Fragile below 40. Cash shows the band. Risk lists every job and can mark one already replaced.

**Files.** `packages/forecast-engine/src/risk.ts`, `drivers.ts`, `lookups.ts`, `engine.ts` `assessSecurity`, Risk tab, Cash home.

### J01 — Cash update clobbered every liquid account

**Status:** fixed. Test: `applyLiquidTotal` in `engine.test.ts`.

**Failure.** Cash on hand and Adjust the date wrote the typed number onto every checking, savings, and cash row. Two accounts of $4,000 and $6,000 became $10,000 and $10,000. The field also showed only the first account, so tapping Update could shrink a real total.

**Now.** The field is the combined total. `applyLiquidTotal` keeps each account’s share. A single account is replaced. A zero combined balance lands on the first account.

**Files.** `packages/forecast-engine/src/engine.ts`, Cash home, `looks-wrong.tsx`.

### J02 — A bad date override could ignore the goal date

**Status:** fixed. Test: consumer calculator guards in `goals.test.ts`.

**Failure.** A date goal read `targetDate` before its own date. Garbage in the override made `hiredFromIso` fail, and the date case then reported the goal as already hired (month 0). An incomplete date never reaches standing; it falls back to Stay Afloat.

**Now.** A date goal uses its own `YYYY-MM-DD`. A bad override is ignored. If neither date parses, the goal stays undated.

### J03 — “Pay off this loan” treated a blank rate as 0%

**Status:** fixed. Test: consumer calculator guards.

**Failure.** Debt Free uses a labeled typical APR when the rate is blank. A custom “pay off this loan” goal used `apr ?? 0`, so the same blank card looked free and paid off too soon.

**Now.** That path uses `liabilityApr`, the same typical rate as Debt Free. An entered 0% stays 0%.

---

## Open — usability of features that exist

### J04 — “A monthly bill” edits the first expense, unlabeled

**Status:** fixed.

**Failure.** Adjust the date writes one number onto `expenses[0]`. If that row is rent, the user overwrites rent while thinking they edited living costs.

**Target.** Name the row being edited. Edit living and rent as separate fields. Do not create a second “Living” row when one exists.

**Acceptance.** Rent of $1,800 stays $1,800 when the user changes a living bill. A household with no expenses gets one named Living row.

**Files.** `apps/mobile/src/app/looks-wrong.tsx`.

### J05 — Skip on Improve this plan does not stick

**Status:** fixed. Decision: a skip sticks until books.

**Failure.** Partner skip stores $0. Cadence skip stores monthly. Roof, HVAC, mileage, ZIP, and house call `done()` and go home. The next Improve tap asks the same question.

**Target.** A skip is remembered. The question returns only from books, not from the chip.

**Acceptance.** Skip roof, leave, open Improve: the next question is not roof. Books can still set roof year.

**Files.** `improve.tsx`, `jobs.ts` `nextBest`, household JSON (a skip set, not a fake roof year).

### J06 — Books are add-only

**Status:** fixed.

**Failure.** Accounts and expenses can be added. They cannot be edited, renamed, or removed. Types show as `checking` and `retirement_401k`. Balances after the first cash total are stuck.

**Target.** Each row edits in place: name, type, balance, payment, rate, return. Delete asks once. Labels are Checking, Savings, 401(k), and so on.

**Acceptance.** Change a savings balance from books and the cash total and the hired date both move. Delete a duplicate expense and it stays gone.

**Files.** `apps/mobile/src/app/accounts.tsx`.

### J07 — A second car or house cannot be added

**Status:** fixed. Decision: books can add another car or house. Downsize applies to one chosen house.

**Failure.** Improve this plan replaces the first home or the first vehicle. Onboarding asks for one of each. The walker already depreciates two cars independently.

**Target.** Books add another vehicle or another house. Search still fills year, make, model, and class. The featured house is the one Keep / delay / downsize uses.

**Acceptance.** Two vehicles produce two maintenance lines and two depreciation paths. Adding the second does not wipe the first.

**Files.** `accounts.tsx` or a dedicated assets editor, `improve.tsx` `upsertAsset`, `moves.tsx`.

### J08 — Downsize ignores the mortgage; delay does nothing without years

**Status:** fixed.

**Failure.** Downsize multiplies house value by 0.7 and leaves the mortgage. Delay adds five years only to roof, HVAC, and water-heater years that are already filled. Unknown years stay unknown, and the button still says it applied.

**Target.** Downsize states the mortgage assumption before apply. If a mortgage exists, the user chooses: keep this loan, or pay it down with the value cut (equity stays, loan scales or is capped at the new value). Delay says “nothing to push” when no system year is known, and does not pretend it moved the date.

**Acceptance.** A $400k house with a $300k mortgage cannot silently become a $280k house with the same $300k loan unless the user chose that. Delay with a blank roof year does not change standing.

**Files.** `packages/forecast-engine/src/sequence.ts`, `moves.tsx`.

### J09 — Percent fields accept 0.07 as 0.07%

**Status:** fixed.

**Failure.** Rates are typed as 6.5 meaning 6.5%. `parsePercentInput` also accepts 0.07 and stores 0.07%. A blank over 80% is dropped with no message.

**Target.** If the user types a number between 0 and 1 exclusive, ask whether they meant percent or a decimal. Reject out-of-range with a line under the field. Same helper for APR, expected return, and withdrawal rate.

**Acceptance.** 7 stores 7%. 0.07 does not store until the user confirms. 120% does not store.

**Files.** `rates.ts` `parsePercentInput`, every percent field.

### J10 — Purchase review does not save Expected, Recurring, or Ignore

**Status:** fixed.

**Failure.** On a simulated purchase, only “One-off shock” writes the household. Expected, Recurring, and Ignore merchant go back and forget the choice.

**Target.** Each choice persists. Recurring becomes an expense. Ignore suppresses that merchant. Expected leaves the forecast alone and records the review so it is not asked again.

**Acceptance.** Ignore, leave, reopen: the merchant is not offered again. Recurring increases monthly living and the hired date can move.

**Files.** `apps/mobile/src/app/event/[id].tsx`, household or local txn store.

### J11 — The chart stops at 5 years; the date can be 30

**Status:** fixed.

**Failure.** The walker is 60 months. Retire early and debt dates search 360 months. A date in year 12 has no path on Forecast.

**Target.** Forecast can show the hired horizon, with 5 years as the default zoom. The hired month is marked. Figures past 5 years stay in today’s dollars unless nominal is on.

**Acceptance.** A Retire early date at month 120 is visible on the chart. Cash home still leads with the sentence, not the chart.

**Files.** `drivers.ts` horizon, `forecast.tsx`, `charts/`.

### J12 — Debt first vs Retire early does not match Forecast

**Status:** fixed. Decision: one surplus choice, default leave it in cash.

**Failure.** Debt first adds leftover to one loan’s minimum on a clone, then dates that clone. Forecast still uses minimums only. The screen does not say how many dollars moved.

**Target.** The lab states the extra monthly dollars and which loan gets them. Forecast uses the same surplus policy the user picked, so the chart and the sentence agree.

**Acceptance.** With “extra to debt” on, the forecast liability balance hits zero in the same month the lab names.

**Files.** `sequence.ts`, `sequence.tsx`, walker debt driver.

### J13 — Money fields do not check the number

**Status:** fixed.

**Failure.** Negative pay, a roof year of 12, and a mileage of a billion all save. Several inputs use `number-pad`, which has no decimal. Labels are often placeholders only.

**Target.** Pay, balances, and bills reject negatives and non-numbers. Years are 1900 through next year. Mileage is 0 through 500,000. Money keyboards allow a decimal. Each field has a visible label.

**Acceptance.** “-200” in take-home does not save. Roof year 2014 still saves. A $10.50 expense can be typed.

**Files.** onboarding, improve, accounts, looks-wrong, custom goal.

### J14 — Emergency Fund is stuck at 3 months

**Status:** fixed. Decision: preset offers 3 or 6 months, default 3.

**Failure.** The preset reserves `DEFAULT_BUFFER_MONTHS` (3). A 6-month fund requires a custom goal the user has to discover.

**Target.** The Emergency Fund card offers 3 or 6 months. The sentence names which.

**Acceptance.** Switching 3 to 6 raises reserved and can move the date. Custom runway goals are unchanged.

**Files.** `types.ts`, `goals.ts`, job pick or the goal card.

### J15 — Paycheck timing is a cartoon of the calendar

**Status:** fixed.

**Failure.** Both paychecks share one cadence. Biweekly “three-paycheck months” are always March and September, not the user’s Fridays. Weekly five-paycheck months are February, May, August, and November.

**Target.** Each earner has a cadence. The user names the next payday once; three-paycheck months follow that anchor. Annual pay still matches the monthly take-home times 12.

**Acceptance.** A Friday biweekly schedule puts the third check in the months that actually have three Fridays from that anchor. Partner weekly plus owner biweekly both land in cash.

**Files.** `cadence.ts`, onboarding, accounts.

### J16 — “I already paid this” only recognizes three labels

**Status:** fixed.

**Failure.** Home marks a collision realized only when the label contains roof, hvac, or water. Any other hit has no control. The key is guessed from English.

**Target.** The button uses the event key. Every discrete ownership hit can be marked paid. Marking it removes that key from reserved.

**Acceptance.** A water-heater hit and a future system hit both drop out when marked paid. A mistyped label cannot mark the wrong system.

**Files.** `(tabs)/index.tsx` `markRealized`.

### J17 — Custom goals cannot be edited

**Status:** fixed.

**Failure.** Something else always inserts a new id. There is no edit or remove on the card. Featuring a goal does not say that Forecast is still the household path, not that goal alone.

**Target.** A card can edit or remove its goal. Remove asks once. The featured label says this goal is the sentence on Forecast.

**Acceptance.** Renaming “Honda paid off” does not create a second goal. Removing it drops it from the board and keeps the other goals’ numbers.

**Files.** `custom-goal.tsx`, `(tabs)/index.tsx`, `goals.ts` `upsertCustomGoal`.

---

## Open — calculators for ordinary households

These are the situations a typical US household will get a wrong date for. Shop quotes, a tax return, a spouse login, and “buy that other house” stay out.

### K01 — One surplus rule

**Status:** fixed. Decision: one surplus choice, default leave it in cash.

**Failure.** Retire early invests leftover inside `workOptionalMonth` at a flat real save rate. The walker leaves leftover in cash and never contributes to investments. Income and living inflate in the walker; the retire-date save does not. Ownership is paid from cash in the walker and is not subtracted from that save. The retire date and the chart describe different households.

**Target.** Surplus each month follows the user’s policy. The retire date reads the same path the chart draws, including inflation and ownership bills.

**Acceptance.** A fixture with $500 a month surplus, a 401(k), and a known roof: the month investments can fund spending equals the month the chart’s portfolio crosses that need. Coast saves $0 of new money on both.

**Files.** `standing.ts` `workOptionalMonth`, `drivers.ts` income, living, invest, events.

### K02 — Ongoing retirement contributions and a match

**Status:** fixed. Decision: one surplus choice, default leave it in cash.

**Failure.** Take-home is after a 401(k) deferral for most W-2 households. The deferral is not added to the account. The balance only earns a return. Employer match does not exist. Retire early is late, and the chart’s retirement line is flat except for return.

**Target.** Each retirement account can take an employee contribution (dollars or percent of gross, or a monthly dollar amount) and an employer match (percent of pay, up to a percent). Contributions are part of the path in K01. Take-home stays what hits checking. The screen says contributions are not inside take-home.

**Acceptance.** $500 a month into a 401(k) plus a 50% match on that $500 raises the balance by about $750 a month before return. Take-home cash does not rise by $500.

**Files.** `AccountInput`, invest driver, onboarding and books.

### K03 — Mortgage payment is not all principal and interest

**Status:** fixed.

**Failure.** The whole minimum is amortized as P&I. A payment that includes tax and insurance pays the loan off too soon and understates interest.

**Target.** A mortgage has balance, rate, P&I payment, and an optional escrow (tax and insurance). Escrow is a housing expense, not principal. If the user only knows the total payment, ask them to split it, and until they do show a chip that the payoff assumes the whole payment is P&I.

**Acceptance.** $1,800 total with $600 escrow pays principal on $1,200 only. The $600 still leaves cash every month.

**Files.** `amort.ts`, debt driver, loan forms.

### K04 — A card paid off every month is not a 22% loan

**Status:** fixed.

**Failure.** A statement balance with a minimum payment amortizes for years at a typical card rate. Many households pay the statement in full.

**Target.** Each card is Revolving or Paid monthly. Paid monthly costs the balance once as spending if it is not already in expenses, then the balance does not accrue. Revolving keeps amortization. The same-bill prompt still catches a card payment typed again as an expense.

**Acceptance.** Paid monthly, $2,000 statement, does not add years of 22% interest. Revolving with a $40 minimum still accrues.

**Files.** `AccountInput`, debt driver, books.

### K05 — Debt dates after month 60 drop the interest

**Status:** fixed.

**Failure.** If loans remain at month 60, Debt Free adds `remaining balance / minimum payment` with no further interest.

**Target.** Payoff always amortizes month by month up to 360, using the same rate rule as J03. No straight-line tail.

**Acceptance.** A loan that is not done at month 60 has a later date than balance/payment, when the rate is above zero.

**Files.** `standing.ts` `debtFreeMonth`.

### K06 — A replacement past year 5 disappears

**Status:** fixed. Ties to J11.

**Failure.** Roof, HVAC, and water heater enter the walker only if due inside 60 months. A roof due in year 8 is invisible on Forecast and is not in the retire-date spending need (that need uses recurring maintenance only).

**Target.** On the long horizon, a known system replacement lands in its month and is paid from cash. Recurring maintenance does not also pretend to be that replacement.

**Acceptance.** Roof year such that replacement is month 72: that month’s cash drops by the replacement cost. A roof inside 12 months still changes reserved.

**Files.** `drivers.ts` `plannedEvents`, standing ownership need.

### K07 — A car is maintenance and depreciation only

**Status:** fixed.

**Failure.** Class tables cover maintenance and depreciation. Insurance, fuel, and registration are missing. Catalog rows have `mpg` and nothing reads it.

**Target.** Each vehicle has insurance, registration, and either a fuel bill or miles-per-year times a fuel price over mpg. Defaults are labeled estimates the user can override. They show on the vehicle risk card.

**Acceptance.** Changing insurance moves 5-year vehicle cost and leftover. A car with no mpg uses the typed fuel bill.

**Files.** vehicle seed, `plannedEvents`, risk card, vehicle form.

### K08 — House tax, insurance, and HOA are inside a percent of value

**Status:** fixed.

**Failure.** Maintenance is a percent of value. Tax, insurance, and HOA are not lines. A user who also types them as expenses pays them twice. Square feet change maintenance, and no screen asks for square feet.

**Target.** Tax, insurance, and HOA are their own monthly lines, prefilled from nothing (user-entered) so we do not invent a national tax. The maintenance percent is labeled “repairs,” not “all housing.” Square feet is an optional field. The same-bill check includes these names, not only loan tokens.

**Acceptance.** Adding $400 property tax raises housing outflow once. “Insurance” as an expense and a house insurance line triggers the same-bill question.

**Files.** home events, expense duplicate tokens in `debt.ts`, house form.

### K09 — Rent and pay never change unless an overlay is on

**Status:** fixed.

**Failure.** Living and pay inflate with CPI inside the walker, which is a hidden raise. The user cannot set “rent up 3% a year” or “a raise in June” as the plan. Those exist only as Compare overlays.

**Target.** Optional annual rent growth. Optional planned raise: month and percent, for one earner. CPI inflation stays on and is labeled. The raise overlay remains a shock, not the plan.

**Acceptance.** A 10% raise at month 12 increases pay from that month on the base forecast, not only on the overlay chart.

**Files.** household income fields, income driver, onboarding or books.

### K10 — Retire early has no age, Social Security, pension, or health handoff

**Status:** fixed. Decision: typed benefit and start age; one health amount at the retire date.

**Failure.** The date is when investments times a withdrawal rate cover today’s spending plus recurring ownership. No age, no benefit, no pension, no change in health insurance when work stops. That date is wrong for most households over 40, and for anyone losing an employer health plan.

**Target.** Optional birth year or current age. Optional Social Security: monthly amount and start age. Optional pension: monthly amount and start age. Optional health replacement: monthly amount that begins on the work-optional month. Spending need falls by those benefits after they start. The 4% path remains when these are blank, and the sentence says benefits are not included.

**Acceptance.** A $2,000 Social Security benefit at 67 moves a later retire date earlier than the same books with the benefit blank. Blank benefits reproduce today’s date on the same fixture.

**Files.** household fields, `workOptionalMonth` once K01 shares one path, job pick flavor section.

### K11 — No dated family bills

**Status:** fixed. Decision: expenses can start and end. No 529 tool.

**Failure.** Childcare, tuition, and a known future bill have no end date. A custom “afford” goal is one number, not a bill that starts and stops.

**Target.** An expense can have a start month and an end month. Cash and the retire date include it only inside that window.

**Acceptance.** Childcare of $1,500 that ends in 48 months is gone from living after month 48. The retire date uses the lower spending after that.

**Files.** `ExpenseInput`, living driver, books.

### K12 — Income is two regular paychecks

**Status:** fixed.

**Failure.** Bonus, commission, self-employment draws, alimony, and child support have nowhere to go except pretending they are monthly take-home.

**Target.** Extra income rows: name, amount, and schedule (monthly, annual in a named month, or one date). They hit cash on that schedule. They are not a second login.

**Acceptance.** A $6,000 bonus each March raises March cash and does not raise the other months by $500.

**Files.** household income list, `cadence.ts` or a sibling, books.

### K13 — Traditional withdrawals are treated as spendable in full

**Status:** fixed. Decision: one effective rate on traditional withdrawals. Roth untaxed.

**Failure.** A 4% draw on a traditional 401(k) is modeled as if the whole withdrawal pays bills. Roth and traditional are the same account type family.

**Target.** An account is Traditional or Roth. Traditional withdrawals shrink by the user’s effective tax rate before they count toward spending need. Roth does not. The rate is one number, default blank, and blank means “not taxed in this plan” with a chip that says so.

**Acceptance.** Same balance, 20% tax on traditional, reaches the spending need later than Roth.

**Files.** `AccountInput`, retire-date need. No tax brackets, credits, or state returns.

### K14 — Student loans have no end other than payoff

**Status:** fixed.

**Failure.** The payment the user types is amortized until the balance dies. Income-driven plans that forgive a remainder, or a known payoff date, are not representable. A payment below interest already grows the balance, which is correct for negative amortization.

**Target.** Optional forgiveness month. Balance remaining then drops to zero and the payment stops. Until that field is set, behavior stays pure amortization.

**Acceptance.** Forgiveness at month 120 stops the payment at 120 even if a balance remains. No forgiveness matches today’s amortization.

**Files.** loan fields, debt driver, `debtFreeMonth`.

### K15 — Home and car ownership still double-count easily

**Status:** fixed. Extends the same-bill prompt.

**Failure.** The duplicate check looks for a short token list (mortgage, rent, a few car brands, visa, mastercard) and only on the books screen. Home maintenance versus a “repairs” expense is invisible. “Not sure” links the expense but does not mark the loan reviewed the same way “Same bill” does.

**Target.** The prompt appears on Cash when a guess exists. Tokens include tax, insurance, HOA, repairs, and fuel. Not sure and Same bill both stop the double count and stop the prompt.

**Acceptance.** An expense named Insurance and a house insurance line ask once. Same bill counts the dollars once in `monthlyOutflows`.

**Files.** `debt.ts`, Cash home, `accounts.tsx`.

---

## Still later — distribution

Not usability of the current calculators. Tracked here so consumer-grade shipping is one list.

| ID | Item | Status | Done when |
| --- | --- | --- | --- |
| D01 | Database encryption at rest | open | SQLite file is encrypted. Backup AES-256-GCM stays. Restore after reinstall matches the household. |
| D02 | Bank link in the Android app | open | Points at the Plaid budgets plan. Link runs in the dev client. A failed link leaves books intact. Sandbox cannot write the real household. The no-keys outlier still works. |
| D03 | Store build | open | EAS project id is real. Android AAB builds. In-app privacy stays; hosted policy URL exists before listing. iOS waits on an Apple Developer account. |
| D04 | Paid offer | later | Standing stays free. Annual or monthly bank link, two institutions. The Play pipe is in the app. The price is still unset until Play lists `bank_link_annual` and `bank_link_monthly`. Entitlement stays out of household JSON. |

## Out of this scope

Full tax returns, insurance shopping, comparing a different house, envelope-as-the-product, a spouse login, receipt scanning, live ticker prices, non-USD, and a cloud ledger. Category budgets are in the Plaid budgets plan. The home is still the hired date.
