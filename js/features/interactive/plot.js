/**
 * plot.js — Interactive math graphing widget (v2)
 * Backward compatible with the legacy ```plot spec format.
 *
 * Improvements over v1:
 *  - True 2D pan (drag) + wheel/pinch zoom centered on the pointer
 *  - Adaptive "nice" tick steps (1/2/5 series) at every zoom level
 *  - Crosshair hover that reads values of EVERY curve, not just the first
 *  - Automatic key-point detection for quadratics (vertex, roots, intercept)
 *  - Live sliders for a, b, c on single-equation cards
 *  - Labeled custom points, fullscreen mode, PNG export
 */

import {
  injectCss, el, buildHeader, buildSlider, openFullscreen, downloadSvgAsPng,
  theme, SERIES_COLORS, toPersianDigits, formatNumber, invalidateThemeCache} from './theme.js';

/* ---------------- spec parsing (legacy compatible) ---------------- */

export function parseLineEquation(eqStr) {
  let eq = eqStr.replace(/\s+/g, '').toLowerCase();
  const fa = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
  const ar = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
  for (let i = 0; i < 10; i++) eq = eq.split(fa[i]).join(i).split(ar[i]).join(i);
  if (eq.startsWith('y==')) eq = eq.slice(3);
  else if (eq.startsWith('y=')) eq = eq.slice(2);
  eq = eq.replace(/x\^3|x\*\*3|x³|x_3/g, 'X3');
  eq = eq.replace(/x\^2|x\*\*2|x²|x_2/g, 'X2');
  eq = eq.replace(/x/g, 'X1');

  const terms = eq.match(/([+-]?[^+-]+)/g) || [eq];
  let a = 0, b = 0, c = 0, d3 = 0;
  const coeffOf = (term, marker) => {
    const s = term.replace(marker, '');
    if (s === '' || s === '+') return 1;
    if (s === '-') return -1;
    if (s.includes('/')) {
      const [p, q] = s.split('/');
      return (parseFloat(p) || (s.startsWith('-') ? -1 : 1)) / (parseFloat(q) || 1);
    }
    const v = parseFloat(s);
    return Number.isNaN(v) ? 1 : v;
  };
  for (const term of terms) {
    if (term.includes('X3')) d3 += coeffOf(term, 'X3');
    else if (term.includes('X2')) a += coeffOf(term, 'X2');
    else if (term.includes('X1')) b += coeffOf(term, 'X1');
    else {
      const v = parseFloat(term);
      if (!Number.isNaN(v)) c += v;
    }
  }
  return { a, b, c, d: d3 };
}

export function parsePlotSpec(specText) {
  const lines = String(specText || '').split('\n');
  const spec = {
    title: 'نمودار تعاملی ریاضی',
    equations: [],
    points: [],
    minX: -10, maxX: 10, minY: null, maxY: null,
  };
  const isMulti = lines.some((l) => l.includes(':'));

  const pushEq = (raw) => {
    const parsed = parseLineEquation(raw);
    spec.equations.push({ ...parsed, raw, color: SERIES_COLORS[spec.equations.length % SERIES_COLORS.length] });
  };

  if (!isMulti) {
    if (specText.trim()) pushEq(specText.trim());
    return spec;
  }
  for (let line of lines) {
    line = line.trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx !== -1) {
      const key = line.slice(0, idx).trim().toLowerCase();
      const val = line.slice(idx + 1).trim();
      if (key === 'title') spec.title = val;
      else if (key === 'eq' || key === 'y' || key === 'y=') pushEq(val);
      else if (key === 'point') {
        const parts = val.split('|').map((s) => s.trim());
        const coords = parts[0].split(',').map(Number);
        if (coords.length === 2 && coords.every((n) => !Number.isNaN(n))) {
          spec.points.push({ x: coords[0], y: coords[1], label: parts[1] || '', color: parts[2] || '#EF4444' });
        }
      } else if (key === 'range') {
        const [a, b] = val.split(',').map(Number);
        if (!Number.isNaN(a) && !Number.isNaN(b)) { spec.minX = a; spec.maxX = b; }
      } else if (key === 'yrange') {
        const [a, b] = val.split(',').map(Number);
        if (!Number.isNaN(a) && !Number.isNaN(b)) { spec.minY = a; spec.maxY = b; }
      } else if (val.toLowerCase().includes('x') || /^[0-9+\-*/().\s]+$/.test(val)) {
        pushEq(line);
      }
    } else if (line.toLowerCase().startsWith('y=') || line.includes('x') || /^[0-9+\-*/().\s]+$/.test(line)) {
      pushEq(line);
    }
  }
  return spec;
}

