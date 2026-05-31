/* ============================================================================
   Compound — projection engine
   ----------------------------------------------------------------------------
   Implements the projection loop and sub-functions from compound-engine-spec.md.
   All statutory figures come from constants.js (CompoundConstants); this file
   contains only logic.

   Reconciliations vs the spec, applied per the build brief:
   - Savings model: savings = saveRate * takeHome; expenses = takeHome - savings
     (the design exposes a "Savings rate", not an absolute expenses figure).
   - Half-year growth: new money earns a half-year of return; the existing
     balance earns a full year. routeSavings therefore does NOT pre-add new
     money into `investments` (step 9 applies it with the half-year factor),
     which avoids the double-count latent in literally reading spec 5.5 + step 9.
   - All money in `results[]` is NOMINAL; the real/nominal toggle only changes a
     display-time deflator, so it is instant and lossless.
   ============================================================================ */
(function (global) {
  'use strict';

  var C = global.CompoundConstants;

  function num(v, fallback) {
    if (v === '' || v === null || v === undefined) return fallback;
    var n = Number(v);
    return isFinite(n) ? n : fallback;
  }

  /* -------------------------------------------------------------- band lookup */
  // Resolve a person's contribution/allocation band by age (first band whose
  // maxAge >= age, scanning ascending).
  function resolveBand(age) {
    var bands = C.CONTRIBUTION_BANDS;
    for (var i = 0; i < bands.length; i++) {
      if (age <= bands[i].maxAge) return bands[i];
    }
    return bands[bands.length - 1];
  }

  /* ----------------------------------------------------------- 5.1 computeCPF */
  function computeCPF(salary, bonus, age) {
    var band = resolveBand(age);
    var owAnnual = Math.min(salary / 12, C.OW_CEILING_MONTHLY) * 12;
    var awCeiling = Math.max(0, C.ANNUAL_SALARY_CEILING - owAnnual);
    var aw = Math.min(bonus, awCeiling);
    var wageBase = owAnnual + aw;

    var total = Math.min(wageBase * band.total, C.CPF_ANNUAL_LIMIT);
    // split employee/employer proportionally so the annual-limit cap is respected
    var employee = total * (band.employee / band.total);
    var employer = total - employee;
    return { total: total, employee: employee, employer: employer, wageBase: wageBase };
  }

  /* --------------------------------------------------------- 5.2 allocateCPF */
  function allocateCPF(total, age, state) {
    var band = resolveBand(age);
    var oaAmt = total * (band.oa / band.total);
    var maAmt = total * (band.ma / band.total);
    var retireAmt = total * (band.retire / band.total);

    state.oa += oaAmt;
    state.ma += maAmt;            // BHS overflow ignored in v1 (see spec scope)

    if (age < 55) {
      state.sa += retireAmt;
    } else {
      // 55+: retirement contributions fill RA up to FRS, remainder to OA
      var room = Math.max(0, C.FRS - state.ra);
      var toRA = Math.min(retireAmt, room);
      state.ra += toRA;
      state.oa += (retireAmt - toRA);
    }
  }

  // RSTU-style voluntary top-up to the retirement bucket (SA under 55, RA 55+).
  function applyVoluntaryTopup(amount, age, state) {
    if (!amount || amount <= 0) return;
    if (age < 55) state.sa += amount;
    else state.ra += amount;
  }

  /* ----------------------------------------------------------- 5.3 incomeTax */
  function incomeTax(chargeable) {
    if (chargeable <= 0) return 0;
    var bands = C.TAX_BANDS;
    var band = bands[0];
    for (var i = 0; i < bands.length; i++) {
      if (chargeable >= bands[i].floor) band = bands[i];
      else break;
    }
    return band.cumAtFloor + (chargeable - band.floor) * band.rate;
  }

  /* ----------------------------------------------------- 5.4 applyCpfInterest */
  // Interest on beginning-of-year balances after this year's contributions
  // (conservative annual approximation of CPF's monthly method). Base interest
  // stays in its own account; extra interest is credited to SA (<55) or RA (55+).
  function applyCpfInterest(age, state) {
    var baseOA = state.oa * C.OA_RATE;
    var baseSA = state.sa * C.SMRA_RATE;
    var baseMA = state.ma * C.SMRA_RATE;
    var baseRA = state.ra * C.SMRA_RATE;

    var oaCounted = Math.min(state.oa, C.EXTRA_OA_CAP);
    var extra;
    if (age < 55) {
      var eligible = Math.min(C.EXTRA_UNDER55_TIER, oaCounted + state.sa + state.ma + state.ra);
      extra = eligible * C.EXTRA_UNDER55_RATE;
    } else {
      var combined = oaCounted + state.sa + state.ma + state.ra;   // sa is 0 after settle55
      var tier1 = Math.min(C.EXTRA_55PLUS_TIER1, combined) * C.EXTRA_55PLUS_RATE1;
      var tier2 = Math.min(C.EXTRA_55PLUS_TIER2, Math.max(0, combined - C.EXTRA_55PLUS_TIER1)) * C.EXTRA_55PLUS_RATE2;
      extra = tier1 + tier2;
    }

    // credit base to own accounts
    state.oa += baseOA;
    state.sa += baseSA;
    state.ma += baseMA;
    state.ra += baseRA;
    // credit extra interest to SA (<55) or RA (55+)
    if (age < 55) state.sa += extra;
    else state.ra += extra;
  }

  /* ---------------------------------------------------------- 5.5 routeSavings */
  // Returns newlyInvestedThisYear. Does not pre-grow money (step 9 does the
  // growth). On a shortfall, draws cash first, then investments.
  function routeSavings(savings, expenses, state, cashTargetMonths) {
    if (savings >= 0) {
      var targetCash = (expenses / 12) * cashTargetMonths;
      var needed = Math.max(0, targetCash - state.cash);
      var toCash = Math.min(savings, needed);
      state.cash += toCash;
      return savings - toCash;                 // newly invested (added in step 9)
    }
    // shortfall: draw cash, then investments
    var shortfall = -savings;
    var fromCash = Math.min(state.cash, shortfall);
    state.cash -= fromCash;
    state.investments -= (shortfall - fromCash);
    if (state.investments < 0) state.investments = 0;   // clamp (flagged via shortfall)
    return 0;
  }

  /* -------------------------------------------------------------- 5.6 settle55 */
  function settle55(state) {
    // create RA from SA, then top up from OA toward FRS
    state.ra += state.sa;
    state.sa = 0;
    var room = Math.max(0, C.FRS - state.ra);
    var fromOA = Math.min(state.oa, room);
    state.ra += fromOA;
    state.oa -= fromOA;
    state.ra55Settled = true;
    // excess OA stays in OA (withdrawable in reality; kept as Liquid here)
  }

  /* ---------------------------------------------- starting CPF balance estimate */
  // Used only when the user leaves OA/SA/MA blank. Rough proxy assuming a career
  // from age 23 at ~70% of current salary, split by the typical young-worker
  // allocation. Not a statutory figure — purely a convenience default.
  function estimateCpf(age, annualSalary) {
    var years = Math.max(0, age - 23);
    var avg = annualSalary * 0.7;
    return {
      oa: avg * 0.23 * years * 0.55,
      sa: avg * 0.06 * years * 1.30,
      ma: avg * 0.08 * years * 0.80
    };
  }

  /* ------------------------------------------------------------- promotions */
  // Combined one-off bump multiplier for an exact age, from [{age, pct}, ...].
  function bumpFor(promotions, age) {
    var add = 0;
    for (var k = 0; k < promotions.length; k++) {
      var ba = num(promotions[k].age, NaN);
      var bp = num(promotions[k].pct, NaN);
      if (!isNaN(ba) && !isNaN(bp) && Math.round(ba) === age) add += bp / 100;
    }
    return add;
  }

  /* ============================================================ projection loop */
  // s = UI state (see main.js). Returns { rows, startAge, endAge, mode } where
  // every money field is deflated to today's dollars when mode === 'real'.
  function project(s, mode) {
    mode = mode || 'real';

    var currentAge   = num(s.age, 30);
    var projectToAge = num(s.untilAge, 65);
    var startSalary  = num(s.salary, 7500) * 12;     // UI salary is gross MONTHLY
    var startInvest  = num(s.investments, 0);         // combined cash + investments
    var annualReturn = num(s.returnPct, 5) / 100;
    var saveRate     = num(s.savingsRate, 40) / 100;
    var annualRaise  = num(s.salaryIncreasePct, 3) / 100;
    var inflation    = num(s.inflationPct, 2.5) / 100;
    var bonusMonths  = num(s.bonusMonths, 0);
    var topup        = num(s.cpfTopup, 0);
    var cashMonths   = num(s.cashTargetMonths, 6);
    var promotions   = Array.isArray(s.payBumps) ? s.payBumps : [];

    if (projectToAge < currentAge) projectToAge = currentAge;

    // Starting CPF balances (estimate when blank)
    var est = estimateCpf(currentAge, startSalary);

    var state = {
      cash: 0,
      investments: startInvest,
      oa: num(s.oa, est.oa),
      sa: num(s.sa, est.sa),
      ma: num(s.ma, est.ma),
      ra: 0,
      ra55Settled: false,
      cumTaxPaid: 0,
      cumContributed: 0
    };

    var nominal = [];
    var salary = startSalary;
    var age = currentAge;

    for (var yearIndex = 0; age <= projectToAge; yearIndex++, age++) {
      // ---- 1. SALARY ----
      if (yearIndex === 0) salary = startSalary;
      else salary = salary * (1 + annualRaise);
      salary = salary * (1 + bumpFor(promotions, age));   // one-off pay bump this age
      var bonus = (salary / 12) * bonusMonths;             // Additional Wages

      // ---- 2. CPF CONTRIBUTIONS ----
      var cpf = computeCPF(salary, bonus, age);

      // ---- 3. ALLOCATE CONTRIBUTIONS ----
      allocateCPF(cpf.total, age, state);
      applyVoluntaryTopup(topup, age, state);

      // ---- 4. INCOME TAX ----
      var cpfRelief = cpf.employee;                        // employee CPF is deductible
      var chargeable = Math.max(0, salary + bonus - cpfRelief);
      var tax = incomeTax(chargeable);

      // ---- 5. TAKE-HOME ----
      var takeHome = salary + bonus - cpf.employee - tax;

      // ---- 6/7. SAVINGS & EXPENSES (savings-rate model per build brief) ----
      var savings = saveRate * takeHome;
      var expenses = takeHome - savings;

      // ---- 8. ROUTE SAVINGS / DRAWDOWN ----
      var newlyInvested = routeSavings(savings, expenses, state, cashMonths);

      // ---- 9. INVESTMENT GROWTH (half-year convention on new money) ----
      state.investments = state.investments * (1 + annualReturn)
                        + newlyInvested * Math.pow(1 + annualReturn, 0.5);

      // ---- 10. CPF INTEREST ----
      applyCpfInterest(age, state);

      // ---- 11. AGE-55 TRANSITION (once) ----
      if (age >= 55 && !state.ra55Settled) settle55(state);

      // ---- 12. RECORD (nominal) ----
      var invest = state.cash + state.investments;
      var cpfTotal = state.oa + state.sa + state.ma + state.ra;
      var liquid = state.cash + state.investments + state.oa;
      var locked = state.sa + state.ma + state.ra;

      state.cumTaxPaid += tax;
      state.cumContributed += cpf.total;

      nominal.push({
        age: age,
        yearIndex: yearIndex,
        salary: salary + bonus,            // gross annual incl. bonus (table "Salary")
        monthly: salary / 12,              // base monthly (salary chart, excl. bonus)
        takeHome: takeHome,
        tax: tax,
        expenses: expenses,
        savings: savings,
        invest: invest,                    // cash + investments
        cpf: cpfTotal,                     // oa + sa + ma + ra
        liquid: liquid,                    // cash + investments + oa
        locked: locked,                    // sa + ma + ra
        oa: state.oa,
        sa: state.sa,                      // raw Special Account (0 after settle55)
        ma: state.ma,
        ra: state.ra,
        total: invest + cpfTotal,          // = net worth
        cpfContributedThisYear: cpf.total,
        cumTaxPaid: state.cumTaxPaid
      });
    }

    // ---- DISPLAY: deflate to today's dollars when real ----
    // The table shows OA / SA / MA columns. Post-55 the retirement money lives in
    // RA, so the "SA" column reflects the retirement-account lineage (SA pre-55,
    // RA post-55); the total already includes everything.
    var rows = nominal.map(function (r) {
      var d = (mode === 'real') ? Math.pow(1 + inflation, r.yearIndex) : 1;
      var saCol = r.age >= 55 ? r.ra : r.sa;   // retirement-account lineage
      return {
        age: r.age,
        salary: r.salary / d,
        monthly: r.monthly / d,
        takeHome: r.takeHome / d,
        expenses: r.expenses / d,
        savings: r.savings / d,
        invest: r.invest / d,
        cpf: r.cpf / d,
        liquid: r.liquid / d,
        locked: r.locked / d,
        oa: r.oa / d,
        sa: saCol / d,
        ma: r.ma / d,
        ra: r.ra / d,
        total: r.total / d,
        cumTaxPaid: r.cumTaxPaid / d
      };
    });

    return { rows: rows, startAge: currentAge, endAge: projectToAge, mode: mode };
  }

  /* ----------------------------------------------------------- formatting */
  function fmtMoney(v) {
    return '$' + Math.round(v).toLocaleString('en-SG');
  }
  function fmtCompact(v) {
    var abs = Math.abs(v);
    if (abs >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
    if (abs >= 1e3) return '$' + Math.round(v / 1e3) + 'k';
    return '$' + Math.round(v);
  }
  function fmtMillions(v) {
    if (Math.abs(v) >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
    if (Math.abs(v) >= 1e3) return '$' + Math.round(v / 1e3) + 'k';
    return '$' + Math.round(v);
  }

  global.CompoundEngine = {
    project: project,
    // exposed for tests / reuse
    computeCPF: computeCPF,
    allocateCPF: allocateCPF,
    incomeTax: incomeTax,
    applyCpfInterest: applyCpfInterest,
    settle55: settle55,
    resolveBand: resolveBand,
    fmtMoney: fmtMoney,
    fmtCompact: fmtCompact,
    fmtMillions: fmtMillions,
    num: num
  };
})(typeof window !== 'undefined' ? window : globalThis);
