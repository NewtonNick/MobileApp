# Public cost-data ETL

Builds versioned seed JSON in `data/seed/` from official downloads and attributed published tables.

```bash
python packages/data-etl/run.py
```

Requires Python 3.12+ and `pip install -r packages/data-etl/requirements.txt`.

If a download fails, the script keeps the existing attributed seed and prints the error. It never scrapes sites that forbid it.

Optional `FRED_API_KEY` refreshes CPI series. EPA vehicles refresh the catalog via fueleconomy.gov.
