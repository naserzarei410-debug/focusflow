/**
 * Pomodoro Focus Timer — standalone feature.
 * Pure vanilla JS + localStorage only. Reached from the Home page as a secondary route.
 */
import { router } from '../core/router.js';
import { showToast, createSelectField } from '../core/ui.js';
import { schedulePomodoroEndNotification, cancelPomodoroNotification } from '../core/notifications.js';
import { getSubjectsSorted } from '../core/planner-data.js';

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
  if (!stats || typeof stats !== 'object') {
    stats = { date: todayStr(), completed: 0, focusMinutes: 0, byDate: {} };
  }
  if (!stats.byDate || typeof stats.byDate !== 'object') stats.byDate = {};
  const today = todayStr();
  if (stats.date !== today) {
    // Archive the previous day before rolling over so the study calendar
    // can still colour cells for past focus sessions.
    if (stats.date && ((stats.completed || 0) > 0 || (stats.focusMinutes || 0) > 0)) {
      stats.byDate[stats.date] = {
        completed: stats.completed || 0,
        focusMinutes: stats.focusMinutes || 0,
      };
    }
    const archived = stats.byDate[today] || { completed: 0, focusMinutes: 0 };
    stats.date = today;
    stats.completed = archived.completed || 0;
    stats.focusMinutes = archived.focusMinutes || 0;
    // Persist the rollover immediately — otherwise a read-only visit (e.g. stats
    // page) would lose the archived day when the process is killed.
    try {
      localStorage.setItem(KEYS.stats, JSON.stringify(stats));
    } catch (e) { /* quota / private mode */ }
  }
  return stats;
}

function saveTodayStats(stats) {
  if (!stats || typeof stats !== 'object') return;
  if (!stats.byDate || typeof stats.byDate !== 'object') stats.byDate = {};
  const day = stats.date || todayStr();
  stats.byDate[day] = {
    completed: stats.completed || 0,
    focusMinutes: stats.focusMinutes || 0,
  };
  // Keep calendar history bounded (≈ 18 months) to avoid localStorage growth.
  const keys = Object.keys(stats.byDate).sort();
  const maxDays = 560;
  if (keys.length > maxDays) {
    for (const k of keys.slice(0, keys.length - maxDays)) {
      delete stats.byDate[k];
    }
  }
  try {
    localStorage.setItem(KEYS.stats, JSON.stringify(stats));
  } catch (e) { /* quota */ }
}

/** Map of YYYY-MM-DD -> { completed, focusMinutes } including today. */
export function getPomodoroFocusByDate() {
  const stats = getTodayStats();
  const map = { ...(stats.byDate || {}) };
  map[stats.date || todayStr()] = {
    completed: stats.completed || 0,
    focusMinutes: stats.focusMinutes || 0,
  };
  return map;
}

let sharedAudioCtx = null;

function initAudio() {
  try {
    if (!sharedAudioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) sharedAudioCtx = new Ctx();
    }
    if (sharedAudioCtx && sharedAudioCtx.state === 'suspended') {
      sharedAudioCtx.resume();
    }
  } catch (e) { /* ignore */ }
}

