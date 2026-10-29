# Track D — finish first-pass

**Status:** in code (founder owns device QA)

## Intent

B and C shipped as form dumps. This track makes the living loop match the product rules: one next fact, change hire without wipe, Preview does not silently replace real books.

## What changed

- `nextBest()` returns a field key plus the question. Completeness chip and **Improve this job** open `/improve` for that one fact. Skip is always safe.
- Home has **Change hire**. If the new hire’s outline is already ready, it goes back to standing. Onboarding prefills and merges instead of `emptyRealHousehold` wiping accounts.
- Tour Preview asks before replacing a real household.
- Tab glyphs so Cash / Forecast / Risk / More are not broken X boxes.
- Compare → Advanced bars scale to the fan series (still not Victory/Skia — that is backlog P8).
- Home shows the 18-month seed banner when `seedStale`. Stale-cash pulse can fire one notify/day.

## Tests

`packages/forecast-engine` — “sends a Stay Afloat owner with unknown roof to the roof field.” 29 tests passing.
