/**
 * mindmap.js — Interactive mind map / tree widget (v2)
 * Backward compatible with the legacy ```mindmap (node|parent) spec format.
 * Self-contained tidy-tree layout (no d3 dependency).
 *
 * Improvements over v1:
 *  - Collapsible subtrees, color-coded depth levels
 *  - Pan / zoom / pinch, fit-to-content
 *  - Node pills with measured widths (no more overlap of long labels)
 *  - Fullscreen, PNG export, RTL-aware horizontal layout
 */

import {
  injectCss, el, buildHeader, openFullscreen, downloadSvgAsPng,
  theme, svgEl, toPersianDigits, SERIES_COLORS,
} from './theme.js';

export function parseMindmapSpec(specStr) {
  const spec = { title: 'نقشه ذهنی', nodes: [] };
  for (let line of String(specStr || '').split('\n')) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf(':');
    let id = null, parent = null;
    if (idx !== -1) {
      const key = line.slice(0, idx).trim().toLowerCase();
      const val = line.slice(idx + 1).trim();
      if (key === 'title') { spec.title = val; continue; }
      if (key === 'node') {
        const parts = val.split('|').map((s) => s.trim());
        id = parts[0]; parent = parts[1] || null;
      }
    }
    if (!id && line.includes('|')) {
      const parts = line.split('|').map((s) => s.trim());
      id = parts[0]; parent = parts[1] || null;
    }
    if (id) {
      if (parent === 'root' || parent === '') parent = null;
      spec.nodes.push({ id, parent });
    }
  }
  // dedupe + synthesize missing parents
  const map = new Map();
  spec.nodes.forEach((n) => {
    if (!map.has(n.id)) map.set(n.id, n);
    else if (n.parent && !map.get(n.id).parent) map.get(n.id).parent = n.parent;
  });
  [...map.values()].forEach((n) => {
    if (n.parent && !map.has(n.parent)) map.set(n.parent, { id: n.parent, parent: null });
  });
  spec.nodes = [...map.values()];
  return spec;
}

/* ---------------- tidy tree layout ---------------- */

function buildForest(nodes) {
  const byId = new Map(nodes.map((n) => [n.id, { id: n.id, children: [], parent: null, depth: 0, collapsed: false, _n: n }]));
  const roots = [];
  byId.forEach((node) => {
    if (node._n.parent && byId.has(node._n.parent)) {
      node.parent = byId.get(node._n.parent);
      node.parent.children.push(node);
    } else {
      roots.push(node);
    }
  });
  if (roots.length > 1) {
    const virtual = { id: '', children: roots, parent: null, depth: -1, virtual: true, collapsed: false };
    roots.forEach((r) => { r.parent = virtual; });
    return virtual;
  }
  return roots[0] || null;
}

function setDepths(node, d) {
  node.depth = d;
  node.children.forEach((c) => setDepths(c, d + 1));
}

/** Measure label widths with canvas. */
let measureCtx = null;
function textWidth(text) {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  measureCtx.font = '700 13px system-ui, sans-serif';
  return measureCtx.measureText(text).width;
}

/** Tidy layout: leaves stacked, parents centered over children. */
function layout(root, visibleOnly = true) {
  const NODE_H = 34, GAP_Y = 10, LEVEL_GAP = 42;
  let nextY = 0;
  const visibleChildren = (n) => (visibleOnly && n.collapsed ? [] : n.children);

  function place(n) {
    n.w = Math.max(54, textWidth(n.virtual ? '' : toPersianDigits(n.id)) + 30);
    const kids = visibleChildren(n);
    if (!kids.length) {
      n.y = nextY;
      nextY += NODE_H + GAP_Y;
    } else {
      kids.forEach(place);
      n.y = (kids[0].y + kids[kids.length - 1].y) / 2;
    }
  }
  place(root);
  // assign x by depth using max width per depth
  const depthWidth = [];
  (function walk(n) {
    depthWidth[n.depth] = Math.max(depthWidth[n.depth] || 0, n.w);
    visibleChildren(n).forEach(walk);
  })(root);
  const depthX = [0];
  for (let d = 1; d < depthWidth.length; d++) {
    depthX[d] = depthX[d - 1] + (depthWidth[d - 1] || 0) + LEVEL_GAP;
  }
  (function walk(n) {
    n.x = depthX[Math.max(0, n.depth)] + (n.depth < 0 ? 0 : 0);
    visibleChildren(n).forEach(walk);
  })(root);
  let maxX = 0;
  (function walk(n) { maxX = Math.max(maxX, n.x + n.w); visibleChildren(n).forEach(walk); })(root);
  return { width: maxX + 20, height: nextY - GAP_Y + 20 };
}

