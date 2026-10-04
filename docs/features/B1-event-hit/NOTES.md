# B1 — Export EventHit

**Status:** done (engine tests; not device QA)

## Done when

Hits usable by projectors; existing tests still pass.

## What changed

- Moved `EventHit` to `packages/forecast-engine/src/types.ts` and exported it.
- Exported `plannedEvents()` and `reservedFromHits()` from `engine.ts`.
- Hits are live only. They are not stored on `HouseholdInput` and are not written to SQLite.
- Overdue system replacements used to land on month `0` and never fire in the walker. Discrete hits now clamp to month `≥ 1`.

## Tests

`packages/forecast-engine` — “exports walker hits without attaching them to the household.” 18 tests passing.
