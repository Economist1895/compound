/* ============================================================================
   Compound — PLACEHOLDER projection engine
   ----------------------------------------------------------------------------
   This is ILLUSTRATIVE ONLY. It is NOT the real financial model. It exists so
   the wireframe's chart, hero number and table respond sensibly to the inputs.
   The real CPF / tax / projection engine will be supplied at the coding stage.
   ============================================================================ */
(function (global) {
  'use strict';

  function num(v, fallback) {
    if (v === '' || v === null || v === undefined) return fallback;
    var n = Number(v);
    return isFinite(n) ? n : fallback;
  }

  // Rough estimate of CPF starting balances if the user left them blank.
  function estimateCpf(age, salary) {
    var years = Math.max(0, age - 23);            // assume career from 23
    var avg = salary * 0.7;                        // rough lifetime-average proxy
    var oa = avg * 0.23 * years * 0.55;
    var sa = avg * 0.23 * years * 0.25;
    var ma = avg * 0.23 * years * 0.20;
    return { oa: oa, sa: sa, ma: ma };
  }

  /* Returns an object:
     { rows: [ {age, salary, takeHome, expenses, savings, liquid, locked,
                oa, sa, ma, total} ... ],
       startAge, endAge, mode } */
  function project(s, mode) {
    mode = mode || 'real';
    var startAge   = num(s.age, 30);
    var endAge     = num(s.untilAge, 65);
    var salary     = num(s.salary, 7500) * 12;   // input is gross MONTHLY salary
    var invest     = num(s.investments, 100000);   // cash + investments (liquid)
    var ret        = num(s.returnPct, 5) / 100;
    var infl       = num(s.inflationPct, 2.5) / 100;
    var salInc     = num(s.salaryIncreasePct, 3) / 100;
    var bonusM     = num(s.bonusMonths, 2);
    var topup      = num(s.cpfTopup, 0);
    var saveRate   = num(s.savingsRate, 40) / 100;

    // one-off pay bumps: { age, pct }. Returns the combined multiplier for an age.
    var bumps = Array.isArray(s.payBumps) ? s.payBumps : [];
    function bumpAt(age) {
      var add = 0;
      for (var k = 0; k < bumps.length; k++) {
        var ba = num(bumps[k].age, NaN), bp = num(bumps[k].pct, NaN);
        if (!isNaN(ba) && !isNaN(bp) && Math.round(ba) === age) add += bp / 100;
      }
      return add;
    }

    // CPF starting balances (estimate if blank)
    var est = estimateCpf(startAge, salary);
    var oa = num(s.oa, est.oa);
    var sa = num(s.sa, est.sa);
    var ma = num(s.ma, est.ma);

    var rows = [];
    var yearIndex = 0;
    for (var a = startAge; a <= endAge; a++) {
      // apply any one-off pay bump on reaching this age
      salary = salary * (1 + bumpAt(a));
      var inflFactor = Math.pow(1 + infl, yearIndex);
      var bonus = salary * (bonusM / 12);
      var gross = salary + bonus;

      // --- illustrative CPF + tax ---
      var empCpf = gross * 0.20;                    // employee share
      var erCpf  = gross * 0.17;                    // employer share
      var totalCpf = empCpf + erCpf;
      var tax = gross * 0.07;                        // crude effective rate
      var takeHome = gross - empCpf - tax;

      // CPF split (illustrative allocation of total contributions)
      var oaAdd = totalCpf * 0.55;
      var saAdd = totalCpf * 0.25;
      var maAdd = totalCpf * 0.20 + topup;

      // Savings rate drives the split of take-home into savings vs expenses.
      // Expenses are whatever is left after saving, so they scale with income.
      var savings = takeHome * saveRate;
      var expenses = takeHome - savings;

      // grow balances
      invest = invest * (1 + ret) + Math.max(savings, -invest);
      oa = oa * 1.025 + oaAdd;
      sa = sa * 1.04 + saAdd;
      ma = ma * 1.04 + maAdd;

      // Two top-level buckets: Investments (cash + market) and CPF (OA+SA+MA)
      var cpf = oa + sa + ma;
      var liquid = invest + oa;       // retained for the breakdown table
      var locked = sa + ma;
      var total = invest + cpf;

      // real vs nominal
      var d = (mode === 'real') ? inflFactor : 1;

      rows.push({
        age: a,
        salary: gross / d,
        monthly: (salary / 12) / d,
        takeHome: takeHome / d,
        expenses: expenses / d,
        savings: savings / d,
        invest: invest / d,
        cpf: cpf / d,
        liquid: liquid / d,
        locked: locked / d,
        oa: oa / d,
        sa: sa / d,
        ma: ma / d,
        total: total / d
      });

      salary = salary * (1 + salInc);
      yearIndex++;
    }

    return { rows: rows, startAge: startAge, endAge: endAge, mode: mode };
  }

  /* ---- formatting helpers ---- */
  function fmtMoney(v) {
    var n = Math.round(v);
    return '$' + n.toLocaleString('en-SG');
  }
  function fmtCompact(v) {
    var abs = Math.abs(v);
    if (abs >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
    if (abs >= 1e3) return '$' + Math.round(v / 1e3) + 'k';
    return '$' + Math.round(v);
  }
  function fmtMillions(v) {
    return '$' + (v / 1e6).toFixed(1) + ' M';
  }

  global.CompoundEngine = {
    project: project,
    fmtMoney: fmtMoney,
    fmtCompact: fmtCompact,
    fmtMillions: fmtMillions,
    num: num
  };
})(window);
