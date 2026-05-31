# Compound — Projection Engine Spec

**Purpose of this document.** This is the source-of-truth specification for the calculation engine behind *Compound*, a single-page, client-side net-worth forecasting tool for a Singapore citizen. Hand this to Claude Code alongside the Claude Design bundle. The design bundle defines the UI; **this document defines all logic and must override any placeholder calculations in the design.**

**Build target.** Static site for GitHub Pages. No backend, no accounts. All computation runs in the browser. **No persistence:** all state lives in memory only (React state or plain JS objects) and resets on page reload. Do **not** use `localStorage`, `sessionStorage`, or URL query params for state. All financial constants live in a single `constants` module so a yearly rules update is a one-line edit, never a logic change.

---

## 1. Scope

**In scope (v1):**
- Singapore **citizen** only (no PR graduated rates, no residency branching).
- Accumulation phase: project net worth from current age to a target age.
- Two parallel sub-systems: a cash/investment engine and a CPF engine.
- Annual time steps.
- Resident income tax with automatic CPF relief.
- Net worth split into **Liquid** (cash + investments + CPF OA) and **Locked** (SA/RA + MA).
- Real (inflation-adjusted) and nominal output, user-toggleable.

**Explicitly out of scope (do NOT build in v1 — leave clean extension points):**
- Housing / OA drawdown for a mortgage.
- CPF LIFE decumulation (payouts after 65). The engine stops at net worth; it does not spend it down.
- MediSave overflow to OA once BHS is reached.
- PR / SPR graduated rates.
- Monte Carlo / stochastic returns (single deterministic path only).
- The $80,000 total personal income-tax relief cap (treat CPF relief as uncapped beyond the wage-ceiling cap; note this as a known minor simplification).

---

## 2. Constants (config module)

> All figures below are for **2026** and were verified against CPF Board / IRAS sources current to early 2026. Put them in one config object. Add a `lastVerified` date string and a comment on each block telling the maintainer where to re-check it yearly.

### 2.1 CPF wage ceilings & limits
```
OW_CEILING_MONTHLY      = 8000        // Ordinary Wage monthly ceiling
ANNUAL_SALARY_CEILING   = 102000      // OW + AW combined, per year
CPF_ANNUAL_LIMIT        = 37740       // max total (employee+employer) mandatory contribution / year
FRS                     = 220400      // Full Retirement Sum (cohort turning 55 in 2026)
BHS_UNDER_65            = 79000       // Basic Healthcare Sum (MediSave cap), under 65
```

### 2.2 CPF contribution & allocation by age (2026)
Allocation percentages are **% of wage** and sum to the total contribution rate for that band. Under-55 routes the retirement portion to **SA**; 55-and-over routes it to **RA**.

| Age band | Total | Employer | Employee | OA | SA/RA | MA |
|---|---|---|---|---|---|---|
| 35 and below | 37% | 17% | 20% | 23.0% | 6.0% (SA) | 8.0% |
| Above 35 to 45 | 37% | 17% | 20% | 21.0% | 7.0% (SA) | 9.0% |
| Above 45 to 50 | 37% | 17% | 20% | 19.0% | 8.0% (SA) | 10.0% |
| Above 50 to 55 | 37% | 17% | 20% | 15.0% | 11.5% (SA) | 10.5% |
| Above 55 to 60 | 34% | 16% | 18% | 12.0% | 11.5% (RA) | 10.5% |
| Above 60 to 65 | 25% | 12.5% | 12.5% | 3.5% | 11.0% (RA) | 10.5% |
| Above 65 to 70 | 16.5% | 9% | 7.5% | 1.0% | 5.0% (RA) | 10.5% |
| Above 70 | 12.5% | 7.5% | 5% | 1.0% | 1.0% (RA) | 10.5% |

Store as an array of band objects keyed by an upper-age bound, e.g. `{ maxAge: 35, total: 0.37, employee: 0.20, oa: 0.23, retire: 0.06, ma: 0.08 }`. Resolve a person's band by `age <= maxAge` (first match, ascending). Whether `retire` lands in SA or RA is decided by `age >= 55`, not by the band object.

