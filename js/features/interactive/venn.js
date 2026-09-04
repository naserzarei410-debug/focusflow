/**
 * venn.js — Interactive Venn diagram widget (v2)
 * Backward compatible with the legacy ```venn spec format (2, 3 or 4 sets).
 *
 * Improvements over v1:
 *  - Region-accurate hover highlighting driven by real geometry hit-testing
 *  - Automatic element placement inside the correct region (incl. U-only)
 *  - Shade expressions (A∩B, A∪B, A-B, complements) resolved live
 *  - Click a region to pin its contents in the info panel
 *  - Legend chips, fullscreen, PNG export
 */

import {
  injectCss, el, buildHeader, openFullscreen, downloadSvgAsPng,
  theme, SERIES_COLORS, toPersianDigits, svgEl,
} from './theme.js';

export function parseVennSpec(specText) {
  const spec = {
    title: 'نمودار ون مجموعه‌ها',
    label_A: 'A', label_B: 'B', label_C: '', label_D: '',
    shade: 'none', layout: 'overlapping',
  };
  const elemKeys = ['a', 'b', 'c', 'd', 'ab', 'ac', 'ad', 'bc', 'bd', 'cd', 'abc', 'abd', 'acd', 'bcd', 'abcd', 'intersection', 'u'];
  elemKeys.forEach((k) => { spec['elements_' + k] = []; });
  for (const line of String(specText || '').split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const val = line.slice(idx + 1).trim();
    if (key === 'title') spec.title = val;
    else if (key.startsWith('label_')) spec['label_' + key.slice(6)] = val;
    else if (key.startsWith('elements_') && key.slice(9) in Object.fromEntries(elemKeys.map((k) => [k, 1]))) {
      spec['elements_' + key.slice(9)] = val.split(',').map((s) => s.trim()).filter(Boolean);
    }
    else if (key === 'shade') spec.shade = val;
    else if (key === 'layout') spec.layout = val.toLowerCase().trim();
  }
  if (spec.elements_intersection.length && !spec.elements_ab.length && !spec.label_C) {
    spec.elements_ab = spec.elements_intersection;
  }
  return spec;
}

