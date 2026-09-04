/**
 * theme.js — Shared design system for all interactive widgets.
 * Reads CSS custom properties from the host app when available and
 * falls back to a built-in palette, so widgets look native everywhere.
 */

const FALLBACK_LIGHT = {
  '--bg-card': '#ffffff',
  '--bg-sunken': '#f4f6fb',
  '--bg-inset': '#eceff6',
  '--color-primary': '#4f6df5',
  '--color-danger': '#e5484d',
  '--text-primary': '#1a2233',
  '--text-secondary': '#5b6474',
  '--border-subtle': '#e8ebf2',
  '--border-soft': '#d0d6e4',
  '--border-strong': '#aab3c5',
  '--font-mono': 'ui-monospace, SFMono-Regular, Menlo, monospace',
  // Dedicated graph grid colors (light)
  '--grid-minor': 'rgba(0, 0, 0, 0.045)',
  '--grid-major': 'rgba(0, 0, 0, 0.10)',
  '--axis-color': 'rgba(0, 0, 0, 0.38)',
};

const FALLBACK_DARK = {
  '--bg-card': '#1C1C1E',
  '--bg-sunken': '#09090A',
  '--bg-inset': '#2C2C2E',
  '--color-primary': '#94A3B8',
  '--color-danger': '#F87171',
  '--text-primary': '#F4F4F5',
  '--text-secondary': '#A1A1AA',
  '--border-subtle': '#2A2A2E',
  '--border-soft': '#3A3A40',
  '--border-strong': '#52525B',
  '--font-mono': 'ui-monospace, SFMono-Regular, Menlo, monospace',
  // Dedicated graph grid colors (dark) — soft, not glaring
  '--grid-minor': 'rgba(255, 255, 255, 0.045)',
  '--grid-major': 'rgba(255, 255, 255, 0.10)',
  '--axis-color': 'rgba(255, 255, 255, 0.42)',
};

export const SERIES_COLORS = ['#4f6df5', '#e5484d', '#18a058', '#f0a020', '#8b5cf6', '#ec4899'];

let cachedTheme = null;
let cachedThemeKey = null;

function isDarkMode() {
  const root = document.documentElement;
  const attr = root.getAttribute('data-theme');
  if (attr === 'dark') return true;
  if (attr === 'light') return false;
  // fallback: check computed background luminance or media query
  try {
    const bg = getComputedStyle(document.body).getPropertyValue('--bg-card').trim()
      || getComputedStyle(document.body).backgroundColor;
    if (bg.startsWith('#') && bg.length >= 7) {
      const r = parseInt(bg.slice(1, 3), 16);
      const g = parseInt(bg.slice(3, 5), 16);
      const b = parseInt(bg.slice(5, 7), 16);
      // relative luminance approximation
      return (0.299 * r + 0.587 * g + 0.114 * b) < 128;
    }
  } catch (_) { /* ignore */ }
  return window.matchMedia?.('(prefers-color-scheme: dark)')?.matches ?? false;
}

export function getTheme() {
  const dark = isDarkMode();
  const fallback = dark ? FALLBACK_DARK : FALLBACK_LIGHT;
  const styles = getComputedStyle(document.body);
  const t = {};
  for (const key of Object.keys(fallback)) {
    // Prefer live CSS variables when present
    const v = styles.getPropertyValue(key).trim();
    t[key] = v || fallback[key];
  }
  // Always compute dedicated grid colors from the actual bg so they stay
  // balanced even if the host theme tokens are sparse.
  if (dark) {
    t['--grid-minor'] = t['--grid-minor'] || 'rgba(255, 255, 255, 0.045)';
    t['--grid-major'] = t['--grid-major'] || 'rgba(255, 255, 255, 0.10)';
    t['--axis-color'] = t['--axis-color'] || 'rgba(255, 255, 255, 0.42)';
  } else {
    t['--grid-minor'] = t['--grid-minor'] || 'rgba(0, 0, 0, 0.045)';
    t['--grid-major'] = t['--grid-major'] || 'rgba(0, 0, 0, 0.10)';
    t['--axis-color'] = t['--axis-color'] || 'rgba(0, 0, 0, 0.38)';
  }
  cachedTheme = t;
  cachedThemeKey = dark ? 'dark' : 'light';
  return t;
}

/** Fast path; auto-invalidates when the app theme flips. */
export function theme() {
  const key = isDarkMode() ? 'dark' : 'light';
  if (!cachedTheme || cachedThemeKey !== key) return getTheme();
  return cachedTheme;
}

