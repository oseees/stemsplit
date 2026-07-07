# SalesPal

A mobile-first web app to run a small physical-products business: track **sales,
profit, and expenses**, send **PDF invoices**, record **customer payments**, and get
**AI advice** on growing sales/profit plus an end-of-week report.

Built with FastAPI + SQLite (no external database) and a vanilla-JS phone-style UI.
Local-first; ready to deploy to Railway later like the other apps.

## Run it

```bash
./run.sh
```

Then open **http://localhost:8000** (on your phone, use your computer's local IP,
e.g. `http://192.168.1.x:8000`, while on the same Wi-Fi).

First run creates `.venv`, installs deps, and makes the SQLite database at
`backend/data/salespal.db`.

## Enable AI insights (optional)

```bash
cp backend/.env.example backend/.env
# edit backend/.env and set ANTHROPIC_API_KEY=sk-ant-...
```

Without a key, everything works except the Insights tab (it shows a setup note).
Model defaults to `claude-opus-4-8`.

## Using it

1. **⚙️ Settings** (menu, top-right) — set your business name + currency. These show on invoices.
2. **📦 Products** — add what you sell with selling price + unit cost (this is how profit is calculated).
3. **👥 Customers** — optional, so invoices show who they're for.
4. **＋** (center button) — record a sale, which creates an invoice.
5. **Sales tab** — open any invoice → **📄 PDF** to download, or **Record payment**.
6. **Money tab** — log expenses, and see who still owes you (outstanding).
7. **Home** — net profit, revenue, COGS, expenses, collected vs outstanding, trend, top products.
8. **Insights** — AI advice for the selected period + a weekly report.

## How profit is calculated

- **Revenue** = total of sales (invoices) in the period
- **Cost of goods (COGS)** = unit cost × qty sold
- **Gross profit** = Revenue − COGS
- **Net profit** = Gross profit − Expenses
- **Collected** = payments received; **Outstanding** = unpaid invoice balances

## Project layout

```
sales-tracker/
  run.sh                  # one-command launcher
  backend/
    main.py               # FastAPI app + all API endpoints
    db.py                 # SQLite schema & helpers
    pdf.py                # PDF invoice generation (reportlab)
    ai.py                 # Claude advice + weekly report
    requirements.txt
    static/               # mobile-first frontend (index.html, app.js, styles.css)
    data/salespal.db      # created on first run
```

## Deploy later

It's a standard FastAPI app serving its own static frontend, so it deploys to
Railway/Render the same way as PoultryPal. The only persistent state is the SQLite
file in `backend/data/` — mount that on a volume.
