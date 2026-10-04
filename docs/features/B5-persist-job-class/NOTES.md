# B5 — Persist jobClass + entitlements stub

**Status:** done in code (not device QA)

## Done when

Household round-trips `jobClass`; no Plus fields in JSON.

## What changed

- Load/save run through `normalizeHousehold()` so extra Plus / `reservedCash` keys cannot become books.
- `apps/mobile/src/entitlements.ts` stub: standing always unlocked, `plus: false`.
- Forecast engine does not import entitlements.
- `withdrawalRate` lives on `AppSettings`, not household JSON.
