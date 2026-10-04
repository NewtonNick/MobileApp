# G1 — Plaid sidecar

**Status:** freeze lifted 2026-09-26

The sidecar now does real link, exchange, and paged `transactions/sync`. Access tokens stay encrypted on the sidecar behind `PLAID_SIDECAR_TOKEN`. They are not in household JSON or the backup.

Trial (`PLAID_ENV=trial`) may use `https://production.plaid.com` and stops at 10 Items. Paid Production is still not this step. Sandbox sync cannot write the real household. A failed link leaves the books.

The stable Plaid user id is on the household and comes back with a backup.
