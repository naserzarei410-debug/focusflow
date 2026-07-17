/**
 * Pomodoro Focus Timer — standalone feature.
 * Pure vanilla JS + localStorage only (no IndexedDB schema change, no new
 * npm packages), so it's guaranteed to work the same after being wrapped
 * into an offline APK. Reached from the Home page as a secondary route.
 */
import { router } from '../core/router.js';
import { showToast } from '../core/ui.js';

const KEYS = {
  focus: 'pomodoro_focus_min',
  short: 'pomodoro_break_min',
  long: 'pomodoro_long_break_min',
  cycles: 'pomodoro_cycles',
  stats: 'pomodoro_stats',
};

function getSetting(key, fallback) {
  const raw = localStorage.getItem(key);
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getTodayStats() {
  let stats = null;
  try { stats = JSON.parse(localStorage.getItem(KEYS.stats) || 'null'); } catch (e) { stats = null; }
  if (!stats || stats.date !== todayStr()) {
    stats = { date: todayStr(), completed: 0, focusMinutes: 0 };
  }
  return stats;
}

function saveTodayStats(stats) {
  localStorage.setItem(KEYS.stats, JSON.stringify(stats));
}

/** Short offline beep via Web Audio API — no audio file needed. */
function playChime() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    [880, 1320].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.connect(ctx.destination);
      const startAt = ctx.currentTime + i * 0.16;
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(0.18, startAt + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.32);
      osc.start(startAt);
      osc.stop(startAt + 0.34);
    });
    setTimeout(() => ctx.close(), 900);
  } catch (e) { /* silent — non-critical */ }
}