/** Force refresh (call after user toggles theme). */
export function invalidateThemeCache() {
  cachedTheme = null;
  cachedThemeKey = null;
}

export function cssVar(name) {
  return theme()[name] || FALLBACK[name] || name;
}

export function toPersianDigits(str) {
  if (str === null || str === undefined) return '';
  const farsi = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
  return String(str).replace(/[0-9]/g, (w) => farsi[+w]);
}

/** Parse a number typed by the user (Latin / Persian / Arabic digits). */
export function parseUserNumber(str) {
  if (str === null || str === undefined) return null;
  const fa = '۰۱۲۳۴۵۶۷۸۹';
  const ar = '٠١٢٣٤٥٦٧٨٩';
  let s = String(str).trim()
    .replace(/[۰-۹]/g, (d) => String(fa.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String(ar.indexOf(d)))
    .replace(/[٬,]/g, '')
    .replace(/٫/g, '.')
    .replace(/[−–—]/g, '-')
    .replace(/[^\d.eE+-]/g, '');
  if (!s || s === '-' || s === '.' || s === '-.') return null;
  const v = parseFloat(s);
  return Number.isFinite(v) ? v : null;
}

export function formatNumber(n, digits = 2, persian = true) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  if (!Number.isFinite(n)) return n > 0 ? '∞' : '-∞';
  let s = Math.abs(n) >= 1000 || Number.isInteger(n)
    ? String(Math.round(n * 100) / 100)
    : n.toFixed(digits).replace(/\.?0+$/, '');
  return persian ? toPersianDigits(s) : s;
}

/* ------------------------------------------------------------------ */
/*  Shared CSS (injected once)                                         */
/* ------------------------------------------------------------------ */

