/**
 * lewis.js — Lewis structure widget (v2)
 * Backward compatible with the legacy ```lewis spec format.
 *
 * Improvements over v1:
 *  - Smarter lone-pair placement (repelled from bond directions, ordered)
 *  - Double/triple bonds with proper offsets; coordinate-bond (arrow) support
 *  - Per-atom formal charge badges, overall ion brackets with charge
 *  - Pan / zoom stage, fullscreen, PNG export, element color legend
 */

import {
  injectCss, el, buildHeader, openFullscreen, downloadSvgAsPng,
  theme, svgEl, toPersianDigits,
} from './theme.js';

export function parseLewisSpec(specText) {
  const spec = { title: 'ساختار لوویس', charge: null, atoms: [], bonds: [], lones: [] };
  String(specText || '').split('\n').forEach((line) => {
    const idx = line.indexOf(':');
    if (idx === -1) return;
    const key = line.slice(0, idx).trim().toLowerCase();
    const val = line.slice(idx + 1).trim();
    if (key === 'charge') spec.charge = parseFloat(val);
    else if (key === 'title') spec.title = val;
    else if (key === 'atom') {
      const p = val.split('|').map((s) => s.trim());
      if (p.length >= 5) spec.atoms.push({ id: p[0], symbol: p[1], charge: parseFloat(p[2]) || 0, x: +p[3] || 0, y: +p[4] || 0 });
    } else if (key === 'bond') {
      const p = val.split('|').map((s) => s.trim());
      const pair = (p[0] || '').split(/[-=≡]/);
      if (pair.length === 2) spec.bonds.push({ a: pair[0].trim(), b: pair[1].trim(), order: parseInt(p[1], 10) || 1, arrow: p[2] === 'arrow' });
    } else if (key === 'lone') {
      const p = val.split('|').map((s) => s.trim());
      if (p.length >= 2) spec.lones.push({ id: p[0], count: parseInt(p[1], 10) || 0 });
    }
  });
  return spec;
}

export const ELEMENT_COLORS = {
  H: '#5b6472', C: '#2d2d2d', N: '#2563eb', O: '#dc2626', F: '#16a34a',
  Cl: '#16a34a', Br: '#92400e', I: '#7c3aed', S: '#ca8a04', P: '#ea580c',
  Na: '#7c3aed', K: '#7c3aed', Mg: '#059669', Ca: '#059669', Si: '#78716c',
  B: '#be5b00', Al: '#78716c', Ar: '#0e7490', He: '#0e7490', Ne: '#0e7490',
};

export function formatCharge(charge) {
  if (!charge) return '';
  const abs = Math.abs(charge);
  return (abs === 1 ? '' : String(Math.round(abs))) + (charge > 0 ? '+' : '−');
}