/** Short offline beep via Web Audio API — no audio file needed. */
function playChime() {
  try {
    if (!sharedAudioCtx) initAudio();
    if (!sharedAudioCtx) return;
    if (sharedAudioCtx.state === 'suspended') sharedAudioCtx.resume();

    const ctx = sharedAudioCtx;
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
  /** Absolute wall-clock timestamp (ms) when the current phase ends. Source of truth. */
  phaseEndsAt: null,
  /** Optional planner subject id this focus session is "for" — drives the
   *  post-session "add this time to the weekly planner?" prompt. */
  selectedSubjectId: null,
};
state.secondsLeft = state.focusMin * 60;
state.totalSeconds = state.secondsLeft;

let activeUiCallback = null;
let wakeLock = null;
let onFocusCompletedCallback = null;

/** Registers a callback fired right after a *live* (foreground) focus phase
 *  finishes, but only when the session was linked to a planner subject.
 *  Called as fn(subjectId, focusMinutes). Registered once from app.js. */
export function setOnFocusCompleted(fn) {
  onFocusCompletedCallback = typeof fn === 'function' ? fn : null;
}

export function getSelectedSubjectId() {
  return state.selectedSubjectId;
}

export function setSelectedSubjectId(subjectId) {
  state.selectedSubjectId = subjectId || null;
  persistRuntimeState();
}

function minutesForMode(mode) {
  return { focus: state.focusMin, short: state.shortMin, long: state.longMin }[mode] || state.focusMin;
}

/** Persist live session so time survives screen-off, backgrounding, and process kill. */
function persistRuntimeState() {
  try {
    localStorage.setItem(KEYS.runtime, JSON.stringify({
      mode: state.mode,
      secondsLeft: state.secondsLeft,
      totalSeconds: state.totalSeconds,
      completedInCycle: state.completedInCycle,
      isRunning: state.isRunning,
      phaseEndsAt: state.phaseEndsAt,
      selectedSubjectId: state.selectedSubjectId,
    }));
  } catch (e) { /* non-critical */ }
}

function clearTickInterval() {
  if (state.timerInterval) {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
  }
}

function ensureTickInterval() {
  if (state.timerInterval) return;
  state.timerInterval = setInterval(globalTick, 1000);
}

/**
 * Credit the phase that just finished (stats + cycle counter).
 * @param {boolean} announce - show toast / chime / vibrate (only when app is live)
 */
function creditFinishedPhase(announce) {
  if (state.mode === 'focus') {
    const todayStats = getTodayStats();
    todayStats.completed += 1;
    todayStats.focusMinutes += state.focusMin;
    saveTodayStats(todayStats);
    state.completedInCycle += 1;

    if (state.completedInCycle >= state.cyclesBeforeLong) {
      state.completedInCycle = 0;
      state.mode = 'long';
      if (announce) showToast('یک دوره‌ی تمرکز دیگر تمام شد — وقت یک استراحت بلند است!', 'success');
    } else {
      state.mode = 'short';
      if (announce) showToast('یک پومودورو تمام شد — چند دقیقه استراحت کنید.', 'success');
    }
  } else {
    state.mode = 'focus';
    if (announce) showToast('استراحت تمام شد — وقت تمرکز دوباره است!', 'info');
  }
}

/**
 * Core recovery: advance through every phase that should have finished
 * while the screen was off / app was killed, using wall-clock time.
 * Timeline is continuous from the original phaseEndsAt so multi-hour
 * study sessions are fully credited (not just one phase).
 */
function reconcileFromWallClock(opts = {}) {
  const announce = opts.announce === true;
  if (!state.isRunning || !state.phaseEndsAt) {
    if (state.isRunning && !state.phaseEndsAt && state.secondsLeft > 0) {
      // Recover a corrupted running state without end timestamp
      state.phaseEndsAt = Date.now() + state.secondsLeft * 1000;
    } else {
      return;
    }
  }

  const now = Date.now();
  let finishedCount = 0;
  // Safety: never process more than ~24h of phases in one catch-up
  const maxSteps = 200;

  while (state.phaseEndsAt <= now && finishedCount < maxSteps) {
    // Next phase starts exactly when the previous one ended (continuous timeline)
    const nextStartsAt = state.phaseEndsAt;
    creditFinishedPhase(false);
    finishedCount += 1;

    const durationSec = minutesForMode(state.mode) * 60;
    state.totalSeconds = durationSec;
    state.phaseEndsAt = nextStartsAt + durationSec * 1000;
  }

  state.secondsLeft = Math.max(0, Math.round((state.phaseEndsAt - now) / 1000));

  if (finishedCount > 0) {
    if (announce) {
      playChime();
      if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
      if (finishedCount === 1) {
        // single phase — normal message already covered by credit when announce was false;
        // give a short summary toast for catch-up
        if (state.mode === 'focus') {
          showToast('فاز قبلی تمام شد — زمان تمرکز دوباره.', 'info');
        } else if (state.mode === 'long') {
          showToast('وقت یک استراحت بلند است!', 'success');
        } else {
          showToast('یک پومودورو تمام شد — چند دقیقه استراحت کنید.', 'success');
        }
      } else {
        showToast(
          `${finishedCount.toLocaleString('fa-IR')} فاز در پس‌زمینه تمام شد و آمار به‌روز شد.`,
          'success'
        );
      }
    }
    if (activeUiCallback) activeUiCallback(true);
  } else if (activeUiCallback) {
    activeUiCallback(false);
  }

  ensureTickInterval();
  persistRuntimeState();
  if (state.isRunning && state.phaseEndsAt) {
    schedulePomodoroEndNotification(state.phaseEndsAt, state.mode).catch(() => {});
  }
}

function loadPersistedState() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(KEYS.runtime) || 'null'); } catch (e) { saved = null; }
  if (!saved || typeof saved !== 'object' || !saved.mode) return;

  state.mode = saved.mode;
  state.completedInCycle = Number.isFinite(saved.completedInCycle) ? saved.completedInCycle : 0;
  state.totalSeconds = Number.isFinite(saved.totalSeconds) ? saved.totalSeconds : state.totalSeconds;
  state.selectedSubjectId = saved.selectedSubjectId || null;

  if (saved.isRunning && saved.phaseEndsAt) {
    state.isRunning = true;
    state.phaseEndsAt = saved.phaseEndsAt;
    // Catch up through any phases that finished while the app was dead
    reconcileFromWallClock({ announce: false });
  } else {
    state.secondsLeft = Number.isFinite(saved.secondsLeft) ? saved.secondsLeft : state.totalSeconds;
    state.isRunning = false;
    state.phaseEndsAt = null;
    clearTickInterval();
  }
  persistRuntimeState();
}
loadPersistedState();

