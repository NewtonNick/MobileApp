# Asset Aware — status

What exists in the repo vs what is still open. Update this file when a milestone is verified, not when a screen is first sketched.

**Contract:** [DESIGN.md](./DESIGN.md)  
**Backlog (deferred):** [BACKLOG.md](./BACKLOG.md)  
**In-scope tickets:** [WORK.md](./WORK.md)  
**Full original steps:** [PLAN.md](./PLAN.md)  
**Data citations:** [SOURCES.md](./SOURCES.md)  
**Thesis:** kept outside this repo.

## Now (2026-09-08)

Track G is in code: take-home pay is load-bearing, home is an elected-goals board, Forecast/Compare use SVG line graphs. Engine tests 56/56. Founder still owns Track A device QA.

Android Studio, OpenJDK 21, the SDK, and a **Pixel_8_API_36** emulator are installed. A1–A3 are founder QA.

## Built in code

| Area | Where | Honest limit |
| --- | --- | --- |
| Expo Router screens (unlock, disclaimer, onboarding, Cash / Forecast / Risk / More, compare, accounts, looks-wrong, backup, Plaid, event) | `apps/mobile/src/app/` | UI is first-pass. Not device-QA’d against R1–R17 done-whens. |
| L/R/C forecast engine + 9 unit tests | `packages/forecast-engine` | Tests are Node, not on-device. |
| Public seed tables | `data/seed/` | Class/ZIP distributions, not shop quotes. |
| ETL | `packages/data-etl/run.py` | Needs Python on PATH when you refresh. |
| Plaid sidecar | `apps/plaid-api` | Real link, exchange, and paged sync. Tokens encrypted on the sidecar. Phone uses `react-native-plaid-link-sdk` (rebuild the dev client). Sandbox cannot write the real household. No-keys outlier still works. |
| Local books | `expo-sqlite` with SQLCipher when the build provides it | Release builds fail closed if the file cannot be encrypted. Dev builds may seal values inside the file instead. |
| PIN / backup | SecureStore scrypt PIN + passphrase backup | Backup v3 uses scrypt. v1 XOR files are rejected except through the old-backup import. |
| Web preview | `npx expo start --web` | Memory only. Nothing is saved. |

## Not built / not verified (the remaining work)

Product tickets through Track E (except Plaid) are in [WORK.md](./WORK.md). Founder device QA is Track A there.

Do the Android daily loop (below) in parallel unless [DESIGN.md](./DESIGN.md) cut-order says otherwise. SQLCipher at-rest, Plaid Link, EAS, and store listing are [BACKLOG.md](./BACKLOG.md), not this list.

### 1. Make the Android build the daily loop

- Open a **new** terminal (so `ANDROID_HOME` / `JAVA_HOME` / `GRADLE_USER_HOME` apply).
- Start the emulator (`Pixel_8_API_36`) if it is not running.
- `cd apps/mobile` then `npx expo run:android` once if the APK is missing; day to day `npx expo start --dev-client`.
- Walk R1–R17 on the emulator (four-field forecast, Not sure, vehicle search, debt-link, cash homepage vs illiquid tab, backup, Preview isolation).
- Do **not** use Expo Go.

### 2. Close the vault gap (plan promised encryption)

- Backup files are AES-256-GCM. Remaining: replace plain `expo-sqlite` with SQLCipher-class storage (op-sqlite or equivalent).
- Prove: export → wipe app → import restores the same household and seed vintage.

### 3. Plaid on a device

- Rebuild the Android dev client so `react-native-plaid-link-sdk` is in the binary.
- Sandbox outlier still works with no keys. A sandbox sync must not change the real household.
- Trial: `PLAID_ENV=trial`, production host, ≤10 Items. Do not submit paid Production until the per-Item fee is known.
- Link failure must not wipe the ledger. Register `app.assetaware.mobile` in the Plaid dashboard before an OAuth bank.

### 4. EAS (optional for Android, required for iOS from Windows)

- `npx eas-cli login` then `eas init` (replace `replace-after-eas-init` in `app.json`).
- iOS only after an Apple Developer account.

### 5. Plan “done-when” still open

These are in [PLAN.md](./PLAN.md) and are **not** all proven:

- Completeness score / next-best-question chip behavior on device
- Debt “same bill?” property in the real UI, not only engine tests
- Stale-cash 30-day banner; 14-day backup banner
- Notification cap (≤1/day, ≤3 all-clears)
- Vintage on every risk card; 18-month seed banner
- Monte Carlo fan only in Compare → Advanced
- Physical-device pass of the success bar (explain 5-year path from sources; roof age / mileage move the forecast)

### 6. Explicitly later

Moved to [BACKLOG.md](./BACKLOG.md) (`later`, `unresolved`, `out-of-scope`). Do not grow this list here.

## Machine notes (this PC)

- `JAVA_HOME` = Microsoft OpenJDK 21
- `ANDROID_HOME` = `%LOCALAPPDATA%\Android\Sdk`
- `GRADLE_USER_HOME` should be a short path. A long sandbox Gradle cache can hit the Windows path limit.
- Emulator: `Pixel_8_API_36`
- EAS: not logged in
