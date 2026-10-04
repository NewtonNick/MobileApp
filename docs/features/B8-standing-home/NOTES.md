# B8 — Standing sentence on home

**Status:** done in code (not device QA)

## Done when

Edit cash or roof year → sentence updates with no save dialog.

## What changed

- `HouseholdProvider` memos a live `standingView` from books + scenario + withdrawal rate. It is not written to kv.
- Cash tab hero is that sentence (hired date, reserved vs leftover, house/car constraint).
- Cash field on home calls `setHousehold` immediately (Update cash / onEndEditing). Looks-wrong roof year does the same.
- No Plus gate on this screen.
