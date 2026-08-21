/**
 * geometry.js — Interactive geometry widget (v2)
 * Backward compatible with the legacy ```geometry spec format.
 *
 * Improvements over v1:
 *  - Pan & zoom (drag / wheel / pinch) with fit-to-content default
 *  - Angle arcs drawn automatically from the sides meeting at the vertex
 *  - Touch-friendly hit areas, pinned selection with clear highlight
 *  - Sides / angles / area / perimeter all clickable with formula panel
 *  - Fullscreen, PNG export
 */

import {
  injectCss, el, buildHeader, openFullscreen, downloadSvgAsPng,
  theme, svgEl, toPersianDigits,
} from './theme.js';

export function parseGeometrySpec(specStr) {
  const spec = { title: 'شکل هندسی', type: 'polygon', points: {}, sides: [], angles: [], area: '' };
  for (let line of String(specStr || '').split('\n')) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    if (key === 'title') spec.title = val;
    else if (key === 'type') spec.type = val;
    else if (key === 'area') spec.area = val;
    else if (key === 'perimeter') spec.perimeter = val;
    else if (key === 'point') {
      const p = val.split('|').map((s) => s.trim());
      if (p.length >= 3 && !Number.isNaN(+p[1]) && !Number.isNaN(+p[2])) {
        spec.points[p[0]] = { x: +p[1], y: +p[2] };
      }
    } else if (key === 'side') {
      const p = val.split('|').map((s) => s.trim());
      if (p.length >= 2) {
        const pts = p[0].split(',').map((s) => s.trim());
        if (pts.length === 2) spec.sides.push({ p1: pts[0], p2: pts[1], label: p[1] || '', formula: p.slice(2).join(' | ') });
      }
    } else if (key === 'angle') {
      const p = val.split('|').map((s) => s.trim());
      if (p.length >= 2) spec.angles.push({ p: p[0], label: p[1] || '', formula: p.slice(2).join(' | ') });
    }
  }
  return spec;
}

const W = 340, H = 280;

