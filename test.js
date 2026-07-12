/* ============================================================================
   Compound — validation tests (compound-engine-spec.md §7 + regressions)
   ----------------------------------------------------------------------------
   Run with:  node test.js        (exits non-zero on failure)

   Run this after every yearly constants.js update — the self-consistency
   checks catch typos in the CPF bands and tax table, and the spec tests catch
   logic regressions in the engine.
   ============================================================================ */
'use strict';

require('./constants.js');
require('./engine.js');

var C = globalThis.CompoundConstants;
var E = globalThis.CompoundEngine;

var pass = 0, fail = 0;
function check(name, ok, detail) {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail !== undefined ? '  → ' + detail : ''));
  if (ok) pass++; else fail++;
}
function approx(a, b, eps) { return Math.abs(a - b) <= (eps || 1e-6); }

// Baseline inputs (mirror main.js defaults); override per test.
function inputs(over) {
  var s = {
    age: 30, salary: 7500, investments: 120000, returnPct: 5, savingsRate: 40,
    salaryIncreasePct: 3, inflationPct: 2.5, bonusMonths: 2, untilAge: 65,
    cpfTopup: 0, salaryAnchors: [], oa: 50000, sa: 20000, ma: 30000
  };
  for (var k in over) s[k] = over[k];
  return s;
}

/* ------------------------------------------------ constants self-consistency */
C.CONTRIBUTION_BANDS.forEach(function (b) {
  check('band ' + b.maxAge + ': oa+retire+ma == total',
    approx(b.oa + b.retire + b.ma, b.total, 1e-9),
    (b.oa + b.retire + b.ma) + ' vs ' + b.total);
  check('band ' + b.maxAge + ': employee+employer == total',
    approx(b.employee + b.employer, b.total, 1e-9),
    (b.employee + b.employer) + ' vs ' + b.total);
});
// Each tax band's cumAtFloor must equal the previous band's cum + its span.
for (var i = 1; i < C.TAX_BANDS.length; i++) {
  var lo = C.TAX_BANDS[i - 1], hi = C.TAX_BANDS[i];
  check('tax band $' + hi.floor + ': cumAtFloor chains',
    approx(hi.cumAtFloor, lo.cumAtFloor + (hi.floor - lo.floor) * lo.rate, 0.5),
    hi.cumAtFloor);
}
check('CPF annual limit == ceiling * max rate (mandatory never exceeds it)',
  approx(C.CPF_ANNUAL_LIMIT, C.ANNUAL_SALARY_CEILING * 0.37, 1),
  C.CPF_ANNUAL_LIMIT);

/* --------------------------------------------------------- spec §7 tests */
// 1. Zero-return floor: net worth must still rise every year.
var d1 = E.project(inputs({ returnPct: 0 }), 'nominal');
check('§7.1 zero return: net worth rises every year',
  d1.rows.every(function (r, i) { return i === 0 || r.total > d1.rows[i - 1].total; }));

// 2. CPF contribution: 40yo, $8,000/mo, no bonus.
var c2 = E.computeCPF(96000, 0, 40);
check('§7.2 CPF total = 35,520', approx(c2.total, 35520, 0.5), c2.total);
check('§7.2 CPF employee = 19,200', approx(c2.employee, 19200, 0.5), c2.employee);

// 3. Ceiling bite: $8k → $12k/mo must NOT raise CPF, but must raise take-home.
var c3a = E.computeCPF(96000, 0, 40), c3b = E.computeCPF(144000, 0, 40);
check('§7.3 CPF flat past OW ceiling', approx(c3a.total, c3b.total, 0.5));
var t3a = E.project(inputs({ age: 40, salary: 8000, bonusMonths: 0, untilAge: 41 }), 'nominal').rows[0];
var t3b = E.project(inputs({ age: 40, salary: 12000, bonusMonths: 0, untilAge: 41 }), 'nominal').rows[0];
check('§7.3 take-home rises with salary', t3b.takeHome > t3a.takeHome);
// rows expose tax as cumTaxPaid; at row 0 that IS the first year's tax
check('§7.3 tax rises with salary', t3b.cumTaxPaid > t3a.cumTaxPaid);

