# B2 — jobClass on HouseholdInput

**Status:** done (types + preview fixture)

## Done when

Preview household has a default `jobClass`; types compile.

## What changed

- Added `JobClass`: `work_optional` | `debt_free` | `cash_buffer` | `keep_house_car`.
- FIRE is the **label** for `work_optional`, not a fifth class.
- `HouseholdInput.jobClass` is required. `targetDate` is an optional ISO date override, not the primary key.
- No `reservedCash` column. No IAP / Plus / entitlement fields on household JSON.
- Preview and empty real households default to `keep_house_car`.
- `normalizeHousehold()` coerces loaded JSON and drops Plus / `reservedCash` if they appear.

## Assumption

Preview defaults to keep-house-and-car because the current demo books are house + car. Confirm if preview should hire work-optional instead.
