# B3 — standing() live projector

**Status:** done (unit tests)

## Done when

401k ≠ reserved; leftover can be 0; seed/roof year changes move reserved.

## What changed

New `packages/forecast-engine/src/standing.ts`:

`standing(household, bundle, scenario, jobClass)` → sentence, reserved, leftover, collisionMonth, pulseReasons.

- **Reserved** = Conservative ownership shocks in the next 12 months (liquid cash only).
- **Leftover** = max(0, liquid − reserved). Retirement is not liquid.
- Result is never persisted. Callers recompute on household save.
- Hired date by job:
  - work-optional: 4% of investments + leftover covering living + reserved (house/car constraint).
  - debt-free: first month liabilities hit ~0.
  - cash-buffer: first month cash covers reserved.
  - keep-house-and-car: next discrete ownership shock month.
- `targetDate` on the household overrides the computed hired date.
- Withdrawal rate is an optional standing option, not a household column (see B10).

## Tests

401k ignored for reserved/leftover; leftover can be 0; roof year and seed replacement costs move reserved; realized shocks drop out of reserved.