/* ---------------- renderer ---------------- */

export function renderMindmapCard(spec, opts = {}) {
  injectCss();
  const t = theme();
  const card = el('div', 'iw-card interactive-mindmap-card');
  card.setAttribute('data-spec', spec.rawText || '');

  const root = buildForest(spec.nodes);
  if (!root) {
    card.appendChild(el('div', 'iw-error', 'گره‌ای برای نمایش وجود ندارد.'));
    return card;
  }
  setDepths(root, root.virtual ? -1 : 0);

  let svg, gRoot;
  const view = { k: 1, tx: 0, ty: 0 };

  const { header } = buildHeader({
    title: spec.title, badgeIcon: 'account_tree',
    buttons: [
      { icon: 'unfold_less', title: 'جمع‌کردن همه', onClick: () => { walkAll(root, (n) => { if (n.children.length) n.collapsed = true; }); root.collapsed = false; draw(); } },
      { icon: 'unfold_more', title: 'بازکردن همه', onClick: () => { walkAll(root, (n) => { n.collapsed = false; }); draw(); } },
      { icon: 'download', title: 'دانلود تصویر', onClick: () => downloadSvgAsPng(svg, 'mind-map', opts.saveFile) },
      {
        icon: 'fullscreen', title: 'تمام‌صفحه',
        onClick: () => openFullscreen({
          title: spec.title, badgeIcon: 'account_tree',
          renderBody: (body) => { const c = renderMindmapCard({ ...spec }, opts); c.style.margin = '0'; body.appendChild(c); body.style.overflow = 'auto'; },
        }),
      },
    ],
  });
  card.appendChild(header);

  const stage = el('div', 'iw-stage');
  stage.style.height = '320px';
  svg = svgEl('svg', { width: '100%', height: '100%' });
  gRoot = svgEl('g');
  svg.appendChild(gRoot);
  stage.appendChild(svg);
  card.appendChild(stage);
  const hint = el('div', 'iw-info', 'برای جمع/باز کردن هر شاخه روی آن بزنید. با کشیدن جابه‌جا و با اسکرول بزرگ‌نمایی کنید.');
  card.appendChild(hint);

  function walkAll(n, fn) { fn(n); n.children.forEach((c) => walkAll(c, fn)); }

  function draw() {
    const dims = layout(root);
    gRoot.innerHTML = '';
    const NODE_H = 34;

    // links
    (function walk(n) {
      const kids = n.collapsed ? [] : n.children;
      kids.forEach((c) => {
        const x1 = n.virtual ? c.x : n.x + n.w / 2 + n.w / 2;
        const sx = n.virtual ? c.x - 8 : n.x + n.w;
        const sy = n.virtual ? c.y + NODE_H / 2 : n.y + NODE_H / 2;
        const ex = c.x, ey = c.y + NODE_H / 2;
        const mx = (sx + ex) / 2;
        gRoot.appendChild(svgEl('path', {
          d: `M ${sx} ${sy} C ${mx} ${sy}, ${mx} ${ey}, ${ex} ${ey}`,
          fill: 'none', stroke: t['--border-strong'], 'stroke-width': 1.8, opacity: 0.75,
        }));
        walk(c);
      });
    })(root);

    // nodes
    (function walk(n) {
      if (!n.virtual) {
        const color = SERIES_COLORS[Math.max(0, n.depth) % SERIES_COLORS.length];
        const g = svgEl('g', { cursor: n.children.length ? 'pointer' : 'default' });
        const isLeaf = !n.children.length;
        const rect = svgEl('rect', {
          x: n.x, y: n.y, width: n.w, height: NODE_H, rx: 12,
          fill: isLeaf ? t['--bg-card'] : color,
          stroke: color, 'stroke-width': 1.8,
          style: 'filter: drop-shadow(0 2px 3px rgba(20,30,60,.12)); transition: filter .15s',
        });
        const label = svgEl('text', {
          x: n.x + n.w / 2, y: n.y + NODE_H / 2 + 1,
          'text-anchor': 'middle', 'dominant-baseline': 'middle',
          'font-size': 13, 'font-weight': isLeaf ? 600 : 800,
          fill: isLeaf ? t['--text-primary'] : '#ffffff',
        });
        label.textContent = toPersianDigits(n.id);
        g.append(rect, label);
        if (n.children.length) {
          const badge = svgEl('g');
          const bx = n.x - 9, by = n.y + NODE_H / 2;
          badge.appendChild(svgEl('circle', { cx: bx, cy: by, r: 9, fill: t['--bg-card'], stroke: color, 'stroke-width': 1.8 }));
          const sign = svgEl('text', {
            x: bx, y: by + 0.5, 'text-anchor': 'middle', 'dominant-baseline': 'middle',
            'font-size': 13, 'font-weight': 900, fill: color,
          });
          sign.textContent = n.collapsed ? '+' : '−';
          badge.appendChild(sign);
          g.appendChild(badge);
          if (n.collapsed) {
            const cnt = svgEl('text', {
              x: n.x + n.w + 8, y: n.y + NODE_H / 2 + 1, 'dominant-baseline': 'middle',
              'font-size': 11, 'font-weight': 700, fill: t['--text-secondary'],
            });
            let count = 0;
            walkAll(n, (m) => { if (m !== n) count++; });
            cnt.textContent = `(${toPersianDigits(count)})`;
            g.appendChild(cnt);
          }
        }
        g.addEventListener('click', (e) => {
          e.stopPropagation();
          if (n.children.length) { n.collapsed = !n.collapsed; draw(); }
        });
        gRoot.appendChild(g);
      }
      (n.collapsed ? [] : n.children).forEach(walk);
    })(root);

    // fit view
    const rect = stage.getBoundingClientRect();
    const sw = rect.width || 600, sh = rect.height || 320;
    const k = Math.min(sw / (dims.width + 30), sh / (dims.height + 30), 1.4);
    if (!view.user) {
      view.k = k;
      view.tx = (sw - dims.width * k) / 2;
      view.ty = (sh - dims.height * k) / 2;
    }
    gRoot.setAttribute('transform', `translate(${view.tx},${view.ty}) scale(${view.k})`);
  }

  // pan / zoom
  let drag = null, pinch = null;
  stage.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty };
    stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener('pointermove', (e) => {
    if (!drag) return;
    view.user = true;
    view.tx = drag.tx + (e.clientX - drag.x);
    view.ty = drag.ty + (e.clientY - drag.y);
    gRoot.setAttribute('transform', `translate(${view.tx},${view.ty}) scale(${view.k})`);
  });
  stage.addEventListener('pointerup', () => { drag = null; });
  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    view.user = true;
    const rect = stage.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const factor = Math.exp(-e.deltaY * 0.0012);
    const nk = Math.min(4, Math.max(0.2, view.k * factor));
    view.tx = mx - ((mx - view.tx) / view.k) * nk;
    view.ty = my - ((my - view.ty) / view.k) * nk;
    view.k = nk;
    gRoot.setAttribute('transform', `translate(${view.tx},${view.ty}) scale(${view.k})`);
  }, { passive: false });
  stage.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      pinch = { d: Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY), k: view.k };
    }
  }, { passive: true });
  stage.addEventListener('touchmove', (e) => {
    if (pinch && e.touches.length === 2) {
      e.preventDefault();
      view.user = true;
      view.k = Math.min(4, Math.max(0.2, pinch.k * (Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY) / pinch.d)));
      gRoot.setAttribute('transform', `translate(${view.tx},${view.ty}) scale(${view.k})`);
    }
  }, { passive: false });
  stage.addEventListener('touchend', () => { pinch = null; });

  new ResizeObserver(() => { if (!view.user) draw(); }).observe(stage);
  requestAnimationFrame(draw);
  return card;
}

export function initMindmaps(parent, opts = {}) {
  parent.querySelectorAll('.interactive-mindmap-card').forEach((old) => {
    const specStr = old.getAttribute('data-spec') || '';
    const spec = parseMindmapSpec(specStr);
    spec.rawText = specStr;
    old.replaceWith(renderMindmapCard(spec, opts));
  });
}
