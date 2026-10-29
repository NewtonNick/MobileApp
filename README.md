# Asset Aware

Local-first household planner. The phone holds the books. Forecasts are planning estimates, not a bank and not advice.

The forecast is a pure module (`packages/forecast-engine`) with a CI check. The Expo app, the Plaid sidecar, and the seed refresh sit around it.

**Do not use Expo Go.** Native modules need the Android development build.

## Check

```bash
npm run check
```

That runs typecheck, lint, the engine tests, the mobile tests, the bank-sync tests, and `pytest apps/plaid-api`. `npm test` is the same suite without typecheck, lint, or pytest.

## Run

Android development build:

```bash
cd apps/mobile
npx expo run:android
```

First compile is slow. After the app is installed:

```bash
npx expo start --dev-client
```

Rebuild with `run:android` only when native modules change.

Web is a first-flow preview only (nothing is saved):

```bash
cd apps/mobile
npx expo start --web
```

## Layout

- `apps/mobile` — Expo, Android first
- `packages/forecast-engine` — Liberal / Realistic / Conservative math
- `packages/data-etl` — refresh public tables into `data/seed`
- `apps/plaid-api` — tokens stay here. Sandbox, then free Trial (max 10 Items). Do not apply for paid Production.