// 4. Age-55 transition: SA → 0, RA ≤ FRS, CPF conserved.
var st4 = { oa: 150000, sa: 180000, ma: 70000, ra: 0 };
var before4 = st4.oa + st4.sa + st4.ma + st4.ra;
E.settle55(st4);
check('§7.4 SA is 0 after settle55', st4.sa === 0);
check('§7.4 RA ≤ FRS', st4.ra <= C.FRS + 1e-9, st4.ra);
check('§7.4 CPF conserved across transition',
  approx(st4.oa + st4.sa + st4.ma + st4.ra, before4, 1e-6));

// 5. Real vs nominal: equal at year 0, real strictly below after.
var real5 = E.project(inputs({}), 'real').rows;
var nom5 = E.project(inputs({}), 'nominal').rows;
check('§7.5 year-0 real == nominal', approx(real5[0].total, nom5[0].total));
check('§7.5 real < nominal every later year',
  real5.slice(1).every(function (r, i) { return r.total < nom5[i + 1].total; }));

// 6. Tax sanity (exact IRAS cumulative figures).
check('§7.6 tax(20,000) = 0', E.incomeTax(20000) === 0, E.incomeTax(20000));
check('§7.6 tax(80,000) = 3,350', E.incomeTax(80000) === 3350, E.incomeTax(80000));
check('§7.6 tax(320,000) = 44,550', E.incomeTax(320000) === 44550, E.incomeTax(320000));
check('§7.6 tax(1,000,000) = 199,150', E.incomeTax(1000000) === 199150, E.incomeTax(1000000));

/* ------------------------------------------------------------- regressions */
// A $0 salary milestone (career break) must not NaN the projection.
var d7 = E.project(inputs({
  inflationPct: 0, bonusMonths: 0, untilAge: 55,
  salaryAnchors: [
    { age: 40, salary: 0, basis: 'nominal' },
    { age: 50, salary: 12000, basis: 'nominal' }
  ]
}), 'nominal');
check('regression: $0 milestone stays finite',
  d7.rows.every(function (r) { return isFinite(r.total) && isFinite(r.salary); }));
check('regression: salary recovers after $0 milestone',
  d7.rows[d7.rows.length - 1].monthly > 0);

// CPF Cash Top-up Relief: a $10k top-up reduces tax by marginal rate × $8k cap.
// 40yo on $120k, no bonus: chargeable 100,800 sits in the 11.5% band, and the
// full $8,000 relief stays inside it → tax delta = 8,000 × 0.115 = 920.
var t8a = E.project(inputs({ age: 40, salary: 10000, bonusMonths: 0, untilAge: 41, cpfTopup: 0 }), 'nominal').rows[0];
var t8b = E.project(inputs({ age: 40, salary: 10000, bonusMonths: 0, untilAge: 41, cpfTopup: 10000 }), 'nominal').rows[0];
check('top-up relief: capped at $' + C.TOPUP_RELIEF_CAP,
  approx(t8a.cumTaxPaid - t8b.cumTaxPaid, C.TOPUP_RELIEF_CAP * 0.115, 0.5),
  (t8a.cumTaxPaid - t8b.cumTaxPaid));

// Salary milestone interpolation hits the milestone exactly (nominal basis).
var knots = E.buildSalaryKnots([{ age: 40, salary: 12000, basis: 'nominal' }], 90000, 30, 0.025);
check('milestone: salary at knot age is exact', approx(E.salaryAtAge(knots, 40, 0.03), 144000, 0.5));
check('milestone: interpolation is monotonic here',
  E.salaryAtAge(knots, 35, 0.03) > 90000 && E.salaryAtAge(knots, 35, 0.03) < 144000);

/* ------------------------------------------------------------------ result */
console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
