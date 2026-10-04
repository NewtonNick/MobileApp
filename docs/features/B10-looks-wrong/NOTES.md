# B10 — Looks-wrong edits the date/gap

**Status:** done in code (not device QA)

## Done when

Changing an assumption updates the homepage sentence.

## What changed

Looks-wrong now edits paycheck, a monthly bill, “I’m not on 4%” (settings `withdrawalRate`), hired `targetDate`, cash, plus the existing roof/HVAC/mileage/maint cost lines. Apply writes books (and settings for the rate) and pops back; home recomputes standing with no extra save dialog.

4% override is intentionally **not** a household column.