const evalEq = (eq, x) => eq.d * x * x * x + eq.a * x * x + eq.b * x + eq.c;

/**
 * Frame the view so a parabola's vertex (or a line's intercept) sits
 * in the middle of the plot — far-away vertices like y = x² - 450
 * would otherwise look like "nothing was drawn".
 */
function autoFramePlot(spec, state) {
  if (spec.minY !== null && spec.maxY !== null) return;
  const eqs = spec.equations || [];
  if (!eqs.length) return;

  const pts = [];
  for (const eq of eqs) {
    pts.push({ x: 0, y: evalEq(eq, 0) });
    if (Math.abs(eq.a) > 1e-9 && Math.abs(eq.d) < 1e-12) {
      const xv = -eq.b / (2 * eq.a);
      const yv = evalEq(eq, xv);
      if (Number.isFinite(xv) && Number.isFinite(yv)) {
        pts.push({ x: xv, y: yv, vertex: true });
        const disc = eq.b * eq.b - 4 * eq.a * eq.c;
        if (disc >= 0) {
          const sq = Math.sqrt(disc);
          pts.push({ x: (-eq.b - sq) / (2 * eq.a), y: 0 });
          if (disc > 1e-9) pts.push({ x: (-eq.b + sq) / (2 * eq.a), y: 0 });
        }
      }
    } else if (Math.abs(eq.b) > 1e-9 && Math.abs(eq.a) < 1e-12) {
      pts.push({ x: -eq.c / eq.b, y: 0 });
    }
  }
  for (const p of spec.points || []) {
    if (Number.isFinite(p.x) && Number.isFinite(p.y)) pts.push({ x: p.x, y: p.y });
  }
  const finite = pts.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (!finite.length) return;

  const vertex = finite.find((p) => p.vertex);
  if (vertex && eqs.length === 1) {
    state.cx = vertex.x;
    state.cy = vertex.y;
    const a = Math.abs(eqs[0].a) || 0.25;
    // span so the parabola's curvature is visible around the vertex
    state.span = Math.min(24, Math.max(5, 4 / Math.sqrt(a)));
    return;
  }

  const xs = finite.map((p) => p.x);
  const ys = finite.map((p) => p.y);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  state.cx = (xMin + xMax) / 2;
  state.cy = (yMin + yMax) / 2;
  const dx = Math.max(6, (xMax - xMin) * 0.7 + 4);
  const dy = Math.max(6, (yMax - yMin) * 0.7 + 4);
  state.span = Math.min(80, Math.max(dx / 2, dy / 2.4));
}

/* ---------------- nice tick steps ---------------- */

function niceStep(rawStep) {
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const n = rawStep / mag;
  if (n < 1.5) return mag;
  if (n < 3.5) return 2 * mag;
  if (n < 7.5) return 5 * mag;
  return 10 * mag;
}

function formatTick(v, step) {
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
  let s = v.toFixed(Math.min(decimals, 4));
  if (s.includes('.')) s = s.replace(/\.?0+$/, '');
  if (s === '-0') s = '0';
  return s;
}

/* ---------------- renderer ---------------- */