export function evaluateSetExpression(expr, hasA, hasB, hasC = false, hasD = false) {
  try {
    let clean = String(expr || '').toLowerCase().trim();
    if (!clean) return false;
    let prev = '';
    while (clean !== prev) {
      prev = clean;
      clean = clean.replace(/\(([^()]+)\)['’c]/gi, '!($1)');
    }
    clean = clean.replace(/\b([a-d])['’c]/gi, '!$1');
    clean = clean.replace(/\s*-\s*([a-d]|\()/gi, ' && !$1');
    clean = clean.replace(/[∪u+|]|\bor\b/gi, ' || ');
    clean = clean.replace(/[∩n*&]|\band\b/gi, ' && ');
    clean = clean.replace(/\ba\b/gi, hasA ? 'true' : 'false');
    clean = clean.replace(/\bb\b/gi, hasB ? 'true' : 'false');
    clean = clean.replace(/\bc\b/gi, hasC ? 'true' : 'false');
    clean = clean.replace(/\bd\b/gi, hasD ? 'true' : 'false');
    if (/^(?:true|false|[!&|()\s])+$/.test(clean)) {
      return Boolean(Function(`"use strict"; return Boolean(${clean});`)());
    }
  } catch (e) { /* fall through */ }
  return false;
}

/* ---------------- geometry ---------------- */

const VW = 460, VH = 320, PAD = 26;

function setGeometry(count, layout) {
  // returns [{cx,cy,rx,ry,label}]
  if (count === 2) {
    if (layout === 'disjoint') return [
      { cx: 150, cy: 160, rx: 78, ry: 78 },
      { cx: 320, cy: 160, rx: 78, ry: 78 },
    ];
    if (layout === 'subset') return [
      { cx: 225, cy: 160, rx: 118, ry: 100 },
      { cx: 245, cy: 168, rx: 58, ry: 52 },
    ];
    return [
      { cx: 185, cy: 160, rx: 95, ry: 95 },
      { cx: 275, cy: 160, rx: 95, ry: 95 },
    ];
  }
  if (count === 3) {
    if (layout === 'disjoint') return [
      { cx: 110, cy: 110, rx: 55, ry: 55 },
      { cx: 350, cy: 110, rx: 55, ry: 55 },
      { cx: 230, cy: 235, rx: 55, ry: 55 },
    ];
    if (layout === 'subset') return [
      { cx: 230, cy: 165, rx: 150, ry: 118 },
      { cx: 250, cy: 172, rx: 92, ry: 74 },
      { cx: 265, cy: 180, rx: 44, ry: 38 },
    ];
    return [
      { cx: 190, cy: 130, rx: 90, ry: 90 },
      { cx: 270, cy: 130, rx: 90, ry: 90 },
      { cx: 230, cy: 205, rx: 90, ry: 90 },
    ];
  }
  // 4 sets (ellipses, Venn-style)
  if (layout === 'disjoint') return [
    { cx: 90, cy: 95, rx: 45, ry: 45 },
    { cx: 230, cy: 95, rx: 45, ry: 45 },
    { cx: 370, cy: 95, rx: 45, ry: 45 },
    { cx: 230, cy: 240, rx: 45, ry: 45 },
  ];
  if (layout === 'subset') return [
    { cx: 230, cy: 165, rx: 165, ry: 120 },
    { cx: 250, cy: 172, rx: 112, ry: 84 },
    { cx: 265, cy: 178, rx: 66, ry: 52 },
    { cx: 278, cy: 184, rx: 32, ry: 26 },
  ];
  return [
    { cx: 175, cy: 150, rx: 115, ry: 72 },
    { cx: 285, cy: 150, rx: 115, ry: 72 },
    { cx: 195, cy: 205, rx: 115, ry: 72 },
    { cx: 265, cy: 205, rx: 115, ry: 72 },
  ];
}

const inSet = (g, x, y) => {
  const dx = (x - g.cx) / g.rx, dy = (y - g.cy) / g.ry;
  return dx * dx + dy * dy <= 1;
};

const regionKeyOf = (geoms, x, y) => {
  let key = '';
  geoms.forEach((g, i) => { if (inSet(g, x, y)) key += 'ABCD'[i]; });
  return key || 'U';
};

/** Find a good anchor point for a region by scanning a grid. */
function findRegionAnchor(geoms, key) {
  let best = null, bestScore = -1;
  for (let x = PAD + 8; x <= VW - PAD - 8; x += 6) {
    for (let y = PAD + 8; y <= VH - PAD - 8; y += 6) {
      if (regionKeyOf(geoms, x, y) !== key) continue;
      // score = distance from all set boundaries (deeper = better)
      let score = Infinity;
      for (const g of geoms) {
        const d = Math.abs(1 - ((x - g.cx) / g.rx) ** 2 - ((y - g.cy) / g.ry) ** 2) * Math.min(g.rx, g.ry);
        score = Math.min(score, d);
      }
      if (score > bestScore) { bestScore = score; best = { x, y }; }
    }
  }
  return best;
}

/* ---------------- spec -> region element buckets ---------------- */

function bucketElements(spec, count) {
  const buckets = {}; // key -> elements[]
  const push = (key, arr) => {
    if (!arr || !arr.length) return;
    const k = key || 'U';
    buckets[k] = (buckets[k] || []).concat(arr);
  };
  const E = spec.elements_a;
  const setKeys = ['a', 'b', 'c', 'd'].slice(0, count);
  // exclusive regions
  const combos = count === 2
    ? { a: 'A', b: 'B', ab: 'AB' }
    : count === 3
      ? { a: 'A', b: 'B', c: 'C', ab: 'AB', ac: 'AC', bc: 'BC', abc: 'ABC' }
      : { a: 'A', b: 'B', c: 'C', d: 'D', ab: 'AB', ac: 'AC', ad: 'AD', bc: 'BC', bd: 'BD', cd: 'CD', abc: 'ABC', abd: 'ABD', acd: 'ACD', bcd: 'BCD', abcd: 'ABCD' };
  for (const [k, region] of Object.entries(combos)) {
    if (k === 'intersection') continue;
    push(region, spec['elements_' + k]);
  }
  if (spec.elements_intersection.length) {
    push(count === 2 ? 'AB' : count === 3 ? 'ABC' : 'ABCD', spec.elements_intersection);
  }
  push('U', spec.elements_u);
  return buckets;
}

/* ---------------- renderer ---------------- */

export function renderVennCard(spec, opts = {}) {
  injectCss();
  const t = theme();
  const count = (spec.label_D || spec.elements_d.length) ? 4
    : (spec.label_C || spec.elements_c.length) ? 3 : 2;
  const geoms = setGeometry(count, spec.layout);
  const labels = [spec.label_A, spec.label_B, spec.label_C, spec.label_D].slice(0, count);
  const colors = SERIES_COLORS;
  const buckets = bucketElements(spec, count);

  const card = el('div', 'iw-card interactive-venn-card');
  card.setAttribute('data-spec', spec.rawText || '');

  let svg;
  const { header } = buildHeader({
    title: spec.title, badgeIcon: 'bubble_chart',
    buttons: [
      { icon: 'download', title: 'دانلود تصویر', onClick: () => downloadSvgAsPng(svg, 'venn-diagram', opts.saveFile) },
      {
        icon: 'fullscreen', title: 'تمام‌صفحه',
        onClick: () => openFullscreen({
          title: spec.title, badgeIcon: 'bubble_chart',
          renderBody: (body) => { const c = renderVennCard({ ...spec }, opts); c.style.margin = '0'; body.appendChild(c); body.style.overflow = 'auto'; },
        }),
      },
    ],
  });
  card.appendChild(header);

  const legend = el('div', 'iw-legend');
  labels.forEach((lb, i) => {
    const chip = el('span', 'iw-chip', `<span class="iw-dot" style="background:${colors[i]}"></span><span></span>`);
    chip.querySelector('span:last-child').textContent = toPersianDigits(lb || 'ABCD'[i]);
    legend.appendChild(chip);
  });
  card.appendChild(legend);

  const stage = el('div', 'iw-stage');
  svg = svgEl('svg', { viewBox: `0 0 ${VW} ${VH}` });
  stage.appendChild(svg);
  const hud = el('div', 'iw-hud');
  hud.style.top = '8px'; hud.style.left = '8px';
  stage.appendChild(hud);
  card.appendChild(stage);

  const info = el('div', 'iw-info');
  info.textContent = 'روی هر ناحیه بزنید تا اعضای آن نمایش داده شود.';
  card.appendChild(info);

  /* draw */
  // Universe
  svg.appendChild(svgEl('rect', {
    x: PAD, y: PAD, width: VW - 2 * PAD, height: VH - 2 * PAD, rx: 14,
    fill: t['--bg-card'], stroke: t['--border-strong'], 'stroke-width': 1.6,
  }));
  const uLabel = svgEl('text', { x: VW - PAD - 10, y: PAD + 18, 'text-anchor': 'end', 'font-size': 14, 'font-weight': 800, fill: t['--text-secondary'] });
  uLabel.textContent = 'U';
  svg.appendChild(uLabel);

  // Region shading for spec.shade
  if (spec.shade && spec.shade !== 'none') {
    const maskShapes = [];
    for (let x = PAD; x <= VW - PAD; x += 5) {
      for (let y = PAD; y <= VH - PAD; y += 5) {
        const key = regionKeyOf(geoms, x, y);
        const inR = evaluateSetExpression(spec.shade,
          key.includes('A'), key.includes('B'), key.includes('C'), key.includes('D'));
        if (inR) maskShapes.push(`M${x} ${y}h5v5h-5z`);
      }
    }
    if (maskShapes.length) {
      svg.appendChild(svgEl('path', {
        d: maskShapes.join(''), fill: t['--color-primary'], opacity: 0.14, 'pointer-events': 'none',
      }));
    }
  }

  // Set outlines
  geoms.forEach((g, i) => {
    svg.appendChild(svgEl('ellipse', {
      cx: g.cx, cy: g.cy, rx: g.rx, ry: g.ry,
      fill: colors[i], 'fill-opacity': 0.10,
      stroke: colors[i], 'stroke-width': 2.2,
    }));
  });
  // Set labels at outer anchors
  geoms.forEach((g, i) => {
    const ang = count === 2 ? (i === 0 ? Math.PI * 1.15 : -Math.PI * 0.15)
      : [-Math.PI * 0.75, -Math.PI * 0.25, Math.PI * 0.5, Math.PI * 0.9][i] ?? 0;
    const lx = g.cx + Math.cos(ang) * g.rx * 0.92;
    const ly = g.cy + Math.sin(ang) * g.ry * 0.92;
    const lt = svgEl('text', { x: lx, y: ly, 'text-anchor': 'middle', 'font-size': 17, 'font-weight': 900, fill: colors[i], stroke: t['--bg-card'], 'stroke-width': 4, 'paint-order': 'stroke' });
    lt.textContent = toPersianDigits(labels[i] || 'ABCD'[i]);
    svg.appendChild(lt);
  });

  // Elements per region
  const regionGroup = {};
  for (const [key, items] of Object.entries(buckets)) {
    const anchor = findRegionAnchor(geoms, key);
    if (!anchor) continue;
    const gEl = svgEl('g', { 'font-size': 11.5, 'font-weight': 700, fill: t['--text-primary'] });
    items.slice(0, 12).forEach((item, idx) => {
      const cols = Math.ceil(Math.sqrt(items.length));
      const ox = (idx % cols) * 26 - (cols - 1) * 13;
      const oy = Math.floor(idx / cols) * 15;
      const te = svgEl('text', { x: anchor.x + ox, y: anchor.y + oy, 'text-anchor': 'middle' });
      te.textContent = toPersianDigits(item);
      gEl.appendChild(te);
    });
    svg.appendChild(gEl);
    regionGroup[key] = gEl;
  }

  // Invisible region hit-layer: sample points, group by region
  const hit = svgEl('g', { opacity: 0 });
  const hitPaths = {};
  for (let x = PAD; x <= VW - PAD; x += 5) {
    for (let y = PAD; y <= VH - PAD; y += 5) {
      const key = regionKeyOf(geoms, x, y);
      (hitPaths[key] = hitPaths[key] || []).push(`M${x} ${y}h5v5h-5z`);
    }
  }
  const REGION_FA = (key) => {
    if (key === 'U') return 'ناحیه خارج از مجموعه‌ها (U)';
    const names = key.split('').map((k) => labels['ABCD'.indexOf(k)] || k);
    return names.length === 1 ? `فقط ${toPersianDigits(names[0])}` : `اشتراک ${toPersianDigits(names.join(' و '))}`;
  };
  for (const [key, d] of Object.entries(hitPaths)) {
    const p = svgEl('path', { d: d.join(''), fill: '#000', 'pointer-events': 'all', cursor: 'pointer' });
    p.addEventListener('pointerenter', () => {
      hud.textContent = `${key} ${buckets[key] ? '— ' + buckets[key].length + ' عضو' : ''}`;
      hud.style.opacity = '1';
      for (const [k, g] of Object.entries(regionGroup)) g.setAttribute('opacity', k === key ? 1 : 0.35);
    });
    p.addEventListener('pointerleave', () => {
      hud.style.opacity = '0';
      for (const g of Object.values(regionGroup)) g.setAttribute('opacity', 1);
    });
    p.addEventListener('click', (e) => {
      e.stopPropagation();
      const members = buckets[key] || [];
      info.innerHTML = `<strong>${REGION_FA(key)}</strong>${members.length ? ' — اعضا: ' + toPersianDigits(members.join('، ')) : ' — بدون عضو'}`;
    });
    hit.appendChild(p);
  }
  svg.appendChild(hit);

  // shade summary chip
  if (spec.shade && spec.shade !== 'none') {
    const chip = el('div', 'iw-chip', `<span class="iw-dot" style="background:${t['--color-primary']}"></span><span style="direction:ltr;font-family:var(--font-mono)"></span>`);
    chip.querySelector('span:last-child').textContent = spec.shade;
    chip.style.alignSelf = 'flex-start';
    card.appendChild(chip);
  }

  return card;
}

export function initVennDiagrams(parent, opts = {}) {
  parent.querySelectorAll('.interactive-venn-card').forEach((old) => {
    const specStr = old.getAttribute('data-spec') || '';
    const spec = parseVennSpec(specStr);
    spec.rawText = specStr;
    old.replaceWith(renderVennCard(spec, opts));
  });
}
