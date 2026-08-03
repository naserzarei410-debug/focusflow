/**
 * Pomodoro Focus Timer — standalone feature.
 * Pure vanilla JS + localStorage only. Reached from the Home page as a secondary route.
 * npm packages), so it's guaranteed to work the same after being wrapped
 */
import { router } from '../core/router.js';
import { showToast } from '../core/ui.js';

const KEYS = {
  focus: 'pomodoro_focus_min',
  short: 'pomodoro_break_min',
  long: 'pomodoro_long_break_min',
  cycles: 'pomodoro_cycles',
  stats: 'pomodoro_stats',
  runtime: 'pomodoro_runtime_state',
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
  phaseEndsAt: null,
};
state.secondsLeft = state.focusMin * 60;
state.totalSeconds = state.secondsLeft;

/** Writes the live session (phase, time left, cycles done) to localStorage. */
function persistRuntimeState() {
  try {
    localStorage.setItem(KEYS.runtime, JSON.stringify({
      mode: state.mode,
      secondsLeft: state.secondsLeft,
      totalSeconds: state.totalSeconds,
      completedInCycle: state.completedInCycle,
      isRunning: state.isRunning,
      phaseEndsAt: state.phaseEndsAt,
    }));
  } catch (e) { /* localStorage unavailable — non-critical */ }
}

/**
 * Restores an in-progress session after the app was fully closed and
 * reopened. If the timer was running, the remaining time is derived from
 * the saved wall-clock end timestamp (same trick used for backgrounding),
 * so time that passed while the app was closed is accounted for. If the
 * phase had already finished while closed, the session is left paused at
 * 0:00 on that phase instead of silently firing chimes/toasts for an
 * event that happened in the past — the user presses skip/start to move
 * on themselves.
 */
function loadPersistedState() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(KEYS.runtime) || 'null'); } catch (e) { saved = null; }
  if (!saved || typeof saved !== 'object' || !saved.mode) return;

  state.mode = saved.mode;
  state.completedInCycle = Number.isFinite(saved.completedInCycle) ? saved.completedInCycle : 0;
  state.totalSeconds = Number.isFinite(saved.totalSeconds) ? saved.totalSeconds : state.totalSeconds;

  if (saved.isRunning && saved.phaseEndsAt) {
    const remaining = Math.round((saved.phaseEndsAt - Date.now()) / 1000);
    if (remaining > 0) {
      state.secondsLeft = remaining;
      state.phaseEndsAt = saved.phaseEndsAt;
      state.isRunning = true;
      state.timerInterval = setInterval(globalTick, 1000);
    } else {
      state.secondsLeft = 0;
      state.isRunning = false;
      state.phaseEndsAt = null;
    }
  } else {
    state.secondsLeft = Number.isFinite(saved.secondsLeft) ? saved.secondsLeft : state.totalSeconds;
    state.isRunning = false;
    state.phaseEndsAt = null;
  }
}
loadPersistedState();

let activeUiCallback = null;

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.isRunning) {
    globalTick();
  } else if (document.visibilityState === 'hidden') {
    persistRuntimeState();
  }
});
window.addEventListener('pagehide', persistRuntimeState);

function globalTick() {
  if (state.phaseEndsAt) {
    state.secondsLeft = Math.max(0, Math.round((state.phaseEndsAt - Date.now()) / 1000));
  } else {
    state.secondsLeft -= 1;
  }
  if (state.secondsLeft <= 0) {
    completePhase();
  } else {
    if (activeUiCallback) activeUiCallback();
    if (state.secondsLeft % 10 === 0) persistRuntimeState();
  }
}