### 2.3 CPF interest rates
```
OA_RATE   = 0.025     // 2.5% floor
SMRA_RATE = 0.04      // 4% floor (SA / MA / RA)

// Extra interest, applied to combined balances:
// Under 55: +1% on first $60,000 combined, with OA counted only up to $20,000.
// 55 and over: +2% on first $30,000 combined, +1% on next $30,000, OA counted only up to $20,000.
EXTRA_OA_CAP            = 20000
EXTRA_UNDER55_TIER      = 60000   // @ +1%
EXTRA_55PLUS_TIER1      = 30000   // @ +2%
EXTRA_55PLUS_TIER2      = 30000   // @ +1%
```
Extra interest is **credited to SA** (under 55) or **RA** (55+), not back to OA.

### 2.4 Resident income tax brackets
> Stable structure since YA2024. **Verify against IRAS for the current Year of Assessment before each tax year.** Store as marginal bands; compute tax by walking the bands.

| Chargeable income band | Marginal rate | Tax on band | Cumulative tax at top |
|---|---|---|---|
| First $20,000 | 0% | $0 | $0 |
| $20,001 – $30,000 | 2% | $200 | $200 |
| $30,001 – $40,000 | 3.5% | $350 | $550 |
| $40,001 – $80,000 | 7% | $2,800 | $3,350 |
| $80,001 – $120,000 | 11.5% | $4,600 | $7,950 |
| $120,001 – $160,000 | 15% | $6,000 | $13,950 |
| $160,001 – $200,000 | 18% | $7,200 | $21,150 |
| $200,001 – $240,000 | 19% | $7,600 | $28,750 |
| $240,001 – $280,000 | 19.5% | $7,800 | $36,550 |
| $280,001 – $320,000 | 20% | $8,000 | $44,550 |
| $320,001 – $500,000 | 22% | $39,600 | $84,150 |
| $500,001 – $1,000,000 | 23% | $115,000 | $199,150 |
| Above $1,000,000 | 24% | — | — |

---

## 3. Data structures

### 3.1 Inputs
```
inputs = {
  // Core (always visible in UI)
  currentAge:          int
  startSalaryAnnual:   number     // gross base salary, excludes bonus
  startInvestments:    number     // invested assets (cash entered separately below)
  annualReturnPct:     number     // expected investment return, e.g. 0.05
  startExpensesAnnual: number     // current annual living expenses

  // Assumptions (collapsed by default)
  startCash:           number     // liquid cash buffer (default 0)
  annualRaisePct:      number     // default 0.03
  inflationPct:        number     // default 0.025
  bonusMonths:         number     // months of salary as annual bonus (AW), default 0
  cashTargetMonths:    number     // keep N months of expenses in cash, rest invested (default 6)
  projectToAge:        int        // default 65
  voluntaryTopupRA:    number     // annual RSTU top-up to SA/RA (default 0)

  // CPF starting balances (collapsed; "leave blank to estimate")
  startOA:             number
  startSA:             number
  startMA:             number

  // Display
  showReal:            bool        // default true (today's dollars)
}
```

### 3.2 Carried state (mutated each year)
```
state = {
  age, yearIndex,           // yearIndex = 0 at currentAge
  salary, bonus,
  cash, investments,
  oa, sa, ma, ra,           // ra stays 0 until the age-55 transition
  cumTaxPaid, cumContributed
}
```
Initialise from inputs; `ra = 0`; `cumTaxPaid = 0`; `cumContributed = 0`.

### 3.3 Per-year output record (one per projected year; drives chart + table)
```
{
  year, age,
  salary, bonus, takeHome, tax, expenses, savings,
  cash, investments, oa, sa, ma, ra,
  liquidNetWorth, lockedNetWorth, netWorth,
  cpfContributedThisYear, cumTaxPaid
}
```
If `showReal`, deflate every money field by `(1 + inflationPct)^yearIndex` **at display time** (keep `results[]` in nominal terms; deflate in a selector so the toggle is instant and lossless).

---

## 4. Projection loop

Run for `yearIndex` from 0 to `(projectToAge - currentAge)` inclusive. **Order is load-bearing** — tax depends on CPF, take-home depends on tax, savings depends on take-home.