const CSS = `
.iw-card {
  --iw-accent: var(--color-primary, #4f6df5);
  background: var(--bg-card, #fff);
  border: 1.5px solid var(--border-soft, #d5dbe8);
  border-radius: 16px;
  padding: 14px;
  margin: 12px 0;
  box-shadow: 0 2px 10px rgba(20, 30, 60, 0.05);
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
  box-sizing: border-box;
  direction: rtl;
  font-family: inherit;
  transition: box-shadow .25s ease, transform .25s ease;
}
.iw-card:hover { box-shadow: 0 6px 22px rgba(20, 30, 60, 0.09); }
.iw-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.iw-title {
  display: flex; align-items: center; gap: 8px;
  font-weight: 800; font-size: 14px; color: var(--text-primary, #1a2233);
}
.iw-title .iw-badge {
  width: 30px; height: 30px; border-radius: 9px; flex: none;
  display: inline-flex; align-items: center; justify-content: center;
  background: color-mix(in srgb, var(--iw-accent) 12%, transparent);
  color: var(--iw-accent);
  font-size: 18px;
}
.iw-title .iw-badge .material-symbols-rounded { font-size: 19px; }
.iw-toolbar { display: flex; align-items: center; gap: 6px; }
.iw-btn {
  min-width: 36px; height: 36px; padding: 0 10px;
  border-radius: 8px; border: 1px solid var(--border-subtle, #e3e7f0);
  background: var(--bg-card, #fff); color: var(--text-secondary, #5b6474);
  cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 4px;
  font-size: 12px; font-weight: 700; font-family: inherit;
  transition: background .15s, color .15s, border-color .15s, transform .1s;
}
.iw-btn:hover { background: var(--bg-sunken, #f4f6fb); color: var(--text-primary, #1a2233); border-color: var(--border-soft, #d5dbe8); }
.iw-btn:active { transform: scale(.94); }
.iw-btn.iw-btn-active { background: color-mix(in srgb, var(--iw-accent) 14%, transparent); color: var(--iw-accent); border-color: color-mix(in srgb, var(--iw-accent) 35%, transparent); }
.iw-btn .material-symbols-rounded { font-size: 18px; }
.iw-stage {
  position: relative; width: 100%;
  background: var(--bg-sunken, #f4f6fb);
  border: 1px solid var(--border-subtle, #e3e7f0);
  border-radius: 12px; overflow: hidden;
  touch-action: none; user-select: none; -webkit-user-select: none;
}
.iw-stage svg, .iw-stage canvas { display: block; width: 100%; height: 100%; }
.iw-hud {
  position: absolute; padding: 4px 9px; border-radius: 8px;
  background: rgba(15, 20, 35, 0.82); color: #fff;
  font-family: var(--font-mono, monospace); font-size: 11px; direction: ltr;
  pointer-events: none; opacity: 0; transition: opacity .15s;
  white-space: nowrap; z-index: 5; backdrop-filter: blur(4px);
}
.iw-panel {
  display: flex; flex-direction: column; gap: 8px;
  background: var(--bg-sunken, #f4f6fb);
  border: 1px solid var(--border-subtle, #e3e7f0);
  border-radius: 12px; padding: 10px 12px;
}
.iw-panel[hidden] { display: none; }
.iw-info {
  min-height: 20px; font-size: 13px; line-height: 1.9;
  color: var(--text-primary, #1a2233);
}
.iw-info:empty { display: none; }
.iw-chip {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 3px 10px; border-radius: 999px; font-size: 12px; font-weight: 700;
  background: var(--bg-card, #fff); border: 1px solid var(--border-subtle, #e3e7f0);
  color: var(--text-primary, #1a2233); margin: 2px;
}
.iw-chip .iw-dot { width: 9px; height: 9px; border-radius: 50%; flex: none; }
.iw-slider-row {
  display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 10px;
  font-size: 12px; font-weight: 700; color: var(--text-secondary, #5b6474);
}
.iw-slider-row output {
  font-family: var(--font-mono, monospace); font-weight: 800; min-width: 52px; text-align: center;
  color: var(--iw-accent); background: color-mix(in srgb, var(--iw-accent) 10%, transparent);
  border-radius: 8px; padding: 6px 8px; direction: ltr; cursor: pointer;
  border: 1px solid transparent; box-sizing: border-box;
}
.iw-slider-row output:hover, .iw-slider-row output:focus {
  border-color: color-mix(in srgb, var(--iw-accent) 45%, transparent);
  background: color-mix(in srgb, var(--iw-accent) 16%, transparent);
}
.iw-num-edit {
  font-family: var(--font-mono, monospace); font-weight: 800; min-width: 52px; width: 64px;
  text-align: center; direction: ltr; color: var(--iw-accent);
  background: var(--bg-card, #fff);
  border: 1.5px solid var(--iw-accent); border-radius: 8px;
  padding: 6px 6px; font-size: 13px; box-sizing: border-box;
  outline: none;
}
.iw-telemetry {
  display: flex; flex-wrap: wrap; gap: 6px; direction: ltr; justify-content: flex-end;
  font-family: var(--font-mono, monospace); font-size: 11.5px; color: var(--text-secondary, #5b6474);
}
.iw-telem-item {
  display: inline-flex; align-items: baseline; gap: 6px;
  min-width: 112px; padding: 5px 8px;
  background: var(--bg-sunken, #f4f6fb);
  border: 1px solid var(--border-subtle, #e3e7f0);
  border-radius: 8px; box-sizing: border-box;
}
.iw-telem-item .k { color: var(--text-secondary, #5b6474); font-weight: 700; min-width: 1.5em; }
.iw-telem-item .v {
  color: var(--text-primary, #1a2233); font-weight: 800;
  font-variant-numeric: tabular-nums lining-nums;
  min-width: 6.8ch; text-align: left; white-space: nowrap;
}
input[type="range"].iw-range {
  -webkit-appearance: none; appearance: none; width: 100%; height: 26px; background: transparent; cursor: pointer;
}
input[type="range"].iw-range::-webkit-slider-runnable-track {
  height: 6px; border-radius: 3px;
  background: linear-gradient(to left, var(--iw-accent) var(--fill, 50%), var(--border-subtle, #e3e7f0) var(--fill, 50%));
}
input[type="range"].iw-range::-webkit-slider-thumb {
  -webkit-appearance: none; width: 18px; height: 18px; margin-top: -6px;
  border-radius: 50%; background: var(--bg-card, #fff);
  border: 2.5px solid var(--iw-accent); box-shadow: 0 1px 4px rgba(0,0,0,.2);
  transition: transform .12s;
}
input[type="range"].iw-range::-webkit-slider-thumb:hover { transform: scale(1.15); }
input[type="range"].iw-range::-moz-range-track { height: 6px; border-radius: 3px; background: var(--border-subtle, #e3e7f0); }
input[type="range"].iw-range::-moz-range-progress { height: 6px; border-radius: 3px; background: var(--iw-accent); }
input[type="range"].iw-range::-moz-range-thumb {
  width: 15px; height: 15px; border-radius: 50%; background: var(--bg-card, #fff);
  border: 2.5px solid var(--iw-accent); box-shadow: 0 1px 4px rgba(0,0,0,.2);
}
.iw-controls { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.iw-play {
  width: 34px; height: 34px; border-radius: 10px; border: none;
  background: var(--iw-accent); color: #fff; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  transition: filter .15s, transform .1s;
}
.iw-play:hover { filter: brightness(1.1); }
.iw-play:active { transform: scale(.93); }
.iw-play .material-symbols-rounded { font-size: 20px; }
.iw-overlay {
  position: absolute; inset: 0; z-index: 4;
  display: flex; align-items: center; justify-content: center;
  background: color-mix(in srgb, var(--bg-sunken, #f4f6fb) 72%, transparent);
  backdrop-filter: blur(2px); cursor: pointer;
}
.iw-overlay span {
  background: var(--bg-card, #fff); border: 1px solid var(--border-soft, #d5dbe8);
  padding: 8px 18px; border-radius: 999px; font-size: 13px; font-weight: 800;
  color: var(--text-primary, #1a2233); box-shadow: 0 4px 14px rgba(0,0,0,.1);
  display: inline-flex; align-items: center; gap: 6px;
}
.iw-error {
  padding: 16px; text-align: center; font-size: 13px; font-weight: 700;
  color: var(--color-danger, #e5484d);
}
.iw-legend { display: flex; flex-wrap: wrap; gap: 4px; }
.iw-fs {
  position: fixed; inset: 0; z-index: 9999; background: var(--bg-card, #fff);
  display: flex; flex-direction: column; padding: 16px; gap: 10px; direction: rtl;
}
.iw-fs .iw-stage { flex: 1; min-height: 0; }
.iw-fs-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
@media (max-width: 480px) {
  .iw-card { padding: 10px; border-radius: 14px; }
}
`;