/** Re-sync whenever the app becomes visible again (screen on, task switch, unlock). */
function onAppVisible() {
  if (state.isRunning) {
    reconcileFromWallClock({ announce: true });
  }
  tryAcquireWakeLock();
}

function onAppHidden() {
  persistRuntimeState();
  releaseWakeLock();
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') onAppVisible();
  else onAppHidden();
});
window.addEventListener('pageshow', onAppVisible);
window.addEventListener('focus', onAppVisible);
window.addEventListener('pagehide', () => {
  persistRuntimeState();
  releaseWakeLock();
});
// Android WebView sometimes fires freeze/resume
document.addEventListener('freeze', () => persistRuntimeState());
document.addEventListener('resume', onAppVisible);

async function tryAcquireWakeLock() {
  // Optional: reduces aggressive throttling while the app is still in foreground.
  // Does NOT keep the timer alive when the screen is forced off — wall-clock does that.
  if (!state.isRunning) return;
  if (!('wakeLock' in navigator)) return;
  try {
    if (wakeLock && !wakeLock.released) return;
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch (e) { /* permission / policy — ignore */ }
}

function releaseWakeLock() {
  if (wakeLock) {
    try { wakeLock.release(); } catch (e) { /* ignore */ }
    wakeLock = null;
  }
}

function globalTick() {
  if (!state.isRunning) return;

  if (state.phaseEndsAt) {
    state.secondsLeft = Math.max(0, Math.round((state.phaseEndsAt - Date.now()) / 1000));
  } else {
    // Fallback only; should not happen while running
    state.secondsLeft = Math.max(0, state.secondsLeft - 1);
  }

  if (state.secondsLeft <= 0) {
    completePhaseLive();
  } else {
    if (activeUiCallback) activeUiCallback();
    // Persist often so a sudden process kill still has a recent end timestamp
    if (state.secondsLeft % 5 === 0) persistRuntimeState();
  }
}

/** Phase finished while the app is actively running in the foreground. */
function completePhaseLive() {
  clearTickInterval();
  playChime();
  if (navigator.vibrate) navigator.vibrate(state.mode === 'focus' ? [200, 100, 200] : [120]);

  // Use continuous timeline: next phase starts at the scheduled end, not "now",
  // so small timer drift does not accumulate.
  const scheduledEnd = state.phaseEndsAt || Date.now();
  const wasFocusPhase = state.mode === 'focus';
  const justFinishedFocusMinutes = state.focusMin;
  creditFinishedPhase(true);

  if (wasFocusPhase && state.selectedSubjectId && typeof onFocusCompletedCallback === 'function') {
    try {
      onFocusCompletedCallback(state.selectedSubjectId, justFinishedFocusMinutes);
    } catch (e) { console.error('onFocusCompleted callback failed', e); }
  }

  const durationSec = minutesForMode(state.mode) * 60;
  state.totalSeconds = durationSec;
  state.secondsLeft = durationSec;
  state.isRunning = true;
  state.phaseEndsAt = scheduledEnd + durationSec * 1000;

  // If we somehow lagged, catch up immediately
  reconcileFromWallClock({ announce: false });

  ensureTickInterval();
  if (activeUiCallback) activeUiCallback(true);
  persistRuntimeState();
  tryAcquireWakeLock();
}

function setPhase(mode, autoStart) {
  state.mode = mode;
  state.totalSeconds = minutesForMode(mode) * 60;
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
  initAudio();
  if (state.isRunning) {
    // Already running — just re-sync from wall clock
    reconcileFromWallClock({ announce: false });
    if (state.phaseEndsAt) {
      schedulePomodoroEndNotification(state.phaseEndsAt, state.mode).catch(() => {});
    }
    return;
  }
  state.isRunning = true;
  state.phaseEndsAt = Date.now() + state.secondsLeft * 1000;
  ensureTickInterval();
  if (activeUiCallback) activeUiCallback(true);
  persistRuntimeState();
  tryAcquireWakeLock();
  schedulePomodoroEndNotification(state.phaseEndsAt, state.mode).catch(() => {});
}

function pauseGlobal() {
  // Snapshot remaining time from wall clock before clearing the end stamp
  if (state.isRunning && state.phaseEndsAt) {
    state.secondsLeft = Math.max(0, Math.round((state.phaseEndsAt - Date.now()) / 1000));
  }
  state.isRunning = false;
  state.phaseEndsAt = null;
  clearTickInterval();
  releaseWakeLock();
  if (activeUiCallback) activeUiCallback(true);
  persistRuntimeState();
  cancelPomodoroNotification().catch(() => {});
}

export function renderPomodoro(container) {
  // Always re-sync from wall clock when the Pomodoro page is opened
  // (covers screen-off recovery even if visibility events were missed).
  if (state.isRunning) {
    reconcileFromWallClock({ announce: true });
  }

  container.innerHTML = '';
  
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex; flex-direction:column; gap:var(--space-3); width:100%; max-width:var(--max-content-w); margin:0 auto;';
  container.appendChild(wrap);

  const modeBadge = document.createElement('div');
  modeBadge.style.cssText = 'align-self:center; display:inline-flex; align-items:center; gap:6px; padding:6px 16px; border-radius:var(--radius-pill); font-size:13px; font-weight:800;';
  wrap.appendChild(modeBadge);

  // ---- optional: link this focus session to a Weekly Planner subject ----
  const subjectPickerWrap = document.createElement('div');
  subjectPickerWrap.style.cssText = 'padding:0 var(--space-1);';
  wrap.appendChild(subjectPickerWrap);
  (async () => {
    let subjects = [];
    try { subjects = await getSubjectsSorted(); } catch (e) { subjects = []; }
    const options = [
      { value: '', label: 'بدون درس خاص (تمرکز عمومی)' },
      ...subjects.filter((s) => !s.archived).map((s) => ({ value: s.id, label: s.title })),
    ];
    const picker = createSelectField({
      label: 'این تمرکز برای کدام درس است؟',
      hint: 'در صورت انتخاب، پس از پایان هر دورهٔ تمرکز، برای افزودن آن به جدول برنامه‌ریزی هفتگی از شما سؤال می‌شود.',
      options,
      value: state.selectedSubjectId || '',
      onChange: (v) => setSelectedSubjectId(v),
    });
    subjectPickerWrap.appendChild(picker);
  })();

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

  // Always re-read from storage so focus minutes update live when a phase
  // finishes — the previous closed-over snapshot stayed stale until re-entry.
  function renderTodayStats() {
    const s = getTodayStats();
    statCompleted.innerHTML = `<span style="font-size:var(--text-title); font-weight:800; color:var(--color-primary);">${(s.completed || 0).toLocaleString('fa-IR')}</span><span style="font-size:11px; color:var(--text-tertiary); font-weight:600;">پومودورو تکمیل‌شده امروز</span>`;
    statMinutes.innerHTML = `<span style="font-size:var(--text-title); font-weight:800; color:var(--color-accent);">${(s.focusMinutes || 0).toLocaleString('fa-IR')}</span><span style="font-size:11px; color:var(--text-tertiary); font-weight:600;">دقیقه تمرکز امروز</span>`;
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
      try { customOptions = JSON.parse(localStorage.getItem(customKey)) || []; } catch (e) { customOptions = []; }
      customOptions = customOptions.filter((n) => Number.isFinite(n) && n > 0);
    }
    const defaultSet = new Set(defaultOptions);
    const allOptions = Array.from(new Set([...defaultOptions, ...customOptions])).sort((a, b) => a - b);

    function clearChipDeleteModes(exceptChip) {
      btnRow.querySelectorAll('button[data-delete-mode="1"]').forEach((ch) => {
        if (ch === exceptChip) return;
        const v = Number(ch.dataset.value);
        ch.dataset.deleteMode = '0';
        ch.innerHTML = '';
        ch.textContent = v.toLocaleString('fa-IR');
        const isActive = v === current;
        ch.style.borderColor = isActive ? 'var(--color-primary)' : 'var(--border-soft)';
        ch.style.background = isActive ? 'var(--color-primary-soft)' : 'var(--bg-card)';
        ch.style.color = isActive ? 'var(--color-primary)' : 'var(--text-secondary)';
      });
    }

    allOptions.forEach((val) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.dataset.value = String(val);
      const active = val === current;
      // Only user-added values (not in the built-in list) can be deleted
      const isCustom = !!(customKey && customOptions.includes(val) && !defaultSet.has(val));
      chip.style.cssText = `padding:5px 10px; border-radius:var(--radius-pill); font-size:12px; font-weight:700; cursor:pointer; border:1.5px solid ${active ? 'var(--color-primary)' : 'var(--border-soft)'}; background:${active ? 'var(--color-primary-soft)' : 'var(--bg-card)'}; color:${active ? 'var(--color-primary)' : 'var(--text-secondary)'}; transition:all 0.2s; min-width:36px; display:inline-flex; align-items:center; justify-content:center;`;
      chip.textContent = val.toLocaleString('fa-IR');

      let pressTimer = null;
      let longPressed = false;

      const enterDeleteMode = () => {
        if (!isCustom) return;
        clearChipDeleteModes(chip);
        longPressed = true;
        chip.dataset.deleteMode = '1';
        chip.innerHTML = '<span class="material-symbols-rounded" style="font-size:18px;">delete</span>';
        chip.style.borderColor = '#EF4444';
        chip.style.background = 'rgba(239, 68, 68, 0.12)';
        chip.style.color = '#EF4444';
        if (navigator.vibrate) navigator.vibrate(30);
      };

      chip.addEventListener('pointerdown', () => {
        if (!isCustom) return;
        longPressed = false;
        pressTimer = setTimeout(enterDeleteMode, 480);
      });
      const cancelPress = () => {
        if (pressTimer) {
          clearTimeout(pressTimer);
          pressTimer = null;
        }
      };
      chip.addEventListener('pointerup', cancelPress);
      chip.addEventListener('pointerleave', cancelPress);
      chip.addEventListener('pointercancel', cancelPress);

      chip.addEventListener('click', (e) => {
        if (chip.dataset.deleteMode === '1') {
          e.preventDefault();
          e.stopPropagation();
          customOptions = customOptions.filter((v) => v !== val);
          try { localStorage.setItem(customKey, JSON.stringify(customOptions)); } catch (err) { /* ignore */ }
          if (current === val) {
            const fallback = defaultOptions.includes(25) ? 25 : defaultOptions[0];
            onPick(fallback, box);
          }
          showToast('زمان دلخواه حذف شد.', 'info');
          rebuildSettingsGrid();
          return;
        }
        if (longPressed) {
          longPressed = false;
          return;
        }
        onPick(val, box);
      });

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
            if (!customOptions.includes(val)) customOptions.push(val);
            localStorage.setItem(customKey, JSON.stringify(customOptions));
            onPick(val, box);
            rebuildSettingsGrid();
          }
        });
      });
      btnRow.appendChild(addBtn);
    }

    const onDocPointer = (e) => {
      if (!btnRow.contains(e.target)) clearChipDeleteModes(null);
    };
    document.addEventListener('pointerdown', onDocPointer, true);
    box._cleanupDeleteListener = () => document.removeEventListener('pointerdown', onDocPointer, true);

    box.append(lbl, btnRow);
    return box;
  }


  function rebuildSettingsGrid() {
    // Remove previous document listeners attached by makePicker
    Array.from(settingsGrid.children).forEach((child) => {
      if (typeof child._cleanupDeleteListener === 'function') child._cleanupDeleteListener();
    });
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
    // Full session reset: stop timer, zero cycle progress & today's stats, start fresh focus
    pauseGlobal();
    state.completedInCycle = 0;
    const cleared = { date: todayStr(), completed: 0, focusMinutes: 0, byDate: (getTodayStats().byDate || {}) };
    // Zero only today; keep historical byDate for the study calendar.
    cleared.byDate = { ...cleared.byDate, [cleared.date]: { completed: 0, focusMinutes: 0 } };
    saveTodayStats(cleared);
    setPhase('focus', false);
    renderDots();
    renderTodayStats();
    showToast('همه دوره‌ها ریست شد — از ابتدا شروع کنید.', 'info');
  });

  skipBtn.addEventListener('click', () => {
    clearTickInterval();
    state.isRunning = false;
    state.phaseEndsAt = null;
    releaseWakeLock();
    cancelPomodoroNotification().catch(() => {});
    if (state.mode === 'focus') {
      setPhase('short', false);
    } else {
      setPhase('focus', false);
    }
  });

  applyModeStyles();
  renderTick();
  renderDots();
  updateStartPauseBtn();

  // Router calls this cleanup when navigating away (preferred over hashchange-once).
  return function cleanupPomodoroUi() {
    activeUiCallback = null;
    Array.from(settingsGrid.children).forEach((child) => {
      if (typeof child._cleanupDeleteListener === 'function') {
        try { child._cleanupDeleteListener(); } catch (e) { /* ignore */ }
      }
    });
  };
}