```
for each year:

  // ---- 1. SALARY ----
  if yearIndex == 0:
      salary = startSalaryAnnual
  else:
      salary = salary * (1 + annualRaisePct)
  bonus = (salary / 12) * bonusMonths            // Additional Wages (AW)

  // ---- 2. CPF CONTRIBUTIONS ----
  cpf = computeCPF(salary, bonus, age)           // { total, employee, employer }

  // ---- 3. ALLOCATE CONTRIBUTIONS TO ACCOUNTS ----
  allocateCPF(cpf.total, age, state)             // mutates oa, sa/ra, ma (see 5.2)
  applyVoluntaryTopup(voluntaryTopupRA, age, state)

  // ---- 4. INCOME TAX ----
  cpfRelief   = cpf.employee                     // employee compulsory CPF is deductible
  chargeable  = max(0, salary + bonus - cpfRelief)
  tax         = incomeTax(chargeable)

  // ---- 5. TAKE-HOME ----
  takeHome = salary + bonus - cpf.employee - tax

  // ---- 6. EXPENSES ----
  expenses = startExpensesAnnual * (1 + inflationPct)^yearIndex

  // ---- 7. SAVINGS ----
  savings = takeHome - expenses                  // may be negative

  // ---- 8. ROUTE SAVINGS / DRAWDOWN ----
  routeSavings(savings, expenses, state)         // see 5.5

  // ---- 9. INVESTMENT GROWTH (half-year convention on new money) ----
  state.investments = state.investments * (1 + annualReturnPct)
                    + newlyInvestedThisYear * (1 + annualReturnPct)^0.5
  // (track newlyInvestedThisYear inside routeSavings)

  // ---- 10. CPF INTEREST ----
  applyCpfInterest(age, state)                   // see 5.4

  // ---- 11. AGE-55 TRANSITION (only the year age first reaches/passes 55) ----
  if (age >= 55 and not state.ra55Settled):
      settle55(state)                            // see 5.6

  // ---- 12. RECORD ----
  push snapshot to results[]

  // advance
  state.cumTaxPaid += tax
  age += 1
  yearIndex += 1
```

---

## 5. Sub-functions

### 5.1 computeCPF(salary, bonus, age)
```
band      = resolveBand(age)
owAnnual  = min(salary / 12, OW_CEILING_MONTHLY) * 12
awCeiling = max(0, ANNUAL_SALARY_CEILING - owAnnual)
aw        = min(bonus, awCeiling)
wageBase  = owAnnual + aw

total     = min(wageBase * band.total, CPF_ANNUAL_LIMIT)
// split employee/employer proportionally so the annual-limit cap is respected
employee  = total * (band.employee / band.total)
employer  = total - employee
return { total, employee, employer, wageBase }
```

### 5.2 allocateCPF(total, age, state)
Allocation %s are proportional to the band total, so split the (possibly capped) `total` by those proportions. Route the retirement slice to SA if under 55, else RA — with the FRS rule for 55+.
```
band = resolveBand(age)
oaAmt     = total * (band.oa     / band.total)
maAmt     = total * (band.ma     / band.total)
retireAmt = total * (band.retire / band.total)

state.oa += oaAmt
state.ma += maAmt        // (BHS overflow ignored in v1 — see scope)

if age < 55:
    state.sa += retireAmt
else:
    // 55+: retirement contributions fill RA up to FRS, remainder to OA
    room = max(0, FRS - state.ra)
    toRA = min(retireAmt, room)
    state.ra += toRA
    state.oa += (retireAmt - toRA)
```

### 5.3 incomeTax(chargeable)
Walk the bracket array; sum marginal tax. (Equivalently use the cumulative column: find the band, add `(chargeable - bandFloor) * marginalRate` to the band's cumulative-at-floor.) No rebate modelled in v1 (the YA rebates are small and capped; note as a simplification).

### 5.4 applyCpfInterest(age, state)
Apply interest on **beginning-of-year balances after this year's contributions have been added** (a conservative approximation of CPF's monthly lowest-balance method — acceptable for a multi-decade forecast). Base interest stays in its own account; extra interest is credited to SA (under 55) or RA (55+).
```
// base
baseOA  = state.oa * OA_RATE
baseSA  = state.sa * SMRA_RATE
baseMA  = state.ma * SMRA_RATE
baseRA  = state.ra * SMRA_RATE

// extra interest (OA counted only up to EXTRA_OA_CAP)
oaCounted = min(state.oa, EXTRA_OA_CAP)
if age < 55:
    eligible = min(EXTRA_UNDER55_TIER, oaCounted + state.sa + state.ma + state.ra)
    extra    = eligible * 0.01
else:
    combined = oaCounted + state.sa + state.ma + state.ra   // sa is 0 after settle55
    tier1    = min(EXTRA_55PLUS_TIER1, combined) * 0.02
    tier2    = min(EXTRA_55PLUS_TIER2, max(0, combined - EXTRA_55PLUS_TIER1)) * 0.01
    extra    = tier1 + tier2

// credit base to own accounts
state.oa += baseOA
state.sa += baseSA
state.ma += baseMA
state.ra += baseRA
// credit extra to SA (<55) or RA (55+)
if age < 55: state.sa += extra
else:        state.ra += extra
```