let cssInjected = false;
export function injectCss() {
  if (document.getElementById('iw-widgets-css')) return;
  if (cssInjected) return;
  cssInjected = true;
  const style = document.createElement('style');
  style.id = 'iw-shared-css';
  style.textContent = CSS;
  document.head.appendChild(style);
}

/* ------------------------------------------------------------------ */
/*  Shared DOM helpers                                                 */
/* ------------------------------------------------------------------ */

export function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

export function icon(name) {
  return `<span class="material-symbols-rounded" aria-hidden="true">${name}</span>`;
}

/** Standard widget header: badge + title + toolbar buttons. */
export function buildHeader({ title, badgeIcon, accent, buttons = [] }) {
  const header = el('div', 'iw-header');
  const titleEl = el('div', 'iw-title',
    `<span class="iw-badge">${icon(badgeIcon)}</span><span class="iw-title-text"></span>`);
  titleEl.querySelector('.iw-title-text').textContent = title;
  header.appendChild(titleEl);

  const toolbar = el('div', 'iw-toolbar');
  for (const b of buttons) {
    const btn = el('button', 'iw-btn' + (b.active ? ' iw-btn-active' : ''), icon(b.icon));
    btn.type = 'button';
    btn.title = b.title || '';
    btn.setAttribute('aria-label', b.title || '');
    if (b.label) btn.appendChild(document.createTextNode(b.label));
    btn.addEventListener('click', (e) => { e.stopPropagation(); b.onClick(btn); });
    toolbar.appendChild(btn);
  }
  header.appendChild(toolbar);
  return { header, toolbar };
}