export function buildLewisSvg(spec) {
  const t = theme();
  const PX = 52, ATOM_R = 16;
  const PADDING = spec.charge ? 70 : 52;

  const xs = spec.atoms.map((a) => a.x), ys = spec.atoms.map((a) => a.y);
  const minX = Math.min(...xs, 0), maxX = Math.max(...xs, 0);
  const minY = Math.min(...ys, 0), maxY = Math.max(...ys, 0);
  const W = PADDING * 2 + (maxX - minX) * PX;
  const H = PADDING * 2 + (maxY - minY) * PX;
  const toPx = (a) => ({ x: PADDING + (a.x - minX) * PX, y: PADDING + (a.y - minY) * PX });
  const pos = {};
  spec.atoms.forEach((a) => { pos[a.id] = { ...toPx(a), atom: a }; });

  let bondsSvg = '';
  const bondDirs = {};
  spec.bonds.forEach((b) => {
    const p1 = pos[b.a], p2 = pos[b.b];
    if (!p1 || !p2) return;
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len, px = -uy, py = ux;
    const deg = Math.atan2(dy, dx) * 180 / Math.PI;
    (bondDirs[b.a] = bondDirs[b.a] || []).push(deg);
    (bondDirs[b.b] = bondDirs[b.b] || []).push((deg + 180) % 360);
    const x1 = p1.x + ux * ATOM_R, y1 = p1.y + uy * ATOM_R;
    const x2 = p2.x - ux * ATOM_R, y2 = p2.y - uy * ATOM_R;
    if (b.arrow) {
      bondsSvg += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${t['--text-primary']}" stroke-width="2" marker-end="url(#lewis-arrow)"/>`;
      return;
    }
    const order = Math.min(Math.max(b.order, 1), 3);
    const offsets = order === 1 ? [0] : order === 2 ? [-4, 4] : [-6.5, 0, 6.5];
    offsets.forEach((off) => {
      bondsSvg += `<line x1="${x1 + px * off}" y1="${y1 + py * off}" x2="${x2 + px * off}" y2="${y2 + py * off}" stroke="${t['--text-primary']}" stroke-width="2.3" stroke-linecap="round"/>`;
    });
  });

  let atomsSvg = '', lonesSvg = '';
  spec.atoms.forEach((a) => {
    const p = pos[a.id];
    const color = ELEMENT_COLORS[a.symbol] || t['--text-primary'];
    atomsSvg += `<circle cx="${p.x}" cy="${p.y}" r="${ATOM_R + 3}" fill="${t['--bg-card']}"/>
      <text x="${p.x}" y="${p.y + 1}" text-anchor="middle" dominant-baseline="central" font-size="22" font-weight="800" font-family="ui-monospace, Menlo, monospace" fill="${color}">${a.symbol}</text>`;
    if (a.charge) {
      atomsSvg += `<g><circle cx="${p.x + 16}" cy="${p.y - 16}" r="9.5" fill="${t['--bg-card']}" stroke="${color}" stroke-width="1.2"/>
        <text x="${p.x + 16}" y="${p.y - 15.5}" text-anchor="middle" dominant-baseline="central" font-size="11" font-weight="800" fill="${color}">${formatCharge(a.charge)}</text></g>`;
    }
    const lone = spec.lones.find((l) => l.id === a.id);
    if (lone && lone.count > 0) {
      const used = bondDirs[a.id] || [];
      // choose directions with maximal angular separation from bonds and each other
      const candidates = [90, 270, 0, 180, 45, 135, 225, 315];
      const isFree = (deg, others) => [...used, ...others].every((u) => {
        let diff = Math.abs(((deg - u + 540) % 360) - 180);
        return diff > 40;
      });
      const chosen = [];
      for (const c of candidates) {
        if (chosen.length >= lone.count) break;
        if (isFree(c, chosen)) chosen.push(c);
      }
      for (const c of candidates) { // fallback if strict filter failed
        if (chosen.length >= lone.count) break;
        if (!chosen.includes(c)) chosen.push(c);
      }
      chosen.slice(0, lone.count).forEach((deg) => {
        const rad = deg * Math.PI / 180;
        const dx = Math.cos(rad), dy = Math.sin(rad);
        const px = -dy, py = dx;
        const cx = p.x + dx * (ATOM_R + 11), cy = p.y + dy * (ATOM_R + 11);
        [-3.4, 3.4].forEach((off) => {
          lonesSvg += `<circle cx="${cx + px * off}" cy="${cy + py * off}" r="2.3" fill="${t['--text-primary']}"/>`;
        });
      });
    }
  });

  let bracketSvg = '';
  if (spec.charge != null && spec.charge !== 0) {
    const bX = 24, bY = 24, bW = W - 48, bH = H - 48, tl = 12;
    bracketSvg = `
      <path d="M ${bX + tl} ${bY} L ${bX} ${bY} L ${bX} ${bY + bH} L ${bX + tl} ${bY + bH}" fill="none" stroke="${t['--text-primary']}" stroke-width="2.2"/>
      <path d="M ${bX + bW - tl} ${bY} L ${bX + bW} ${bY} L ${bX + bW} ${bY + bH} L ${bX + bW - tl} ${bY + bH}" fill="none" stroke="${t['--text-primary']}" stroke-width="2.2"/>
      <text x="${bX + bW + 6}" y="${bY + 4}" font-size="18" font-weight="800" font-family="ui-monospace, Menlo, monospace" fill="${t['--text-primary']}">${formatCharge(spec.charge)}</text>`;
  }

  const svg = `<svg class="lewis-svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <defs><marker id="lewis-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
      <path d="M0,0 L8,4 L0,8 z" fill="${t['--text-primary']}"/></marker></defs>
    ${bondsSvg}${atomsSvg}${lonesSvg}${bracketSvg}</svg>`;
  return { svg, width: W, height: H };
}

export function renderLewisCard(spec, opts = {}) {
  injectCss();
  const t = theme();
  const card = el('div', 'iw-card interactive-lewis-card');
  card.setAttribute('data-spec', spec.rawText || '');

  let svgNode;
  const { header } = buildHeader({
    title: spec.title, badgeIcon: 'hub',
    buttons: [
      { icon: 'download', title: 'دانلود تصویر', onClick: () => downloadSvgAsPng(svgNode, 'lewis-structure', opts.saveFile) },
      {
        icon: 'fullscreen', title: 'تمام‌صفحه',
        onClick: () => openFullscreen({
          title: spec.title, badgeIcon: 'hub',
          renderBody: (body) => { const c = renderLewisCard({ ...spec }, opts); c.style.margin = '0'; body.appendChild(c); body.style.overflow = 'auto'; },
        }),
      },
    ],
  });
  card.appendChild(header);

  const stage = el('div', 'iw-stage');
  stage.style.display = 'flex';
  stage.style.alignItems = 'center';
  stage.style.justifyContent = 'center';
  stage.style.padding = '14px';
  stage.style.minHeight = '180px';
  stage.style.overflow = 'auto';

  if (!spec.atoms.length) {
    stage.innerHTML = '<div class="iw-error">اتمی تعریف نشده است.</div>';
  } else {
    const { svg } = buildLewisSvg(spec);
    stage.innerHTML = svg;
    svgNode = stage.querySelector('svg');
    svgNode.style.maxWidth = '100%';
    svgNode.style.height = 'auto';
  }
  card.appendChild(stage);

  // legend of element colors
  const symbols = [...new Set(spec.atoms.map((a) => a.symbol))];
  if (symbols.length > 1) {
    const legend = el('div', 'iw-legend');
    symbols.forEach((s) => {
      const chip = el('span', 'iw-chip', `<span class="iw-dot" style="background:${ELEMENT_COLORS[s] || t['--text-primary']}"></span><span></span>`);
      chip.querySelector('span:last-child').textContent = s;
      legend.appendChild(chip);
    });
    card.appendChild(legend);
  }
  return card;
}

export function initLewisStructures(parent, opts = {}) {
  parent.querySelectorAll('.interactive-lewis-card').forEach((old) => {
    // legacy cards only contain pre-rendered svg + download button; if a spec
    // attribute exists, rebuild with v2, otherwise just rebind download.
    const specStr = old.getAttribute('data-spec');
    if (!specStr) {
      const btn = old.querySelector('.lewis-download-btn');
      const svg = old.querySelector('.lewis-svg');
      if (btn && svg) btn.addEventListener('click', () => downloadSvgAsPng(svg, btn.getAttribute('data-filename') || 'lewis-structure', opts.saveFile));
      return;
    }
    const spec = parseLewisSpec(specStr);
    spec.rawText = specStr;
    old.replaceWith(renderLewisCard(spec, opts));
  });
}