function completePhase() {
  state.isRunning = false;
  clearInterval(state.timerInterval);
  playChime();
  if (navigator.vibrate) navigator.vibrate(state.mode === 'focus' ? [200, 100, 200] : [120]);

  const todayStats = getTodayStats();

  if (state.mode === 'focus') {
    todayStats.completed += 1;
    todayStats.focusMinutes += state.focusMin;
    saveTodayStats(todayStats);
    state.completedInCycle += 1;

    if (state.completedInCycle >= state.cyclesBeforeLong) {
      showToast('یک دوره‌ی تمرکز دیگر تمام شد — وقت یک استراحت بلند است!', 'success');
      state.completedInCycle = 0;
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

function setPhase(mode, autoStart) {
  state.mode = mode;
  const minutesByMode = { focus: state.focusMin, short: state.shortMin, long: state.longMin };
  state.totalSeconds = minutesByMode[mode] * 60;
  state.secondsLeft = state.totalSeconds;
  
  if (autoStart) {
    startGlobal();
  } else {
    pauseGlobal();
  }
  
  if (activeUiCallback) activeUiCallback(true);
  persistRuntimeState();
}

function startGlobal() {
  if (state.isRunning) return;
  state.isRunning = true;
  state.phaseEndsAt = Date.now() + state.secondsLeft * 1000;
  state.timerInterval = setInterval(globalTick, 1000);
  if (activeUiCallback) activeUiCallback(true);
  persistRuntimeState();
}

function pauseGlobal() {
  state.isRunning = false;
  state.phaseEndsAt = null;
  clearInterval(state.timerInterval);
  if (activeUiCallback) activeUiCallback(true);
  persistRuntimeState();
}

export function renderPomodoro(container) {
  container.innerHTML = '';
  
  const todayStats = getTodayStats();

  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex; flex-direction:column; gap:var(--space-3); width:100%; max-width:var(--max-content-w); margin:0 auto;';
  container.appendChild(wrap);

  const modeBadge = document.createElement('div');
  modeBadge.style.cssText = 'align-self:center; display:inline-flex; align-items:center; gap:6px; padding:6px 16px; border-radius:var(--radius-pill); font-size:13px; font-weight:800;';
  wrap.appendChild(modeBadge);

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

  const dotsRow = document.createElement('div');
  dotsRow.style.cssText = 'display:flex; gap:8px;';
  timerCard.appendChild(dotsRow);

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


  function showCustomNumberDialog(title, onConfirm) {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); display:flex; justify-content:center; align-items:center; z-index:9999; backdrop-filter:blur(4px); opacity:0; transition:opacity 0.2s ease;';
    
    const dialog = document.createElement('div');
    dialog.style.cssText = 'background:var(--bg-card); padding:var(--space-4); border-radius:24px; box-shadow:0 8px 32px rgba(0,0,0,0.1); display:flex; flex-direction:column; align-items:center; gap:var(--space-3); width:280px; max-width:90%; transform:scale(0.9); opacity:0; transition:all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275); direction:rtl;';
    
    const titleEl = document.createElement('h3');
    titleEl.style.cssText = 'margin:0; font-size:16px; font-weight:800; color:var(--text-primary); text-align:center;';
    titleEl.textContent = title;
    
    const inputWrapper = document.createElement('div');
    inputWrapper.style.cssText = 'position:relative; width:100px; height:100px; margin:0 auto;';
    
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '1';
    input.max = '999';
    input.style.cssText = 'width:100%; height:100%; padding:0; font-size:32px; font-weight:800; text-align:center; border:2px solid var(--border-soft); border-radius:50%; background:var(--bg-sunken); color:var(--color-primary); box-sizing:border-box; outline:none; transition:border-color 0.2s; -moz-appearance:textfield;';
    
    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex; gap:var(--space-2); margin-top:var(--space-2); width:100%;';
    
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn btn-outline';
    cancelBtn.style.flex = '1';
    cancelBtn.textContent = 'انصراف';
    
    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'btn btn-primary';
    confirmBtn.style.flex = '1';
    confirmBtn.textContent = 'تایید';
    
    btnRow.append(cancelBtn, confirmBtn);
    dialog.append(titleEl, inputWrapper, btnRow);
    inputWrapper.appendChild(input);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    
    const style = document.createElement('style');
    style.textContent = `
      input[type=number]::-webkit-inner-spin-button, 
      input[type=number]::-webkit-outer-spin-button { 
        -webkit-appearance: none; 
        margin: 0; 
      }
    `;
    overlay.appendChild(style);

    requestAnimationFrame(() => {
      overlay.style.opacity = '1';
      dialog.style.opacity = '1';
      dialog.style.transform = 'scale(1)';
      input.focus();
    });
    
    const close = () => {
      overlay.style.opacity = '0';
      dialog.style.transform = 'scale(0.9)';
      dialog.style.opacity = '0';
      setTimeout(() => overlay.remove(), 200);
    };
    
    cancelBtn.onclick = close;
    overlay.onclick = (e) => { if(e.target === overlay) close(); };
    confirmBtn.onclick = () => {
      const val = parseInt(input.value, 10);
      if (!isNaN(val) && val > 0) {
        onConfirm(val);
        close();
      } else {
        input.style.borderColor = 'var(--color-danger)';
        setTimeout(() => input.style.borderColor = 'var(--border-soft)', 1000);
      }
    };
    input.onkeydown = (e) => {
      if (e.key === 'Enter') confirmBtn.click();
      if (e.key === 'Escape') cancelBtn.click();
    };
  }

  function makePicker(labelText, defaultOptions, current, customKey, onPick) {
    const box = document.createElement('div');
    box.style.cssText = 'display:flex; flex-direction:column; gap:4px;';
    const lbl = document.createElement('span');
    lbl.style.cssText = 'font-size:11px; color:var(--text-tertiary); font-weight:600;';
    lbl.textContent = labelText;
    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex; flex-wrap:wrap; gap:4px; align-items:center;';

    let customOptions = [];
    if (customKey) {
      try { customOptions = JSON.parse(localStorage.getItem(customKey)) || []; } catch(e){}
    }
    const allOptions = Array.from(new Set([...defaultOptions, ...customOptions])).sort((a,b)=>a-b);

    allOptions.forEach((val) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      const active = val === current;
      chip.style.cssText = `padding:5px 10px; border-radius:var(--radius-pill); font-size:12px; font-weight:700; cursor:pointer; border:1.5px solid ${active ? 'var(--color-primary)' : 'var(--border-soft)'}; background:${active ? 'var(--color-primary-soft)' : 'var(--bg-card)'}; color:${active ? 'var(--color-primary)' : 'var(--text-secondary)'}; transition:all 0.2s;`;
      chip.textContent = val.toLocaleString('fa-IR');
      chip.addEventListener('click', () => onPick(val, box));
      btnRow.appendChild(chip);
    });

    if (customKey) {
      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.style.cssText = `padding:0; width:28px; height:28px; display:flex; justify-content:center; align-items:center; border-radius:50%; border:1.5px dashed var(--border-soft); background:transparent; color:var(--text-tertiary); cursor:pointer; transition:all 0.2s;`;
      addBtn.innerHTML = '<span class="material-symbols-rounded" style="font-size:16px;">add</span>';
      addBtn.addEventListener('click', () => {
        showCustomNumberDialog(`زمان دلخواه (${labelText})`, (val) => {
          if (val > 0) {
            customOptions.push(val);
            localStorage.setItem(customKey, JSON.stringify(customOptions));
            onPick(val, box);
            rebuildSettingsGrid();
          }
        });
      });
      btnRow.appendChild(addBtn);
    }

    box.append(lbl, btnRow);
    return box;
  }


  function rebuildSettingsGrid() {
    settingsGrid.innerHTML = '';
    settingsGrid.appendChild(makePicker('تمرکز', [15, 20, 25, 30, 45, 50, 60], state.focusMin, 'custom_focus', (val) => {
      state.focusMin = val;
      localStorage.setItem(KEYS.focus, String(val));
      if (!state.isRunning && state.mode === 'focus') setPhase('focus', false);
      rebuildSettingsGrid();
    }));
    settingsGrid.appendChild(makePicker('استراحت کوتاه', [5, 10, 15], state.shortMin, 'custom_short', (val) => {
      state.shortMin = val;
      localStorage.setItem(KEYS.short, String(val));
      if (!state.isRunning && state.mode === 'short') setPhase('short', false);
      rebuildSettingsGrid();
    }));
    settingsGrid.appendChild(makePicker('استراحت بلند', [15, 20, 30], state.longMin, 'custom_long', (val) => {
      state.longMin = val;
      localStorage.setItem(KEYS.long, String(val));
      if (!state.isRunning && state.mode === 'long') setPhase('long', false);
      rebuildSettingsGrid();
    }));
    settingsGrid.appendChild(makePicker('تعداد چرخه', [2, 3, 4, 5, 6], state.cyclesBeforeLong, 'custom_cycles', (val) => {
      state.cyclesBeforeLong = val;
      localStorage.setItem(KEYS.cycles, String(val));
      renderDots();
      rebuildSettingsGrid();
    }));
  }
  rebuildSettingsGrid();

  const infoCard = document.createElement('div');
  infoCard.style.cssText = 'display:flex; align-items:flex-start; gap:var(--space-2); padding:var(--space-3); border-radius:var(--radius-card); background:var(--color-primary-soft); color:var(--text-secondary); font-size:12px; line-height:1.7; text-align:right;';
  infoCard.innerHTML = '<span class="material-symbols-rounded" style="font-size:18px; color:var(--color-primary); flex-shrink:0;">info</span><span>در تکنیک پومودورو، دوره‌های کوتاه تمرکز کامل (بدون گوشی و حواس‌پرتی) با استراحت‌های کوتاه جایگزین می‌شوند. بعد از چند دوره، یک استراحت بلندتر می‌گیرید.</span>';
  wrap.appendChild(infoCard);

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

  function updateStartPauseBtn() {
    startPauseBtn.innerHTML = `<span class="material-symbols-rounded" style="font-size:32px;">${state.isRunning ? 'pause' : 'play_arrow'}</span>`;
    startPauseBtn.style.background = state.isRunning ? 'var(--color-secondary)' : 'var(--color-primary)';
  }

  activeUiCallback = (phaseChanged = false) => {
    if (phaseChanged) {
      applyModeStyles();
      renderDots();
    }
    renderTick();
    updateStartPauseBtn();
    renderTodayStats();
  };

  startPauseBtn.addEventListener('click', () => {
    if (state.isRunning) pauseGlobal(); else startGlobal();
  });

  resetBtn.addEventListener('click', () => {
    setPhase(state.mode, false);
  });

  skipBtn.addEventListener('click', () => {
    clearInterval(state.timerInterval);
    if (state.mode === 'focus') {
      setPhase('short', false);
    } else {
      setPhase('focus', false);
    }
  });

  window.addEventListener('hashchange', () => {
    activeUiCallback = null;
  }, { once: true });

  applyModeStyles();
  renderTick();
  renderDots();
  updateStartPauseBtn();
}