function formatTime(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

const MODE_META = {
  focus: { label: 'زمان تمرکز', color: 'var(--color-primary)', icon: 'auto_awesome' },
  short: { label: 'استراحت کوتاه', color: 'var(--color-success)', icon: 'local_cafe' },
  long: { label: 'استراحت بلند', color: 'var(--color-success)', icon: 'celebration' },
};

export function renderPomodoro(container) {
  container.innerHTML = '';

  const state = {
    focusMin: getSetting(KEYS.focus, 25),
    shortMin: getSetting(KEYS.short, 5),
    longMin: getSetting(KEYS.long, 15),
    cyclesBeforeLong: getSetting(KEYS.cycles, 4),
    mode: 'focus',
    secondsLeft: 0,
    totalSeconds: 0,
    isRunning: false,
    completedInCycle: 0,
    timerInterval: null,
  };
  state.secondsLeft = state.focusMin * 60;
  state.totalSeconds = state.secondsLeft;

  const todayStats = getTodayStats();

  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex; flex-direction:column; gap:var(--space-3); width:100%; max-width:var(--max-content-w); margin:0 auto;';
  container.appendChild(wrap);

  // ── Mode badge ──
  const modeBadge = document.createElement('div');
  modeBadge.style.cssText = 'align-self:center; display:inline-flex; align-items:center; gap:6px; padding:6px 16px; border-radius:var(--radius-pill); font-size:13px; font-weight:800;';
  wrap.appendChild(modeBadge);

  // ── Timer card with ring ──
  const timerCard = document.createElement('div');
  timerCard.className = 'ds-card';
  timerCard.style.cssText = 'padding:var(--space-5); display:flex; flex-direction:column; align-items:center; gap:var(--space-3);';
  wrap.appendChild(timerCard);

  const RADIUS = 100;
  const STROKE = 12;
  const R = RADIUS - STROKE;
  const CIRCUMFERENCE = 2 * Math.PI * R;

  const ringWrapper = document.createElement('div');
  ringWrapper.style.cssText = `position:relative; width:${RADIUS * 2}px; height:${RADIUS * 2}px; max-width:80vw; max-height:80vw;`;

  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${RADIUS * 2} ${RADIUS * 2}`);
  svg.style.cssText = 'width:100%; height:100%; transform:rotate(-90deg);';

  const track = document.createElementNS(svgNS, 'circle');
  track.setAttribute('cx', RADIUS); track.setAttribute('cy', RADIUS); track.setAttribute('r', R);
  track.setAttribute('fill', 'none');
  track.setAttribute('stroke', 'var(--border-soft)');
  track.setAttribute('stroke-width', STROKE);
  svg.appendChild(track);

  const fillRing = document.createElementNS(svgNS, 'circle');
  fillRing.setAttribute('cx', RADIUS); fillRing.setAttribute('cy', RADIUS); fillRing.setAttribute('r', R);
  fillRing.setAttribute('fill', 'none');
  fillRing.setAttribute('stroke-width', STROKE);
  fillRing.setAttribute('stroke-linecap', 'round');
  fillRing.setAttribute('stroke-dasharray', CIRCUMFERENCE.toString());
  fillRing.style.transition = 'stroke-dashoffset 0.9s linear, stroke 0.3s';
  svg.appendChild(fillRing);
  ringWrapper.appendChild(svg);

  const centerBox = document.createElement('div');
  centerBox.style.cssText = 'position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:2px;';
  const timeDisplay = document.createElement('span');
  timeDisplay.style.cssText = 'font-family:var(--font-mono); font-size:40px; font-weight:800; color:var(--text-primary); direction:ltr;';
  const cycleCaption = document.createElement('span');
  cycleCaption.style.cssText = 'font-size:11px; font-weight:700; color:var(--text-tertiary);';
  centerBox.append(timeDisplay, cycleCaption);
  ringWrapper.appendChild(centerBox);

  timerCard.appendChild(ringWrapper);

  // ── Cycle dots ──
  const dotsRow = document.createElement('div');
  dotsRow.style.cssText = 'display:flex; gap:8px;';
  timerCard.appendChild(dotsRow);

  // ── Controls ──
  const controlsRow = document.createElement('div');
  controlsRow.style.cssText = 'display:flex; align-items:center; justify-content:center; gap:var(--space-4);';
  timerCard.appendChild(controlsRow);

  const resetBtn = document.createElement('button');
  resetBtn.className = 'icon-btn';
  resetBtn.setAttribute('aria-label', 'شروع دوباره');
  resetBtn.innerHTML = '<span class="material-symbols-rounded">restart_alt</span>';

  const startPauseBtn = document.createElement('button');
  startPauseBtn.style.cssText = 'width:64px; height:64px; border-radius:50%; border:none; display:flex; align-items:center; justify-content:center; cursor:pointer; box-shadow:var(--shadow-md); background:var(--color-primary); color:var(--text-on-primary);';
  startPauseBtn.innerHTML = '<span class="material-symbols-rounded" style="font-size:32px;">play_arrow</span>';

  const skipBtn = document.createElement('button');
  skipBtn.className = 'icon-btn';
  skipBtn.setAttribute('aria-label', 'رد کردن این مرحله');
  skipBtn.innerHTML = '<span class="material-symbols-rounded">skip_next</span>';

  controlsRow.append(resetBtn, startPauseBtn, skipBtn);

  // ── Today stats ──
  const statsCard = document.createElement('div');
  statsCard.className = 'ds-card';
  statsCard.style.cssText = 'padding:var(--space-3); display:flex; justify-content:space-around; text-align:center;';
  const statCompleted = document.createElement('div');
  const statMinutes = document.createElement('div');
  [statCompleted, statMinutes].forEach((el) => {
    el.style.cssText = 'display:flex; flex-direction:column; gap:2px;';
  });
  statsCard.append(statCompleted, statMinutes);
  wrap.appendChild(statsCard);

  function renderTodayStats() {
    statCompleted.innerHTML = `<span style="font-size:var(--text-title); font-weight:800; color:var(--color-primary);">${todayStats.completed.toLocaleString('fa-IR')}</span><span style="font-size:11px; color:var(--text-tertiary); font-weight:600;">پومودورو تکمیل‌شده امروز</span>`;
    statMinutes.innerHTML = `<span style="font-size:var(--text-title); font-weight:800; color:var(--color-accent);">${todayStats.focusMinutes.toLocaleString('fa-IR')}</span><span style="font-size:11px; color:var(--text-tertiary); font-weight:600;">دقیقه تمرکز امروز</span>`;
  }
  renderTodayStats();

  // ── Settings ──
  const settingsCard = document.createElement('div');
  settingsCard.className = 'ds-card';
  settingsCard.style.cssText = 'padding:var(--space-3); display:flex; flex-direction:column; gap:var(--space-3); text-align:right;';

  const settingsHeader = document.createElement('div');
  settingsHeader.style.cssText = 'display:flex; align-items:center; gap:var(--space-2); font-weight:800; font-size:13px; color:var(--text-secondary);';
  settingsHeader.innerHTML = '<span class="material-symbols-rounded" style="font-size:18px;">tune</span><span>تنظیمات زمان‌بندی</span>';
  settingsCard.appendChild(settingsHeader);

  const settingsGrid = document.createElement('div');
  settingsGrid.style.cssText = 'display:grid; grid-template-columns:1fr 1fr; gap:var(--space-2);';
  settingsCard.appendChild(settingsGrid);
  wrap.appendChild(settingsCard);

  function makePicker(labelText, options, current, onPick) {
    const box = document.createElement('div');
    box.style.cssText = 'display:flex; flex-direction:column; gap:4px;';
    const lbl = document.createElement('span');
    lbl.style.cssText = 'font-size:11px; color:var(--text-tertiary); font-weight:600;';
    lbl.textContent = labelText;
    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex; flex-wrap:wrap; gap:4px;';
    options.forEach((val) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      const active = val === current;
      chip.style.cssText = `padding:5px 10px; border-radius:var(--radius-pill); font-size:12px; font-weight:700; cursor:pointer; border:1.5px solid ${active ? 'var(--color-primary)' : 'var(--border-soft)'}; background:${active ? 'var(--color-primary-soft)' : 'var(--bg-card)'}; color:${active ? 'var(--color-primary)' : 'var(--text-secondary)'};`;
      chip.textContent = val.toLocaleString('fa-IR');
      chip.addEventListener('click', () => onPick(val, box));
      btnRow.appendChild(chip);
    });
    box.append(lbl, btnRow);
    return box;
  }

  function rebuildSettingsGrid() {
    settingsGrid.innerHTML = '';
    settingsGrid.appendChild(makePicker('تمرکز (دقیقه)', [15, 20, 25, 30, 45, 50, 60], state.focusMin, (val) => {
      state.focusMin = val;
      localStorage.setItem(KEYS.focus, String(val));
      if (!state.isRunning && state.mode === 'focus') setPhase('focus', false);
      rebuildSettingsGrid();
    }));
    settingsGrid.appendChild(makePicker('استراحت کوتاه (دقیقه)', [5, 10, 15], state.shortMin, (val) => {
      state.shortMin = val;
      localStorage.setItem(KEYS.short, String(val));
      if (!state.isRunning && state.mode === 'short') setPhase('short', false);
      rebuildSettingsGrid();
    }));
    settingsGrid.appendChild(makePicker('استراحت بلند (دقیقه)', [15, 20, 30], state.longMin, (val) => {
      state.longMin = val;
      localStorage.setItem(KEYS.long, String(val));
      if (!state.isRunning && state.mode === 'long') setPhase('long', false);
      rebuildSettingsGrid();
    }));
    settingsGrid.appendChild(makePicker('چرخه تا استراحت بلند', [2, 3, 4, 5, 6], state.cyclesBeforeLong, (val) => {
      state.cyclesBeforeLong = val;
      localStorage.setItem(KEYS.cycles, String(val));
      renderDots();
      rebuildSettingsGrid();
    }));
  }
  rebuildSettingsGrid();

  // ── Info card explaining the technique (helps students unfamiliar with it) ──
  const infoCard = document.createElement('div');
  infoCard.style.cssText = 'display:flex; align-items:flex-start; gap:var(--space-2); padding:var(--space-3); border-radius:var(--radius-card); background:var(--color-primary-soft); color:var(--text-secondary); font-size:12px; line-height:1.7; text-align:right;';
  infoCard.innerHTML = '<span class="material-symbols-rounded" style="font-size:18px; color:var(--color-primary); flex-shrink:0;">info</span><span>در تکنیک پومودورو، دوره‌های کوتاه تمرکز کامل (بدون گوشی و حواس‌پرتی) با استراحت‌های کوتاه جایگزین می‌شوند. بعد از چند دوره، یک استراحت بلندتر می‌گیرید.</span>';
  wrap.appendChild(infoCard);

  // ── Render helpers ──
  function renderDots() {
    dotsRow.innerHTML = '';
    for (let i = 0; i < state.cyclesBeforeLong; i++) {
      const dot = document.createElement('span');
      const filled = i < state.completedInCycle;
      dot.style.cssText = `width:9px; height:9px; border-radius:50%; background:${filled ? 'var(--color-primary)' : 'var(--border-soft)'}; transition:background 0.3s;`;
      dotsRow.appendChild(dot);
    }
  }

  function renderTick() {
    timeDisplay.textContent = formatTime(state.secondsLeft);
    const progress = state.totalSeconds > 0 ? state.secondsLeft / state.totalSeconds : 0;
    const offset = CIRCUMFERENCE * (1 - progress);
    fillRing.setAttribute('stroke-dashoffset', offset.toString());
  }

  function applyModeStyles() {
    const meta = MODE_META[state.mode];
    modeBadge.style.background = state.mode === 'focus' ? 'var(--color-primary-soft)' : 'var(--color-success-soft)';
    modeBadge.style.color = meta.color;
    modeBadge.innerHTML = `<span class="material-symbols-rounded" style="font-size:16px;">${meta.icon}</span><span>${meta.label}</span>`;
    fillRing.setAttribute('stroke', meta.color);
    cycleCaption.textContent = `دور ${(state.completedInCycle + 1).toLocaleString('fa-IR')} از ${state.cyclesBeforeLong.toLocaleString('fa-IR')}`;
  }

  function setPhase(mode, autoStart) {
    state.mode = mode;
    const minutesByMode = { focus: state.focusMin, short: state.shortMin, long: state.longMin };
    state.totalSeconds = minutesByMode[mode] * 60;
    state.secondsLeft = state.totalSeconds;
    applyModeStyles();
    renderTick();
    renderDots();
    if (autoStart) start(); else pause();
  }

  function updateStartPauseBtn() {
    startPauseBtn.innerHTML = `<span class="material-symbols-rounded" style="font-size:32px;">${state.isRunning ? 'pause' : 'play_arrow'}</span>`;
    startPauseBtn.style.background = state.isRunning ? 'var(--color-secondary)' : 'var(--color-primary)';
  }

  function tick() {
    state.secondsLeft -= 1;
    if (state.secondsLeft <= 0) {
      completePhase();
      return;
    }
    renderTick();
  }

  function completePhase() {
    clearInterval(state.timerInterval);
    playChime();
    if (navigator.vibrate) navigator.vibrate(state.mode === 'focus' ? [200, 100, 200] : [120]);

    if (state.mode === 'focus') {
      todayStats.completed += 1;
      todayStats.focusMinutes += state.focusMin;
      saveTodayStats(todayStats);
      renderTodayStats();
      state.completedInCycle += 1;

      if (state.completedInCycle >= state.cyclesBeforeLong) {
        showToast('یک دوره‌ی تمرکز دیگر تمام شد — وقت یک استراحت بلند است!', 'success');
        state.completedInCycle = 0; // reset after the long break kicks in
        setPhase('long', true);
      } else {
        showToast('یک پومودورو تمام شد — چند دقیقه استراحت کنید.', 'success');
        setPhase('short', true);
      }
    } else {
      showToast('استراحت تمام شد — وقت تمرکز دوباره است!', 'info');
      setPhase('focus', true);
    }
  }

  function start() {
    if (state.isRunning) return;
    state.isRunning = true;
    updateStartPauseBtn();
    state.timerInterval = setInterval(tick, 1000);
  }

  function pause() {
    state.isRunning = false;
    updateStartPauseBtn();
    clearInterval(state.timerInterval);
  }

  startPauseBtn.addEventListener('click', () => {
    if (state.isRunning) pause(); else start();
  });

  resetBtn.addEventListener('click', () => {
    setPhase(state.mode, false);
  });

  skipBtn.addEventListener('click', () => {
    clearInterval(state.timerInterval);
    if (state.mode === 'focus') {
      // Skipping focus doesn't count it as completed — go straight to a short break.
      setPhase(state.completedInCycle + 1 >= state.cyclesBeforeLong ? 'focus' : 'short', false);
    } else {
      setPhase('focus', false);
    }
  });

  // Stop the countdown if the user navigates away any other way (bottom
  // nav, hardware back, etc.) so it can't keep firing after this screen
  // is gone — same safety pattern used by the exam timer.
  window.addEventListener('hashchange', () => {
    clearInterval(state.timerInterval);
  }, { once: true });

  applyModeStyles();
  renderTick();
  renderDots();
  updateStartPauseBtn();
}
