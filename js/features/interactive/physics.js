/**
 * physics.js — Interactive physics simulator widget (v2)
 * Backward compatible with the legacy ```physics spec format.
 *
 * Improvements over v1:
 *  - Unified simulation engine on <canvas> with play/pause/restart/speed
 *  - Live parameter sliders per simulation (change physics while running)
 *  - Real-time telemetry (t, x, y, v, E, ...) per simulation
 *  - Consistent visual design: ground, grids, vectors, trails
 *  - Fullscreen, pause-aware rendering (no runaway rAF loops)
 *
 * Supported types: projectile, forces, pendulum, spring, collision,
 * kinematics1d, circular, wave, circuit, optics, gas_laws, buoyancy,
 * electric_field, capacitor, magnetic_field/lorentz, faraday,
 * incline_friction, doppler, photoelectric, u_tube, manometer_tanks,
 * tube_system
 */

import {
  injectCss, el, buildHeader, buildSlider, buildTransport, openFullscreen,
  theme, toPersianDigits, formatNumber,
} from './theme.js';

export function parsePhysicsSpec(specStr) {
  const spec = { title: 'شبیه‌سازی فیزیک', type: 'projectile', v0: 10, angle: 45, h0: 0, g: 9.8, mass: 1, mu: 0, forces: [] };
  for (let line of String(specStr || '').split('\n')) {
    line = line.split('#')[0].trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    const num = () => parseFloat(val);
    switch (key) {
      case 'title': spec.title = val; break;
      case 'type': spec.type = val; break;
      case 'elastic': spec.elastic = val.trim().toLowerCase() !== 'false'; break;
      case 'reversed_poles': spec.reversed_poles = val.trim().toLowerCase() === 'true'; break;
      case 'charges': case 'resistors':
        spec[key] = val.split(',').map((s) => parseFloat(s.trim())).filter((n) => !Number.isNaN(n)); break;
      case 'arms': case 'connections': case 'liquids': case 'labels': case 'lines':
        try { spec[key] = JSON.parse(val); } catch (e) { spec[key] = []; } break;
      case 'force': {
        const p = val.split('|').map((s) => s.trim());
        if (p.length >= 3) spec.forces.push({ name: p[0], mag: parseFloat(p[1]), angle: parseFloat(p[2]), color: p[3] || '' });
        break;
      }
      case 'element': case 'left_type': spec[key] = val.trim(); break;
      default: {
        const n = num();
        spec[key] = Number.isNaN(n) ? val : n;
      }
    }
  }
  return spec;
}

/* ================= engine ================= */

const CW = 400, CH = 300;

function makeEngine(stage, sim, controls) {
  const canvas = document.createElement('canvas');
  const dpr = Math.min(2.5, window.devicePixelRatio || 1);
  canvas.width = CW * dpr;
  canvas.height = CH * dpr;
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  stage.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  let raf = null;
  let last = null;
  let running = true;
  let speed = 1;
  let simTime = 0;

  function frame(now) {
    raf = null;
    if (last == null) last = now;
    let dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (running) {
      simTime += dt * speed;
      sim.update(simTime, dt * speed);
    }
    ctx.clearRect(0, 0, CW, CH);
    sim.draw(ctx, simTime);
    controls.telemetry(sim.telemetry ? sim.telemetry(simTime) : []);
    if (!sim.finished || !sim.finished(simTime)) {
      raf = requestAnimationFrame(frame);
    }
  }
  const api = {
    play() { running = true; if (!raf) { last = null; raf = requestAnimationFrame(frame); } },
    pause() { running = false; },
    restart() { simTime = 0; sim.reset && sim.reset(); running = true; if (!raf) { last = null; raf = requestAnimationFrame(frame); } },
    setSpeed(s) { speed = s; },
    isPlaying: () => running,
  };
  raf = requestAnimationFrame(frame);
  return api;
}

/* ================= draw helpers ================= */

function ground(ctx, y = 268) {
  const t = theme();
  ctx.strokeStyle = t['--border-strong'];
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(CW, y); ctx.stroke();
  ctx.lineWidth = 1;
  for (let x = 6; x < CW; x += 14) {
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 6, y + 7); ctx.stroke();
  }
}

function arrow(ctx, x1, y1, x2, y2, color, width = 2.4) {
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const len = Math.hypot(x2 - x1, y2 - y1);
  if (len < 4) return;
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = width;
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  const hs = Math.min(9, len * 0.35);
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - hs * Math.cos(ang - 0.45), y2 - hs * Math.sin(ang - 0.45));
  ctx.lineTo(x2 - hs * Math.cos(ang + 0.45), y2 - hs * Math.sin(ang + 0.45));
  ctx.closePath(); ctx.fill();
}

function ball(ctx, x, y, r, color) {
  const grad = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.15, x, y, r);
  grad.addColorStop(0, '#ffffffcc');
  grad.addColorStop(0.25, color);
  grad.addColorStop(1, shade(color, -0.35));
  ctx.fillStyle = grad;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 1; ctx.stroke();
}

function shade(hex, amt) {
  const c = hex.replace('#', '');
  if (c.length !== 6) return hex;
  const n = (i) => Math.max(0, Math.min(255, parseInt(c.substr(i, 2), 16) + Math.round(255 * amt)));
  return `rgb(${n(0)},${n(2)},${n(4)})`;
}