/** Range slider row. Tap the numeric box to type a value (mobile keyboard). */
export function buildSlider({ label, min, max, step = 0.1, value, format, onInput }) {
  const row = el('div', 'iw-slider-row');
  const nameEl = el('span', '', label);
  const range = document.createElement('input');
  range.type = 'range';
  range.className = 'iw-range';
  range.min = min; range.max = max; range.step = step; range.value = value;
  const out = el('output');
  out.title = 'برای وارد کردن عدد لمس کنید';
  out.setAttribute('role', 'button');
  out.tabIndex = 0;
  const fmt = format || ((v) => formatNumber(v, 2));
  const origMin = Number(min);
  const origMax = Number(max);
  const sync = () => {
    out.textContent = fmt(parseFloat(range.value));
    const mn = parseFloat(range.min);
    const mx = parseFloat(range.max);
    const pct = mx === mn ? 50 : ((range.value - mn) / (mx - mn)) * 100;
    range.style.setProperty('--fill', Math.max(0, Math.min(100, pct)) + '%');
  };
  const applyValue = (v) => {
    if (!Number.isFinite(v)) return;
    let mn = parseFloat(range.min);
    let mx = parseFloat(range.max);
    if (v < mn) range.min = v;
    if (v > mx) range.max = v;
    range.value = v;
    sync();
    onInput(parseFloat(range.value));
  };
  range.addEventListener('input', () => { sync(); onInput(parseFloat(range.value)); });

  function beginEdit() {
    if (row.querySelector('.iw-num-edit')) return;
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.inputMode = 'decimal';
    inp.enterKeyHint = 'done';
    inp.autocomplete = 'off';
    inp.className = 'iw-num-edit';
    inp.value = range.value;
    inp.setAttribute('aria-label', label);
    out.replaceWith(inp);
    requestAnimationFrame(() => { inp.focus(); inp.select(); });
    let committed = false;
    const commit = () => {
      if (committed) return;
      committed = true;
      const parsed = parseUserNumber(inp.value);
      if (parsed !== null) applyValue(parsed);
      if (inp.parentNode) inp.replaceWith(out);
      sync();
    };
    const cancel = () => {
      if (committed) return;
      committed = true;
      if (inp.parentNode) inp.replaceWith(out);
    };
    inp.addEventListener('blur', commit);
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); inp.blur(); }
      if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    });
    inp.addEventListener('click', (e) => e.stopPropagation());
  }
  out.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); beginEdit(); });
  out.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); beginEdit(); }
  });
  sync();
  row.append(nameEl, range, out);
  return {
    row, range, out,
    set(v) {
      applyValue(v);
    },
    restoreRange() {
      range.min = origMin;
      range.max = origMax;
    },
  };
}

/** Play / pause / restart / speed control cluster for simulators. */
export function buildTransport({ onPlay, onPause, onRestart, onSpeed, speeds = [0.5, 1, 2, 4], initialSpeed = 1 }) {
  const wrap = el('div', 'iw-controls');
  const play = el('button', 'iw-play', icon('pause'));
  play.type = 'button';
  play.title = 'اجرا / توقف';
  const restart = el('button', 'iw-btn', icon('replay'));
  restart.type = 'button';
  restart.title = 'شروع دوباره';
  const speed = el('button', 'iw-btn', `×${toPersianDigits(initialSpeed)}`);
  speed.type = 'button';
  speed.title = 'سرعت شبیه‌سازی';
  let playing = true;
  let speedIdx = speeds.indexOf(initialSpeed);
  if (speedIdx < 0) speedIdx = speeds.indexOf(1) >= 0 ? speeds.indexOf(1) : 0;

  play.addEventListener('click', () => {
    playing = !playing;
    play.innerHTML = icon(playing ? 'pause' : 'play_arrow');
    playing ? onPlay() : onPause();
  });
  restart.addEventListener('click', () => {
    if (!playing) { playing = true; play.innerHTML = icon('pause'); onPlay(); }
    onRestart();
  });
  speed.addEventListener('click', () => {
    speedIdx = (speedIdx + 1) % speeds.length;
    speed.textContent = `×${toPersianDigits(speeds[speedIdx])}`;
    onSpeed(speeds[speedIdx]);
  });
  wrap.append(play, restart, speed);
  return {
    wrap,
    isPlaying: () => playing,
    setPlaying(v) { playing = v; play.innerHTML = icon(v ? 'pause' : 'play_arrow'); },
  };
}

