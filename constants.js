/* ============================================================================
   Compound — financial constants (CPF Board + IRAS)
   ----------------------------------------------------------------------------
   SINGLE SOURCE OF TRUTH for every statutory figure used by the engine. A
   yearly rules update should be a one-line edit here, never a logic change in
   engine.js.

   lastVerified: 2026-05-31
   Verified live against:
     - CPF Board (https://www.cpf.gov.sg)
         * OW ceiling $8,000/mo, annual salary ceiling $102,000,
           CPF Annual Limit $37,740 (from 1 Jan 2026; OW ceiling final step
           of the Budget-2023 phased increase).
         * Contribution + allocation rates from 1 January 2026 (senior-worker
           rates above 55–65 raised this year; fully allocated to RA).
         * Interest: OA 2.5% floor, SA/MA/RA 4% floor (4% floor extended to
           31 Dec 2026). Extra interest: <55 +1% on first $60k combined;
           55+ +2% on first $30k then +1% on next $30k; OA counted up to
           $20k in both cases.
         * FRS (cohort turning 55 in 2026) = $220,400.
         * Basic Healthcare Sum (under 65), 2026 = $79,000.
     - IRAS (https://www.iras.gov.sg)
         * Resident individual income tax rates, structure in force since
           YA2024 (0% to 24%).

   Re-check each block against the linked authority before each tax year.
   ============================================================================ */
(function (global) {
  'use strict';

  /* --- CPF wage ceilings & limits ------------------------------------------
     Re-check: cpf.gov.sg → "What is the Ordinary Wage (OW) ceiling?" and the
     contribution-rate tables. */
  var OW_CEILING_MONTHLY    = 8000;      // Ordinary Wage monthly ceiling
  var ANNUAL_SALARY_CEILING = 102000;    // OW + AW combined, per year
  var CPF_ANNUAL_LIMIT      = 37740;     // max total (ee+er) mandatory contribution / year
  var FRS                   = 220400;    // Full Retirement Sum, cohort turning 55 in 2026
  var BHS_UNDER_65          = 79000;     // Basic Healthcare Sum (MediSave cap), under 65

  /* --- CPF contribution & allocation by age (from 1 Jan 2026) --------------
     Allocation %s are % of wage and sum to `total` for the band. Resolve a
     person's band by `age <= maxAge` (first match, ascending). The retirement
     slice (`retire`) lands in SA when age < 55, else RA (decided in engine,
     not here).
     Re-check: cpf.gov.sg → "CPF contribution rates" + "CPF allocation rates". */
  var CONTRIBUTION_BANDS = [
    // maxAge   total   employer employee   oa      retire   ma
    { maxAge: 35,  total: 0.37,  employer: 0.17,  employee: 0.20,  oa: 0.230, retire: 0.060, ma: 0.080 },
    { maxAge: 45,  total: 0.37,  employer: 0.17,  employee: 0.20,  oa: 0.210, retire: 0.070, ma: 0.090 },
    { maxAge: 50,  total: 0.37,  employer: 0.17,  employee: 0.20,  oa: 0.190, retire: 0.080, ma: 0.100 },
    { maxAge: 55,  total: 0.37,  employer: 0.17,  employee: 0.20,  oa: 0.150, retire: 0.115, ma: 0.105 },
    { maxAge: 60,  total: 0.34,  employer: 0.16,  employee: 0.18,  oa: 0.120, retire: 0.115, ma: 0.105 },
    { maxAge: 65,  total: 0.25,  employer: 0.125, employee: 0.125, oa: 0.035, retire: 0.110, ma: 0.105 },
    { maxAge: 70,  total: 0.165, employer: 0.09,  employee: 0.075, oa: 0.010, retire: 0.050, ma: 0.105 },
    { maxAge: 200, total: 0.125, employer: 0.075, employee: 0.05,  oa: 0.010, retire: 0.010, ma: 0.105 }
  ];

  /* --- CPF interest rates --------------------------------------------------
     Re-check: cpf.gov.sg → "Earning attractive interest". */
  var OA_RATE   = 0.025;   // 2.5% floor
  var SMRA_RATE = 0.04;    // 4% floor (SA / MA / RA)

  // Extra interest (applied to combined balances; OA counted only up to cap).
  var EXTRA_OA_CAP       = 20000;
  var EXTRA_UNDER55_TIER = 60000;  // <55: +1% on first $60k combined
  var EXTRA_UNDER55_RATE = 0.01;
  var EXTRA_55PLUS_TIER1 = 30000;  // 55+: +2% on first $30k combined
  var EXTRA_55PLUS_RATE1 = 0.02;
  var EXTRA_55PLUS_TIER2 = 30000;  // 55+: +1% on next $30k combined
  var EXTRA_55PLUS_RATE2 = 0.01;

  /* --- Resident income tax brackets (IRAS, YA2024 structure) ---------------
     Marginal bands; engine walks them. `floor` is the band's lower bound,
     `rate` the marginal rate on income within the band, `cumAtFloor` the total
     tax on all income up to (and including) `floor`.
     Re-check: iras.gov.sg → "Individual Income Tax rates". */
  var TAX_BANDS = [
    { floor: 0,       rate: 0.00,  cumAtFloor: 0      },
    { floor: 20000,   rate: 0.02,  cumAtFloor: 0      },
    { floor: 30000,   rate: 0.035, cumAtFloor: 200    },
    { floor: 40000,   rate: 0.07,  cumAtFloor: 550    },
    { floor: 80000,   rate: 0.115, cumAtFloor: 3350   },
    { floor: 120000,  rate: 0.15,  cumAtFloor: 7950   },
    { floor: 160000,  rate: 0.18,  cumAtFloor: 13950  },
    { floor: 200000,  rate: 0.19,  cumAtFloor: 21150  },
    { floor: 240000,  rate: 0.195, cumAtFloor: 28750  },
    { floor: 280000,  rate: 0.20,  cumAtFloor: 36550  },
    { floor: 320000,  rate: 0.22,  cumAtFloor: 44550  },
    { floor: 500000,  rate: 0.23,  cumAtFloor: 84150  },
    { floor: 1000000, rate: 0.24,  cumAtFloor: 199150 }
  ];

  global.CompoundConstants = {
    lastVerified: '2026-05-31',

    OW_CEILING_MONTHLY: OW_CEILING_MONTHLY,
    ANNUAL_SALARY_CEILING: ANNUAL_SALARY_CEILING,
    CPF_ANNUAL_LIMIT: CPF_ANNUAL_LIMIT,
    FRS: FRS,
    BHS_UNDER_65: BHS_UNDER_65,

    CONTRIBUTION_BANDS: CONTRIBUTION_BANDS,

    OA_RATE: OA_RATE,
    SMRA_RATE: SMRA_RATE,
    EXTRA_OA_CAP: EXTRA_OA_CAP,
    EXTRA_UNDER55_TIER: EXTRA_UNDER55_TIER,
    EXTRA_UNDER55_RATE: EXTRA_UNDER55_RATE,
    EXTRA_55PLUS_TIER1: EXTRA_55PLUS_TIER1,
    EXTRA_55PLUS_RATE1: EXTRA_55PLUS_RATE1,
    EXTRA_55PLUS_TIER2: EXTRA_55PLUS_TIER2,
    EXTRA_55PLUS_RATE2: EXTRA_55PLUS_RATE2,

    TAX_BANDS: TAX_BANDS
  };
})(typeof window !== 'undefined' ? window : globalThis);
