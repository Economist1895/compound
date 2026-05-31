# Compound

**See where your money is headed.** A single-page net-worth forecasting tool for
Singapore citizens. It projects your cash, investments, and CPF from today to a
target age — modelling salary growth, bonuses, CPF contributions and interest,
income tax, and the age-55 SA→RA transition.

🔗 **Live:** https://economist1895.github.io/compound/

Everything runs in your browser. There is **no backend, no account, and no
persistence** — nothing you type is stored or sent anywhere, and the page resets
on reload.

---

## What it does

- **Five inputs to start:** current age, gross monthly salary, annual bonus,
  current investments + cash, expected return, and savings rate. Refine the rest
  (base raise, salary milestones, inflation, target age, voluntary CPF top-ups,
  and CPF starting balances) in the collapsible sections.
- **Flexible salary growth** — set a base annual raise, and/or pin your expected
  gross monthly salary at specific ages ("milestones"). The salary curve runs
  from today's pay through each milestone (geometric interpolation), then resumes
  the base raise beyond the last. Milestones honour the real/nominal toggle.
- **Projects net worth** year by year, split into **Investments** (cash + market)
  and **CPF** (OA · SA · MediSave · RA).
- **Real or nominal** — toggle between today's dollars and future dollars
  instantly; the toggle only changes the display, never the underlying figures.
- **Charts + a full year-by-year table**, including an optional CPF account
  breakdown.

## How the projection works

Each year, in this (load-bearing) order:

```
salary → CPF contributions → allocate to OA/SA/MA → income tax → take-home
→ savings (= savings-rate × take-home) → expenses (the remainder)
→ route savings (build cash buffer, invest the rest)
→ investment growth (half-year convention on new money)
→ CPF interest (base + extra) → age-55 SA→RA transition (once) → record
```

The full specification lives in [`compound-engine-spec.md`](compound-engine-spec.md).

## Data sources

All statutory figures are isolated in [`constants.js`](constants.js) so a yearly
rules update is a one-line edit, never a logic change. They were verified on
**2026-05-31** against:

- **[CPF Board](https://www.cpf.gov.sg)** — contribution & allocation rates
  (from 1 Jan 2026), OW ceiling ($8,000/mo), annual salary ceiling ($102,000),
  CPF Annual Limit ($37,740), interest rates (OA 2.5%, SA/MA/RA 4%) and extra
  interest tiers, Full Retirement Sum ($220,400), and Basic Healthcare Sum
  ($79,000).
- **[IRAS](https://www.iras.gov.sg)** — resident individual income tax brackets
  (YA2024 structure, 0%–24%).

> **Maintainers:** re-check each block in `constants.js` against the linked
> authority before each tax year and bump the `lastVerified` date.

## Tech stack

Vanilla HTML, CSS, and JavaScript — no framework, no build step. The only
external dependency is [Chart.js](https://www.chartjs.org/) (loaded from cdnjs)
for the charts.

| File | Role |
|---|---|
| [`index.html`](index.html) | Page shell; loads the scripts |
| [`style.css`](style.css) | Styling (light theme, single accent, responsive at 768px) |
| [`constants.js`](constants.js) | All CPF & tax figures (the only thing to update yearly) |
| [`engine.js`](engine.js) | The projection loop and sub-functions |
| [`main.js`](main.js) | UI wiring — connects inputs to the engine, renders chart + table |

## Run locally

No build step — open `index.html` directly, or serve it statically:

```bash
python3 -m http.server 8000
# then visit http://127.0.0.1:8000/
```

(Chart.js loads from a CDN, so the charts need an internet connection on first
load.)

## Deploy (GitHub Pages)

The app is served straight from the repository root. In the repo:
**Settings → Pages → Build and deployment → Source: _Deploy from a branch_ →
Branch: `main` / `/ (root)`**. The site publishes at
`https://<user>.github.io/compound/`.

## Limitations

These are deliberate v1 simplifications (directional forecast, not advice):

- No housing / OA drawdown for a mortgage — OA growth is optimistic for anyone
  servicing one.
- No CPF LIFE payouts — the model ends at accumulated net worth; it does not
  spend it down after 65.
- No MediSave→OA overflow at the Basic Healthcare Sum, no $80k tax-relief cap,
  no tax rebates.
- CPF interest uses an annual (post-contribution) approximation of CPF's monthly
  method — intentionally conservative.
- Singapore **citizen** only (no PR graduated rates).

**All projections are estimates. Returns, raises, and inflation are your
assumptions, not predictions.**