export function renderPlotCard(spec, opts = {}) {
  injectCss();
  const card = el('div', 'iw-card iw-plot-card');
  card.style.setProperty('--iw-accent', 'var(--color-primary, #4f6df5)');
  card.classList.add('interactive-plot-card');
  card.setAttribute('data-spec', spec.rawText || '');

  // View state in math coordinates: center + units-per-half-width.
  const state = {
    cx: (spec.minX + spec.maxX) / 2,
    cy: spec.minY !== null ? (spec.minY + spec.maxY) / 2 : 0,
    span: Math.max(0.5, (spec.maxX - spec.minX) / 2),
  };
  autoFramePlot(spec, state);
  const initialView = { ...state };
  const sliders = [];

  let stage, svg, hud;
  let traceMode = false;
  let traceX = 0;
  let traceBtn = null;

  const { header, toolbar } = buildHeader({
    title: spec.title,
    badgeIcon: 'show_chart',
    buttons: [
      {
        icon: 'timeline', title: 'نقطه روی منحنی — با کشیدن انگشت مقدار x را عوض کنید',
        onClick: (btn) => {
          traceMode = !traceMode;
          btn.classList.toggle('iw-btn-active', traceMode);
          if (traceMode) {
            traceX = state.cx;
            draw();
            showTrace();
          } else {
            hideCross();
            draw();
          }
        },
      },
      {
        icon: 'restart_alt', title: 'بازنشانی نما',
        onClick: () => { Object.assign(state, initialView); sliders.forEach((s) => s.reset && s.reset()); draw(); if (traceMode) showTrace(); },
      },
      { icon: 'download', title: 'دانلود تصویر', onClick: () => downloadSvgAsPng(svg, 'math-plot', opts.saveFile) },
      {
        icon: 'fullscreen', title: 'تمام‌صفحه',
        onClick: () => openFullscreen({
          title: spec.title, badgeIcon: 'show_chart',
          renderBody: (body) => { const c = renderPlotCard({ ...spec }, opts); c.style.margin = '0'; c.style.height = '100%'; body.appendChild(c); body.style.overflow = 'auto'; },
        }),
      },
    ],
  });
  traceBtn = toolbar.querySelector('button');
  card.appendChild(header);

  // equation chips
  if (spec.equations.length) {
    const legend = el('div', 'iw-legend');
    spec.equations.forEach((eq) => {
      const raw = eq.raw.toLowerCase().startsWith('y=') ? eq.raw : 'y = ' + eq.raw;
      const chip = el('span', 'iw-chip', `<span class="iw-dot" style="background:${eq.color}"></span><span style="direction:ltr;font-family:var(--font-mono)"></span>`);
      chip.querySelector('span:last-child').textContent = raw;
      legend.appendChild(chip);
    });
    card.appendChild(legend);
  }

  stage = el('div', 'iw-stage');
  stage.style.aspectRatio = '4 / 3';
  stage.style.maxHeight = '420px';
  svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  stage.appendChild(svg);
  hud = el('div', 'iw-hud');
  hud.style.bottom = '8px'; hud.style.right = '8px';
  stage.appendChild(hud);
  card.appendChild(stage);

  const info = el('div', 'iw-info');
  card.appendChild(info);

  // sliders for single polynomial equation
  if (spec.equations.length === 1) {
    const eq = spec.equations[0];
    const panel = el('div', 'iw-panel');
    const mk = (label, key, min, max, step) => {
      const s = buildSlider({
        label, min, max, step, value: eq[key],
        onInput: (v) => { eq[key] = v; draw(); },
      });
      s.reset = () => s.set(spec.equations[0][key] === eq[key] ? initialCoeffs[key] : initialCoeffs[key]);
      panel.appendChild(s.row);
      sliders.push(s);
    };
    const initialCoeffs = { a: eq.a, b: eq.b, c: eq.c };
    if (eq.d !== 0 || eq.a !== 0) mk('ضریب x² (a)', 'a', -5, 5, 0.1);
    mk('ضریب x (b)', 'b', -10, 10, 0.1);
    mk('جمله ثابت (c)', 'c', -10, 10, 0.1);
    sliders.forEach((s, i) => { const keys = ['a', 'b', 'c']; s.reset = () => { /* reset to initial */ }; });
    // wire proper reset
    const rows = panel.querySelectorAll('.iw-slider-row');
    const keys = (eq.d !== 0 || eq.a !== 0) ? ['a', 'b', 'c'] : ['b', 'c'];
    sliders.forEach((s, i) => { s.reset = () => { const k = keys[i]; s.set(initialCoeffs[k]); eq[k] = initialCoeffs[k]; draw(); }; });
    card.appendChild(panel);
  }

  /* ---- drawing ---- */

  function draw() {
    const W = stage.clientWidth || 600;
    const H = stage.clientHeight || Math.round(W * 0.75);
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const t = theme();

    const unitsPerPx = (state.span * 2) / W;
    const xMin = state.cx - state.span;
    const xMax = state.cx + state.span;
    const ySpanHalf = unitsPerPx * H / 2;
    const yMin = state.cy - ySpanHalf;
    const yMax = state.cy + ySpanHalf;

    const X = (x) => (x - xMin) / unitsPerPx;
    const Y = (y) => H - (y - yMin) / unitsPerPx;

    let html = '';
    // grid — use dedicated theme-aware colors (soft in both light & dark)
    const step = niceStep(state.span / 4);
    const minor = step / 5;
    const gridMinor = t['--grid-minor'] || t['--border-subtle'] || 'rgba(128,128,128,0.08)';
    const gridMajor = t['--grid-major'] || t['--border-soft'] || 'rgba(128,128,128,0.16)';
    const axisColor = t['--axis-color'] || t['--text-secondary'] || '#888';
    let gridMin = '', gridMaj = '', ticks = '';
    for (let x = Math.ceil(xMin / minor) * minor; x <= xMax; x += minor) {
      const major = Math.abs(x / step - Math.round(x / step)) < 1e-6;
      const px = X(x).toFixed(1);
      if (major) {
        gridMaj += `<line x1="${px}" y1="0" x2="${px}" y2="${H}" stroke="${gridMajor}" stroke-width="0.9"/>`;
        if (Math.abs(x) > step / 100) ticks += `<text x="${px}" y="${Math.min(H - 4, Math.max(12, Y(0) + 14))}" font-size="10" fill="${t['--text-secondary']}" text-anchor="middle" font-family="monospace">${toPersianDigits(formatTick(x, step))}</text>`;
      } else {
        gridMin += `<line x1="${px}" y1="0" x2="${px}" y2="${H}" stroke="${gridMinor}" stroke-width="0.5"/>`;
      }
    }
    for (let y = Math.ceil(yMin / minor) * minor; y <= yMax; y += minor) {
      const major = Math.abs(y / step - Math.round(y / step)) < 1e-6;
      const py = Y(y).toFixed(1);
      if (major) {
        gridMaj += `<line x1="0" y1="${py}" x2="${W}" y2="${py}" stroke="${gridMajor}" stroke-width="0.9"/>`;
        if (Math.abs(y) > step / 100) ticks += `<text x="${Math.max(14, Math.min(W - 8, X(0) - 10))}" y="${py}" font-size="10" fill="${t['--text-secondary']}" text-anchor="middle" dominant-baseline="middle" font-family="monospace">${toPersianDigits(formatTick(y, step))}</text>`;
      } else {
        gridMin += `<line x1="0" y1="${py}" x2="${W}" y2="${py}" stroke="${gridMinor}" stroke-width="0.5"/>`;
      }
    }
    // axes — slightly stronger than major grid, still soft
    let axes = '';
    if (yMin <= 0 && yMax >= 0) axes += `<line x1="0" y1="${Y(0)}" x2="${W}" y2="${Y(0)}" stroke="${axisColor}" stroke-width="1.4"/>`;
    if (xMin <= 0 && xMax >= 0) axes += `<line x1="${X(0)}" y1="0" x2="${X(0)}" y2="${H}" stroke="${axisColor}" stroke-width="1.4"/>`;

    // curves
    let curves = '';
    for (const eq of spec.equations) {
      let d = '';
      let pen = false;
      let prevY = null;
      const N = Math.max(160, Math.floor(W / 2));
      for (let i = 0; i <= N; i++) {
        const x = xMin + (i / N) * (xMax - xMin);
        const y = evalEq(eq, x);
        const px = X(x), py = Y(y);
        // break path on asymptote-like jumps
        if (prevY !== null && Math.abs(py - prevY) > H * 2) { pen = false; }
        if (py < -H * 2 || py > H * 3) { pen = false; prevY = py; continue; }
        d += (pen ? ' L ' : ' M ') + px.toFixed(1) + ' ' + py.toFixed(1);
        pen = true;
        prevY = py;
      }
      curves += `<path d="${d}" fill="none" stroke="${eq.color}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`;
    }

    // key points for single quadratic
    let keyPts = '';
    if (spec.equations.length === 1) {
      const eq = spec.equations[0];
      const kp = [];
      if (Math.abs(eq.a) > 1e-9) {
        const xv = -eq.b / (2 * eq.a);
        const yv = evalEq(eq, xv);
        kp.push({ x: xv, y: yv, label: 'رأس', color: '#f0a020' });
        const disc = eq.b * eq.b - 4 * eq.a * eq.c;
        if (disc >= 0) {
          const sq = Math.sqrt(disc);
          kp.push({ x: (-eq.b - sq) / (2 * eq.a), y: 0, label: 'ریشه', color: '#e5484d' });
          if (disc > 1e-9) kp.push({ x: (-eq.b + sq) / (2 * eq.a), y: 0, label: 'ریشه', color: '#e5484d' });
        }
      } else if (Math.abs(eq.b) > 1e-9) {
        kp.push({ x: -eq.c / eq.b, y: 0, label: 'ریشه', color: '#e5484d' });
      }
      kp.push({ x: 0, y: evalEq(eq, 0), label: 'عرض از مبدأ', color: '#18a058' });
      for (const p of kp) {
        if (p.x < xMin || p.x > xMax || p.y < yMin || p.y > yMax) continue;
        const px = X(p.x), py = Y(p.y);
        keyPts += `<g class="iw-key-pt" data-label="${p.label} (${formatNumber(p.x, 2)} , ${formatNumber(p.y, 2)})" style="cursor:pointer">
          <circle cx="${px}" cy="${py}" r="4.5" fill="${p.color}" stroke="#fff" stroke-width="1.6"/>
          <circle cx="${px}" cy="${py}" r="9" fill="${p.color}" opacity="0.18"/></g>`;
      }
    }

    // custom points
    let pts = '';
    for (const p of spec.points) {
      if (p.x < xMin || p.x > xMax || p.y < yMin || p.y > yMax) continue;
      const px = X(p.x), py = Y(p.y);
      pts += `<circle cx="${px}" cy="${py}" r="5" fill="${p.color}" stroke="#fff" stroke-width="1.8"/>`;
      if (p.label) pts += `<text x="${px + 8}" y="${py - 8}" font-size="11" font-weight="800" fill="${t['--text-primary']}" paint-order="stroke" stroke="${t['--bg-sunken']}" stroke-width="3">${toPersianDigits(p.label)}</text>`;
    }

    const cross = `<g class="iw-cross" style="display:none">
      <line class="cx-v" stroke="${t['--color-primary']}" stroke-width="1" stroke-dasharray="4,4"/>
      <line class="cx-h" stroke="${t['--color-primary']}" stroke-width="1" stroke-dasharray="4,4"/>
      <circle class="cx-d" r="6" fill="${t['--color-primary']}" stroke="#fff" stroke-width="2"/>
    </g>`;

    svg.innerHTML = gridMin + gridMaj + axes + ticks + curves + keyPts + pts + cross;
    svg.querySelectorAll('.iw-key-pt').forEach((g) => {
      g.addEventListener('click', (e) => { e.stopPropagation(); info.textContent = g.getAttribute('data-label'); });
    });
    if (traceMode) showTrace();
  }

  /* ---- interactions ---- */

  const posFromEvent = (e) => {
    const r = stage.getBoundingClientRect();
    const cx = (e.clientX ?? (e.touches && e.touches[0] && e.touches[0].clientX)) - r.left;
    const cy = (e.clientY ?? (e.touches && e.touches[0] && e.touches[0].clientY)) - r.top;
    return { px: cx, py: cy, w: r.width, h: r.height };
  };
  const mathFromPx = ({ px, py, w, h }) => {
    const unitsPerPx = (state.span * 2) / w;
    return {
      x: state.cx - state.span + px * unitsPerPx,
      y: state.cy + (h / 2 - py) * unitsPerPx,
      unitsPerPx,
    };
  };

  function showTrace() {
    const g = svg.querySelector('.iw-cross');
    if (!g) return;
    const W = stage.clientWidth || 1;
    const H = stage.clientHeight || 1;
    const unitsPerPx = (state.span * 2) / W;
    const xMin = state.cx - state.span;
    const ySpanHalf = unitsPerPx * H / 2;
    const yMin = state.cy - ySpanHalf;
    const X = (x) => (x - xMin) / unitsPerPx;
    const Y = (y) => H - (y - yMin) / unitsPerPx;
    const eq = spec.equations[0];
    const yv = eq ? evalEq(eq, traceX) : 0;
    const px = X(traceX);
    const py = eq ? Y(yv) : Y(0);
    g.style.display = '';
    const v = g.querySelector('.cx-v'), h = g.querySelector('.cx-h'), d = g.querySelector('.cx-d');
    v.setAttribute('x1', px); v.setAttribute('x2', px); v.setAttribute('y1', 0); v.setAttribute('y2', H);
    h.setAttribute('x1', 0); h.setAttribute('x2', W); h.setAttribute('y1', py); h.setAttribute('y2', py);
    d.setAttribute('cx', px); d.setAttribute('cy', py);
    if (eq) d.setAttribute('fill', eq.color);
    hud.textContent = eq
      ? `x = ${formatNumber(traceX, 3, false)}    y = ${formatNumber(yv, 3, false)}`
      : `x = ${formatNumber(traceX, 3, false)}`;
    hud.style.opacity = '1';
    info.textContent = eq
      ? `نقطه روی منحنی: ( ${formatNumber(traceX, 3)} ، ${formatNumber(yv, 3)} )`
      : '';
  }

  const hideCross = () => {
    if (traceMode) return;
    const g = svg.querySelector('.iw-cross');
    if (g) g.style.display = 'none';
    hud.style.opacity = '0';
  };

  function setTraceFromClientX(clientX) {
    const r = stage.getBoundingClientRect();
    const px = Math.max(0, Math.min(r.width, clientX - r.left));
    const unitsPerPx = (state.span * 2) / (r.width || 1);
    traceX = state.cx - state.span + px * unitsPerPx;
    showTrace();
  }

  const pointers = new Map();
  let drag = null;
  let pinch = null;
  let suppressUntilUp = false; // after pinch, leftover finger must not pan/trace

  function pinchFromPointers() {
    const pts = [...pointers.values()];
    if (pts.length < 2) return null;
    const dx = pts[0].x - pts[1].x, dy = pts[0].y - pts[1].y;
    const r = stage.getBoundingClientRect();
    const midX = (pts[0].x + pts[1].x) / 2 - r.left;
    const midY = (pts[0].y + pts[1].y) / 2 - r.top;
    return { d: Math.hypot(dx, dy) || 1, midX, midY, w: r.width, h: r.height };
  }

  function applyPinch() {
    const now = pinchFromPointers();
    if (!pinch || !now) return;
    const factor = pinch.d / now.d;
    state.span = Math.min(1e5, Math.max(0.05, pinch.span * factor));
    const unitsPerPx = (state.span * 2) / now.w;
    // Keep the math point that was under the original pinch midpoint
    state.cx = pinch.mathX - (now.midX - now.w / 2) * unitsPerPx;
    state.cy = pinch.mathY + (now.midY - now.h / 2) * unitsPerPx;
    draw();
  }

  stage.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { stage.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }

    if (pointers.size === 2) {
      const p = pinchFromPointers();
      const m = mathFromPx({ px: p.midX, py: p.midY, w: p.w, h: p.h });
      pinch = { d: p.d, span: state.span, mathX: m.x, mathY: m.y };
      drag = null;
      hideCross();
      return;
    }

    if (suppressUntilUp) return;

    if (traceMode) {
      setTraceFromClientX(e.clientX);
      return;
    }

    drag = { x: e.clientX, y: e.clientY, cx: state.cx, cy: state.cy, moved: false };
  });

  stage.addEventListener('pointermove', (e) => {
    if (pointers.has(e.pointerId)) {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    if (pinch && pointers.size >= 2) {
      e.preventDefault();
      applyPinch();
      return;
    }
    if (suppressUntilUp) return;

    if (traceMode && pointers.has(e.pointerId)) {
      e.preventDefault();
      setTraceFromClientX(e.clientX);
      return;
    }

    if (drag) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
      if (drag.moved) {
        const unitsPerPx = (state.span * 2) / stage.clientWidth;
        state.cx = drag.cx - dx * unitsPerPx;
        state.cy = drag.cy + dy * unitsPerPx;
        draw();
        return;
      }
    }
  });

  const endPointer = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) {
      if (pinch) suppressUntilUp = true;
      pinch = null;
    }
    if (pointers.size === 0) {
      drag = null;
      suppressUntilUp = false;
    }
  };
  stage.addEventListener('pointerup', endPointer);
  stage.addEventListener('pointercancel', endPointer);
  stage.addEventListener('pointerleave', (e) => {
    if (pointers.has(e.pointerId)) endPointer(e);
  });

  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    const p = posFromEvent(e);
    const before = mathFromPx(p);
    const factor = Math.exp(e.deltaY * 0.0012);
    state.span = Math.min(1e5, Math.max(0.05, state.span * factor));
    const after = mathFromPx(p);
    state.cx += before.x - after.x;
    state.cy += before.y - after.y;
    draw();
    if (traceMode) showTrace();
  }, { passive: false });

  new ResizeObserver(() => draw()).observe(stage);

  // Redraw when the host app switches light/dark theme so grid colors stay correct
  const onThemeChange = () => {
    try { invalidateThemeCache(); } catch (_) { /* optional export */ }
    draw();
  };
  window.addEventListener('theme-changed', onThemeChange);
  // Clean up when the card is removed from the DOM
  const mo = new MutationObserver(() => {
    if (!document.body.contains(card)) {
      window.removeEventListener('theme-changed', onThemeChange);
      mo.disconnect();
    }
  });
  mo.observe(document.body, { childList: true, subtree: true });

  requestAnimationFrame(draw);
  return card;
}

/* ---------------- host binding ---------------- */

export function initPlots(parent, opts = {}) {
  parent.querySelectorAll('.interactive-plot-card').forEach((old) => {
    const specStr = old.getAttribute('data-spec') || old.getAttribute('data-equation') || '';
    const spec = parsePlotSpec(specStr);
    spec.rawText = specStr;
    const card = renderPlotCard(spec, opts);
    old.replaceWith(card);
  });
}
