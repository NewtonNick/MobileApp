# Seed refresh

Restamps `data/seed/*.json`. It does not download the FHFA, AHS, or AAA tables those files cite. The app and the engine tests load the JSON directly.

```bash
python packages/data-etl/run.py
```

Python 3.12+. The script uses the standard library only.

Optional `FRED_API_KEY` updates the CPI fields in `macro_v1.json`. Without it, the script fills missing volatility fields and stamps a vintage. The EPA download collapses `vehicles.csv` into one year/make/model row per model year from 2000 through the latest year in the file. If that download fails, the existing catalog stays.