### 5.5 routeSavings(savings, expenses, state)
```
newlyInvestedThisYear = 0
if savings >= 0:
    targetCash = (expenses / 12) * cashTargetMonths
    needed     = max(0, targetCash - state.cash)
    toCash     = min(savings, needed)
    state.cash += toCash
    newlyInvestedThisYear = savings - toCash
    state.investments += newlyInvestedThisYear
else:
    // shortfall: draw cash first, then investments
    shortfall = -savings
    fromCash  = min(state.cash, shortfall)
    state.cash -= fromCash
    state.investments -= (shortfall - fromCash)   // may go negative; clamp at 0 and flag
```
Expose `newlyInvestedThisYear` to step 9 (half-year growth applies only to new money; existing balance already grew for a full year).

### 5.6 settle55(state)
Runs once, the first projected year `age >= 55`.
```
// create RA from SA, then top up from OA toward FRS
state.ra += state.sa
state.sa  = 0
room = max(0, FRS - state.ra)
fromOA = min(state.oa, room)
state.ra += fromOA
state.oa -= fromOA
state.ra55Settled = true
// excess OA stays in OA (withdrawable in reality; kept as Liquid here)
```

### 5.7 Net worth (per snapshot)
```
liquidNetWorth = state.cash + state.investments + state.oa
lockedNetWorth = state.sa + state.ma + state.ra
netWorth       = liquidNetWorth + lockedNetWorth
```

---

## 6. UI wiring (engine ↔ design)

- Inputs change → re-run the full loop (it's cheap; no memoization needed for ~40 years).
- Primary chart: stacked area of `liquidNetWorth` and `lockedNetWorth` vs `age`; thin line for `salary`.
- Hero number: `netWorth` at `projectToAge`, formatted to 1 decimal place in millions if ≥ 1M.
- Real/nominal toggle: switches the display selector only; never recompute the loop.
- "Show year-by-year breakdown" → table from `results[]`.
- "Show CPF detail" → split the locked column into `oa / sa / ma / ra` (note OA is in Liquid, SA/MA/RA in Locked — label clearly).

---

## 7. Validation tests (run these before trusting output)

1. **Zero-return floor.** Set `annualReturnPct = 0`. Net worth must still rise every year — CPF interest plus positive savings guarantee it. If it's flat or falls, contributions or interest are wrong.
2. **CPF contribution check.** For a 40-year-old on $8,000/month with no bonus: annual total ≈ `min(96000 * 0.37, 37740) = 35,520`; employee ≈ `96000 * 0.20 = 19,200`. Compare against CPF Board's official contribution calculator.
3. **Ceiling bite.** Raising salary from $8,000 to $12,000/month must NOT increase CPF contributions (OW ceiling caps it), but must increase tax and take-home.
4. **Age-55 transition.** In the year age hits 55: SA → 0, RA appears, RA ≤ FRS unless starting balances already exceeded it; total CPF (oa+ma+ra) is conserved across the transition (no money created or lost).
5. **Real vs nominal.** With `inflationPct > 0`, real net worth < nominal at every year after year 0; year 0 they're equal.
6. **Tax sanity.** Chargeable income of $80,000 → tax $3,350 exactly (matches cumulative table).

---

## 8. Notes & known simplifications (carry into UI copy or a footnote)

- Annual compounding on post-contribution balances slightly **understates** CPF interest vs the real monthly method — intentionally conservative.
- No housing/OA drawdown: OA growth is optimistic for anyone servicing a mortgage from OA. This is the first feature to add in v2.
- No CPF LIFE payouts: the model ends at accumulated net worth; it does not simulate retirement spending.
- No MediSave→OA overflow at BHS, no relief cap, no tax rebate: all minor for a directional forecast.
- All projections are estimates; returns, raises, and inflation are user assumptions, not predictions. Surface this plainly in the UI.
