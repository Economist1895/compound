/* ============================================================================
   Compound — sketchy SVG stacked-area chart
   Draws Investments + CPF as stacked areas, with a thin secondary salary line.
   Hand-drawn feel: slightly wobbly axes, rough strokes, hatched "CPF" band.
   ============================================================================ */
(function (global) {
  'use strict';
  var E = global.CompoundEngine;
  var NS = 'http://www.w3.org/2000/svg';

  function el(tag, attrs) {
    var n = document.createElementNS(NS, tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }

  // jitter a path for a hand-drawn look (used when .sketchy is on)
  function rough(pts, amp) {    if (!amp) amp = 0;
    var d = '';
    for (var i = 0; i < pts.length; i++) {
      var jx = amp ? (Math.sin(i * 12.9898) * 43758.5453 % 1) * amp - amp / 2 : 0;
      var jy = amp ? (Math.sin(i * 78.233) * 12543.123 % 1) * amp - amp / 2 : 0;
      d += (i === 0 ? 'M' : 'L') + (pts[i][0] + jx).toFixed(1) + ' ' + (pts[i][1] + jy).toFixed(1) + ' ';
    }
    return d;
  }

  // Shared hover interaction: vertical guide, series dots, and a value tooltip.
  // o = { container, svg, W, ml, mt, pw, ph, n, x, ink, paper, dotColors, info }
  // info(i) -> { title, lines:[{label,val,color?}], cys:[y|null,...] }
  function attachHover(o) {
    var svg = o.svg, container = o.container;
    container.style.position = 'relative';

    var tip = document.createElement('div');
    tip.className = 'chart-tip';
    tip.style.display = 'none';
    container.appendChild(tip);

    var guide = el('line', { y1: o.mt, y2: o.mt + o.ph, stroke: o.ink, 'stroke-width': 1, 'stroke-opacity': 0.45, 'stroke-dasharray': '3 3' });
    guide.style.display = 'none';
    svg.appendChild(guide);

    var dots = o.dotColors.map(function (col) {
      var c = el('circle', { r: 4, fill: o.paper, stroke: col, 'stroke-width': 2 });
      c.style.display = 'none';
      svg.appendChild(c);
      return c;
    });

    var hot = el('rect', { x: o.ml, y: o.mt, width: o.pw, height: o.ph, fill: 'transparent' });
    hot.style.cursor = 'crosshair';
    svg.appendChild(hot);

    function locate(clientX) {
      var rect = svg.getBoundingClientRect();
      var relX = (clientX - rect.left) / rect.width * o.W;
      var best = 0, bd = Infinity;
      for (var i = 0; i < o.n; i++) { var d = Math.abs(o.x(i) - relX); if (d < bd) { bd = d; best = i; } }
      return best;
    }
    function show(clientX) {
      var i = locate(clientX);
      var gx = o.x(i);
      guide.setAttribute('x1', gx); guide.setAttribute('x2', gx);
      guide.style.display = '';
      var info = o.info(i);
      dots.forEach(function (dot, k) {
        if (info.cys[k] == null) { dot.style.display = 'none'; return; }
        dot.setAttribute('cx', gx); dot.setAttribute('cy', info.cys[k]); dot.style.display = '';
      });
      var html = '<div class="ct-title">' + info.title + '</div>';
      info.lines.forEach(function (ln) {
        html += '<div class="ct-row"><span class="ct-key">' +
          (ln.color ? '<span class="ct-sw" style="background:' + ln.color + '"></span>' : '') +
          ln.label + '</span><span class="ct-val">' + ln.val + '</span></div>';
      });
      tip.innerHTML = html;
      tip.style.display = 'block';
      var rect = svg.getBoundingClientRect();
      var crect = container.getBoundingClientRect();
      var pxX = gx / o.W * rect.width + (rect.left - crect.left);
      var tw = tip.offsetWidth;
      var left = pxX + 14;
      if (left + tw > container.clientWidth) left = pxX - tw - 14;
      if (left < 2) left = 2;
      tip.style.left = left + 'px';
      tip.style.top = (o.mt + 2) + 'px';
    }
    function hide() {
      guide.style.display = 'none';
      dots.forEach(function (d) { d.style.display = 'none'; });
      tip.style.display = 'none';
    }
    svg.addEventListener('mousemove', function (e) { show(e.clientX); });
    svg.addEventListener('mouseleave', hide);
  }

  function render(container, data, opts) {    opts = opts || {};
    var rows = data.rows;
    container.innerHTML = '';
    var W = container.clientWidth || 600;
    var H = container.clientHeight || 320;
    if (W < 40) W = 600;
    if (H < 40) H = 320;

    var styles = getComputedStyle(document.documentElement);
    var accent = (styles.getPropertyValue('--accent') || '#5b7fb5').trim();
    var accent2 = (styles.getPropertyValue('--accent-2') || '#caa24a').trim();
    var ink = (styles.getPropertyValue('--ink') || '#222').trim();
    var muted = (styles.getPropertyValue('--muted') || '#888').trim();
    var paper = (styles.getPropertyValue('--paper') || '#fff').trim();
    var sketchy = document.documentElement.classList.contains('sketchy');
    var amp = sketchy ? 2.2 : 0;

    var ml = 52, mr = 16, mt = 18, mb = 34;
    var pw = W - ml - mr, ph = H - mt - mb;

    var svg = el('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, class: 'chart-svg' });

    // scales
    var n = rows.length;
    var maxTotal = 0;
    for (var i = 0; i < n; i++) {
      if (rows[i].total > maxTotal) maxTotal = rows[i].total;
    }
    maxTotal = maxTotal * 1.08 || 1;

    function x(i) { return ml + (n <= 1 ? 0 : (i / (n - 1)) * pw); }
    function yT(v) { return mt + ph - (v / maxTotal) * ph; }   // wealth axis

    // hatch pattern for Locked band
    var defs = el('defs', {});
    var pat = el('pattern', { id: 'hatch', width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' });
    pat.appendChild(el('rect', { width: 6, height: 6, fill: 'none' }));
    pat.appendChild(el('line', { x1: 0, y1: 0, x2: 0, y2: 6, stroke: ink, 'stroke-width': 1, 'stroke-opacity': 0.35 }));
    defs.appendChild(pat);
    svg.appendChild(defs);

    // gridlines + y labels
    var ticks = 4;
    for (var g = 0; g <= ticks; g++) {
      var val = (maxTotal / ticks) * g;
      var gy = yT(val);
      svg.appendChild(el('line', { x1: ml, y1: gy, x2: W - mr, y2: gy, stroke: muted, 'stroke-width': 1, 'stroke-opacity': g === 0 ? 0.5 : 0.18, 'stroke-dasharray': g === 0 ? 'none' : '3 4' }));
      var lbl = el('text', { x: ml - 8, y: gy + 4, 'text-anchor': 'end', class: 'chart-axislabel' });
      lbl.textContent = E.fmtCompact(val);
      svg.appendChild(lbl);
    }

    // build stacked area paths
    // bottom band = Investments (0 -> invest); top band = CPF (invest -> total)
    var liqTop = [], total = [], base = [];
    for (i = 0; i < n; i++) {
      liqTop.push([x(i), yT(rows[i].invest)]);
      total.push([x(i), yT(rows[i].total)]);
      base.push([x(i), yT(0)]);
    }

    // Liquid area (filled accent)
    var liqArea = liqTop.concat(base.slice().reverse());
    var liqPath = el('path', { d: rough(liqArea, amp) + 'Z', fill: accent, 'fill-opacity': 0.30, stroke: 'none' });
    svg.appendChild(liqPath);
    // Liquid top outline
    svg.appendChild(el('path', { d: rough(liqTop, amp), fill: 'none', stroke: accent, 'stroke-width': sketchy ? 2.4 : 1.8, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));

    // Locked area (hatched) between liquid and total
    var lockArea = total.concat(liqTop.slice().reverse());
    svg.appendChild(el('path', { d: rough(lockArea, amp) + 'Z', fill: 'url(#hatch)', stroke: 'none' }));
    // Locked top outline
    svg.appendChild(el('path', { d: rough(total, amp), fill: 'none', stroke: ink, 'stroke-width': sketchy ? 2.2 : 1.6, 'stroke-opacity': 0.7, 'stroke-dasharray': '1 0', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));

    // X axis line
    svg.appendChild(el('path', { d: rough([[ml, mt + ph], [W - mr, mt + ph]], amp), fill: 'none', stroke: ink, 'stroke-width': 1.4 }));

    // X labels (age) — show ~6 ticks
    var step = Math.max(1, Math.round((n - 1) / 6));
    for (i = 0; i < n; i += step) {
      var tx = el('text', { x: x(i), y: H - 12, 'text-anchor': 'middle', class: 'chart-axislabel' });
      tx.textContent = rows[i].age;
      svg.appendChild(tx);
    }
    // ensure last age shown
    var lastT = el('text', { x: x(n - 1), y: H - 12, 'text-anchor': 'middle', class: 'chart-axislabel' });
    lastT.textContent = rows[n - 1].age;
    svg.appendChild(lastT);
    var ageCap = el('text', { x: ml, y: H - 12, 'text-anchor': 'start', class: 'chart-axislabel chart-axiscap' });
    ageCap.textContent = 'age →';
    // (skip if overlaps; keep subtle)

    attachHover({
      container: container, svg: svg, W: W, ml: ml, mt: mt, pw: pw, ph: ph, n: n, x: x,
      ink: ink, paper: paper, dotColors: [accent, ink],
      info: function (i) {
        var r = rows[i];
        return {
          title: 'Age ' + r.age,
          lines: [
            { label: 'Investments', val: E.fmtMoney(r.invest), color: accent },
            { label: 'CPF', val: E.fmtMoney(r.cpf), color: ink },
            { label: 'Net worth', val: E.fmtMoney(r.total) }
          ],
          cys: [yT(r.invest), yT(r.total)]
        };
      }
    });

    container.appendChild(svg);
  }

  global.CompoundChart = { render: render, renderSalary: renderSalary };

  // Secondary chart: assumed monthly (base) salary over time — a single line so
  // the user can read expected salary growth at a glance.
  function renderSalary(container, data) {
    var rows = data.rows;
    container.innerHTML = '';
    var W = container.clientWidth || 600;
    var H = container.clientHeight || 200;
    if (W < 40) W = 600;
    if (H < 40) H = 200;

    var styles = getComputedStyle(document.documentElement);
    var accent2 = (styles.getPropertyValue('--accent-2') || '#b08a3e').trim();
    var ink = (styles.getPropertyValue('--ink') || '#222').trim();
    var muted = (styles.getPropertyValue('--muted') || '#888').trim();
    var paper = (styles.getPropertyValue('--paper') || '#fff').trim();
    var sketchy = document.documentElement.classList.contains('sketchy');
    var amp = sketchy ? 1.8 : 0;

    var ml = 56, mr = 16, mt = 16, mb = 30;
    var pw = W - ml - mr, ph = H - mt - mb;
    var svg = el('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, class: 'chart-svg' });

    var n = rows.length;
    var maxV = 0;
    for (var i = 0; i < n; i++) if (rows[i].monthly > maxV) maxV = rows[i].monthly;
    maxV = maxV * 1.1 || 1;

    function x(i) { return ml + (n <= 1 ? 0 : (i / (n - 1)) * pw); }
    function y(v) { return mt + ph - (v / maxV) * ph; }
    function fmtK(v) { return v >= 1000 ? '$' + (v / 1000).toFixed(1) + 'k' : '$' + Math.round(v); }

    // gridlines + y labels
    var ticks = 3;
    for (var g = 0; g <= ticks; g++) {
      var val = (maxV / ticks) * g;
      var gy = y(val);
      svg.appendChild(el('line', { x1: ml, y1: gy, x2: W - mr, y2: gy, stroke: muted, 'stroke-width': 1, 'stroke-opacity': g === 0 ? 0.5 : 0.18, 'stroke-dasharray': g === 0 ? 'none' : '3 4' }));
      var lbl = el('text', { x: ml - 8, y: gy + 4, 'text-anchor': 'end', class: 'chart-axislabel' });
      lbl.textContent = fmtK(val);
      svg.appendChild(lbl);
    }

    // salary line + soft fill
    var line = [], base = [];
    for (i = 0; i < n; i++) { line.push([x(i), y(rows[i].monthly)]); base.push([x(i), y(0)]); }
    var area = line.concat(base.slice().reverse());
    svg.appendChild(el('path', { d: rough(area, amp) + 'Z', fill: accent2, 'fill-opacity': 0.14, stroke: 'none' }));
    svg.appendChild(el('path', { d: rough(line, amp), fill: 'none', stroke: accent2, 'stroke-width': sketchy ? 2.6 : 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));

    // x axis + age labels
    svg.appendChild(el('path', { d: rough([[ml, mt + ph], [W - mr, mt + ph]], amp), fill: 'none', stroke: ink, 'stroke-width': 1.4 }));
    var step = Math.max(1, Math.round((n - 1) / 6));
    for (i = 0; i < n; i += step) {
      var tx = el('text', { x: x(i), y: H - 10, 'text-anchor': 'middle', class: 'chart-axislabel' });
      tx.textContent = rows[i].age;
      svg.appendChild(tx);
    }
    var lastT = el('text', { x: x(n - 1), y: H - 10, 'text-anchor': 'middle', class: 'chart-axislabel' });
    lastT.textContent = rows[n - 1].age;
    svg.appendChild(lastT);

    attachHover({
      container: container, svg: svg, W: W, ml: ml, mt: mt, pw: pw, ph: ph, n: n, x: x,
      ink: ink, paper: paper, dotColors: [accent2],
      info: function (i) {
        var r = rows[i];
        return {
          title: 'Age ' + r.age,
          lines: [ { label: 'Monthly salary', val: E.fmtMoney(r.monthly), color: accent2 } ],
          cys: [y(r.monthly)]
        };
      }
    });

    container.appendChild(svg);
  }
})(window);
