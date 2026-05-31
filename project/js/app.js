/* ============================================================================
   Compound — wireframe app (vanilla JS). Single layout: inputs -> results.
   Desktop: inputs left (sticky), results right. Mobile: stacked, inputs first,
   with a sticky summary bar that keeps the projected number visible while you
   edit, and jumps you down to the chart.
   ============================================================================ */
(function () {
  'use strict';
  var E = window.CompoundEngine;
  var Chart = window.CompoundChart;

  /* ---------------- state ---------------- */
  var state = {
    age: 30, salary: 7500, investments: 120000, returnPct: 5, savingsRate: 40,
    salaryIncreasePct: 3, inflationPct: 2.5, bonusMonths: 2,
    untilAge: 65, cpfTopup: 0,
    payBumps: [{ age: '', pct: '' }],
    oa: '', sa: '', ma: '', mode: 'real'
  };

  var FIELDS = {
    age:               { label: 'Current age', kind: 'slider', min: 18, max: 70, step: 1, editable: true },
    salary:            { label: 'Current gross monthly salary', kind: 'money' },
    investments:       { label: 'Current investments + cash', kind: 'money' },
    returnPct:         { label: 'Expected annual investment return', kind: 'slider', min: 0, max: 12, step: 0.5, suffix: '%', editable: true, openMax: true },
    salaryIncreasePct: { label: 'Base annual raise', kind: 'pct' },
    inflationPct:      { label: 'Inflation', kind: 'slider', min: 0, max: 6, step: 0.5, suffix: '%', editable: true, openMax: true },
    bonusMonths:       { label: 'Annual bonus', kind: 'slider', min: 0, max: 6, step: 0.5, suffix: ' mo', editable: true, openMax: true },
    cashBufferMonths:  { label: 'Cash buffer target', kind: 'slider', min: 0, max: 24, step: 1, suffix: ' mo' },
    untilAge:          { label: 'Project until age', kind: 'slider', min: 50, max: 80, step: 1, editable: true },
    cpfTopup:          { label: 'Voluntary CPF top-up / year', kind: 'money' },
    oa:                { label: 'Ordinary Account (OA)', kind: 'money', placeholder: 'estimate' },
    sa:                { label: 'Special Account (SA)', kind: 'money', placeholder: 'estimate' },
    ma:                { label: 'MediSave (MA)', kind: 'money', placeholder: 'estimate' }
  };

  var CORE = ['age', 'salary', 'bonusMonths', 'investments', 'returnPct', 'savingsRate'];
  var ASSUMPTIONS = ['salaryIncreasePct', 'inflationPct', 'untilAge', 'cpfTopup'];
  var CPF = ['oa', 'sa', 'ma'];

  var bindings = {};
  var sliderEls = {};     // key -> range input, for cross-field coupling
  var heroTargets = [];   // {numEl, subEl, labelEl}
  var rnToggles = [];
  var tableTargets = [];
  var chartEl = null;
  var salaryChartEl = null;
  var barNumEl = null;
  var savingsReadoutEl = null;
  var resultsAnchor = null;
  var tweaks = { showSalary: true };
  var lastData = null;
  var flashTimer = null;

  /* ---------------- helpers ---------------- */
  function h(tag, props, kids) {
    var n = document.createElement(tag);
    if (props) for (var k in props) {
      if (k === 'class') n.className = props[k];
      else if (k === 'text') n.textContent = props[k];
      else if (k === 'html') n.innerHTML = props[k];
      else n.setAttribute(k, props[k]);
    }
    if (kids) kids.forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }
  function register(key, fn) { (bindings[key] = bindings[key] || []).push(fn); }
  function cleanNum(s) { return String(s).replace(/[^0-9.]/g, ''); }
  function onInput(key, raw) {
    state[key] = raw;
    if (key === 'age' || key === 'untilAge') coupleAges(key);
    (bindings[key] || []).forEach(function (fn) { fn(state[key]); });
    renderResults(true);
  }
  function refresh(key) { (bindings[key] || []).forEach(function (fn) { fn(state[key]); }); }

  // Current age must stay below "Project until age". Whichever slider the user
  // drags, the other gives way so the two can never cross.
  function setAgeBounds() {
    if (sliderEls.age)      sliderEls.age.max = Math.min(70, Number(state.untilAge) - 1);
    if (sliderEls.untilAge) sliderEls.untilAge.min = Math.max(50, Number(state.age) + 1);
  }
  function coupleAges(edited) {
    if (Number(state.age) >= Number(state.untilAge)) {
      if (edited === 'age') { state.untilAge = Math.min(80, Number(state.age) + 1); refresh('untilAge'); }
      else { state.age = Math.max(18, Number(state.untilAge) - 1); refresh('age'); }
    }
    setAgeBounds();
  }

  /* ---------------- control factories ---------------- */
  function makeField(key) {
    if (key === 'savingsRate') return makeSavingsRate();
    var cfg = FIELDS[key];
    if (cfg.kind === 'pct') return makePctField(key, cfg);
    return cfg.kind === 'slider' ? makeSlider(key, cfg) : makeMoney(key, cfg);
  }

  // compact percentage number field (e.g. base annual raise)
  function makePctField(key, cfg) {
    var inp = h('input', { type: 'text', inputmode: 'decimal' });
    inp.value = state[key];
    inp.addEventListener('input', function () { var raw = cleanNum(inp.value); onInput(key, raw === '' ? '' : Number(raw)); });
    register(key, function (v) { inp.value = v; });
    return h('div', { class: 'field' }, [
      h('label', {}, [ h('span', { text: cfg.label }) ]),
      h('div', { class: 'pct-input' }, [ inp, h('span', { class: 'suf', text: '%' }) ])
    ]);
  }
  function makeSlider(key, cfg) {
    var range = h('input', { type: 'range', min: cfg.min, max: cfg.max, step: cfg.step });
    range.value = clamp(state[key], cfg);
    sliderEls[key] = range;
    var node, setVal;
    if (cfg.editable) {
      var ev = editableSliderVal(key, cfg, range, function (v) { onInput(key, v); });
      node = ev.box; setVal = ev.set;
    } else {
      var val = h('span', { class: 'slider-val' });
      setVal = function (v) { val.textContent = fmtSv(v, cfg) + (cfg.suffix || ''); };
      node = val;
    }
    setVal(state[key]);
    range.addEventListener('input', function () { onInput(key, Number(range.value)); });
    register(key, function (v) { range.value = clamp(v, cfg); setVal(v); });
    return h('div', { class: 'field' }, [
      h('label', {}, [ h('span', { text: cfg.label }) ]),
      h('div', { class: 'slider-row' }, [range, node])
    ]);
  }
  function clamp(v, cfg) { return Math.max(cfg.min, Math.min(cfg.max, Number(v))); }
  function fmtSv(v, cfg) { return (cfg.step % 1 ? Number(v).toFixed(1) : v); }

  // Editable numeric read-out paired with a slider. Typing can exceed the
  // slider's drag range — the thumb just pins to its end, the field keeps the
  // true value.
  function editableSliderVal(key, cfg, range, onCommit) {
    var floor = cfg.floor != null ? cfg.floor : cfg.min;
    var ceil = cfg.openMax ? Infinity : (cfg.ceil != null ? cfg.ceil : cfg.max);
    var inp = h('input', { type: 'text', inputmode: 'decimal', class: 'sv-input' });
    var kids = [inp];
    if (cfg.suffix) kids.push(h('span', { class: 'sv-suf', text: cfg.suffix.trim() }));
    var box = h('div', { class: 'slider-val editable' }, kids);
    function set(v) {
      if (document.activeElement !== inp) inp.value = fmtSv(v, cfg);
      range.value = clamp(v, cfg);
    }
    inp.addEventListener('input', function () {
      var raw = cleanNum(inp.value);
      var v = raw === '' ? floor : Number(raw);
      v = Math.max(floor, Math.min(ceil, v));
      range.value = clamp(v, cfg);
      onCommit(v);
    });
    inp.addEventListener('blur', function () { inp.value = fmtSv(state[key], cfg); });
    return { box: box, set: set };
  }
  function makeMoney(key, cfg) {
    var inp = h('input', { type: 'text', inputmode: 'numeric', placeholder: cfg.placeholder || '0' });
    if (state[key] !== '') inp.value = Number(state[key]).toLocaleString('en-SG');
    function clean(s) { return s.replace(/[^0-9.]/g, ''); }
    inp.addEventListener('input', function () { var raw = clean(inp.value); onInput(key, raw === '' ? '' : Number(raw)); });
    inp.addEventListener('blur', function () { if (state[key] !== '' && state[key] != null) inp.value = Number(state[key]).toLocaleString('en-SG'); });
    register(key, function (v) { inp.value = (v === '' || v == null) ? '' : Number(v).toLocaleString('en-SG'); });
    return h('div', { class: 'field' }, [
      h('label', {}, [ h('span', { text: cfg.label }) ]),
      h('div', { class: 'money' }, [ h('span', { class: 'pre', text: '$' }), inp ])
    ]);
  }
  function fieldsFor(list) { return list.map(makeField); }

  // Savings rate: % of take-home saved, with a live read-out of the implied
  // dollar split (saved vs spent) for the current year.
  function makeSavingsRate() {
    var cfg = { min: 0, max: 100, step: 5, suffix: '%', editable: true };
    var range = h('input', { type: 'range', min: cfg.min, max: cfg.max, step: cfg.step });
    range.value = clamp(state.savingsRate, cfg);
    sliderEls.savingsRate = range;
    var ev = editableSliderVal('savingsRate', cfg, range, function (v) { onInput('savingsRate', v); });
    ev.set(state.savingsRate);
    range.addEventListener('input', function () { onInput('savingsRate', Number(range.value)); });
    register('savingsRate', function (v) { range.value = clamp(v, cfg); ev.set(v); });
    savingsReadoutEl = h('div', { class: 'savings-readout', text: '—' });
    return h('div', { class: 'field' }, [
      h('label', {}, [ h('span', { text: 'Savings rate' }), h('span', { class: 'lbl-note', text: '% of take-home' }) ]),
      h('div', { class: 'slider-row' }, [range, ev.box]),
      savingsReadoutEl
    ]);
  }

  function disclosure(title, bodyKids, opts) {
    opts = opts || {};
    var chev = h('span', { class: 'chev', text: '›' });
    var head = h('button', { class: 'disc-head', 'aria-expanded': opts.open ? 'true' : 'false' }, [ h('span', { text: title }), chev ]);
    var body = h('div', { class: 'disc-body' + (opts.open ? ' open' : '') }, bodyKids);
    if (opts.helper) body.insertBefore(h('p', { class: 'panel-sub', text: opts.helper }), body.firstChild);
    head.addEventListener('click', function () {
      var isOpen = body.classList.toggle('open');
      head.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      if (isOpen) setTimeout(renderChart, 0);
    });
    return h('div', { class: 'disclosure' }, [head, body]);
  }
  var bumpRowsEl = null;

  // "Pay bumps" — lightweight table of one-off raises at specific ages.
  function makeBumpRow(bump) {
    var ageInp = h('input', { type: 'text', inputmode: 'numeric', placeholder: '32', class: 'bnum' });
    if (bump.age !== '') ageInp.value = bump.age;
    ageInp.addEventListener('input', function () { bump.age = cleanNum(ageInp.value); renderResults(true); });

    var pctInp = h('input', { type: 'text', inputmode: 'decimal', placeholder: '15', class: 'bnum' });
    if (bump.pct !== '') pctInp.value = bump.pct;
    pctInp.addEventListener('input', function () { bump.pct = cleanNum(pctInp.value); renderResults(true); });

    var rm = h('button', { class: 'bump-rm', 'aria-label': 'Remove this bump', title: 'Remove' }, [ document.createTextNode('×') ]);
    var row = h('div', { class: 'bump-row' }, [
      h('div', { class: 'bcell' }, [ageInp]),
      h('div', { class: 'bcell bpct' }, [ pctInp, h('span', { class: 'bsuf', text: '%' }) ]),
      rm
    ]);
    rm.addEventListener('click', function () {
      var idx = state.payBumps.indexOf(bump);
      if (idx > -1) state.payBumps.splice(idx, 1);
      row.remove();
      if (state.payBumps.length === 0) {
        var nb = { age: '', pct: '' };
        state.payBumps.push(nb);
        bumpRowsEl.appendChild(makeBumpRow(nb));
      }
      renderResults(true);
    });
    return row;
  }

  function payBumpsBlock() {
    bumpRowsEl = h('div', { class: 'bump-rows' });
    state.payBumps.forEach(function (b) { bumpRowsEl.appendChild(makeBumpRow(b)); });
    var add = h('button', { class: 'bump-add' }, [ document.createTextNode('+ Add bump') ]);
    add.addEventListener('click', function () {
      var nb = { age: '', pct: '' };
      state.payBumps.push(nb);
      var r = makeBumpRow(nb);
      bumpRowsEl.appendChild(r);
      var first = r.querySelector('input');
      if (first) first.focus();
    });
    return h('div', { class: 'bumps' }, [
      h('div', { class: 'bumps-head' }, [ h('span', { text: 'One-off increases' }) ]),
      h('div', { class: 'bump-cols' }, [
        h('span', { text: 'At age' }), h('span', { text: 'Increase' }), h('span', {})
      ]),
      bumpRowsEl,
      add
    ]);
  }

  function assumptionsDisc() {
    return disclosure('Assumptions', [
      makeField('salaryIncreasePct'),
      payBumpsBlock(),
      makeField('inflationPct'),
      makeField('untilAge'),
      makeField('cpfTopup')
    ], {});
  }
  function cpfDisc() { return disclosure('CPF starting balances', fieldsFor(CPF), { helper: 'From your latest CPF statement — leave blank to estimate.' }); }

  /* ---------------- results pieces ---------------- */
  function rnToggle() {
    var real = h('button', { class: 'on', text: 'Real' });
    var nom = h('button', { text: 'Nominal' });
    real.addEventListener('click', function () { state.mode = 'real'; renderResults(true); });
    nom.addEventListener('click', function () { state.mode = 'nominal'; renderResults(true); });
    var cap = h('span', { class: 'rn-cap', text: "today's dollars" });
    rnToggles.push({ real: real, nom: nom, cap: cap });
    return h('div', {}, [ h('div', { class: 'rn-toggle' }, [real, nom]), cap ]);
  }
  function heroBlock() {
    var labelEl = h('div', { class: 'label', text: 'Projected net worth at ' + state.untilAge });
    var numEl = h('div', { class: 'hero-num num', text: '—' });
    var subEl = h('div', { class: 'sub', text: '' });
    heroTargets.push({ numEl: numEl, subEl: subEl, labelEl: labelEl });
    return h('div', { class: 'hero' }, [ h('div', {}, [labelEl, numEl, subEl]), rnToggle() ]);
  }
  function legendBlock() {
    return h('div', { class: 'legend' }, [
      h('span', { class: 'key', html: '<span class="swatch liquid"></span> Investments (cash + market)' }),
      h('span', { class: 'key', html: '<span class="swatch locked"></span> CPF (OA · SA · MediSave)' })
    ]);
  }
  function chartBlock() {
    chartEl = h('div', { class: 'chart-area' });
    return h('div', { class: 'chart-wrap' }, [
      h('div', { class: 'chart-head' }, [
        h('h3', { class: 'chart-title', text: 'Net worth over time' }),
        h('span', { class: 'chart-cap', text: 'investments + CPF' })
      ]),
      chartEl,
      legendBlock()
    ]);
  }
  function salaryChartBlock() {
    salaryChartEl = h('div', { class: 'chart-area chart-area-sm' });
    return h('div', { class: 'chart-wrap' }, [
      h('div', { class: 'chart-head' }, [
        h('h3', { class: 'chart-title', text: 'Monthly salary over time' }),
        h('span', { class: 'chart-cap', text: 'base pay · excludes bonus' })
      ]),
      salaryChartEl,
      h('div', { class: 'legend' }, [
        h('span', { class: 'key', html: '<span class="swatch salary"></span> Base monthly salary' })
      ])
    ]);
  }
  function headRow() {
    function th(t, cls) { return h('th', { class: (cls || '') + ' n', text: t }); }
    return h('tr', {}, [
      h('th', { text: 'Year' }), th('Age'), th('Salary'), th('Take-home'), th('Expenses'), th('Savings'),
      th('Investments'), th('CPF', 'locked-col'),
      th('OA', 'cpf-col'), th('SA', 'cpf-col'), th('MA', 'cpf-col'), th('Total')
    ]);
  }
  function tableBlock() {
    var tbody = h('tbody');
    var table = h('table', { class: 'bd' }, [ h('thead', {}, [ headRow() ]), tbody ]);
    tableTargets.push({ tbody: tbody });
    var wrap = h('div', { class: 'table-wrap' }, [
      h('p', { class: 'table-hint', text: 'scroll table sideways →' }),
      h('div', { class: 'table-scroll' }, [table])
    ]);
    var bdBtn = h('button', { class: 'toggle-btn' }, [ h('span', { class: 'chev', text: '▸' }), document.createTextNode('Show year-by-year breakdown') ]);
    var cpfBtn = h('button', { class: 'toggle-btn' }, [ h('span', { class: 'chev', text: '▸' }), document.createTextNode('Show CPF detail') ]);
    bdBtn.addEventListener('click', function () {
      var open = wrap.classList.toggle('open');
      bdBtn.classList.toggle('on', open);
      bdBtn.querySelector('.chev').textContent = open ? '▾' : '▸';
      bdBtn.lastChild.textContent = open ? 'Hide year-by-year breakdown' : 'Show year-by-year breakdown';
    });
    cpfBtn.addEventListener('click', function () {
      var on = table.classList.toggle('show-cpf');
      cpfBtn.classList.toggle('on', on);
      cpfBtn.querySelector('.chev').textContent = on ? '▾' : '▸';
      cpfBtn.lastChild.textContent = on ? 'Hide CPF detail' : 'Show CPF detail';
    });
    return h('div', {}, [ h('div', { class: 'toggle-row' }, [bdBtn, cpfBtn]), wrap ]);
  }

  /* ---------------- build ---------------- */
  var thisYear = new Date().getFullYear();

  function build() {
    var inputs = h('div', { class: 'col-inputs' }, [
      h('div', { class: 'sketch panel' }, [
        h('h2', { class: 'panel-title', text: 'Your numbers' }),
        h('p', { class: 'panel-sub', text: 'Five inputs to start — refine the rest below.' })
      ].concat(fieldsFor(CORE)).concat([ assumptionsDisc(), cpfDisc() ]))
    ]);

    resultsAnchor = h('div', { class: 'sketch' }, [ heroBlock() ]);
    var results = h('div', { class: 'stack' }, [
      resultsAnchor,
      h('div', { class: 'sketch' }, [ chartBlock() ]),
      h('div', { class: 'sketch' }, [ salaryChartBlock() ]),
      h('div', { class: 'sketch', style: 'padding-bottom:var(--pad)' }, [ tableBlock() ])
    ]);

    document.getElementById('app').appendChild(h('div', { class: 'split' }, [inputs, results]));

    // mobile summary bar
    barNumEl = h('span', { class: 'bar-num', text: '—' });
    var jump = h('button', { class: 'sb-jump', text: 'View chart' });
    jump.addEventListener('click', function () {
      var y = resultsAnchor.getBoundingClientRect().top + window.pageYOffset - 12;
      window.scrollTo({ top: y, behavior: 'smooth' });
    });
    document.body.appendChild(h('div', { class: 'summary-bar' }, [
      h('div', {}, [ h('div', { class: 'sb-label', text: 'Projected net worth' }), barNumEl ]),
      jump
    ]));
  }

  /* ---------------- render ---------------- */
  function renderResults(flash) {
    var data = E.project(state, state.mode);
    lastData = data;
    var last = data.rows[data.rows.length - 1];
    var heroTxt = E.fmtMillions(last.total);
    var cap = state.mode === 'real' ? "today's dollars" : 'future dollars';
    var sub = (state.mode === 'real' ? 'In real terms · ' : 'Nominal · ') + 'over ' + data.rows.length + ' years';

    heroTargets.forEach(function (t) {
      t.numEl.textContent = heroTxt;
      t.subEl.textContent = sub;
      t.labelEl.textContent = 'Projected net worth at ' + state.untilAge;
    });
    if (barNumEl) barNumEl.textContent = heroTxt;
    if (savingsReadoutEl) {
      var r0 = data.rows[0];
      savingsReadoutEl.innerHTML = '\u2248 <b>' + E.fmtMoney(r0.savings) + '</b> / year saved \u00b7 <b>' +
        E.fmtMoney(r0.expenses) + '</b> / year on expenses';
    }
    rnToggles.forEach(function (r) {
      r.real.classList.toggle('on', state.mode === 'real');
      r.nom.classList.toggle('on', state.mode === 'nominal');
      r.cap.textContent = cap;
    });
    tableTargets.forEach(function (t) { renderTable(t.tbody, data); });
    renderChart();

    if (flash) {
      heroTargets.forEach(function (t) { t.numEl.classList.add('flash'); });
      clearTimeout(flashTimer);
      flashTimer = setTimeout(function () {
        heroTargets.forEach(function (t) { t.numEl.classList.remove('flash'); });
      }, 30);
    }
  }
  function renderTable(tbody, data) {
    tbody.innerHTML = '';
    var f = E.fmtMoney;
    data.rows.forEach(function (r, i) {
      function td(v, cls) { return h('td', { class: (cls || '') + ' n', text: v }); }
      tbody.appendChild(h('tr', {}, [
        h('td', { text: String(thisYear + i) }),
        td(r.age), td(f(r.salary)), td(f(r.takeHome)), td(f(r.expenses)), td(f(r.savings)),
        td(f(r.invest)), td(f(r.cpf), 'locked-col'),
        td(f(r.oa), 'cpf-col'), td(f(r.sa), 'cpf-col'), td(f(r.ma), 'cpf-col'),
        td(f(r.total))
      ]));
    });
  }
  function renderChart() {
    if (chartEl && lastData) Chart.render(chartEl, lastData, { showSalary: tweaks.showSalary });
    if (salaryChartEl && lastData) Chart.renderSalary(salaryChartEl, lastData);
  }

  /* ---------------- tweaks bridge ---------------- */
  window.applyTweaks = function (t) {
    var root = document.documentElement;
    var hand = (t.sketchiness || 'Hand-drawn') === 'Hand-drawn';
    root.classList.toggle('sketchy', hand);
    root.classList.toggle('clean', !hand);
    root.classList.toggle('dark', (t.paper || 'Light') === 'Dark');
    root.classList.toggle('compact', (t.density || 'Comfortable') === 'Compact');
    if (t.accent) root.style.setProperty('--accent', t.accent);
    tweaks.showSalary = t.showSalary !== false;
    renderResults(false);
  };

  /* ---------------- init ---------------- */
  function init() {
    document.documentElement.classList.add('sketchy');
    build();
    setAgeBounds();
    renderResults(false);
    var rt;
    window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(renderChart, 120); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  window.addEventListener('load', function () { setTimeout(renderChart, 60); });
})();