/** Fullscreen overlay hosting a fresh render of the widget. */
export function openFullscreen({ title, badgeIcon, accent, renderBody, onClose }) {
  const fs = el('div', 'iw-fs');
  fs.style.setProperty('--iw-accent', accent);
  const head = el('div', 'iw-fs-head');
  const t = el('div', 'iw-title', `<span class="iw-badge">${icon(badgeIcon)}</span><span></span>`);
  t.querySelector('span:last-child').textContent = title;
  const closeBtn = el('button', 'iw-btn', `${icon('close')}<span>بستن</span>`);
  closeBtn.type = 'button';
  head.append(t, closeBtn);
  const body = el('div', 'iw-stage');
  fs.append(head, body);
  document.body.appendChild(fs);
  document.body.style.overflow = 'hidden';
  const cleanup = () => {
    document.body.style.overflow = '';
    fs.remove();
    onClose && onClose();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => { if (e.key === 'Escape') cleanup(); };
  document.addEventListener('keydown', onKey);
  closeBtn.addEventListener('click', cleanup);
  renderBody(body);
  return cleanup;
}

/* ------------------------------------------------------------------ */
/*  SVG helpers                                                        */
/* ------------------------------------------------------------------ */

export const SVG_NS = 'http://www.w3.org/2000/svg';

export function svgEl(tag, attrs = {}) {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

/** Resolve var(--x) colors so exported PNGs keep their styling. */
export function downloadSvgAsPng(svgElement, filename, saveFile) {
  const t = theme();
  const clone = svgElement.cloneNode(true);
  const map = {
    'var(--bg-card)': t['--bg-card'],
    'var(--bg-sunken)': t['--bg-sunken'],
    'var(--bg-inset)': t['--bg-inset'],
    'var(--color-primary)': t['--color-primary'],
    'var(--color-danger)': t['--color-danger'],
    'var(--text-primary)': t['--text-primary'],
    'var(--text-secondary)': t['--text-secondary'],
    'var(--border-subtle)': t['--border-subtle'],
    'var(--border-soft)': t['--border-soft'],
    'var(--border-strong)': t['--border-strong'],
  };
  clone.querySelectorAll('*').forEach((node) => {
    for (const attr of ['fill', 'stroke', 'color', 'stop-color']) {
      let val = node.getAttribute(attr);
      if (!val) continue;
      for (const [k, v] of Object.entries(map)) val = val.split(k).join(v);
      node.setAttribute(attr, val);
    }
  });
  if (!clone.getAttribute('xmlns')) clone.setAttribute('xmlns', SVG_NS);

  // Prefer content bbox so exports (mindmap etc.) aren't tiny in a huge empty canvas.
  let vb;
  const rawVb = clone.getAttribute('viewBox');
  if (rawVb && rawVb.trim()) {
    vb = rawVb.trim().split(/[\s,]+/).map(Number);
  } else {
    let bbox = null;
    try {
      if (typeof svgElement.getBBox === 'function') bbox = svgElement.getBBox();
    } catch (e) { /* detached / empty */ }
    if (bbox && bbox.width > 1 && bbox.height > 1) {
      const pad = Math.max(24, Math.min(bbox.width, bbox.height) * 0.08);
      vb = [bbox.x - pad, bbox.y - pad, bbox.width + pad * 2, bbox.height + pad * 2];
    } else {
      const w = parseFloat(svgElement.clientWidth) || parseFloat(clone.getAttribute('width')) || 800;
      const h = parseFloat(svgElement.clientHeight) || parseFloat(clone.getAttribute('height')) || 600;
      vb = [0, 0, w, h];
    }
    clone.setAttribute('viewBox', vb.map((n) => (Number.isFinite(n) ? n : 0)).join(' '));
  }
  if (!Number.isFinite(vb[2]) || vb[2] < 2) vb[2] = 800;
  if (!Number.isFinite(vb[3]) || vb[3] < 2) vb[3] = 600;

  clone.setAttribute('width', String(Math.round(vb[2])));
  clone.setAttribute('height', String(Math.round(vb[3])));

  const bg = svgEl('rect', { x: vb[0], y: vb[1], width: vb[2], height: vb[3], fill: t['--bg-card'] });
  clone.insertBefore(bg, clone.firstChild);

  // Higher scale for small content; cap canvas size for memory.
  const targetLong = 1600;
  const longSide = Math.max(vb[2], vb[3]);
  const scale = Math.min(3.5, Math.max(2, targetLong / longSide));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(2, Math.round(vb[2] * scale));
  canvas.height = Math.max(2, Math.round(vb[3] * scale));
  const ctx = canvas.getContext('2d');
  const img = new Image();
  const blob = new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  img.onload = async () => {
    ctx.fillStyle = t['--bg-card'];
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    const base64 = canvas.toDataURL('image/png').split(',')[1];
    if (saveFile) {
      await saveFile({ filename: `${filename}.png`, content: base64, mimeType: 'image/png', isBase64: true });
    } else {
      const a = document.createElement('a');
      a.href = `data:image/png;base64,${base64}`;
      a.download = `${filename}.png`;
      a.click();
    }
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    console.warn('SVG export failed');
  };
  img.src = url;
}

/* ------------------------------------------------------------------ */
/*  Host integration point                                             */
/* ------------------------------------------------------------------ */

let host = { openDialog: null, saveFile: null, renderMath: null };
export function setupWidgets(h = {}) { host = { ...host, ...h }; }
export function getHost() { return host; }