export function renderGeometryCard(spec, opts = {}) {
  injectCss();
  const t = theme();
  const names = Object.keys(spec.points);

  const card = el('div', 'iw-card interactive-geometry-card');
  card.setAttribute('data-spec', spec.rawText || '');

  let svg;
  const { header } = buildHeader({
    title: spec.title, badgeIcon: 'architecture',
    buttons: [
      { icon: 'fit_screen', title: 'تناسب خودکار', onClick: () => { fit(); draw(); } },
      { icon: 'download', title: 'دانلود تصویر', onClick: () => downloadSvgAsPng(svg, 'geometry', opts.saveFile) },
      {
        icon: 'fullscreen', title: 'تمام‌صفحه',
        onClick: () => openFullscreen({
          title: spec.title, badgeIcon: 'architecture',
          renderBody: (body) => { const c = renderGeometryCard({ ...spec }, opts); c.style.margin = '0'; body.appendChild(c); body.style.overflow = 'auto'; },
        }),
      },
    ],
  });
  card.appendChild(header);

  const stage = el('div', 'iw-stage');
  svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}` });
  stage.appendChild(svg);
  card.appendChild(stage);

  const info = el('div', 'iw-info');
  info.textContent = 'روی اضلاع، زاویه‌ها یا داخل شکل بزنید.';
  card.appendChild(info);

  if (!names.length) {
    stage.innerHTML = '<div class="iw-error">هیچ نقطه‌ای تعریف نشده است.</div>';
    return card;
  }

  // view transform
  const view = { scale: 1, ox: 0, oy: 0 };
  function fit() {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    names.forEach((n) => {
      const p = spec.points[n];
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    });
    const pad = 44;
    const rx = maxX - minX || 1, ry = maxY - minY || 1;
    view.scale = Math.min((W - pad * 2) / rx, (H - pad * 2) / ry);
    view.cx = (minX + maxX) / 2;
    view.cy = (minY + maxY) / 2;
  }
  fit();
  const P = (p) => ({
    x: W / 2 + (p.x - view.cx) * view.scale * view.zoom,
    y: H / 2 - (p.y - view.cy) * view.scale * view.zoom + 0,
  });
  view.zoom = 1;
  const toPx = (p) => ({
    x: W / 2 + (p.x - view.cx) * view.scale * view.zoom,
    y: H / 2 - (p.y - view.cy) * view.scale * view.zoom,
  });

  let selected = null; // {kind, ref}

  function draw() {
    svg.innerHTML = '';
    const accent = t['--color-primary'];

    // polygon fill ordered by sides chain
    if (names.length >= 3) {
      let order = [];
      if (spec.sides.length) {
        order = [spec.sides[0].p1];
        let cur = spec.sides[0].p1;
        const rest = [...spec.sides];
        let guard = 0;
        while (rest.length && guard++ < 100) {
          const i = rest.findIndex((s) => s.p1 === cur || s.p2 === cur);
          if (i === -1) break;
          const s = rest.splice(i, 1)[0];
          const next = s.p1 === cur ? s.p2 : s.p1;
          if (!order.includes(next)) order.push(next);
          cur = next;
        }
      } else order = names;
      if (order.length >= 3) {
        const d = order.map((n, i) => `${i ? 'L' : 'M'}${toPx(spec.points[n]).x.toFixed(1)} ${toPx(spec.points[n]).y.toFixed(1)}`).join(' ') + ' Z';
        const poly = svgEl('path', {
          d, fill: selected && selected.kind === 'area' ? 'rgba(79,109,245,0.22)' : 'rgba(79,109,245,0.09)',
          stroke: 'none', cursor: spec.area ? 'pointer' : 'default',
        });
        if (spec.area) {
          poly.addEventListener('click', (e) => {
            e.stopPropagation();
            selected = { kind: 'area' };
            info.innerHTML = '<strong>مساحت:</strong> ' + mathify(spec.area);
            draw();
          });
        }
        svg.appendChild(poly);
      }
    }

    // angle arcs: find sides at vertex
    spec.angles.forEach((ang) => {
      const v = spec.points[ang.p];
      if (!v) return;
      const neighbors = [];
      spec.sides.forEach((s) => {
        if (s.p1 === ang.p && spec.points[s.p2]) neighbors.push(spec.points[s.p2]);
        else if (s.p2 === ang.p && spec.points[s.p1]) neighbors.push(spec.points[s.p1]);
      });
      const vp = toPx(v);
      const isSel = selected && selected.kind === 'angle' && selected.ref === ang;
      if (neighbors.length >= 2) {
        const a1 = Math.atan2(toPx(neighbors[0]).y - vp.y, toPx(neighbors[0]).x - vp.x);
        const a2 = Math.atan2(toPx(neighbors[1]).y - vp.y, toPx(neighbors[1]).x - vp.x);
        let diff = a2 - a1;
        while (diff > Math.PI) diff -= 2 * Math.PI;
        while (diff < -Math.PI) diff += 2 * Math.PI;
        const r = 24;
        const x1 = vp.x + Math.cos(a1) * r, y1 = vp.y + Math.sin(a1) * r;
        const x2 = vp.x + Math.cos(a2) * r, y2 = vp.y + Math.sin(a2) * r;
        svg.appendChild(svgEl('path', {
          d: `M ${x1} ${y1} A ${r} ${r} 0 ${Math.abs(diff) > Math.PI ? 1 : 0} ${diff > 0 ? 1 : 0} ${x2} ${y2}`,
          fill: 'none', stroke: isSel ? '#e5484d' : '#f0a020', 'stroke-width': isSel ? 3 : 2,
        }));
        const mid = a1 + diff / 2;
        const lt = svgEl('text', {
          x: vp.x + Math.cos(mid) * (r + 13), y: vp.y + Math.sin(mid) * (r + 13),
          'text-anchor': 'middle', 'dominant-baseline': 'middle',
          'font-size': 11.5, 'font-weight': 800, fill: '#f0a020',
          stroke: t['--bg-sunken'], 'stroke-width': 3, 'paint-order': 'stroke',
        });
        lt.textContent = toPersianDigits(ang.label);
        svg.appendChild(lt);
      } else {
        const lt = svgEl('text', {
          x: vp.x + 20, y: vp.y + 20, 'font-size': 11.5, 'font-weight': 800, fill: '#f0a020',
        });
        lt.textContent = toPersianDigits(ang.label);
        svg.appendChild(lt);
      }
      const hitC = svgEl('circle', { cx: vp.x, cy: vp.y, r: 26, fill: 'transparent', cursor: 'pointer' });
      hitC.addEventListener('click', (e) => {
        e.stopPropagation();
        selected = { kind: 'angle', ref: ang };
        info.innerHTML = `<strong>زاویه ${ang.p}:</strong> ` + mathify(ang.formula || ang.label);
        draw();
      });
      svg.appendChild(hitC);
    });

    // sides
    spec.sides.forEach((s) => {
      const a = spec.points[s.p1], b = spec.points[s.p2];
      if (!a || !b) return;
      const pa = toPx(a), pb = toPx(b);
      const isSel = selected && selected.kind === 'side' && selected.ref === s;
      const line = svgEl('line', {
        x1: pa.x, y1: pa.y, x2: pb.x, y2: pb.y,
        stroke: isSel ? '#e5484d' : accent, 'stroke-width': isSel ? 4 : 2.6,
        'stroke-linecap': 'round',
      });
      const hitLine = svgEl('line', {
        x1: pa.x, y1: pa.y, x2: pb.x, y2: pb.y,
        stroke: 'transparent', 'stroke-width': 22, cursor: 'pointer',
      });
      hitLine.addEventListener('click', (e) => {
        e.stopPropagation();
        selected = { kind: 'side', ref: s };
        info.innerHTML = `<strong>ضلع ${s.p1}${s.p2}:</strong> ` + mathify(s.formula || s.label);
        draw();
      });
      svg.appendChild(line);
      svg.appendChild(hitLine);
      if (s.label) {
        const mx = (pa.x + pb.x) / 2, my = (pa.y + pb.y) / 2;
        const dx = pb.x - pa.x, dy = pb.y - pa.y;
        const len = Math.hypot(dx, dy) || 1;
        const tx = mx + (-dy / len) * 14, ty = my + (dx / len) * 14;
        const lt = svgEl('text', {
          x: tx, y: ty, 'text-anchor': 'middle', 'dominant-baseline': 'middle',
          'font-size': 12, 'font-weight': 700, fill: t['--text-secondary'],
          stroke: t['--bg-sunken'], 'stroke-width': 3.5, 'paint-order': 'stroke',
        });
        lt.textContent = toPersianDigits(s.label);
        svg.appendChild(lt);
      }
    });

    // vertices
    names.forEach((n) => {
      const p = toPx(spec.points[n]);
      svg.appendChild(svgEl('circle', {
        cx: p.x, cy: p.y, r: 5.5, fill: t['--bg-card'], stroke: accent, 'stroke-width': 2.4,
      }));
      const lt = svgEl('text', {
        x: p.x, y: p.y - 13, 'text-anchor': 'middle', 'font-size': 14, 'font-weight': 900,
        fill: t['--text-primary'], stroke: t['--bg-sunken'], 'stroke-width': 4, 'paint-order': 'stroke',
      });
      lt.textContent = n;
      svg.appendChild(lt);
    });
  }

  function mathify(text) {
    const host = opts.renderMath;
    return host ? host(`$${text}$`) : toPersianDigits(text);
  }

  // pan & zoom
  let drag = null, pinch = null;
  stage.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY, cx: view.cx, cy: view.cy };
    stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const k = view.scale * view.zoom;
    view.cx = drag.cx - (e.clientX - drag.x) / k;
    view.cy = drag.cy + (e.clientY - drag.y) / k;
    draw();
  });
  stage.addEventListener('pointerup', () => { drag = null; });
  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    view.zoom = Math.min(6, Math.max(0.4, view.zoom * Math.exp(-e.deltaY * 0.0012)));
    draw();
  }, { passive: false });
  stage.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      pinch = {
        d: Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY),
        z: view.zoom,
      };
    }
  }, { passive: true });
  stage.addEventListener('touchmove', (e) => {
    if (pinch && e.touches.length === 2) {
      e.preventDefault();
      const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      view.zoom = Math.min(6, Math.max(0.4, pinch.z * (d / pinch.d)));
      draw();
    }
  }, { passive: false });
  stage.addEventListener('touchend', () => { pinch = null; });

  draw();
  return card;
}

export function initInteractiveGeometry(parent, opts = {}) {
  parent.querySelectorAll('.interactive-geometry-card').forEach((old) => {
    const specStr = old.getAttribute('data-spec') || '';
    const spec = parseGeometrySpec(specStr);
    spec.rawText = specStr;
    old.replaceWith(renderGeometryCard(spec, opts));
  });
}
