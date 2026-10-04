# G2 — No standing cache / reservedCash books

**Status:** done (code review)

- `standing()` / `EventHit[]` / reserved / leftover / collision month are not fields on `HouseholdInput`.
- Save path normalizes to books-only JSON and drops `reservedCash`, `plus`, `entitlements` if present.
- UI standing is a React memo over live eval.
