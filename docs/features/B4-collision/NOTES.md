# B4 — projectCollision()

**Status:** done (unit test)

## Done when

Bumping a roof override changes the collision line; books unchanged.

## What changed

`projectCollision(baseStanding, shockedStanding)` diffs two live standing views. It returns a sentence line plus hired-month / leftover / reserved deltas. It does not write books and is not a Compare lab table.

## Tests

Roof cost override raises reserved, collision line mentions reserved/leftover/hired date, original household JSON is byte-stable.
