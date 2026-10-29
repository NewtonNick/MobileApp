# Data and document sources

## Product documents

- [DESIGN.md](./DESIGN.md) is the contract. [STATUS.md](./STATUS.md) is remaining work.
- Pricing and competitor strategy stay outside this repo.

## Seed tables we ship

Versioned JSON in `data/seed/`. The app imports that folder directly.

| File | What | Citations |
| --- | --- | --- |
| `home_v1.json` | 5-year repair %, age buckets, roof/HVAC/WH lives, ZIP/metro HPI, crash/boom paths, mean-reversion half-life | Census AHS 2023, FHFA HPI 2026-Q1 (incl. GFC-like / expansion analogs), ASHRAE/DOE lives, NAHB/JCHS attributed extract |
| `vehicle_v1.json` | Class maintenance, depreciation, age/mileage multipliers, year/make/model catalog for model years 2000 through the latest EPA year | AAA Your Driving Costs 2024 class ranges (repair dollars stay class ranges, not a shop quote), BLS vehicle maintenance CPI, EPA fueleconomy.gov (one row per year, make, and model) |
| `macro_v1.json` | CPI-U, used-vehicle CPI, equity/bond vol, crash/up jump sizes, unemployment/raise rates | FRED / BLS; long-run US vol as attributed extract (not live prices) |

Loan APRs when the user skips: labeled typicals in `packages/forecast-engine/src/rates.ts` (mortgage ~6.5% Realistic, auto ~7%, student ~6.5%, card ~22%). Conservative is a harder year (higher rate). These are not lender quotes and are not in the seed tables. User-entered `apr` always wins.

Employee retirement deferrals are capped in `packages/forecast-engine/src/limits.ts` from IRS Notice 2023-75 (2024), Notice 2024-80 (2025), and Notice 2025-67 (2026). For 2026 the employee 401(k) limit is $24,500, the age-50 catch-up is $8,000, the age 60–63 catch-up is $11,250, the IRA limit is $7,500, and the IRA catch-up is $1,100. Source: [IRS COLA table](https://www.irs.gov/retirement-plans/cola-increases-for-dollar-limitations-on-benefits-and-contributions).

EV, motorcycle, and RV class rows in `vehicle_v1.json` are labeled planning estimates, not an AAA extract. Electricity for an EV uses `macro_v1.json` `electricityPricePerKwh` (a labeled 16¢/kWh planning figure, not a utility quote).

Refresh: `python packages/data-etl/run.py` (keeps attributed files if a download fails). Optional `FRED_API_KEY`.

## Do not use

- FinAtlas GitHub source (proprietary, Spaarna LLC)
- WorthFlow / monteplan as dependencies
- Firefly III code in-repo (AGPL)
- Paid RepairPal, RSMeans, 1build, HomeQuotr, KBB, Edmunds TCO until we choose to spend
- Scraping sites that forbid it

## Open source we may study

- Actual Budget (MIT) — local-first ledger UX
- Beancount — account types
- okama (MIT) — percentile presentation, later portfolios only
