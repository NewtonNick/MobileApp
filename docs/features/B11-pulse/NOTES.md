# B11 — Pulse (R9 only)

**Status:** done in code (not device QA)

## Done when

Stale banner shows; realized shock drops out of reserved.

## What changed

Home shows last-edited cash age and the 30-day stale-cash banner from `pulseReasons`. “I already paid {shock}” appends to `realizedEventKeys`; the walker then omits that hit so reserved falls. No weekly ceremony. Notification caps are unchanged in `notifications.ts`.