function label(ctx, text, x, y, color, size = 11) {
  ctx.font = `800 ${size}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

function springPath(ctx, x1, y1, x2, y2, coils, amp, color, width = 2) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len, px = -uy, py = ux;
  ctx.strokeStyle = color; ctx.lineWidth = width;
  ctx.beginPath(); ctx.moveTo(x1, y1);
  const segs = coils * 2;
  for (let i = 1; i < segs; i++) {
    const t = i / segs;
    const off = (i % 2 ? 1 : -1) * amp;
    ctx.lineTo(x1 + dx * t + px * off, y1 + dy * t + py * off);
  }
  ctx.lineTo(x2, y2); ctx.stroke();
}

/* ================= simulations ================= */
/* Each factory receives (spec, helpers) and returns a sim object:
   { update(t, dt), draw(ctx, t), telemetry(t), reset(), finished(t), sliders } */

const ACCENT = () => theme()['--color-primary'];

function simProjectile(spec) {
  const S = { v0: spec.v0 || 10, angle: spec.angle ?? 45, h0: spec.h0 || 0, g: spec.g || 9.8 };
  const calc = () => {
    const th = S.angle * Math.PI / 180;
    const vy = S.v0 * Math.sin(th), vx = S.v0 * Math.cos(th);
    const tMax = (vy + Math.sqrt(vy * vy + 2 * S.g * S.h0)) / S.g;
    return { th, vx, vy, tMax, xMax: vx * tMax, yMax: S.h0 + vy * vy / (2 * S.g) };
  };
  let m = calc();
  const view = () => {
    const pad = 36;
    const scale = Math.min((CW - pad * 2) / Math.max(1e-6, m.xMax), (CH - pad * 2 - 20) / Math.max(1e-6, m.yMax * 1.15));
    return { pad, scale };
  };
  return {
    sliders: [
      { label: 'سرعت اولیه v₀ (m/s)', key: 'v0', min: 1, max: 50, step: 0.5 },
      { label: 'زاویه پرتاب (°)', key: 'angle', min: 5, max: 85, step: 1 },
      { label: 'ارتفاع اولیه h₀ (m)', key: 'h0', min: 0, max: 30, step: 0.5 },
      { label: 'گرانش g (m/s²)', key: 'g', min: 1, max: 25, step: 0.1 },
    ],
    state: S,
    update() {},
    reset() { m = calc(); },
    draw(ctx, t) {
      const { pad, scale } = view();
      const X = (x) => pad + x * scale;
      const Y = (y) => CH - pad - y * scale;
      const tt = Math.min(t, m.tMax);
      ground(ctx, Y(0));
      // trajectory
      ctx.strokeStyle = theme()['--border-strong'];
      ctx.setLineDash([5, 5]); ctx.lineWidth = 1.6;
      ctx.beginPath();
      for (let i = 0; i <= 100; i++) {
        const ti = (i / 100) * m.tMax;
        const x = m.vx * ti, y = Math.max(0, S.h0 + m.vy * ti - 0.5 * S.g * ti * ti);
        i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y));
      }
      ctx.stroke(); ctx.setLineDash([]);
      // max height guide
      ctx.strokeStyle = theme()['--border-subtle']; ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.moveTo(pad, Y(m.yMax)); ctx.lineTo(CW - pad, Y(m.yMax)); ctx.stroke();
      ctx.setLineDash([]);
      const x = m.vx * tt, y = Math.max(0, S.h0 + m.vy * tt - 0.5 * S.g * tt * tt);
      // velocity vector
      const vxt = m.vx, vyt = m.vy - S.g * tt;
      ball(ctx, X(x), Y(y), 9, ACCENT());
      arrow(ctx, X(x), Y(y), X(x) + vxt * scale * 0.35, Y(y) - vyt * scale * 0.35, '#e5484d', 2.2);
      label(ctx, 'v', X(x) + vxt * scale * 0.35 + 10, Y(y) - vyt * scale * 0.35, '#e5484d');
      label(ctx, `h = ${toPersianDigits(formatNumber(m.yMax, 1))} m`, CW - pad - 30, Y(m.yMax) - 6, theme()['--text-secondary']);
      label(ctx, `R = ${toPersianDigits(formatNumber(m.xMax, 1))} m`, X(m.xMax) - 16, Y(0) + 18, theme()['--text-secondary']);
    },
    telemetry(t) {
      const tt = Math.min(t, m.tMax);
      return [
        ['t', formatNumber(tt, 2, false) + ' s'],
        ['x', formatNumber(m.vx * tt, 2, false) + ' m'],
        ['y', formatNumber(Math.max(0, S.h0 + m.vy * tt - 0.5 * S.g * tt * tt), 2, false) + ' m'],
        ['v', formatNumber(Math.hypot(m.vx, m.vy - S.g * tt), 2, false) + ' m/s'],
      ];
    },
    finished: (t) => t > m.tMax + 1.2,
  };
}

function simPendulum(spec) {
  const S = { length: spec.length || 1, angle: spec.angle ?? 30, g: spec.g || 9.8 };
  let th, om;
  const reset = () => { th = S.angle * Math.PI / 180; om = 0; };
  reset();
  const px = 200, py = 30, scale = 170;
  return {
    sliders: [
      { label: 'طول آونگ L (m)', key: 'length', min: 0.3, max: 3, step: 0.1 },
      { label: 'زاویه اولیه θ₀ (°)', key: 'angle', min: 5, max: 80, step: 1, restart: true },
      { label: 'گرانش g (m/s²)', key: 'g', min: 1, max: 25, step: 0.1 },
    ],
    state: S,
    reset,
    update(t, dt) {
      // velocity Verlet, sub-stepped for stability
      const steps = 8, h = dt / steps;
      for (let i = 0; i < steps; i++) {
        const acc = -(S.g / S.length) * Math.sin(th);
        om += acc * h;
        th += om * h;
      }
    },
    draw(ctx) {
      const bx = px + Math.sin(th) * S.length * scale;
      const by = py + Math.cos(th) * S.length * scale;
      // pivot
      ctx.fillStyle = theme()['--border-strong'];
      ctx.fillRect(px - 30, py - 8, 60, 8);
      // arc guide
      ctx.strokeStyle = theme()['--border-subtle']; ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.arc(px, py, S.length * scale, Math.PI / 2 - S.angle * Math.PI / 180, Math.PI / 2 + S.angle * Math.PI / 180); ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = theme()['--text-secondary']; ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(bx, by); ctx.stroke();
      ball(ctx, bx, by, 13, ACCENT());
    },
    telemetry() {
      const T = 2 * Math.PI * Math.sqrt(S.length / S.g);
      return [
        ['θ', formatNumber(th * 180 / Math.PI, 1, false) + '°'],
        ['ω', formatNumber(om, 2, false) + ' rad/s'],
        ['T', formatNumber(T, 2, false) + ' s'],
      ];
    },
  };
}

function simSpring(spec) {
  const S = { k: spec.k || 50, mass: spec.mass || 1, x0: spec.x0 ?? 0.3, mu: spec.mu || 0 };
  let x, v;
  const reset = () => { x = S.x0; v = 0; };
  reset();
  const wallX = 50, cy = 150, scale = 260;
  return {
    sliders: [
      { label: 'ثابت فنر k (N/m)', key: 'k', min: 5, max: 200, step: 1 },
      { label: 'جرم m (kg)', key: 'mass', min: 0.1, max: 10, step: 0.1 },
      { label: 'انحراف اولیه x₀ (m)', key: 'x0', min: -0.4, max: 0.4, step: 0.02, restart: true },
      { label: 'ضریب اصطکاک μ', key: 'mu', min: 0, max: 1, step: 0.02 },
    ],
    state: S,
    reset,
    update(t, dt) {
      const steps = 8, h = dt / steps;
      for (let i = 0; i < steps; i++) {
        const a = (-S.k * x - (Math.abs(v) > 1e-4 ? S.mu * S.mass * 9.8 * Math.sign(v) : 0)) / S.mass;
        v += a * h; x += v * h;
      }
    },
    draw(ctx) {
      const bx = wallX + 130 + x * scale;
      ctx.fillStyle = theme()['--border-strong'];
      ctx.fillRect(wallX - 10, 60, 10, 180);
      ground(ctx, 220);
      springPath(ctx, wallX, cy, bx - 16, cy, 9, 12, theme()['--text-secondary']);
      ctx.fillStyle = ACCENT();
      roundRect(ctx, bx - 16, cy - 16, 32, 32, 6);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.stroke();
      // equilibrium marker
      ctx.strokeStyle = theme()['--border-subtle']; ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.moveTo(wallX + 130, 60); ctx.lineTo(wallX + 130, 220); ctx.stroke();
      ctx.setLineDash([]);
    },
    telemetry() {
      const E = 0.5 * S.k * x * x + 0.5 * S.mass * v * v;
      return [
        ['x', formatNumber(x, 3, false) + ' m'],
        ['v', formatNumber(v, 2, false) + ' m/s'],
        ['E', formatNumber(E, 2, false) + ' J'],
        ['T', formatNumber(2 * Math.PI * Math.sqrt(S.mass / S.k), 2, false) + ' s'],
      ];
    },
  };
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function simForces(spec) {
  const forces = spec.forces.length ? spec.forces : [{ name: 'F', mag: 10, angle: 0, color: '' }];
  const mass = spec.mass || 1;
  const colors = ['#e5484d', '#18a058', '#f0a020', '#8b5cf6', '#ec4899'];
  return {
    sliders: [],
    state: {},
    update() {},
    draw(ctx) {
      const cx = 200, cy = 155;
      let fx = 0, fy = 0;
      ctx.fillStyle = theme()['--bg-card'];
      roundRect(ctx, cx - 22, cy - 22, 44, 44, 8);
      ctx.fill();
      ctx.strokeStyle = theme()['--border-strong']; ctx.lineWidth = 2; ctx.stroke();
      label(ctx, `${toPersianDigits(formatNumber(mass, 1))} kg`, cx, cy + 4, theme()['--text-primary']);
      forces.forEach((f, i) => {
        const rad = f.angle * Math.PI / 180;
        fx += f.mag * Math.cos(rad); fy += f.mag * Math.sin(rad);
        const len = f.mag * 3.2;
        const color = f.color && !f.color.startsWith('var') ? f.color : colors[i % colors.length];
        arrow(ctx, cx, cy, cx + Math.cos(rad) * len, cy - Math.sin(rad) * len, color);
        label(ctx, f.name, cx + Math.cos(rad) * (len + 13), cy - Math.sin(rad) * (len + 13), color, 12);
      });
      const fres = Math.hypot(fx, fy);
      if (fres > 0.01) {
        const rad = Math.atan2(fy, fx);
        arrow(ctx, cx, cy, cx + Math.cos(rad) * fres * 3.2, cy - Math.sin(rad) * fres * 3.2, ACCENT(), 3.4);
        label(ctx, 'F خالص', cx + Math.cos(rad) * (fres * 3.2 + 16), cy - Math.sin(rad) * (fres * 3.2 + 16), ACCENT(), 12);
      }
      ground(ctx, 268);
    },
    telemetry() {
      let fx = 0, fy = 0;
      forces.forEach((f) => { const r = f.angle * Math.PI / 180; fx += f.mag * Math.cos(r); fy += f.mag * Math.sin(r); });
      const f = Math.hypot(fx, fy);
      return [
        ['F_net', formatNumber(f, 2, false) + ' N'],
        ['a', formatNumber(f / mass, 2, false) + ' m/s²'],
        ['θ', formatNumber(Math.atan2(fy, fx) * 180 / Math.PI, 1, false) + '°'],
      ];
    },
  };
}

function simCollision(spec) {
  const S = { m1: spec.m1 || 2, v1: spec.v1 ?? 4, m2: spec.m2 || 1, v2: spec.v2 ?? 0 };
  const elastic = spec.elastic !== false;
  let x1, x2, v1c, v2c, done;
  const gy = 210, scale = 55;
  const reset = () => { x1 = 0.4; x2 = 5.2; v1c = S.v1; v2c = S.v2; done = false; };
  reset();
  return {
    sliders: [
      { label: 'm₁ (kg)', key: 'm1', min: 0.5, max: 10, step: 0.5, restart: true },
      { label: 'v₁ (m/s)', key: 'v1', min: 0, max: 10, step: 0.5, restart: true },
      { label: 'm₂ (kg)', key: 'm2', min: 0.5, max: 10, step: 0.5, restart: true },
      { label: 'v₂ (m/s)', key: 'v2', min: -5, max: 5, step: 0.5, restart: true },
    ],
    state: S,
    reset,
    update(t, dt) {
      if (done) { x1 += v1c * dt; x2 += v2c * dt; return; }
      x1 += v1c * dt; x2 += v2c * dt;
      const r1 = 0.25 + 0.08 * Math.sqrt(S.m1), r2 = 0.25 + 0.08 * Math.sqrt(S.m2);
      if (x2 - x1 <= r1 + r2) {
        x1 = x2 - (r1 + r2);
        if (elastic) {
          const m1 = S.m1, m2 = S.m2;
          const nv1 = ((m1 - m2) * v1c + 2 * m2 * v2c) / (m1 + m2);
          const nv2 = ((m2 - m1) * v2c + 2 * m1 * v1c) / (m1 + m2);
          v1c = nv1; v2c = nv2;
        } else {
          v1c = v2c = (S.m1 * v1c + S.m2 * v2c) / (S.m1 + S.m2);
        }
        done = true;
      }
    },
    draw(ctx) {
      ground(ctx, gy + 22);
      const r1 = (0.25 + 0.08 * Math.sqrt(S.m1)) * scale;
      const r2 = (0.25 + 0.08 * Math.sqrt(S.m2)) * scale;
      const px1 = 40 + x1 * scale, px2 = 40 + x2 * scale;
      ball(ctx, px1, gy - r1 + 22, r1, '#4f6df5');
      ball(ctx, px2, gy - r2 + 22, r2, '#e5484d');
      arrow(ctx, px1, gy - r1 - 14, px1 + v1c * 12, gy - r1 - 14, '#4f6df5');
      arrow(ctx, px2, gy - r2 - 14, px2 + v2c * 12, gy - r2 - 14, '#e5484d');
      label(ctx, 'm₁', px1, gy - r1 + 26, '#fff');
      label(ctx, 'm₂', px2, gy - r2 + 26, '#fff');
    },
    telemetry() {
      return [
        ['v₁', formatNumber(v1c, 2, false) + ' m/s'],
        ['v₂', formatNumber(v2c, 2, false) + ' m/s'],
        ['p', formatNumber(S.m1 * v1c + S.m2 * v2c, 2, false) + ' kg·m/s'],
        ['KE', formatNumber(0.5 * S.m1 * v1c * v1c + 0.5 * S.m2 * v2c * v2c, 2, false) + ' J'],
      ];
    },
  };
}

function simKinematics1d(spec) {
  const S = { v0: spec.v0 ?? 0, a: spec.a ?? 2, t: spec.t || 6 };
  const scale = () => {
    const xEnd = S.v0 * S.t + 0.5 * S.a * S.t * S.t;
    return (CW - 80) / Math.max(1, Math.abs(xEnd));
  };
  return {
    sliders: [
      { label: 'سرعت اولیه v₀ (m/s)', key: 'v0', min: -10, max: 20, step: 0.5 },
      { label: 'شتاب a (m/s²)', key: 'a', min: -5, max: 10, step: 0.1 },
      { label: 'زمان کل t (s)', key: 't', min: 1, max: 15, step: 0.5 },
    ],
    state: S,
    update() {},
    draw(ctx, t) {
      const tt = Math.min(t, S.t);
      const sc = scale();
      ground(ctx, 230);
      const x = S.v0 * tt + 0.5 * S.a * tt * tt;
      const px = 50 + Math.abs(Math.min(0, Math.min(S.v0 * S.t + 0.5 * S.a * S.t * S.t, 0))) * sc;
      const carX = px + x * sc;
      ctx.fillStyle = ACCENT();
      roundRect(ctx, carX - 18, 196, 36, 20, 5); ctx.fill();
      ctx.fillStyle = '#2d2d2d';
      ctx.beginPath(); ctx.arc(carX - 10, 218, 6, 0, 7); ctx.arc(carX + 10, 218, 6, 0, 7); ctx.fill();
      const v = S.v0 + S.a * tt;
      if (Math.abs(v) > 0.05) arrow(ctx, carX, 188, carX + v * 6, 188, '#e5484d');
      // mini x-t graph
      const gx = 60, gy = 40, gw = 280, gh = 70;
      ctx.strokeStyle = theme()['--border-strong']; ctx.lineWidth = 1.4;
      ctx.strokeRect(gx, gy, gw, gh);
      ctx.strokeStyle = ACCENT(); ctx.lineWidth = 2;
      ctx.beginPath();
      const xAll = (ti) => S.v0 * ti + 0.5 * S.a * ti * ti;
      const xs = Array.from({ length: 41 }, (_, i) => xAll(S.t * i / 40));
      const mn = Math.min(...xs, 0), mx = Math.max(...xs, 1e-6);
      xs.forEach((xv, i) => {
        const px2 = gx + (i / 40) * gw;
        const py2 = gy + gh - ((xv - mn) / (mx - mn)) * gh;
        i ? ctx.lineTo(px2, py2) : ctx.moveTo(px2, py2);
      });
      ctx.stroke();
      const cxp = gx + (tt / S.t) * gw;
      const cyp = gy + gh - ((xAll(tt) - mn) / (mx - mn)) * gh;
      ctx.fillStyle = '#e5484d';
      ctx.beginPath(); ctx.arc(cxp, cyp, 4, 0, 7); ctx.fill();
      label(ctx, 'x-t', gx + 16, gy + 12, theme()['--text-secondary']);
    },
    telemetry(t) {
      const tt = Math.min(t, S.t);
      return [
        ['t', formatNumber(tt, 2, false) + ' s'],
        ['x', formatNumber(S.v0 * tt + 0.5 * S.a * tt * tt, 2, false) + ' m'],
        ['v', formatNumber(S.v0 + S.a * tt, 2, false) + ' m/s'],
      ];
    },
    finished: (t) => t > S.t + 1,
  };
}

function simCircular(spec) {
  const S = { radius: spec.radius || 2, period: spec.period || 4, v: spec.v };
  const om = () => S.v ? S.v / S.radius : 2 * Math.PI / S.period;
  const cx = 200, cy = 155, R = 100;
  return {
    sliders: [
      { label: 'شعاع r (m)', key: 'radius', min: 0.5, max: 5, step: 0.1 },
      { label: 'دوره T (s)', key: 'period', min: 1, max: 12, step: 0.2 },
    ],
    state: S,
    update() {},
    draw(ctx, t) {
      const w = om();
      const ang = -w * t;
      ctx.strokeStyle = theme()['--border-strong']; ctx.lineWidth = 1.6; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.stroke(); ctx.setLineDash([]);
      const bx = cx + Math.cos(ang) * R, by = cy + Math.sin(ang) * R;
      ctx.strokeStyle = theme()['--text-secondary']; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(bx, by); ctx.stroke();
      const v = w * S.radius;
      // velocity tangent
      arrow(ctx, bx, by, bx - Math.sin(ang) * v * 10, by + Math.cos(ang) * v * 10, '#18a058');
      label(ctx, 'v', bx - Math.sin(ang) * v * 10 - 10, by + Math.cos(ang) * v * 10, '#18a058');
      // centripetal accel
      const ac = v * v / S.radius;
      arrow(ctx, bx, by, bx + Math.cos(ang + Math.PI) * ac * 6, by - Math.sin(ang + Math.PI) * -ac * 6, '#e5484d');
      label(ctx, 'a', bx + (cx - bx) * 0.35 - 8, by + (cy - by) * 0.35, '#e5484d');
      ball(ctx, bx, by, 10, ACCENT());
      ball(ctx, cx, cy, 4, theme()['--text-secondary']);
    },
    telemetry(t) {
      const w = om(), v = w * S.radius;
      return [
        ['ω', formatNumber(w, 2, false) + ' rad/s'],
        ['v', formatNumber(v, 2, false) + ' m/s'],
        ['a_c', formatNumber(v * v / S.radius, 2, false) + ' m/s²'],
        ['θ', formatNumber(((w * t * 180 / Math.PI) % 360 + 360) % 360, 0, false) + '°'],
      ];
    },
  };
}

function simWave(spec) {
  const S = { amplitude: spec.amplitude || 0.5, wavelength: spec.wavelength || 2, frequency: spec.frequency || 1 };
  const cy = 150, scaleY = 70;
  // Fixed spatial window so changing λ actually changes how many waves fit.
  const WORLD_W = 12; // meters shown across the canvas
  return {
    sliders: [
      { label: 'دامنه A (m)', key: 'amplitude', min: 0.1, max: 1, step: 0.05 },
      { label: 'طول‌موج λ (m)', key: 'wavelength', min: 0.5, max: 6, step: 0.1 },
      { label: 'بسامد f (Hz)', key: 'frequency', min: 0.2, max: 4, step: 0.1 },
    ],
    state: S,
    update() {},
    draw(ctx, t) {
      const k = 2 * Math.PI / Math.max(0.15, S.wavelength);
      const w = 2 * Math.PI * S.frequency;
      const xScale = CW / WORLD_W; // px per meter — independent of λ
      const tt = theme();

      // axis
      ctx.strokeStyle = tt['--border-subtle'];
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(CW, cy); ctx.stroke();
      // meter ticks
      ctx.fillStyle = tt['--text-secondary'];
      ctx.font = '700 10px ui-monospace, monospace';
      ctx.textAlign = 'center';
      for (let m = 0; m <= WORLD_W; m += 2) {
        const px = m * xScale;
        ctx.strokeStyle = tt['--border-subtle'];
        ctx.beginPath(); ctx.moveTo(px, cy - 4); ctx.lineTo(px, cy + 4); ctx.stroke();
        if (m > 0 && m < WORLD_W) ctx.fillText(toPersianDigits(String(m)) + ' m', px, cy + 16);
      }

      // wave
      ctx.strokeStyle = ACCENT(); ctx.lineWidth = 2.6;
      ctx.beginPath();
      for (let px = 0; px <= CW; px += 2) {
        const x = px / xScale;
        const y = S.amplitude * Math.sin(k * x - w * t);
        const py = cy - y * scaleY;
        px === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.stroke();

      // oscillating particle at x = 0 (makes frequency obvious)
      const y0 = S.amplitude * Math.sin(-w * t);
      ball(ctx, 4, cy - y0 * scaleY, 6, ACCENT());

      // wavelength bracket — length now scales with λ
      const lamPx = Math.max(8, S.wavelength * xScale);
      const x0 = 16;
      const x1 = Math.min(CW - 16, x0 + lamPx);
      const yb = cy - S.amplitude * scaleY - 22;
      ctx.strokeStyle = '#e5484d'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(x0, yb + 6); ctx.lineTo(x0, yb); ctx.lineTo(x1, yb); ctx.lineTo(x1, yb + 6); ctx.stroke();
      label(ctx, 'λ', (x0 + x1) / 2, yb - 6, '#e5484d');
    },
    telemetry() {
      return [
        ['v', formatNumber(S.frequency * S.wavelength, 2, false) + ' m/s'],
        ['λ', formatNumber(S.wavelength, 2, false) + ' m'],
        ['f', formatNumber(S.frequency, 2, false) + ' Hz'],
        ['T', formatNumber(1 / S.frequency, 2, false) + ' s'],
      ];
    },
  };
}

function simInclineFriction(spec) {
  const S = { angle: spec.angle ?? 30, mass: spec.mass || 2, mu_s: spec.mu_s ?? spec.mu ?? 0.3, mu_k: spec.mu_k ?? spec.mu ?? 0.25, g: spec.g || 9.8 };
  let s, v, sliding;
  const reset = () => { s = 0; v = 0; sliding = null; };
  reset();
  const L = 5; // incline length (m)
  return {
    sliders: [
      { label: 'زاویه شیب θ (°)', key: 'angle', min: 5, max: 60, step: 1, restart: true },
      { label: 'μs', key: 'mu_s', min: 0, max: 1, step: 0.02 },
      { label: 'μk', key: 'mu_k', min: 0, max: 1, step: 0.02 },
      { label: 'جرم m (kg)', key: 'mass', min: 0.5, max: 20, step: 0.5 },
    ],
    state: S,
    reset,
    update(t, dt) {
      const th = S.angle * Math.PI / 180;
      const fDrive = S.g * Math.sin(th);
      const n = S.g * Math.cos(th);
      if (sliding === null) sliding = fDrive > S.mu_s * n;
      if (sliding && s < L) {
        const a = S.g * (Math.sin(th) - S.mu_k * Math.cos(th));
        v += Math.max(0, a) * dt;
        s += v * dt;
      }
    },
    draw(ctx) {
      const th = S.angle * Math.PI / 180;
      const bx = 60, by = 250;
      const hx = bx + Math.cos(th) * 260, hy = by - Math.sin(th) * 260;
      ctx.fillStyle = theme()['--bg-inset'];
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(hx, hy); ctx.lineTo(hx, by); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = theme()['--border-strong']; ctx.lineWidth = 2; ctx.stroke();
      // angle arc
      ctx.strokeStyle = theme()['--text-secondary']; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(bx, by, 30, -th, 0); ctx.stroke();
      label(ctx, 'θ', bx + 38, by - 8, theme()['--text-secondary']);
      // block on incline
      const frac = Math.min(1, s / L);
      const cxp = bx + 20 + frac * (Math.cos(th) * 240), cyp = by - frac * (Math.sin(th) * 240);
      ctx.save();
      ctx.translate(cxp, cyp); ctx.rotate(-th);
      ctx.fillStyle = sliding ? '#e5484d' : ACCENT();
      roundRect(ctx, -16, -32, 32, 22, 4); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.3)'; ctx.stroke();
      ctx.restore();
      if (!sliding) label(ctx, 'ساکن (اصطکاک ایستایی)', 200, 40, theme()['--text-primary'], 12);
    },
    telemetry() {
      const th = S.angle * Math.PI / 180;
      return [
        ['a', formatNumber(sliding ? Math.max(0, S.g * (Math.sin(th) - S.mu_k * Math.cos(th))) : 0, 2, false) + ' m/s²'],
        ['v', formatNumber(v, 2, false) + ' m/s'],
        ['N', formatNumber(S.mass * S.g * Math.cos(th), 1, false) + ' N'],
        [sliding ? 'حرکت' : 'سکون', ''],
      ];
    },
    finished: () => s >= L,
  };
}

function simDoppler(spec) {
  const S = { v_s: spec.v_s ?? 15, v_o: spec.v_o ?? 0, f: spec.frequency || 2 };
  const c = 343; // speed of sound
  let wavefronts;
  const reset = () => { wavefronts = []; };
  reset();
  let lastEmit = 0;
  const srcY = 150;
  return {
    sliders: [
      { label: 'سرعت چشمه v_s (m/s)', key: 'v_s', min: 0, max: 100, step: 1 },
      { label: 'بسامد f (Hz)', key: 'f', min: 0.5, max: 5, step: 0.1 },
    ],
    state: S,
    reset,
    update(t, dt) {
      if (t - lastEmit >= 1 / S.f) {
        wavefronts.push({ x: 60 + (t * 4 % 1) * 0 + (S.v_s * t * 0.55), t });
        lastEmit = t;
      }
      wavefronts = wavefronts.filter((wf) => (t - wf.t) * 40 < 400);
    },
    draw(ctx, t) {
      const srcX = 40 + (S.v_s * t * 0.55) % (CW + 200) - 100;
      ctx.strokeStyle = theme()['--border-subtle'];
      wavefronts.forEach((wf) => {
        const r = (t - wf.t) * 40;
        ctx.beginPath(); ctx.arc(wf.x, srcY, r, 0, 7); ctx.stroke();
      });
      ball(ctx, srcX, srcY, 9, ACCENT());
      if (S.v_s > 0) arrow(ctx, srcX, srcY - 18, srcX + 24, srcY - 18, ACCENT());
      label(ctx, 'چشمه', srcX, srcY + 24, theme()['--text-primary']);
      if (S.v_s >= 100) label(ctx, '⚠ سرعت چشمه به سرعت صوت نزدیک است', 200, 30, '#e5484d', 11);
    },
    telemetry(t) {
      const fObs = S.f * c / (c - Math.min(S.v_s, c - 1));
      return [
        ['f_obs', formatNumber(fObs, 2, false) + ' Hz'],
        ['f_src', formatNumber(S.f, 2, false) + ' Hz'],
      ];
    },
  };
}

/* ---------------- electricity & magnetism ---------------- */

function simCircuit(spec) {
  const S = { voltage: spec.voltage || 12 };
  const resistors = spec.resistors && spec.resistors.length ? spec.resistors : [4, 6];
  const R = resistors.reduce((a, b) => a + b, 0);
  const I = () => S.voltage / R;
  const path = [
    [70, 230], [70, 70], [330, 70], [330, 230], [70, 230],
  ];
  return {
    sliders: [{ label: 'ولتاژ V (ولت)', key: 'voltage', min: 1, max: 48, step: 1 }],
    state: S,
    update() {},
    draw(ctx, t) {
      const tt = theme();
      ctx.strokeStyle = tt['--text-secondary']; ctx.lineWidth = 2.4;
      ctx.beginPath();
      path.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
      // battery
      ctx.fillStyle = tt['--bg-card'];
      ctx.fillRect(58, 140, 24, 42);
      ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.moveTo(58, 150); ctx.lineTo(82, 150); ctx.stroke();
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(62, 172); ctx.lineTo(78, 172); ctx.stroke();
      label(ctx, `${toPersianDigits(formatNumber(S.voltage, 0))}V`, 40, 165, tt['--text-primary'], 12);
      // resistors on top edge
      const segW = 260 / resistors.length;
      resistors.forEach((r, i) => {
        const x0 = 70 + i * segW + segW * 0.2, w = segW * 0.6;
        ctx.fillStyle = '#f0a020';
        roundRect(ctx, x0, 60, w, 20, 4); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,.3)'; ctx.lineWidth = 1; ctx.stroke();
        label(ctx, `${toPersianDigits(formatNumber(r, 0))}Ω`, x0 + w / 2, 52, tt['--text-primary']);
      });
      // moving charges
      const per = 400;
      for (let i = 0; i < 10; i++) {
        const d = ((t * I() * 26 + i * 40) % per + per) % per;
        let x, y;
        if (d < 160) { x = 70; y = 230 - d; }
        else if (d < 160 + 260) { x = 70 + (d - 160); y = 70; }
        else if (d < 160 + 260 + 160) { x = 330; y = 70 + (d - 420); }
        else { x = 330 - (d - 580); y = 230; }
        if (x === undefined) { x = 70 + (d - (160 + 260 + 160 + 160)); y = 230; }
        ctx.fillStyle = ACCENT();
        ctx.beginPath(); ctx.arc(x, y, 3.4, 0, 7); ctx.fill();
      }
      label(ctx, `I = ${toPersianDigits(formatNumber(I(), 2))} A`, 200, 260, ACCENT(), 13);
    },
    telemetry() {
      return [
        ['R_eq', formatNumber(R, 1, false) + ' Ω'],
        ['I', formatNumber(I(), 2, false) + ' A'],
        ['P', formatNumber(S.voltage * I(), 2, false) + ' W'],
      ];
    },
  };
}

function simOptics(spec) {
  const S = { f: spec.f || 10, do: spec.do || 25, ho: spec.ho || 5 };
  const cx = 200, cy = 150, scale = 5.2;
  return {
    sliders: [
      { label: 'فاصله کانونی f (cm)', key: 'f', min: 3, max: 20, step: 0.5 },
      { label: 'فاصله جسم d₀ (cm)', key: 'do', min: 2, max: 45, step: 0.5 },
    ],
    state: S,
    update() {},
    draw(ctx) {
      const tt = theme();
      ctx.strokeStyle = tt['--border-strong']; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(20, cy); ctx.lineTo(380, cy); ctx.stroke();
      // lens
      ctx.strokeStyle = ACCENT(); ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(cx, cy - 90); ctx.quadraticCurveTo(cx + 16, cy, cx, cy + 90); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx, cy - 90); ctx.quadraticCurveTo(cx - 16, cy, cx, cy + 90); ctx.stroke();
      // focal points
      [-1, 1].forEach((s) => {
        ctx.fillStyle = '#e5484d';
        ctx.beginPath(); ctx.arc(cx + s * S.f * scale, cy, 3, 0, 7); ctx.fill();
        label(ctx, 'F', cx + s * S.f * scale, cy + 16, '#e5484d');
      });
      // object
      const ox = cx - S.do * scale, oh = S.ho * scale;
      arrow(ctx, ox, cy, ox, cy - oh, '#18a058', 3);
      label(ctx, 'جسم', ox, cy + 16, '#18a058');
      // rays
      const di = 1 / (1 / S.f - 1 / S.do);
      const hi = -S.ho * di / S.do;
      const ix = cx + di * scale, ih = hi * scale;
      ctx.strokeStyle = '#f0a020'; ctx.lineWidth = 1.6;
      // parallel ray then through F
      ctx.beginPath(); ctx.moveTo(ox, cy - oh); ctx.lineTo(cx, cy - oh); ctx.lineTo(ix, cy - ih); ctx.stroke();
      // through center
      ctx.beginPath(); ctx.moveTo(ox, cy - oh); ctx.lineTo(cx, cy); ctx.lineTo(ix, cy - ih); ctx.stroke();
      if (di > 0) {
        ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(cx, cy - oh); ctx.lineTo(cx + S.f * scale * 1.2, cy - oh - (cy - oh - (cy - (cy - oh))) * 0); ctx.stroke();
        ctx.setLineDash([]);
        arrow(ctx, ix, cy, ix, cy - ih, '#8b5cf6', 2.4);
      } else {
        // virtual image
        ctx.setLineDash([5, 4]);
        arrow(ctx, ix, cy, ix, cy - ih, '#8b5cf6', 2.4);
        ctx.setLineDash([]);
      }
      label(ctx, 'تصویر', ix, cy + 16, '#8b5cf6');
    },
    telemetry() {
      const di = 1 / (1 / S.f - 1 / S.do);
      return [
        ['d_i', formatNumber(di, 1, false) + ' cm'],
        ['m', formatNumber(-di / S.do, 2, false)],
        [di > 0 ? 'حقیقی' : 'مجازی', ''],
      ];
    },
  };
}

function simElectricField(spec) {
  const charges = (spec.charges && spec.charges.length ? spec.charges : [1, -1]).map((q, i, arr) => ({
    q, x: 200 + (i - (arr.length - 1) / 2) * 120, y: 150,
  }));
  const fieldAt = (x, y) => {
    let ex = 0, ey = 0;
    charges.forEach((c) => {
      const dx = x - c.x, dy = y - c.y;
      const r2 = dx * dx + dy * dy + 100;
      const r = Math.sqrt(r2);
      const e = c.q * 900 / r2;
      ex += e * dx / r; ey += e * dy / r;
    });
    return [ex, ey];
  };
  return {
    sliders: [],
    state: {},
    update() {},
    draw(ctx) {
      // field lines from each positive charge
      const tt = theme();
      charges.forEach((c) => {
        if (c.q <= 0) return;
        const nLines = Math.max(6, Math.min(14, Math.abs(c.q) * 8));
        for (let i = 0; i < nLines; i++) {
          const ang = (i / nLines) * Math.PI * 2;
          let x = c.x + Math.cos(ang) * 16, y = c.y + Math.sin(ang) * 16;
          ctx.strokeStyle = tt['--text-secondary']; ctx.lineWidth = 1.1; ctx.globalAlpha = 0.7;
          ctx.beginPath(); ctx.moveTo(x, y);
          for (let s = 0; s < 220; s++) {
            const [ex, ey] = fieldAt(x, y);
            const m = Math.hypot(ex, ey) || 1;
            x += (ex / m) * 2.4; y += (ey / m) * 2.4;
            ctx.lineTo(x, y);
            if (x < 0 || x > CW || y < 0 || y > CH) break;
            if (charges.some((o) => o.q < 0 && Math.hypot(x - o.x, y - o.y) < 15)) break;
          }
          ctx.stroke(); ctx.globalAlpha = 1;
        }
      });
      charges.forEach((c) => {
        const col = c.q >= 0 ? '#e5484d' : '#4f6df5';
        ball(ctx, c.x, c.y, 13, col);
        label(ctx, c.q >= 0 ? '+' : '−', c.x, c.y + 1, '#fff', 15);
      });
    },
    telemetry() { return charges.map((c, i) => [`q${toPersianDigits(i + 1)}`, formatNumber(c.q, 1, false) + ' μC']); },
  };
}

function simCapacitor(spec) {
  const S = { voltage: spec.voltage || 12, area: spec.area || 10, distance: spec.distance || 2, dielectric: spec.dielectric || 1 };
  const eps0 = 8.85e-12;
  const C = () => eps0 * S.dielectric * (S.area * 1e-2) / (S.distance * 1e-3);
  return {
    sliders: [
      { label: 'ولتاژ V', key: 'voltage', min: 1, max: 48, step: 1 },
      { label: 'فاصله صفحات d (mm)', key: 'distance', min: 0.5, max: 8, step: 0.5 },
      { label: 'ثابت دی‌الکتریک κ', key: 'dielectric', min: 1, max: 10, step: 0.5 },
    ],
    state: S,
    update() {},
    draw(ctx) {
      const gap = 20 + S.distance * 9;
      const cx = 200, cy = 150;
      ctx.fillStyle = 'rgba(79,109,245,0.10)';
      ctx.fillRect(cx - 70, cy - gap / 2, 140, gap);
      ctx.fillStyle = '#e5484d';
      ctx.fillRect(cx - 70, cy - gap / 2 - 6, 140, 6);
      ctx.fillStyle = '#4f6df5';
      ctx.fillRect(cx - 70, cy + gap / 2, 140, 6);
      label(ctx, '+', cx - 82, cy - gap / 2, '#e5484d', 14);
      label(ctx, '−', cx - 82, cy + gap / 2 + 8, '#4f6df5', 14);
      // field arrows
      ctx.strokeStyle = theme()['--text-secondary']; ctx.globalAlpha = 0.8;
      for (let x = cx - 50; x <= cx + 50; x += 25) arrow(ctx, x, cy - gap / 2 + 4, x, cy + gap / 2 - 4, theme()['--text-secondary'], 1.4);
      ctx.globalAlpha = 1;
      // battery + wires
      ctx.strokeStyle = theme()['--text-secondary']; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(cx - 40, cy - gap / 2 - 6); ctx.lineTo(cx - 40, 40); ctx.lineTo(80, 40); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx + 40, cy + gap / 2 + 6); ctx.lineTo(cx + 40, 260); ctx.lineTo(80, 260); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(80, 40); ctx.lineTo(80, 260); ctx.setLineDash([4, 4]); ctx.stroke(); ctx.setLineDash([]);
      label(ctx, `${toPersianDigits(formatNumber(S.voltage, 0))}V`, 62, 155, theme()['--text-primary'], 12);
    },
    telemetry() {
      const c = C();
      return [
        ['C', formatNumber(c * 1e12, 2, false) + ' pF'],
        ['Q', formatNumber(c * S.voltage * 1e12, 2, false) + ' pC'],
        ['E', formatNumber(S.voltage / (S.distance * 1e-3), 0, false) + ' V/m'],
      ];
    },
  };
}

function simLorentz(spec) {
  const S = { q: spec.q ?? 1, v: spec.v || 5, B: spec.B || 2, mass: spec.mass || 1 };
  const sign = S.q >= 0 ? 1 : -1;
  const omega = () => Math.abs(S.q) * S.B / S.mass;
  const R = () => Math.min(1.6, S.mass * S.v / (Math.abs(S.q) * S.B));
  return {
    sliders: [
      { label: 'سرعت v (m/s)', key: 'v', min: 1, max: 15, step: 0.5 },
      { label: 'میدان B (T)', key: 'B', min: 0.5, max: 8, step: 0.1 },
      { label: 'بار q (C)', key: 'q', min: -4, max: 4, step: 0.5 },
    ],
    state: S,
    update() {},
    draw(ctx, t) {
      // B field crosses (into page)
      ctx.strokeStyle = theme()['--border-subtle'];
      ctx.fillStyle = theme()['--text-secondary'];
      ctx.font = '700 13px system-ui';
      ctx.textAlign = 'center';
      for (let x = 30; x < CW; x += 45) for (let y = 30; y < CH; y += 45) {
        ctx.fillText(S.reversed_poles ? '·' : '×', x, y + 4);
      }
      const r = R() * 80;
      const dirB = S.reversed_poles ? -1 : 1;
      const cxp = 200, cyp = 150;
      const w = omega() * dirB * sign;
      const ang = t * w;
      const bx = cxp + Math.cos(ang) * r, by = cyp + Math.sin(ang) * r;
      ctx.strokeStyle = theme()['--border-strong']; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.arc(cxp, cyp, r, 0, 7); ctx.stroke(); ctx.setLineDash([]);
      ball(ctx, bx, by, 9, S.q >= 0 ? '#e5484d' : '#4f6df5');
      // F vector
      arrow(ctx, bx, by, bx + (cxp - bx) * 0.4, by + (cyp - by) * 0.4, '#f0a020');
      label(ctx, 'F', bx + (cxp - bx) * 0.45 - 10, by + (cyp - by) * 0.45, '#f0a020');
      label(ctx, S.q >= 0 ? '+q' : '−q', bx, by + 3, '#fff', 10);
    },
    telemetry(t) {
      return [
        ['r', formatNumber(S.mass * S.v / (Math.abs(S.q || 1e-9) * S.B), 2, false) + ' m'],
        ['ω', formatNumber(omega(), 2, false) + ' rad/s'],
        ['T', formatNumber(2 * Math.PI / omega(), 2, false) + ' s'],
      ];
    },
  };
}

function simFaraday(spec) {
  const S = { turns: spec.turns || 50, B: spec.B || 1, area: spec.area || 0.01, frequency: spec.frequency || 1 };
  return {
    sliders: [
      { label: 'تعداد دور N', key: 'turns', min: 10, max: 200, step: 10 },
      { label: 'بسامد چرخش f (Hz)', key: 'frequency', min: 0.2, max: 3, step: 0.1 },
      { label: 'میدان B (T)', key: 'B', min: 0.2, max: 3, step: 0.1 },
    ],
    state: S,
    update() {},
    draw(ctx, t) {
      const cx = 130, cy = 150;
      // magnets
      ctx.fillStyle = '#e5484d'; ctx.fillRect(30, 40, 30, 90);
      ctx.fillStyle = '#4f6df5'; ctx.fillRect(30, 170, 30, 90);
      label(ctx, 'N', 45, 88, '#fff', 13);
      label(ctx, 'S', 45, 218, '#fff', 13);
      // rotating coil
      const ang = 2 * Math.PI * S.frequency * t;
      const w = 55, h = 80 * Math.abs(Math.cos(ang));
      ctx.strokeStyle = '#f0a020'; ctx.lineWidth = 3;
      ctx.strokeRect(cx - w / 2, cy - Math.max(6, h) / 2, w, Math.max(6, h));
      // induced EMF graph
      const gx = 210, gy = 60, gw = 170, gh = 180;
      ctx.strokeStyle = theme()['--border-strong']; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(gx, gy + gh / 2); ctx.lineTo(gx + gw, gy + gh / 2); ctx.stroke();
      ctx.strokeRect(gx, gy, 0.5, gh);
      const emf = (ti) => S.turns * S.B * (S.area || 0.01) * 100 * 2 * Math.PI * S.frequency * Math.sin(2 * Math.PI * S.frequency * ti);
      const eMax = Math.abs(emf(0.25 / S.frequency)) || 1;
      ctx.strokeStyle = ACCENT(); ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i <= 100; i++) {
        const ti = (t - 3 + i * 0.03);
        const px = gx + (i / 100) * gw;
        const py = gy + gh / 2 - (emf(ti) / eMax) * gh * 0.42;
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.stroke();
      const nowY = gy + gh / 2 - (emf(t) / eMax) * gh * 0.42;
      ctx.fillStyle = '#e5484d';
      ctx.beginPath(); ctx.arc(gx + gw / 2, nowY, 4, 0, 7); ctx.fill();
      label(ctx, 'ε (EMF القایی)', gx + gw / 2, gy - 8, theme()['--text-secondary'], 11);
    },
    telemetry(t) {
      const emfMax = S.turns * S.B * (S.area || 0.01) * 100 * 2 * Math.PI * S.frequency;
      return [['ε_max', formatNumber(emfMax, 2, false) + ' V'], ['f', formatNumber(S.frequency, 2, false) + ' Hz']];
    },
  };
}

function simPhotoelectric(spec) {
  const S = { frequency: spec.frequency || 6, intensity: spec.intensity || 5, work_function: spec.work_function || 2.5 };
  // use eV-ish units: photon E = f (scaled), threshold = work_function
  const photonE = () => S.frequency; // display units
  const emits = () => photonE() > S.work_function;
  let electrons;
  const reset = () => { electrons = []; };
  reset();
  return {
    sliders: [
      { label: 'انرژی فوتون (eV)', key: 'frequency', min: 1, max: 12, step: 0.1 },
      { label: 'تابش (شدت)', key: 'intensity', min: 1, max: 10, step: 1 },
      { label: 'تابع کار φ (eV)', key: 'work_function', min: 1, max: 8, step: 0.1 },
    ],
    state: S,
    reset,
    update(t, dt) {
      if (emits() && Math.random() < S.intensity * dt * 2) {
        electrons.push({ x: 210, y: 190 + (Math.random() - 0.5) * 60, v: 40 + Math.sqrt(Math.max(0, photonE() - S.work_function)) * 40 });
      }
      electrons.forEach((e) => { e.x += e.v * dt; });
      electrons = electrons.filter((e) => e.x < 340);
    },
    draw(ctx) {
      const tt = theme();
      // metal plate
      ctx.fillStyle = tt['--border-strong'];
      ctx.fillRect(195, 120, 16, 130);
      label(ctx, 'فلز', 203, 265, tt['--text-primary']);
      // collector
      ctx.fillStyle = tt['--border-soft'];
      ctx.fillRect(330, 120, 10, 130);
      // photons
      const nPh = Math.round(S.intensity);
      for (let i = 0; i < nPh; i++) {
        const yy = 135 + i * (110 / Math.max(1, nPh - 1) || 0);
        const phase = (performance.now() / 1000 * 60 + i * 37) % 140;
        const x = 50 + phase;
        if (x > 190) continue;
        ctx.strokeStyle = '#f0a020'; ctx.lineWidth = 2;
        ctx.beginPath();
        for (let s = 0; s < 14; s++) {
          const px = x + s * 1.6, py = yy + Math.sin(s * 1.2) * 4;
          s ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
        }
        ctx.stroke();
      }
      label(ctx, `E = ${toPersianDigits(formatNumber(photonE(), 1))} eV`, 80, 110, '#f0a020', 12);
      electrons.forEach((e) => ball(ctx, e.x, e.y, 3.5, ACCENT()));
      label(ctx, emits() ? 'گسیل فوتوالکترون ✓' : 'انرژی فوتون کافی نیست ✗', 265, 100, emits() ? '#18a058' : '#e5484d', 11);
    },
    telemetry() {
      const ke = Math.max(0, photonE() - S.work_function);
      return [
        ['KE_max', formatNumber(ke, 2, false) + ' eV'],
        ['φ', formatNumber(S.work_function, 2, false) + ' eV'],
      ];
    },
  };
}

/* ---------------- fluids & gases ---------------- */

function simGasLaws(spec) {
  const S = { T: spec.T || 300, V: spec.V || 5, n: spec.n || 1, mode: spec.mode || 'isobaric' };
  const R = 8.314;
  const P = () => S.n * R * S.T / S.V / 1000; // kPa
  return {
    sliders: [
      { label: 'دما T (K)', key: 'T', min: 100, max: 800, step: 5 },
      { label: 'حجم V (L)', key: 'V', min: 1, max: 12, step: 0.2 },
      { label: 'مول n', key: 'n', min: 0.2, max: 4, step: 0.1 },
    ],
    state: S,
    update() {},
    draw(ctx, t) {
      const tt = theme();
      const pistonY = 250 - (S.V / 12) * 160;
      // cylinder
      ctx.strokeStyle = tt['--border-strong']; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(130, 30); ctx.lineTo(130, 260); ctx.lineTo(270, 260); ctx.lineTo(270, 30); ctx.stroke();
      // gas particles
      ctx.fillStyle = ACCENT();
      const nP = Math.round(12 + S.n * 8);
      for (let i = 0; i < nP; i++) {
        const sp = 18 + S.T / 22;
        const x = 145 + ((i * 61.7 + t * sp * (1 + i % 3)) % 110);
        const y = pistonY + 14 + ((i * 41.3 + t * sp * (1 + (i + 1) % 3)) % Math.max(10, 250 - pistonY - 20));
        ctx.beginPath(); ctx.arc(x, y, 3, 0, 7); ctx.fill();
      }
      // piston
      ctx.fillStyle = tt['--text-secondary'];
      ctx.fillRect(130, pistonY, 140, 12);
      label(ctx, `P = ${toPersianDigits(formatNumber(P(), 1))} kPa`, 200, 20, tt['--text-primary'], 13);
      // thermometer color
      const heat = Math.min(1, (S.T - 100) / 700);
      ctx.fillStyle = `rgba(229,72,77,${0.08 + heat * 0.25})`;
      ctx.fillRect(131, pistonY + 12, 138, 260 - pistonY - 12);
    },
    telemetry() {
      return [
        ['P', formatNumber(P(), 1, false) + ' kPa'],
        ['V', formatNumber(S.V, 1, false) + ' L'],
        ['T', formatNumber(S.T, 0, false) + ' K'],
        ['PV/nT', formatNumber(S.n * R * S.T / S.V * S.V / (S.n * S.T), 2, false) + ' J/(mol·K)'],
      ];
    },
  };
}

function simBuoyancy(spec) {
  const S = { rho_f: spec.rho_f || 1000, rho_s: spec.rho_s || 500, v_obj: spec.v_obj || 1, g: spec.g || 9.8 };
  let y, v;
  const sub = () => Math.min(1, S.rho_f / S.rho_s); // equilibrium submerged fraction
  const reset = () => { y = -0.25; v = 0; };
  reset();
  const waterY = 110, scale = 60;
  return {
    sliders: [
      { label: 'چگالی سیال ρ_f', key: 'rho_f', min: 500, max: 2000, step: 20 },
      { label: 'چگالی جسم ρ_s', key: 'rho_s', min: 100, max: 3000, step: 20, restart: true },
    ],
    state: S,
    reset,
    update(t, dt) {
      // simple damped dynamics toward equilibrium draft
      const submerged = Math.max(0, Math.min(1, 0.5 - y));
      const Fb = S.rho_f * S.v_obj * submerged * S.g;
      const W = S.rho_s * S.v_obj * S.g;
      const a = (Fb - W) / (S.rho_s * S.v_obj) - v * 1.6;
      v += a * dt; y += v * dt;
      if (y > 0.9) { y = 0.9; v = 0; }
    },
    draw(ctx) {
      const tt = theme();
      // tank + water
      ctx.fillStyle = 'rgba(79,140,247,0.18)';
      ctx.fillRect(60, waterY, 280, 160);
      ctx.strokeStyle = '#4f8cf7'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(60, waterY); ctx.lineTo(340, waterY); ctx.stroke();
      ctx.strokeStyle = tt['--border-strong'];
      ctx.beginPath(); ctx.moveTo(60, 60); ctx.lineTo(60, 270); ctx.lineTo(340, 270); ctx.lineTo(340, 60); ctx.stroke();
      const size = Math.cbrt(S.v_obj) * 34;
      const by = waterY - size * (0.5 + y);
      ctx.fillStyle = '#b06a2f';
      roundRect(ctx, 200 - size / 2, by, size, size, 4); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.3)'; ctx.stroke();
      // forces
      const submerged = Math.max(0, Math.min(1, (waterY - by) / size));
      const Fb = S.rho_f * S.v_obj * submerged * S.g;
      const W = S.rho_s * S.v_obj * S.g;
      const fscale = 90 / Math.max(Fb, W, 1);
      arrow(ctx, 200 + size / 2 + 14, by + size / 2, 200 + size / 2 + 14, by + size / 2 - Fb * fscale, '#18a058');
      label(ctx, 'F_b', 200 + size / 2 + 26, by + size / 2 - Fb * fscale + 4, '#18a058');
      arrow(ctx, 200 - size / 2 - 14, by + size / 2, 200 - size / 2 - 14, by + size / 2 + W * fscale, '#e5484d');
      label(ctx, 'W', 200 - size / 2 - 26, by + size / 2 + W * fscale + 4, '#e5484d');
    },
    telemetry() {
      const floats = S.rho_s <= S.rho_f;
      return [
        [floats ? 'وضعیت' : 'وضعیت', floats ? 'شناور' : 'غوطه‌ور/غرق'],
        ['کسر فرورفته', formatNumber(Math.min(1, S.rho_s / S.rho_f) * 100, 0, false) + '%'],
      ];
    },
  };
}

function simUTube(spec) {
  const S = { rho_left: spec.rho_left || 1000, h_left: spec.h_left || 20, rho_right: spec.rho_right || 800, h_right: spec.h_right || 25, p_gas: spec.p_gas || 0 };
  return {
    sliders: [
      { label: 'ρ چپ', key: 'rho_left', min: 600, max: 1400, step: 20 },
      { label: 'ρ راست', key: 'rho_right', min: 600, max: 1400, step: 20 },
    ],
    state: S,
    update() {},
    draw(ctx) {
      const tt = theme();
      const baseY = 260, lw = 34, gap = 90, cx = 200;
      const hL = 40 + (S.h_left || 20) * 4;
      const eqH = (S.rho_left * S.h_left) / S.rho_right; // equilibrium right height
      const hR = 40 + Math.min(45, eqH) * 4;
      // tube
      ctx.strokeStyle = tt['--border-strong']; ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(cx - gap - lw / 2, 40); ctx.lineTo(cx - gap - lw / 2, baseY);
      ctx.quadraticCurveTo(cx - gap - lw / 2, baseY + 24, cx - gap, baseY + 24);
      ctx.lineTo(cx + gap, baseY + 24);
      ctx.quadraticCurveTo(cx + gap + lw / 2, baseY + 24, cx + gap + lw / 2, baseY);
      ctx.lineTo(cx + gap + lw / 2, 40);
      ctx.stroke();
      // liquids
      ctx.fillStyle = 'rgba(79,109,245,0.35)';
      ctx.fillRect(cx - gap - lw / 2 + 3, baseY - hL, lw - 6, hL + 20);
      ctx.fillStyle = 'rgba(240,160,32,0.4)';
      ctx.fillRect(cx + gap - lw / 2 + 3, baseY - hR, lw - 6, hR + 20);
      ctx.fillStyle = 'rgba(240,160,32,0.4)';
      ctx.fillRect(cx - gap, baseY + 4, gap * 2, 18);
      label(ctx, 'ρ₁', cx - gap, baseY - hL - 10, tt['--text-primary'], 12);
      label(ctx, 'ρ₂', cx + gap, baseY - hR - 10, tt['--text-primary'], 12);
      // height markers
      ctx.strokeStyle = tt['--text-secondary']; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(cx - gap - lw / 2, baseY - hL); ctx.lineTo(cx - gap + 30, baseY - hL); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx + gap - 30, baseY - hR); ctx.lineTo(cx + gap + lw / 2, baseY - hR); ctx.stroke();
      ctx.setLineDash([]);
    },
    telemetry() {
      const eqH = (S.rho_left * S.h_left) / S.rho_right;
      return [
        ['h₁', formatNumber(S.h_left, 1, false) + ' cm'],
        ['h₂ تعادلی', formatNumber(eqH, 1, false) + ' cm'],
        ['ρ₁h₁ = ρ₂h₂', '✓'],
      ];
    },
  };
}

function simManometerTanks(spec) {
  const S = { p_gas: spec.p_gas || 120, rho: spec.rho_f || 13600, g: 9.8, p_atm: 101.3 };
  const dh = () => (S.p_gas - S.p_atm) * 1000 / (S.rho * S.g); // m
  return {
    sliders: [{ label: 'فشار گاز (kPa)', key: 'p_gas', min: 80, max: 160, step: 1 }],
    state: S,
    update() {},
    draw(ctx) {
      const tt = theme();
      // tank
      ctx.fillStyle = tt['--bg-inset'];
      roundRect(ctx, 60, 90, 110, 150, 10); ctx.fill();
      ctx.strokeStyle = tt['--border-strong']; ctx.lineWidth = 2.4; ctx.stroke();
      label(ctx, `گاز ${toPersianDigits(formatNumber(S.p_gas, 0))} kPa`, 115, 80, tt['--text-primary'], 11);
      // manometer tube
      const dhPx = dh() * 300;
      ctx.strokeStyle = tt['--border-strong']; ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(170, 200); ctx.lineTo(230, 200); ctx.lineTo(230, 240);
      ctx.lineTo(290, 240); ctx.lineTo(290, 60);
      ctx.stroke();
      ctx.fillStyle = 'rgba(120,120,140,0.55)';
      ctx.fillRect(224, 200 - 0, 12, 40); // left column pushed
      ctx.fillRect(284, 200 - Math.max(10, dhPx) + 40, 12, Math.max(10, dhPx));
      label(ctx, `Δh = ${toPersianDigits(formatNumber(dh(), 2))} m`, 265, 48, tt['--text-primary'], 11);
      label(ctx, 'P_atm', 310, 70, tt['--text-secondary'], 10);
    },
    telemetry() {
      return [
        ['ΔP', formatNumber(S.p_gas - S.p_atm, 1, false) + ' kPa'],
        ['Δh', formatNumber(dh(), 3, false) + ' m'],
      ];
    },
  };
}

function simTubeSystem(spec) {
  // connected vessels: pressure equalization visual
  const liquids = Array.isArray(spec.liquids) && spec.liquids.length ? spec.liquids : [{ rho: 1000, h: 30 }, { rho: 800, h: 37.5 }];
  return {
    sliders: [],
    state: {},
    update() {},
    draw(ctx) {
      const tt = theme();
      const baseY = 250;
      const cols = ['rgba(79,109,245,0.4)', 'rgba(240,160,32,0.45)', 'rgba(24,160,88,0.4)', 'rgba(236,72,153,0.4)'];
      const n = liquids.length;
      const w = Math.min(70, 260 / n);
      const x0 = 200 - (n * (w + 24)) / 2 + 12;
      liquids.forEach((lq, i) => {
        const h = Math.min(180, (lq.h || 30) * 3.4);
        const x = x0 + i * (w + 24);
        ctx.strokeStyle = tt['--border-strong']; ctx.lineWidth = 2.4;
        ctx.beginPath(); ctx.moveTo(x, 50); ctx.lineTo(x, baseY); ctx.lineTo(x + w, baseY); ctx.lineTo(x + w, 50); ctx.stroke();
        ctx.fillStyle = cols[i % cols.length];
        ctx.fillRect(x + 2, baseY - h, w - 4, h);
        label(ctx, lq.label || `ρ=${toPersianDigits(lq.rho || 1000)}`, x + w / 2, baseY - h - 10, tt['--text-primary'], 10);
      });
      // connector
      ctx.strokeStyle = tt['--border-strong'];
      ctx.beginPath(); ctx.moveTo(x0, baseY + 16); ctx.lineTo(x0 + (n - 1) * (w + 24) + w, baseY + 16); ctx.stroke();
      for (let i = 0; i < n; i++) {
        const x = x0 + i * (w + 24);
        ctx.beginPath(); ctx.moveTo(x + w / 2, baseY); ctx.lineTo(x + w / 2, baseY + 16); ctx.stroke();
      }
    },
    telemetry() {
      return liquids.map((lq, i) => [`P${toPersianDigits(i + 1)}`, formatNumber((lq.rho || 1000) * 9.8 * (lq.h || 30) / 100 / 1000, 2, false) + ' kPa']);
    },
  };
}

/* ---------------- registry ---------------- */

const SIMS = {
  projectile: simProjectile,
  forces: simForces,
  pendulum: simPendulum,
  spring: simSpring,
  collision: simCollision,
  kinematics1d: simKinematics1d,
  circular: simCircular,
  wave: simWave,
  circuit: simCircuit,
  optics: simOptics,
  gas_laws: simGasLaws,
  buoyancy: simBuoyancy,
  electric_field: simElectricField,
  capacitor: simCapacitor,
  magnetic_field: simLorentz,
  lorentz: simLorentz,
  faraday: simFaraday,
  incline_friction: simInclineFriction,
  doppler: simDoppler,
  photoelectric: simPhotoelectric,
  u_tube: simUTube,
  manometer_tanks: simManometerTanks,
  tube_system: simTubeSystem,
};

/* ---------------- card renderer ---------------- */

export function renderPhysicsCard(spec, opts = {}) {
  injectCss();
  const factory = SIMS[spec.type] || simProjectile;
  const card = el('div', 'iw-card interactive-physics-card');
  card.setAttribute('data-spec', spec.rawText || '');

  const sim = factory(spec);
  let engine = null;

  const { header } = buildHeader({
    title: spec.title, badgeIcon: 'science',
    buttons: [
      {
        icon: 'fullscreen', title: 'تمام‌صفحه',
        onClick: () => openFullscreen({
          title: spec.title, badgeIcon: 'science',
          renderBody: (body) => { const c = renderPhysicsCard({ ...spec }, opts); c.style.margin = '0'; body.appendChild(c); body.style.overflow = 'auto'; },
        }),
      },
    ],
  });
  card.appendChild(header);

  const stage = el('div', 'iw-stage');
  stage.style.aspectRatio = '4 / 3';
  stage.style.maxHeight = '360px';
  card.appendChild(stage);

  const controlsRow = el('div', 'iw-controls');
  controlsRow.style.justifyContent = 'space-between';
  const telemetryEl = el('div', 'iw-telemetry');
  const transport = buildTransport({
    onPlay: () => engine && engine.play(),
    onPause: () => engine && engine.pause(),
    onRestart: () => engine && engine.restart(),
    onSpeed: (s) => engine && engine.setSpeed(s),
  });
  controlsRow.append(transport.wrap, telemetryEl);
  card.appendChild(controlsRow);

  if (sim.sliders && sim.sliders.length) {
    const panel = el('div', 'iw-panel');
    sim.sliders.forEach((sd) => {
      const s = buildSlider({
        label: sd.label, min: sd.min, max: sd.max, step: sd.step, value: sim.state[sd.key],
        onInput: (v) => {
          sim.state[sd.key] = v;
          if (sd.restart && engine) engine.restart();
          else if (sim.reset && !sd.restart) { /* live */ }
          if (sim.reset && !sd.restart && sim.update.length === 0) sim.reset();
        },
      });
      panel.appendChild(s.row);
    });
    card.appendChild(panel);
  }

  engine = makeEngine(stage, sim, {
    telemetry(items) {
      telemetryEl.innerHTML = items.map(([k, v]) =>
        `<span class="iw-telem-item"><span class="k">${k}</span><span class="v">${toPersianDigits(String(v))}</span></span>`
      ).join('');
    },
  });
  // keep engine transport in sync when paused by overlay etc.
  return card;
}

export function initPhysicsSimulations(parent, opts = {}) {
  parent.querySelectorAll('.interactive-physics-card').forEach((old) => {
    const specStr = old.getAttribute('data-spec') || '';
    const spec = parsePhysicsSpec(specStr);
    spec.rawText = specStr;
    old.replaceWith(renderPhysicsCard(spec, opts));
  });
}
