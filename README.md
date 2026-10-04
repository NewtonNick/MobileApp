# Asset Aware

Local-first household planner for house and car ownership costs. Planning estimates, not a bank, not advice.

| Doc | What it is |
| --- | --- |
| [docs/DESIGN.md](docs/DESIGN.md) | Living product contract |
| [docs/PLAN.md](docs/PLAN.md) | Original full steps (weeks, R1–R17, architecture) |
| [docs/STATUS.md](docs/STATUS.md) | Built vs remaining work |
| [docs/BACKLOG.md](docs/BACKLOG.md) | Deferred features (later / unresolved / out of scope) |
| [docs/WORK.md](docs/WORK.md) | In-scope MVP tickets |
| [docs/consumer/SCOPE.md](docs/consumer/SCOPE.md) | Post-MVP consumer scope and gap tracker |
| [docs/SOURCES.md](docs/SOURCES.md) | Seed citations and banned sources |

**Do not use Expo Go.** Native modules need the Android development build.

## Run on the emulator (this machine)

Android Studio, OpenJDK 21, and AVD **Pixel_8_API_36** are installed. Use a **new** terminal so env vars apply.

```bash
cd apps/mobile
npx expo run:android
```

First compile is slow. After the app is installed:

```bash
npx expo start --dev-client
```

Rebuild with `run:android` only when native modules change.

Web is a first-flow preview only (localStorage, not the vault):

```bash
cd apps/mobile
npx expo start --web
```

## Layout

- `apps/mobile` — Expo (Android first)
- `packages/forecast-engine` — Liberal / Realistic / Conservative math
- `packages/data-etl` — public data refresh into `data/seed`
- `apps/plaid-api` — secrets only; Sandbox then free Trial (max 10 Items). **Do not apply for paid Production.**

## Tests

```bash
npm run check
```

That runs typecheck, lint, the engine tests, the mobile tests, the bank-sync tests, and `pytest apps/plaid-api`. `npm test` is the same suite without typecheck, lint, or pytest.
