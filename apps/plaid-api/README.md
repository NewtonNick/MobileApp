# Plaid sidecar

Holds Plaid access tokens only. They are encrypted on disk and never returned to the phone. Household books stay on the device.

Sandbox is free. Trial (`PLAID_ENV=trial`) uses `https://production.plaid.com` and stops at 10 Items for the team. Removing an Item does not free a slot. Do not submit a paid Production application until a second household needs a live link, and read the per-Item fee on the last page of that application first.

Register the Android package `app.assetaware.mobile` for OAuth banks in the Plaid dashboard before linking a real institution.

```bash
pip install -r requirements.txt
set PLAID_CLIENT_ID=...
set PLAID_SECRET=...
set PLAID_ENV=sandbox
set PLAID_SIDECAR_TOKEN=choose-a-long-random-string
uvicorn main:app --port 8787 --host 0.0.0.0
```

The phone sends `PLAID_SIDECAR_TOKEN` as `X-Plaid-Sidecar-Token` on every call except `/health`.

`EXPO_PUBLIC_PLAID_API_URL` is that server. On a physical phone use the laptop’s LAN address, not `127.0.0.1`. Set `EXPO_PUBLIC_PLAID_SIDECAR_TOKEN` to the same shared secret.

`PLAID_TOKEN_STORE` defaults to `token-store.bin` beside this file. The key is `PLAID_TOKEN_KEY`, or the shared secret when that is unset.
